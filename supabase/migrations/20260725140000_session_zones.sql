-- =====================================================================
--  Zonen statt „gespielt" in der Live-Spielrunde
--
--  Der private Kartenüberblick kannte drei Orte: Bibliothek, Hand und ein
--  Sammelbecken „gespielt". Das warf zusammen, was am Tisch getrennt liegt —
--  eine Kreatur auf dem Schlachtfeld, ein abgehandelter Spontanzauber im
--  Friedhof und eine ins Exil geschickte Karte sind drei verschiedene Dinge,
--  und aus dem Friedhof kommt manches zurück.
--
--  Jede Karte liegt jetzt in genau einer Zone:
--
--      Kommandozone · Schlachtfeld · Friedhof · Exil · Hand · Bibliothek
--
--  Gespeichert werden nur vier davon (hand/field/graveyard/exile).
--  Bibliothek und Kommandozone sind der REST aus der Deckmenge:
--
--      Bibliothek bzw. Kommandozone = Deckmenge − hand − field − graveyard − exile
--
--  Eine normale Karte, die nirgends sonst liegt, ist in der Bibliothek; der
--  Commander eines Decks in der Kommandozone. Dadurch kann kein Exemplar
--  doppelt existieren und keine Zeile der Deckmenge widersprechen.
--
--  cast_count zählt daneben, wie oft der Commander aus der Kommandozone
--  gewirkt wurde — daraus ergibt sich die Commander-Steuer (je Mal zwei Mana
--  mehr). Es ist kein Ort, sondern ein Zähler, und bleibt deshalb neben den
--  Zonen stehen.
--
--  Altbestand: qty hieß „gespielt". Die allermeisten so markierten Karten
--  standen auf dem Schlachtfeld, deshalb wandert der Wert dorthin — eine
--  laufende Partie verliert nichts. qty bleibt als Spalte erhalten (auf 0
--  gesetzt), damit ein noch nicht neu geladener Browser nicht auf eine
--  fehlende Spalte läuft; geschrieben wird sie nicht mehr und sie kann in
--  einer späteren Migration entfallen.
--
--  RLS bleibt unverändert — die Policy played_own greift auf Zeilenebene und
--  deckt alle Spalten mit ab.
-- =====================================================================

alter table public.session_played
  add column if not exists field      integer not null default 0 check (field >= 0),
  add column if not exists graveyard  integer not null default 0 check (graveyard >= 0),
  add column if not exists exile      integer not null default 0 check (exile >= 0),
  add column if not exists cast_count integer not null default 0 check (cast_count >= 0);

-- Einmalige Übernahme: „gespielt" war faktisch das Schlachtfeld.
update public.session_played set field = qty, qty = 0 where qty > 0;

comment on column public.session_played.hand       is 'Exemplare auf der Hand des Spielers.';
comment on column public.session_played.field      is 'Exemplare auf dem Schlachtfeld.';
comment on column public.session_played.graveyard  is 'Exemplare im Friedhof.';
comment on column public.session_played.exile      is 'Exemplare im Exil.';
comment on column public.session_played.cast_count is
  'Wie oft der Commander aus der Kommandozone gewirkt wurde (Commander-Steuer: +2 Mana je Mal).';
comment on column public.session_played.qty        is
  'Abgeloest: hiess frueher „gespielt". Wird nicht mehr geschrieben; Werte sind nach field uebernommen.';
