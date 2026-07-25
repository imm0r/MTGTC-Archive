-- =====================================================================
--  Handkarten in der Live-Spielrunde
--
--  Der private Karten-Tracker einer Partie kannte bisher zwei Orte: die
--  Bibliothek und „gespielt" (session_played.qty). Gezogene Karten liegen
--  aber dazwischen — auf der Hand. Statt einer zweiten Tabelle bekommt die
--  bestehende Zeile eine weitere Spalte: eine Karte hat je Partie und Spieler
--  genau EINEN Stand, und der Primärschlüssel (session_id, user_id, card_id)
--  trägt beide Zahlen ohne Verrenkung.
--
--  Die Bibliothek wird bewusst NICHT gespeichert. Sie ist der Rest:
--
--      Bibliothek = Deckmenge − hand − qty
--
--  So kann kein Exemplar doppelt existieren und keine Zeile der Deckmenge
--  widersprechen; die App rechnet den Rest bei jeder Anzeige neu.
--
--  RLS bleibt unverändert — die Policy played_own deckt die Spalte mit ab
--  (sie greift auf Zeilenebene, nicht je Spalte).
-- =====================================================================

alter table public.session_played
  add column if not exists hand integer not null default 0 check (hand >= 0);

comment on column public.session_played.hand is
  'Exemplare dieser Karte auf der Hand des Spielers. qty = bereits gespielt; '
  'die Bibliothek ergibt sich als Deckmenge minus hand minus qty.';
