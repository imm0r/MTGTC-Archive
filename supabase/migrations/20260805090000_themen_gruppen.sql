-- =====================================================================
-- Themen: die wirksame Kartenzahl, und die Gruppierung nach Oberkategorie
--
-- ZWEI BEFUNDE AUS DEM BETRIEB, beide gemessen an den echten Daten.
--
-- ERSTENS: Die Zahl am Chip log. Sie zeigte `cards`, also die DIREKTEN
-- Zuordnungen — ein Klick darauf liefert aber alles, was `cards_with_tag`
-- findet, und das steigt die Hierarchie hinab. Der Unterschied ist keine
-- Kleinigkeit:
--
--     Tag                 angezeigt   tatsächlich in der Kategorie
--     triggered-ability       7.852         17.141
--     cycle                       0          8.366
--     hate                        0          4.600
--     burn                        0          3.166
--     burn-player                883          1.924
--     drawback                 1.345          1.797
--
-- Am schlimmsten bei den reinen Sammelbegriffen: `burn` stand mit 0 da und
-- las sich als „trifft auf keine Karte zu", während 3.166 Karten darunter
-- hängen. Der Tagger klebt solche Oberbegriffe nie an eine Karte, nur ihre
-- Unterbegriffe.
--
-- ZWEITENS: Die Anzeige war flach. Direkte Tags in einer Reihe, geerbte in
-- einer zweiten — welcher geerbte aus welchem direkten folgt, musste man
-- raten. Gemessen an 300 echten Karten: Ø 6,5 direkte und 5,7 geerbte Tags,
-- bei 30 % der Karten mehr geerbte als direkte, im Extremfall 19.
--
-- Zusammengefasst auf die OBERSTE Kategorie werden daraus Ø 3,4 Gruppen
-- (schlimmster Fall 11). Nach dem unmittelbaren Elternteil wären es 4,1 und
-- bis zu 18 — und dazwischen lägen die Zwischenebenen, die am wenigsten
-- sagen. Die Hierarchie ist bis zu sieben Ebenen tief; nach dem Zusammenfassen
-- ist sie flach.
-- =====================================================================

-- ---------------------------------------------------------- Die zweite Zahl
-- Getrennt von `cards`, nicht an ihrer Stelle: Die direkte Zahl bleibt die
-- Grundlage für die Sperrliste der Winzlinge in app.js, und beim Einspielen
-- ist sie das, was die Quelle hergibt. `cards_total` ist abgeleitet.
alter table public.tags add column if not exists cards_total integer not null default 0;

comment on column public.tags.cards_total is
  'Karten dieses Tags EINSCHLIESSLICH aller Unterbegriffe — dieselbe Menge, die cards_with_tag liefert. Abgeleitet, wird von tag_rollup_berechnen() gesetzt.';

-- ---------------------------------------------------------- Das Hochrollen
-- WARUM ALS EIGENE FUNKTION UND NICHT IM TAUSCH. Gemessen dauert der Lauf
-- rund zehn Sekunden: Die Hülle über den Graphen ist zwar klein (11.609
-- Paare bei 4.509 Tags), aber die Verbindung mit den 231.000 Zuordnungen
-- ergibt 472.000 Zeilen, über die einmal gezählt werden muss. Zehn Sekunden
-- täglich sind belanglos — zehn Sekunden INNERHALB von tag_import_commit
-- wären es nicht: Diese Transaktion hält den kompletten Themen-Bestand
-- gesperrt, und solange sähe die App eine Sammlung ohne Themen.
--
-- Deshalb: erst tauschen, dann rechnen. Zwischen beidem steht `cards_total`
-- kurz auf dem Stand von gestern. Das ist die harmloseste Abweichung von
-- allen — eine Zahl neben einem Tag, die sich über Nacht ohnehin kaum bewegt.
create or replace function public.tag_rollup_berechnen()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with recursive kette as (
    -- Jeder Tag ist sein eigener Vorfahr: Ein Tag mit eigenen Karten und
    -- ohne Kinder muss dieselbe Zahl bekommen wie `cards`.
    select t.slug as wurzel, t.slug as knoten from public.tags t
    union
    -- `union` (nicht `union all`) bricht Mehrfachwege ab. 684 der 4.509 Tags
    -- haben mehrere Eltern — ohne das liefe ein Zweig mehrfach durch.
    select k.wurzel, kind.slug
      from kette k join public.tags kind on k.knoten = any(kind.parents)
  ), gezaehlt as (
    select k.wurzel, count(distinct ct.oracle_id) as n
      from kette k join public.card_tags ct on ct.tag = k.knoten
     group by k.wurzel
  )
  -- Über einen Aussenverbund statt einer Unterabfrage je Zeile: Tags ohne
  -- jede Karte müssen auf 0 gesetzt werden, nicht übersprungen — sonst bliebe
  -- dort der Wert von gestern stehen.
  update public.tags t set cards_total = coalesce(g.n, 0)
    from public.tags alle
    left join gezaehlt g on g.wurzel = alle.slug
   where t.slug = alle.slug;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------- Die Gruppierung
-- Eine Zeile je Paar (oberste Kategorie, direkter Tag). Ein Tag mit mehreren
-- Wegen nach oben erscheint mehrfach — das ist keine Doppelung, sondern zwei
-- richtige Aussagen: `cycle-fin-adventure-land` hängt unter `cycle` UND unter
-- `tapland`, die Karte ist beides.
--
-- `wurzel is null` heißt: Der Tag hat gar keinen Oberbegriff (`symmetrical`
-- etwa). Diese stehen in der Anzeige oben, ohne Überschrift — sie brauchen
-- keine.
--
-- Zurückgegeben werden NUR die direkt vergebenen Tags. Die Zwischenebenen
-- fallen weg; sie waren der uninformative Teil der alten Anzeige.
create or replace function public.tag_groups_of_card(p_oracle_id text)
returns table (wurzel text, wurzel_label text, slug text, label text,
               description text, cards integer, cards_total integer)
language sql stable security definer set search_path = public as $$
  with recursive
  direkt as (
    select ct.tag as slug from public.card_tags ct where ct.oracle_id = p_oracle_id
  ),
  hoch as (
    select d.slug as tag, d.slug as knoten from direkt d
    union
    select h.tag, p.parent
      from hoch h join public.tags t on t.slug = h.knoten
      cross join lateral unnest(t.parents) as p(parent)
  ),
  wurzeln as (
    select distinct h.tag, h.knoten as wurzel
      from hoch h join public.tags t on t.slug = h.knoten
     where cardinality(t.parents) = 0 and h.knoten <> h.tag
  )
  select w.wurzel, tw.label, d.slug, td.label, td.description, td.cards, td.cards_total
    from direkt d
    join public.tags td on td.slug = d.slug
    left join wurzeln w on w.tag = d.slug
    left join public.tags tw on tw.slug = w.wurzel
   -- Ohne Oberbegriff zuerst, dann die Gruppen nach Namen; innerhalb einer
   -- Gruppe das Spezifischste zuerst — die kleine Zahl sagt mehr als die große.
   order by (w.wurzel is not null), tw.label, td.cards_total, td.label;
$$;

grant execute on function public.tag_groups_of_card(text) to authenticated;

-- Das Rechnen bleibt dem Lauf vorbehalten, wie schon der Tausch.
revoke all on function public.tag_rollup_berechnen() from public, anon, authenticated;

-- ---------------------------------------------------------- Einmal jetzt
-- Damit die Zahlen nicht bis zum nächsten nächtlichen Lauf auf null stehen.
select public.tag_rollup_berechnen();
