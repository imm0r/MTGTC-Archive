-- =====================================================================
-- Community Foundation — „anonym" anonymisiert nur noch die Person.
--
-- Bisher entfernte diese Stufe auch Kartenname, Bild und Preis. Das war
-- eine Stufe zu viel: Wer anonym bleiben will, will nicht zwangsläufig
-- auch verbergen, WAS in der Community passiert. Ab hier bleibt der
-- Eintrag inhaltlich vollständig, nur ohne Urheber:
--
--   „Ein Mitglied hat Abstergo Entertainment erfasst"
--
-- Wer auch den Inhalt nicht veröffentlichen will, hat dafür „privat".
--
-- Nicht rückholbar: Zeilen, die unter der alten Auslegung anonymisiert
-- wurden, haben Name, Bild und Preis bereits verloren. Sie bleiben ohne.
-- =====================================================================

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

  -- „anonym" heißt: ohne Urheber, aber mit vollem Inhalt.
  insert into public.community_activity (actor_id, kind, metadata)
    values (case when v_sicht = 'anonymous' then null else p_actor_id end,
            p_kind, coalesce(p_metadata, '{}'::jsonb));
end;
$$;
revoke all on function public.record_community_activity(uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.apply_community_visibility()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.community_visibility is not distinct from old.community_visibility then
    return new;
  end if;

  if new.community_visibility = 'private' then
    delete from public.community_activity where actor_id = new.id;
  elsif new.community_visibility = 'anonymous' then
    -- Nur noch den Urheber entfernen; der Inhalt bleibt stehen.
    update public.community_activity set actor_id = null where actor_id = new.id;
  end if;

  return new;
end;
$$;
