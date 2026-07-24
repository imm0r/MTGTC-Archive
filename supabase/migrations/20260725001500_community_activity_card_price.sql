-- =====================================================================
-- Community Foundation — Preis der erfassten Karte im Aktivitätsstrom.
--
-- Die Vorschau nennt jetzt neben dem Kartennamen auch den Preis. Das ist
-- der Marktpreis einer Auflage, den jede und jeder ohnehin bei Scryfall
-- nachschlagen kann — kein Rückschluss auf den Zuschnitt einer Sammlung,
-- der über das hinausginge, was der Kartenname schon verrät.
--
-- Festgehalten wird der Preis zum Zeitpunkt des Erfassens, nicht laufend
-- nachgeführt. Für eine Momentaufnahme im Feed ist das richtig; ein Feed
-- ist ein Verlauf, keine Kursanzeige.
--
-- Wichtig: Der Preis muss überall dort mit verschwinden, wo Name und Bild
-- verschwinden. Sonst hebelte er die Anonymisierung teilweise aus — beide
-- Stellen aus 20260724234500 werden deshalb hier nachgezogen.
-- =====================================================================

create or replace function public.log_card_added_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.qty > old.qty then
    perform public.record_community_activity(new.user_id, 'card_added',
      jsonb_strip_nulls(jsonb_build_object(
        'name', new.name, 'img', new.img, 'price', new.price)));
  end if;
  return new;
end;
$$;

-- Schreibweg: „anonym" darf auch keinen Preis durchlassen.
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
  v_sicht := coalesce(v_sicht, 'public');

  if v_sicht = 'private' then
    return;
  end if;

  if v_sicht = 'anonymous' then
    insert into public.community_activity (actor_id, kind, metadata)
      values (null, p_kind, coalesce(p_metadata, '{}'::jsonb) - 'name' - 'img' - 'price');
    return;
  end if;

  insert into public.community_activity (actor_id, kind, metadata)
    values (p_actor_id, p_kind, coalesce(p_metadata, '{}'::jsonb));
end;
$$;
revoke all on function public.record_community_activity(uuid, text, jsonb) from public, anon, authenticated;

-- Rückwirkende Bereinigung: ebenfalls den Preis mitnehmen.
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
           metadata = metadata - 'name' - 'img' - 'price'
     where actor_id = new.id;
  end if;

  return new;
end;
$$;
