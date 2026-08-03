-- =====================================================================
-- Themen-Index: was eine Karte INHALTLICH tut.
--
-- Bisher rät die App das aus dem Regeltext. SYNERGY_THEMES in app.js führt
-- zehn handgeschriebene Muster („/\bsacrifice\b/i" heißt Opferauslass), und
-- für drei davon fragt sie zusätzlich Scryfalls `otag:` ab. Das trägt, ist
-- aber grob: Ein Regex kennt keinen Unterschied zwischen „sacrifice a
-- creature" als Kosten und als Bedrohung, und die zehn Themen sind ein
-- Fingerhut voll gegenüber dem, was es gibt.
--
-- Es gibt nämlich mehr, und zwar gepflegt: Scryfalls Tagger ist ein
-- Gemeinschaftsprojekt, das Karten von Hand verschlagwortet — 4509 Themen,
-- 231.000 Zuordnungen, samt Beschreibungen und einer Ober-/Unterthemen-
-- Hierarchie. Scryfall veröffentlicht den ganzen Bestand TÄGLICH als eine
-- Datei von 5,9 MB (bulk-data, Typ `oracle_tags`).
--
-- WARUM DIE DATEN HIER LIEGEN UND NICHT LIVE GEHOLT WERDEN. Scryfalls
-- Such-API kann nur die eine Richtung: `otag:sacrifice-outlet` liefert die
-- Karten zu einem Thema. Die Gegenrichtung — „welche Themen hat DIESE Karte?"
-- — bietet sie nicht an. Genau die braucht die Detailansicht, und genau die
-- entsteht erst, wenn der Bestand einmal umgedreht bei uns liegt.
--
-- DREI TABELLEN, und eine davon ist nur Buchhaltung:
--   tags        das Vokabular: Kürzel, Beschreibung, Ober-Themen
--   card_tags   die Zuordnungen, oracle_id ↔ Kürzel
--   tag_import  woher der Bestand stammt und wann — damit ein täglicher Lauf
--               nichts tut, wenn Scryfall nichts Neues hat
--
-- WARUM DIE HIERARCHIE MITKOMMT. Sie ist nicht Zierde. Gemessen an den echten
-- Daten hat `sacrifice-outlet` NULL eigene Karten und acht Unterthemen
-- (sacrifice-outlet-creature, -artifact, -land …) — die Karten hängen
-- ausschließlich an den Kindern. Wer nach dem Oberthema fragt und nur die
-- direkten Zuordnungen ansieht, bekommt eine leere Liste.
--
-- Gespeichert werden trotzdem NUR die direkten Zuordnungen (231.000). Das
-- Hochrollen verdoppelte sie auf 472.000 — beides wäre klein genug, aber
-- doppelte Wahrheit veraltet doppelt. Die beiden Funktionen unten rollen beim
-- Lesen hoch; der Eltern-Graph ist nachweislich zyklenfrei und höchstens
-- fünfzehn Stufen tief, das kostet nichts.
-- =====================================================================

-- ---------------------------------------------------------- Vokabular
create table if not exists public.tags (
  slug        text primary key,
  label       text not null,
  -- Nur 29 % der Themen haben eine; der Rest erklärt sich über das Kürzel.
  description text,
  -- Mehrere Ober-Themen sind erlaubt und kommen vor (bis zu zehn). Deshalb
  -- ein Feld statt einer Spalte, und bewusst KEIN Fremdschlüssel auf sich
  -- selbst: Beim Einspielen stünde sonst die Reihenfolge im Weg, und ein
  -- Verweis ins Leere kann gar nicht entstehen — die Quelle liefert den
  -- Graphen geschlossen (nachgemessen: null offene Verweise).
  parents     text[] not null default '{}',
  -- Zahl der DIREKTEN Zuordnungen. Die App blendet damit die Winzlinge aus:
  -- der Median liegt bei fünf Karten, ein Viertel hat vier oder weniger.
  cards       integer not null default 0,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------- Zuordnungen
create table if not exists public.card_tags (
  -- Die oracle_id bezeichnet die KARTE, nicht die Auflage — ein Thema gilt
  -- für alle Drucke gleichermaßen. Genau diese Spalte führt auch public.cards.
  oracle_id text not null,
  tag       text not null references public.tags(slug) on delete cascade,
  primary key (oracle_id, tag)
);
-- Der Primärschlüssel deckt die Suche nach einer Karte ab. Für die
-- Gegenrichtung („alle Karten zu diesem Thema") braucht es den zweiten Index.
create index if not exists card_tags_tag_idx on public.card_tags (tag);

-- ---------------------------------------------------------- Buchhaltung
create table if not exists public.tag_import (
  -- Genau eine Zeile; der Schlüssel ist fest, damit ein zweiter Lauf sie
  -- fortschreibt statt eine weitere anzulegen.
  id              text primary key default 'oracle_tags',
  bulk_id         text,
  bulk_updated_at timestamptz,
  tags            integer,
  taggings        integer,
  imported_at     timestamptz not null default now()
);

-- ---------------------------------------------------------- Zugriff
-- Wie beim Preisarchiv: lesen darf jeder Angemeldete, schreiben niemand.
-- Gefüllt wird ausschließlich vom Einspiel-Lauf mit dem service_role-Key,
-- und der umgeht RLS.
alter table public.tags       enable row level security;
alter table public.tags       force  row level security;
alter table public.card_tags  enable row level security;
alter table public.card_tags  force  row level security;
alter table public.tag_import enable row level security;
alter table public.tag_import force  row level security;
revoke all on public.tags, public.card_tags, public.tag_import from anon;
-- RLS ERSETZT die Tabellenrechte nicht, sie tritt neben sie: Ohne grant hilft
-- die freundlichste Policy nichts, die Abfrage scheitert an „permission denied
-- for table". Nachgemessen an einer leeren Datenbank — im laufenden Projekt
-- verdeckt Supabases Voreinstellung für neue Tabellen den Fehler, bei einer
-- frischen Installation nicht.
grant select on public.tags, public.card_tags, public.tag_import to authenticated;

drop policy if exists "themen lesbar" on public.tags;
create policy "themen lesbar" on public.tags
  for select to authenticated using (true);

drop policy if exists "zuordnungen lesbar" on public.card_tags;
create policy "zuordnungen lesbar" on public.card_tags
  for select to authenticated using (true);

drop policy if exists "einspielstand lesbar" on public.tag_import;
create policy "einspielstand lesbar" on public.tag_import
  for select to authenticated using (true);

-- =====================================================================
-- Lesen: die beiden Richtungen, jeweils MIT Hierarchie
-- =====================================================================

-- ---- Alle Themen einer Karte, Ober-Themen eingeschlossen -------------
-- `direkt` unterscheidet, was an der Karte hängt, von dem, was sie über die
-- Hierarchie erbt. Die Detailansicht kann damit das Geerbte blasser setzen,
-- statt beides als gleichwertig auszugeben.
create or replace function public.tags_of_card(p_oracle_id text)
returns table (slug text, label text, description text, cards integer, direkt boolean)
language sql stable security definer set search_path = public as $$
  with recursive
  direkt as (
    select ct.tag as slug from public.card_tags ct where ct.oracle_id = p_oracle_id
  ),
  hoch as (
    select d.slug, true as direkt from direkt d
    union
    -- unnest über parents: ein Thema kann mehrere Ober-Themen haben. `union`
    -- (nicht `union all`) bricht Mehrfachwege ab — ohne das liefe ein Thema,
    -- das über zwei Pfade erreichbar ist, mehrfach durch.
    select p.parent, false
      from hoch h
      join public.tags t on t.slug = h.slug
      cross join lateral unnest(t.parents) as p(parent)
  )
  select t.slug, t.label, t.description, t.cards, bool_or(h.direkt)
    from hoch h join public.tags t on t.slug = h.slug
   group by t.slug, t.label, t.description, t.cards
   order by bool_or(h.direkt) desc, t.cards asc, t.slug;
$$;

-- ---- Alle Karten zu einem Thema, Unter-Themen eingeschlossen ----------
-- Die Gegenrichtung, und der Grund, warum sie gebraucht wird: `sacrifice-outlet`
-- selbst trägt keine einzige Karte. Ohne das Hinabsteigen wäre die Antwort leer.
create or replace function public.cards_with_tag(p_slug text)
returns table (oracle_id text)
language sql stable security definer set search_path = public as $$
  with recursive runter as (
    select t.slug from public.tags t where t.slug = p_slug
    union
    select k.slug
      from runter r
      join public.tags k on r.slug = any(k.parents)
  )
  select distinct ct.oracle_id
    from public.card_tags ct
    join runter r on r.slug = ct.tag;
$$;

grant execute on function public.tags_of_card(text)  to authenticated;
grant execute on function public.cards_with_tag(text) to authenticated;

-- =====================================================================
-- Einspielen: Zwischenlager, dann ein Tausch
--
-- Der Lauf ersetzt den GANZEN Bestand, denn Scryfall liefert ihn nur ganz —
-- welche Zuordnung seit gestern verschwunden ist, sagt niemand. Ein „erst
-- löschen, dann füllen" über die REST-Schnittstelle hinterließe die Tabellen
-- aber minutenlang leer, und in dieser Zeit sähe die App eine Sammlung ohne
-- Themen.
--
-- Deshalb: Der Lauf schiebt in zwei Zwischentabellen, und ein einziger Aufruf
-- am Ende tauscht sie in einer Transaktion gegen den Bestand. Wer während des
-- Einspielens liest, sieht den ALTEN Stand, nie einen halben.
--
-- `unlogged`: Die Zwischentabellen überleben einen Absturz nicht — sollen sie
-- auch nicht. Sie werden bei jedem Lauf neu gefüllt, und ohne WAL-Schreiben
-- geht das spürbar schneller.
-- =====================================================================
create unlogged table if not exists public.tags_stage (
  slug text, label text, description text, parents text[], cards integer
);
create unlogged table if not exists public.card_tags_stage (
  oracle_id text, tag text
);
alter table public.tags_stage      enable row level security;
alter table public.card_tags_stage enable row level security;
revoke all on public.tags_stage, public.card_tags_stage from anon, authenticated;

-- Alle vier Funktionen sind dem service_role-Key vorbehalten. Das „nicht
-- granten" allein genügt dafür NICHT: Postgres gibt EXECUTE auf neue
-- Funktionen von sich aus an PUBLIC. Ohne den revoke unten könnte also jeder
-- Angemeldete das Zwischenlager füllen und tauschen — bei security definer
-- mit den Rechten des Eigentümers. Der revoke steht deshalb hinter den
-- Definitionen und ist kein Beiwerk, sondern der Verschluss.
create or replace function public.tag_import_begin()
returns void language sql security definer set search_path = public as $$
  truncate public.tags_stage, public.card_tags_stage;
$$;

create or replace function public.tag_import_tags(p jsonb)
returns integer language sql security definer set search_path = public as $$
  insert into public.tags_stage (slug, label, description, parents, cards)
  select x.slug, x.label, x.description,
         coalesce(x.parents, '{}'::text[]), coalesce(x.cards, 0)
    from jsonb_to_recordset(p) as x(slug text, label text, description text,
                                    parents text[], cards integer);
  select jsonb_array_length(p);
$$;

create or replace function public.tag_import_taggings(p jsonb)
returns integer language sql security definer set search_path = public as $$
  insert into public.card_tags_stage (oracle_id, tag)
  select x.oracle_id, x.tag
    from jsonb_to_recordset(p) as x(oracle_id text, tag text);
  select jsonb_array_length(p);
$$;

-- Der Tausch. Eine Funktion ist eine Transaktion: Entweder steht am Ende der
-- ganze neue Bestand da, oder es bleibt beim alten.
--
-- Die Notbremse davor ist Absicht. Ein Lauf, der unterwegs abbricht, hätte
-- sonst ein halb gefülltes Zwischenlager, und der Tausch machte daraus einen
-- halben Bestand — schlimmer als ein veralteter. Die Schwelle liegt bewusst
-- niedrig (1000 Themen, 100.000 Zuordnungen; gemessen sind es 4509 und
-- 231.000): Sie soll den Totalausfall fangen, nicht das normale Wachsen und
-- Schrumpfen bewerten.
create or replace function public.tag_import_commit(p_bulk_id text, p_bulk_updated timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_tags integer; n_tagg integer;
begin
  select count(*) into n_tags from public.tags_stage;
  select count(*) into n_tagg from public.card_tags_stage;
  if n_tags < 1000 or n_tagg < 100000 then
    raise exception 'Zwischenlager zu dünn (% Themen, % Zuordnungen) — Bestand bleibt unangetastet',
      n_tags, n_tagg;
  end if;

  -- Reihenfolge: erst die Zuordnungen weg (sie hängen am Fremdschlüssel),
  -- dann das Vokabular. delete statt truncate, damit beides in DIESER
  -- Transaktion zurückrollbar bleibt.
  delete from public.card_tags;
  delete from public.tags;

  insert into public.tags (slug, label, description, parents, cards, updated_at)
  select slug, label, description, parents, cards, now() from public.tags_stage;

  -- on conflict: Die Quelle führt dieselbe Karte je Thema nur einmal, aber
  -- darauf verlassen wir uns nicht — ein Duplikat soll den Lauf nicht kippen.
  insert into public.card_tags (oracle_id, tag)
  select s.oracle_id, s.tag from public.card_tags_stage s
   where exists (select 1 from public.tags t where t.slug = s.tag)
  on conflict do nothing;

  insert into public.tag_import (id, bulk_id, bulk_updated_at, tags, taggings, imported_at)
  values ('oracle_tags', p_bulk_id, p_bulk_updated, n_tags, n_tagg, now())
  on conflict (id) do update set bulk_id = excluded.bulk_id,
    bulk_updated_at = excluded.bulk_updated_at, tags = excluded.tags,
    taggings = excluded.taggings, imported_at = excluded.imported_at;

  truncate public.tags_stage, public.card_tags_stage;
  return jsonb_build_object('tags', n_tags, 'taggings', n_tagg);
end;
$$;

-- Der Verschluss (siehe oben): EXECUTE geht bei neuen Funktionen von selbst an
-- PUBLIC. Ohne diese vier Zeilen dürfte jeder Angemeldete den Themen-Index
-- austauschen. Dieselbe Vorsichtsmaßnahme trägt das Preisarchiv für
-- merge_price_history.
revoke all on function public.tag_import_begin()                          from public, anon, authenticated;
revoke all on function public.tag_import_tags(jsonb)                      from public, anon, authenticated;
revoke all on function public.tag_import_taggings(jsonb)                  from public, anon, authenticated;
revoke all on function public.tag_import_commit(text, timestamptz)        from public, anon, authenticated;
