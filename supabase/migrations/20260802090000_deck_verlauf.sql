-- Verlauf je Deck: ein Stand nach jeder Änderung, und der Weg zurück.
--
-- WARUM ALS STAND UND NICHT ALS EREIGNIS. Ein Ereignisstrom ("Karte X ergänzt",
-- "Kategorie umbenannt") müsste an jeder der rund zwanzig Schreibstellen in der
-- App mitgeschrieben werden. Eine davon zu vergessen fiele nicht auf — der
-- Verlauf wäre einfach unvollständig, und ein Rücksprung landete auf einem
-- Stand, den es nie gab. Hier steht deshalb der FERTIGE STAND drin, geschrieben
-- an genau einer Stelle: nach dem Laden der Decks, wenn der Fingerabdruck sich
-- geändert hat. Was sich geändert HAT, rechnet die App aus dem Vergleich zweier
-- Stände aus, statt es sich merken zu müssen.
--
-- NICHT RÜCKWIRKEND. Der erste Stand entsteht beim ersten Laden nach dieser
-- Änderung; was davor am Deck geschah, ist nicht mehr rekonstruierbar und wird
-- auch nicht behauptet.
create table if not exists public.deck_history (
  id      uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  created timestamptz not null default now(),
  -- Fingerabdruck des Standes. Nur wenn er sich gegenüber dem jüngsten Eintrag
  -- unterscheidet, entsteht überhaupt eine Zeile — sonst schriebe jedes Laden
  -- der Seite einen neuen Verlaufseintrag.
  stand   text not null,
  -- Der Stand selbst: Deckkopf, Kategorien und Karten mit Menge und Einordnung.
  -- Die Kategorien stehen darin über ihren NAMEN, nicht über ihre id — ein Fach
  -- kann gelöscht und gleichnamig neu angelegt worden sein, und der Rücksprung
  -- soll dann trotzdem dorthin zeigen.
  daten   jsonb not null
);

create index if not exists deck_history_deck_idx on public.deck_history(deck_id, created desc);

-- Der Verlauf ist ein Gedächtnis, kein Archiv: Die letzten vierzig Stände je
-- Deck reichen für "das war vorgestern besser", und ein Deck mit hundert Karten
-- wiegt als JSON rund sechs Kilobyte. Ohne Grenze wüchse die Tabelle mit jeder
-- Änderung weiter, für immer.
create or replace function public.deck_history_kuerzen() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.deck_history h
   where h.deck_id = new.deck_id
     and h.id not in (
       select id from public.deck_history
        where deck_id = new.deck_id
        order by created desc
        limit 40);
  return null;
end $$;

drop trigger if exists deck_history_kuerzen_trg on public.deck_history;
create trigger deck_history_kuerzen_trg after insert on public.deck_history
  for each row execute function public.deck_history_kuerzen();

alter table public.deck_history enable row level security;

-- Der eigene Verlauf, sonst nichts. Anders als bei Decks und Karten gibt es
-- hier bewusst KEINE Freigabe an Freunde: Ein geteiltes Deck zeigt seinen
-- aktuellen Stand, nicht die Umwege dorthin.
drop policy if exists "eigener deck-verlauf" on public.deck_history;
create policy "eigener deck-verlauf" on public.deck_history
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
