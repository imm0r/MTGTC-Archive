-- Eigene Kategorien je Deck ("Ramp", "Removal", "Kartenziehen" …).
--
-- Bisher gruppierte die Deck-Tabelle allein nach Kartentyp — eine Ordnung, die
-- die Karte mitbringt, nicht der Spieler. Sie sagt, WAS eine Karte ist, aber
-- nicht, WOZU sie im Deck steht: ein Sol Ring ist ein Artefakt, gespielt wird er
-- als Ramp. Diese Tabelle lässt jeden seine eigene Ordnung darüberlegen.
--
-- JE DECK, nicht je Nutzer: dieselbe Karte kann in einem Deck Ramp sein und im
-- nächsten Fixing, und ein Aggro-Deck braucht andere Fächer als ein Control-Deck.
-- Wer eine Liste wiederverwenden will, übernimmt sie in der App aus einem
-- anderen Deck — kopiert, nicht geteilt, damit ein Umbenennen hier nicht dort
-- etwas verstellt.

create table if not exists public.deck_categories (
  id      uuid primary key default gen_random_uuid(),
  deck_id uuid not null references public.decks(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  -- Anzeigename. Getrimmt und begrenzt: ein leerer Name wäre eine Gruppe ohne
  -- Überschrift, und 40 Zeichen sind mehr, als in die Kopfzeile passen.
  name    text not null,
  -- Reihenfolge in der Anzeige, vom Nutzer bestimmt. Nicht alphabetisch: die
  -- Reihenfolge trägt selbst eine Aussage ("erst die Länder, dann das Ramp").
  pos     integer not null default 0,
  created timestamptz not null default now(),
  constraint deck_categories_name_len check (char_length(btrim(name)) between 1 and 40),
  constraint deck_categories_name_unique unique (deck_id, name)
);

create index if not exists deck_categories_deck_idx on public.deck_categories(deck_id);

-- Die Zuordnung sitzt am Deckeintrag, nicht in einer eigenen Tabelle: eine
-- Karte steht in GENAU EINER Kategorie ihres Decks. Damit bleibt die Aussage
-- "die Summe der Gruppen ist die Deckgröße" wahr, die schon für die Typ-Gruppen
-- gilt — und die Karte ist auffindbar, weil es nur einen Ort gibt, an dem sie
-- stehen kann.
--
-- "on delete set null": Wer eine Kategorie löscht, will das Fach loswerden,
-- nicht die Karten darin. Sie fallen zurück in "Ohne Kategorie".
alter table public.deck_entries add column if not exists category_id uuid
  references public.deck_categories(id) on delete set null;

-- Eine Kategorie aus einem FREMDEN Deck wäre eine Gruppe, die in diesem Deck
-- niemand sieht — die Karte verschwände aus der Anzeige. Ein zusammengesetzter
-- Fremdschlüssel auf (id, deck_id) könnte das erzwingen, verlangte beim Löschen
-- aber "set null" auf eine einzelne Spalte (erst ab PostgreSQL 15) — deshalb
-- hier ein Trigger, der überall läuft.
--
-- Was die Regel trägt, ist der Vergleich der deck_id, nicht die RLS: Der
-- Trigger läuft auch aus einer security-definer-Funktion heraus (etwa
-- fulfil_wish_in_deck), und dort ist RLS umgangen. Er selbst braucht deshalb
-- kein security definer — beim Schreiben aus dem Browser verdeckt die RLS eine
-- fremde Kategorie zusätzlich, und der Trigger weist sie ebenso ab.
create or replace function public.deck_entry_kategorie_passt() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.category_id is not null and not exists (
       select 1 from public.deck_categories k
       where k.id = new.category_id and k.deck_id = new.deck_id) then
    raise exception 'Kategorie % gehört nicht zu Deck %', new.category_id, new.deck_id;
  end if;
  return new;
end $$;

drop trigger if exists deck_entries_kategorie_passt on public.deck_entries;
create trigger deck_entries_kategorie_passt
  before insert or update of category_id, deck_id on public.deck_entries
  for each row execute function public.deck_entry_kategorie_passt();

-- ------------------------------------------------- Row Level Security
alter table public.deck_categories enable row level security;
alter table public.deck_categories force row level security;
revoke all on public.deck_categories from anon;

drop policy if exists "eigene deck-kategorien" on public.deck_categories;
create policy "eigene deck-kategorien" on public.deck_categories
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Wie bei decks/deck_entries: Freunde lesen bei einem geteilten Deck mit.
-- Ohne diese Zeile wäre ein geteiltes Deck halb sichtbar — die Karten schon,
-- ihre Einteilung nicht. Die Freundesansicht zeigt die Kategorien noch nicht
-- an; das Recht gehört trotzdem hierher, damit die Zugriffsregeln vollständig
-- sind und nicht später nachgereicht werden müssen.
drop policy if exists deck_categories_select_shared on public.deck_categories;
create policy deck_categories_select_shared on public.deck_categories for select to authenticated
  using (public.deck_shared(deck_id) and public.are_friends(auth.uid(), user_id));

-- ------------------------------------------------- Wunsch einlösen
-- fulfil_wish_in_deck hängt den Deckplatz einer Wunschkarte auf das gekaufte
-- Exemplar um. Ohne die folgende Neufassung bliebe die Kategorie dabei an der
-- verschwindenden Wunschzeile hängen — die Einteilung zerfiele genau in dem
-- Moment, in dem das Deck echt wird, und zwar still. Unverändert gegenüber der
-- Fassung in supabase-schema.sql bis auf v_kat und das insert am Ende.
create or replace function public.fulfil_wish_in_deck(
  p_deck      uuid,
  p_from_card uuid,
  p_to_card   uuid,
  p_n         integer default 1
) returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_from public.cards%rowtype;
  v_to   public.cards%rowtype;
  v_have integer;
  v_n    integer;
  v_kat  uuid;
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet' using hint = 'auth';
  end if;
  if p_from_card = p_to_card then
    raise exception 'Quelle und Ziel sind dieselbe Zeile' using hint = 'same_row';
  end if;

  -- security definer umgeht RLS, deshalb hier jede Zugehörigkeit selbst
  -- prüfen: Deck und BEIDE Kartenzeilen müssen dem Aufrufer gehören.
  perform 1 from public.decks where id = p_deck and user_id = v_uid;
  if not found then
    raise exception 'Deck nicht gefunden' using hint = 'no_deck';
  end if;

  select * into v_from from public.cards where id = p_from_card and user_id = v_uid;
  if not found then
    raise exception 'Wunschkarte nicht gefunden' using hint = 'no_card';
  end if;
  select * into v_to from public.cards where id = p_to_card and user_id = v_uid;
  if not found then
    raise exception 'Zielkarte nicht gefunden' using hint = 'no_card';
  end if;

  -- Nur Auflagen DERSELBEN Karte dürfen getauscht werden, sonst wäre das hier
  -- ein Weg, am 100-Karten-Trigger vorbei beliebig umzubauen.
  --
  -- Drei Wege, jeder genügt allein — dieselbe Regel wie selbeKarte() im Client,
  -- sonst liesse der eine zu, was der andere abweist:
  --   * Set + Sammlernummer bezeichnen EINE Auflage, und eine Auflage ist eine
  --     bestimmte Karte. Setcode buchstabenblind: Scryfall liefert ihn klein,
  --     die Sammlungswege schreiben ihn gross, Altbestand hat beides.
  --   * oracle_id — teilen alle Drucke, Sprachen und Foil-Fassungen.
  --   * Der englische Name, für Uralt-Zeilen ohne oracle_id.
  -- Sprache, Ausführung und Zustand bleiben bei allen dreien aussen vor: eine
  -- Wunschkarte entsteht als englische Nicht-Foil-Zeile, gekauft wird, was da
  -- ist. Ein Abgleich, der darauf bestünde, träfe nie zu.
  if not (
    (v_from.set_code is not null and v_from.cn is not null
       and upper(v_from.set_code) = upper(v_to.set_code) and v_from.cn = v_to.cn)
    or (v_from.oracle_id is not null and v_from.oracle_id = v_to.oracle_id)
    or lower(v_from.name) = lower(v_to.name)
  ) then
    raise exception 'Andere Karte — Umhängen nur zwischen Auflagen derselben Karte'
      using hint = 'not_same_card';
  end if;

  -- Die eigene Kategorie wandert mit: Wer eine Wunschkarte unter "Removal"
  -- eingeplant hat, hat DEN PLATZ eingeordnet, nicht den Platzhalter. Ginge sie
  -- beim Kauf verloren, zerfiele die Einteilung genau in dem Moment, in dem das
  -- Deck echt wird — und zwar still.
  select qty, category_id into v_have, v_kat
    from public.deck_entries
   where deck_id = p_deck and card_id = p_from_card;
  if not found then
    raise exception 'Karte liegt nicht in diesem Deck' using hint = 'no_entry';
  end if;

  v_n := least(greatest(coalesce(p_n, 1), 1), v_have);

  -- Reihenfolge ist nicht beliebig: erst abziehen, dann gutschreiben. So wächst
  -- das Deck zu keinem Zeitpunkt, und der 100-Karten-Trigger sieht beim Insert
  -- bereits den verringerten Rest.
  if v_have = v_n then
    delete from public.deck_entries where deck_id = p_deck and card_id = p_from_card;
  else
    update public.deck_entries set qty = qty - v_n
     where deck_id = p_deck and card_id = p_from_card;
  end if;

  -- Lag die gekaufte Auflage schon im Deck, behält sie ihre eigene Einordnung:
  -- coalesce nimmt die vorhandene und greift nur, wenn dort nichts steht. Die
  -- Kategorie der Wunschzeile ist der Ersatz, nicht die Ansage.
  insert into public.deck_entries (deck_id, card_id, user_id, qty, category_id)
       values (p_deck, p_to_card, v_uid, v_n, v_kat)
  on conflict (deck_id, card_id)
    do update set qty = public.deck_entries.qty + excluded.qty,
                  category_id = coalesce(public.deck_entries.category_id, excluded.category_id);

  return v_n;
end $$;
revoke all on function public.fulfil_wish_in_deck(uuid, uuid, uuid, integer) from public, anon;
grant execute on function public.fulfil_wish_in_deck(uuid, uuid, uuid, integer) to authenticated;
