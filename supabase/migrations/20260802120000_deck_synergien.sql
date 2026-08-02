-- Synergie-Vorschläge je Deck aufheben.
--
-- WARUM ÜBERHAUPT. Ein Lauf kostet: die heuristische Suche mehrere Anfragen an
-- Scryfall, die KI-Variante Tokens und damit Kontingent. Bisher war das Ergebnis
-- beim nächsten Neuzeichnen weg — und ein Neuzeichnen löst schon aus, wer eine
-- der vorgeschlagenen Karten ins Deck legt. Genau der Handgriff, für den man die
-- Vorschläge geholt hat, warf sie also fort.
--
-- EINE ZEILE JE DECK. Der Primärschlüssel ist die deck_id, nicht eine eigene id:
-- Gezeigt wird immer der letzte Lauf, und ein Verlauf der Vorschläge wäre etwas
-- anderes als ein Vorschlag. Ein neuer Lauf überschreibt (upsert).
--
-- WAS DRINSTEHT. Je Vorschlag die Scryfall-Karte, aber nur die Felder, die
-- Kachel und „+"-Knopf brauchen — eine ganze Scryfall-Antwort wiegt ein
-- Vielfaches und enthält zu neun Zehnteln Dinge, die nie jemand ansieht.
create table if not exists public.deck_synergies (
  deck_id uuid primary key references public.decks(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created timestamptz not null default now(),
  -- 'syn' (heuristisch) oder 'ki'. Beide schreiben in denselben Kasten, und
  -- die Anzeige unterscheidet sie nur in der Kopfzeile.
  art     text not null,
  -- Fingerabdruck des Decks zum Zeitpunkt des Laufs — derselbe, den der
  -- Deck-Verlauf führt. Unterscheidet er sich vom jetzigen, sagt die Anzeige,
  -- dass sich das Deck seither geändert hat. Ohne das läse man alte Vorschläge
  -- als aktuelle.
  stand   text,
  daten   jsonb not null
);

alter table public.deck_synergies enable row level security;

-- Nur der eigene Lauf. Keine Freigabe an Freunde: Ein geteiltes Deck zeigt
-- seine Karten, nicht die Überlegungen, die noch nicht darin stehen.
drop policy if exists "eigene deck-synergien" on public.deck_synergies;
create policy "eigene deck-synergien" on public.deck_synergies
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
