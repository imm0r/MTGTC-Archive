-- Sicherheits-Hygiene (Supabase-Advisor 0028/0029: SECURITY DEFINER von anon/
-- authenticated ausführbar).
--
-- Befund des Audits: KEIN offenes Leck. Die als „anon-ausführbar" gemeldeten
-- Funktionen sind entweder self-guarded (auth.uid()/in_session()/in_event()/
-- has_perm()/is_admin() im Rumpf — sie geben Unbefugten nichts zurück) oder
-- absichtlich öffentlich (registered_user_count/total_card_count/total_deck_count
-- für den Login-Bildschirm). Einzig sauber zu härten sind die Trigger-Funktionen:
-- Sie tragen von Haus aus ein EXECUTE an PUBLIC, feuern aber nur über ihre
-- Trigger — Postgres verbietet ohnehin, eine „returns trigger"-Funktion als RPC
-- aufzurufen. Das Recht ist also folgenlos, aber überflüssig; entziehen wie bei
-- den Themen-Import-Funktionen (20260803180000). Die Trigger hängen an
-- CREATE TRIGGER, nicht am EXECUTE-Recht, und laufen unverändert weiter.
revoke all on function public.apply_community_visibility()  from public, anon, authenticated;
revoke all on function public.deck_history_kuerzen()        from public, anon, authenticated;
revoke all on function public.dm_touch_thread()             from public, anon, authenticated;
revoke all on function public.enforce_commander_deck_size() from public, anon, authenticated;
revoke all on function public.enforce_commander_singleton() from public, anon, authenticated;
revoke all on function public.log_card_added_activity()     from public, anon, authenticated;
revoke all on function public.log_deck_created_activity()   from public, anon, authenticated;
revoke all on function public.log_event_activity()          from public, anon, authenticated;
revoke all on function public.log_event_rsvp_activity()     from public, anon, authenticated;
revoke all on function public.log_session_activity()        from public, anon, authenticated;
revoke all on function public.log_session_joined_activity() from public, anon, authenticated;
revoke all on function public.pruefe_deck_oeffentlich()     from public, anon, authenticated;
