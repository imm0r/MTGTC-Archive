-- =====================================================================
--  Getappt und +1/+1-Marken auf dem Schlachtfeld
--
--  Überall sonst genügt eine Zahl je Karte: im Friedhof ist eine Karte eine
--  Karte, und drei gleiche sind drei gleiche. Auf dem Schlachtfeld nicht — von
--  zwei gleichen Kreaturen kann eine getappt sein und die andere zwei Marken
--  tragen. Die Zahl allein kann das nicht ausdrücken.
--
--  Deshalb bekommt allein diese Zone eine Liste je Exemplar:
--
--      field = 2, field_state = [{"t":1,"c":0},{"t":0,"c":2}]
--                                 getappt        +2/+2
--
--      t = getappt (0/1),  c = Anzahl +1/+1-Marken
--
--  field bleibt die maßgebliche ANZAHL — daran hängt die Rechnung „Bibliothek
--  ist der Rest", die keine Liste kennen muss. field_state schmückt sie aus und
--  ist genau so lang wie field; weicht das ab (Karte anderswohin geschoben,
--  Datenbank älter als die App), rückt die App die Liste beim Lesen zurecht,
--  statt sich auf eine Zusicherung zu verlassen, die niemand erzwingt.
--
--  Sind alle Exemplare ungetappt und ohne Marken, bleibt die Liste leer — der
--  Regelfall kostet also nichts. Genau deshalb steht hier jsonb und keine
--  eigene Zeilentabelle: ein Feld voller Standardkarten schreibt weiterhin nur
--  die eine Zeile, die es schon hatte.
--
--  RLS bleibt unverändert — die Policy played_own greift auf Zeilenebene.
-- =====================================================================

alter table public.session_played
  add column if not exists field_state jsonb not null default '[]'::jsonb;

-- Nur Listen zulassen: ein Objekt oder eine Zahl waere fuer die App unlesbar.
alter table public.session_played drop constraint if exists session_played_field_state_array;
alter table public.session_played
  add constraint session_played_field_state_array
  check (jsonb_typeof(field_state) = 'array');

comment on column public.session_played.field_state is
  'Zustand je Exemplar auf dem Schlachtfeld: [{"t":0|1 getappt,"c":Anzahl +1/+1-Marken}, …]. '
  'So lang wie field; leer, solange alles ungetappt und ohne Marken ist.';
