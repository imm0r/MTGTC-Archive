-- Härtung nach den Supabase-Advisors (Sicherheit/Performance) und einer eigenen
-- RPC-Audit im Anschluss an den Themen-Import-Fix (20260809120000).

-- (1) Preisarchiv: merge_price_history mischt je Lauf viele Preiszeilen in EINEM
--     Aufruf (insert … on conflict, je Zeile über merge_price_map) — dieselbe
--     Timeout-Klasse wie der Themen-Tausch. Funktionslokale Grenze wie dort,
--     damit ein wachsendes Archiv nicht in die 8s der authenticator-Rolle läuft.
alter function public.merge_price_history(jsonb) set statement_timeout = '3min';

-- (3) set_friend_code hatte als einzige Funktion kein festes search_path
--     (Advisor 0011_function_search_path_mutable). Nachgezogen wie überall sonst.
alter function public.set_friend_code() set search_path = public;

-- (4) Deckende Indizes für die 21 Fremdschlüssel ohne einen
--     (Advisor 0001_unindexed_foreign_keys). Beschleunigt Joins und vor allem
--     Löschungen am referenzierten Ende. „if not exists": gefahrlos wiederholbar.
create index if not exists idx_deck_categories_user_id       on public.deck_categories (user_id);
create index if not exists idx_deck_entries_card_id          on public.deck_entries (card_id);
create index if not exists idx_deck_entries_user_id          on public.deck_entries (user_id);
create index if not exists idx_deck_entry_categories_user_id on public.deck_entry_categories (user_id);
create index if not exists idx_deck_history_user_id          on public.deck_history (user_id);
create index if not exists idx_deck_ratings_user_id          on public.deck_ratings (user_id);
create index if not exists idx_deck_synergies_user_id        on public.deck_synergies (user_id);
create index if not exists idx_decks_imported_from           on public.decks (imported_from);
create index if not exists idx_decks_main_card_id            on public.decks (main_card_id);
create index if not exists idx_decks_second_card_id          on public.decks (second_card_id);
create index if not exists idx_dm_messages_sender            on public.dm_messages (sender);
create index if not exists idx_friendships_addressee         on public.friendships (addressee);
create index if not exists idx_game_events_host              on public.game_events (host);
create index if not exists idx_game_sessions_host            on public.game_sessions (host);
create index if not exists idx_group_members_user_id         on public.group_members (user_id);
create index if not exists idx_group_roles_role_key          on public.group_roles (role_key);
create index if not exists idx_session_events_user_id        on public.session_events (user_id);
create index if not exists idx_session_played_card_id        on public.session_played (card_id);
create index if not exists idx_session_played_user_id        on public.session_played (user_id);
create index if not exists idx_session_players_deck_id       on public.session_players (deck_id);
create index if not exists idx_user_roles_role_key           on public.user_roles (role_key);
