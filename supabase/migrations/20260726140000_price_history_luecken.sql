-- =====================================================================
--  Lückenprüfung: welche Karten haben noch gar keinen Verlauf?
--
--  MTGJSON liefert Preise ausschließlich als eine ~1 GB große Bulkdatei —
--  einen Abruf für eine einzelne Karte gibt es nicht. Eine neu erfasste Karte
--  bekäme ihre 90 Tage deshalb erst beim nächsten Nachtlauf, also bis zu einen
--  Tag später.
--
--  Damit der Job STÜNDLICH laufen kann, ohne stündlich 1 GB zu ziehen, braucht
--  er eine billige Vorfrage: fehlt überhaupt jemandem der Verlauf? Genau das
--  beantwortet diese Funktion. Ist die Antwort leer, beendet sich der Lauf in
--  Sekunden; nur wenn wirklich etwas fehlt, wird die Bulkdatei angefasst — und
--  dann gezielt für diese Karten.
--
--  security invoker: der Job kommt mit dem service_role-Key, der RLS umgeht und
--  daher den Bestand ALLER Nutzer sieht. Das ist hier richtig, denn das Archiv
--  ist geteilt — eine Karte, die irgendwer hat, soll für alle gefüllt werden.
-- =====================================================================

create or replace function public.cards_missing_price_history()
returns setof text
language sql
stable
security invoker
set search_path = public
as $$
  select distinct c.scryfall_id
    from public.cards c
    left join public.price_history ph on ph.scryfall_id = c.scryfall_id
   where c.scryfall_id is not null
     and ph.scryfall_id is null
$$;

-- Nur der Job braucht das. Angemeldete bekämen wegen RLS ohnehin bloß ihre
-- eigenen Zeilen zu sehen, aber eine Funktion ohne Verwendung im Browser soll
-- dort auch nicht aufrufbar sein.
revoke execute on function public.cards_missing_price_history() from public, anon, authenticated;
grant  execute on function public.cards_missing_price_history() to service_role;

comment on function public.cards_missing_price_history() is
  'scryfall_id aus public.cards, zu denen public.price_history noch keine Zeile führt. '
  'Vorfrage des stündlichen Backfill-Laufs: ist das Ergebnis leer, bleibt die MTGJSON-Bulkdatei ungeladen.';
