-- =====================================================================
-- Community Foundation — jede Person entscheidet selbst über ihre
-- Sichtbarkeit im Aktivitätsstrom.
--
-- Drei Stufen, jede zeigt strikt weniger als die vorherige:
--   public     Name und Kartenname erscheinen im Feed. Bisheriges Verhalten
--              und deshalb die Vorbelegung — sonst änderte diese Migration
--              stillschweigend, was bereits sichtbar war.
--   anonymous  Der Eintrag erscheint ohne Urheber und ohne Kartendetails.
--              Die Aktivität ist sichtbar, die Person nicht.
--   private    Es entsteht gar kein Eintrag.
--
-- Durchgesetzt wird beim SCHREIBEN, nicht beim Lesen. Jede angemeldete
-- Person darf community_activity direkt lesen (select-Grant plus Policy
-- using(true)); würde nur die Oberfläche filtern, stünden Name und Karte
-- trotzdem für alle abrufbar in der Tabelle. Was nicht entstehen soll, darf
-- gar nicht erst geschrieben werden.
--
-- Die Prüfung sitzt in record_community_activity — dem einzigen Schreibweg.
-- Damit gilt sie auch für Ereignisarten, die spätere Sprints ergänzen, ohne
-- dass jemand daran denken muss.
-- =====================================================================

alter table public.profiles
  add column if not exists community_visibility text not null default 'public';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_community_visibility_check') then
    alter table public.profiles
      add constraint profiles_community_visibility_check
      check (community_visibility in ('public', 'anonymous', 'private'));
  end if;
end;
$$;

create or replace function public.record_community_activity(
  p_actor_id uuid,
  p_kind text,
  p_metadata jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_sicht text;
begin
  if p_kind not in ('card_added', 'deck_created', 'session_started', 'session_joined',
                    'session_ended', 'event_created', 'event_rsvp') then
    raise exception 'Unknown community activity kind';
  end if;

  select community_visibility into v_sicht from public.profiles where id = p_actor_id;
  -- Kein Profil (oder kein Urheber) verhält sich wie die Vorbelegung.
  v_sicht := coalesce(v_sicht, 'public');

  if v_sicht = 'private' then
    return;
  end if;

  if v_sicht = 'anonymous' then
    -- Ohne Urheber und ohne Kartenidentität. Zählwerte bleiben: sie sagen,
    -- dass etwas passiert ist, nicht wer es war oder was es betraf.
    insert into public.community_activity (actor_id, kind, metadata)
      values (null, p_kind, coalesce(p_metadata, '{}'::jsonb) - 'name' - 'img');
    return;
  end if;

  insert into public.community_activity (actor_id, kind, metadata)
    values (p_actor_id, p_kind, coalesce(p_metadata, '{}'::jsonb));
end;
$$;
revoke all on function public.record_community_activity(uuid, text, jsonb) from public, anon, authenticated;

-- Die Einstellung wirkt auch rückwirkend. Wer sich auf „anonym" oder „privat"
-- stellt, will nicht, dass die bisherigen Einträge weiter mit Namen dastehen —
-- eine Einstellung, die nur ab jetzt gilt, hielte nicht, was sie verspricht.
-- Das ist endgültig: einmal entfernte Urheber und Kartennamen kommen bei einem
-- Wechsel zurück auf „öffentlich" nicht wieder.
--
-- Folgerichtig räumt ein späterer Wechsel von „anonym" auf „privat" die bereits
-- anonymisierten Zeilen NICHT mehr weg: sie tragen keinen Urheber mehr, also
-- lässt sich nicht mehr feststellen, wessen sie waren. Das ist kein Versehen —
-- an einer Zeile ohne Urheber ist nichts Persönliches mehr zu löschen.
create or replace function public.apply_community_visibility()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.community_visibility is not distinct from old.community_visibility then
    return new;
  end if;

  if new.community_visibility = 'private' then
    delete from public.community_activity where actor_id = new.id;
  elsif new.community_visibility = 'anonymous' then
    update public.community_activity
       set actor_id = null,
           metadata = metadata - 'name' - 'img'
     where actor_id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_community_visibility on public.profiles;
create trigger profiles_community_visibility
after update of community_visibility on public.profiles
for each row execute function public.apply_community_visibility();
