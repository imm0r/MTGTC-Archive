-- =====================================================================
-- Das Sammlungsprofil: worum die eigene Sammlung eigentlich geht
--
-- Das Dashboard beantwortete bisher nur Fragen, die in den Karten selbst
-- stehen — Manakurve, Farben, Seltenheit, Sets, Jahrgänge. Was die Sammlung
-- SPIELT, stand nirgends. Seit dem Themen-Index (#196) liegt die Antwort in
-- der Datenbank: 4.509 Tagger-Themen, 230.993 Zuordnungen, eine Hierarchie
-- bis zu sieben Ebenen tief.
--
-- Diese Funktion rollt sie auf die OBERSTE Ebene hoch und zählt je
-- Sammelbegriff die eigenen Karten. Gemessen an der grössten Sammlung im
-- Bestand (549 verschiedene Karten, 546 davon getaggt) kommen 346
-- Oberkategorien heraus — von „removal" (96 Karten) bis zu Dutzenden mit
-- einer einzigen. Welche davon etwas aussagen, entscheidet die App: Die
-- Sperrliste für Struktur-Themen steht in app.js neben der, die es für die
-- Synergie-Haken schon gibt, damit es EINE Stelle gibt, an der „das ist
-- Grammatik, keine Strategie" gepflegt wird.
--
-- WARUM SECURITY DEFINER UND NICHT INVOKER. `cards` trägt drei Lesepolicies:
-- die eigene (`auth.uid() = user_id`) und zwei, die fremde Karten aus
-- öffentlichen und geteilten Decks sichtbar machen. Eine Invoker-Funktion
-- sähe also auch die — und das Profil der eigenen Sammlung enthielte still
-- die Karten anderer Leute. Deshalb Definer mit dem Filter ausgeschrieben:
-- `user_id = auth.uid()` ist hier eine Zusicherung, keine Bequemlichkeit.
-- =====================================================================

create or replace function public.tag_profil()
returns table (wurzel text, label text, karten integer, getaggt integer)
language sql stable security definer set search_path = public as $$
  with recursive
  -- VERSCHIEDENE Karten, nicht Stück: Vier Exemplare desselben Removals sind
  -- eine Removal-Karte. Der Rest des Dashboards zählt Stück, hier wäre das
  -- irreführend — eine Playset-lastige Sammlung sähe fokussierter aus, als
  -- sie ist.
  meine as (
    select distinct c.oracle_id
      from public.cards c
     where c.user_id = auth.uid() and c.qty > 0 and c.oracle_id is not null
  ),
  hoch as (
    select ct.tag as tag, ct.tag as knoten
      from public.card_tags ct join meine m on m.oracle_id = ct.oracle_id
     group by ct.tag
    union
    -- `union` (nicht `union all`): 684 der 4.509 Themen haben mehrere Eltern,
    -- ohne das liefe derselbe Zweig mehrfach durch.
    select h.tag, p.parent
      from hoch h join public.tags t on t.slug = h.knoten
      cross join lateral unnest(t.parents) as p(parent)
  ),
  wurzeln as (
    select distinct h.tag, h.knoten as wurzel
      from hoch h join public.tags t on t.slug = h.knoten
     where cardinality(t.parents) = 0
  ),
  -- Der Nenner sind die GETAGGTEN Karten, nicht alle. Eine Karte ohne Themen
  -- kann in keiner Kategorie stecken; sie im Nenner mitzuzählen drückte jeden
  -- Anteil, ohne dass ihm etwas gegenüberstünde. Gemessen sind es 546 von 549
  -- — der Unterschied ist klein, die Aussage aber eine andere.
  nenner as (
    select count(distinct ct.oracle_id)::integer as n
      from public.card_tags ct join meine m on m.oracle_id = ct.oracle_id
  )
  select w.wurzel, tw.label, count(distinct ct.oracle_id)::integer,
         (select n from nenner)
    from meine m
    join public.card_tags ct on ct.oracle_id = m.oracle_id
    join wurzeln w on w.tag = ct.tag
    join public.tags tw on tw.slug = w.wurzel
   group by w.wurzel, tw.label
   order by 3 desc, tw.label;
$$;

comment on function public.tag_profil() is
  'Themenprofil der eigenen Sammlung: je oberster Tagger-Kategorie die Zahl der verschiedenen eigenen Karten darunter, dazu die Zahl der getaggten Karten als Nenner. Die Sammelbegriffe hängt der Tagger nie direkt an eine Karte — gezählt wird über die Hierarchie.';

grant execute on function public.tag_profil() to authenticated;
