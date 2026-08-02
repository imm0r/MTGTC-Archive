-- =====================================================================
-- Die Mitgliederliste kennt keine Sichtbarkeitsstufen.
--
-- WAS SICH ÄNDERT. Die Kachel „neuestes Mitglied" nennt ab jetzt IMMER den
-- echten Namen — auch bei „anonymous" und „privat" —, und Privat-Profile
-- fallen dort nicht mehr heraus. Alles andere bleibt, wie es war: Wer in
-- welcher Stufe steht, entscheidet weiterhin über den Aktivitätsstrom, über
-- die Kacheln zu Karten und über „größte Sammlung".
--
-- WARUM. „Ein Mitglied, dabei seit dem 2.8.2026" ist keine Auskunft, sondern
-- eine leere Zeile: Sie nennt weder jemanden, den man begrüßen, noch jemanden,
-- den man anschreiben könnte. Eine Mitgliederliste, die keine Mitglieder
-- nennt, ist keine. Die Stufen sind dafür gedacht, zu regeln, WAS jemand tut
-- — welche Karten er kauft, was er sammelt, was er ausgibt. Ob er überhaupt
-- dabei ist, ist etwas anderes.
--
-- WAS DAS FÜR DIE STUFEN HEISST, und das steht seit dieser Änderung auch so
-- in den Einstellungen: „Anonym" und „Privat" verbergen die Aktivität, nicht
-- die Mitgliedschaft. Wer gar nicht genannt werden will, trägt keinen
-- Anzeigenamen ein — dann steht dort weiterhin die Ersatzbezeichnung, denn
-- name ist NULL, und der Client setzt seine übersetzte Fassung ein.
--
-- NICHT BETROFFEN IST DIE PERSONENSUCHE. Die hing nie an dieser Einstellung,
-- sondern an profiles.findable — wer auf „anonym" stand, war über seinen
-- Namen ohnehin schon zu finden. Diese Änderung macht also nicht auffindbar,
-- was verborgen war; sie schließt die Lücke zwischen zwei Stellen, die
-- dasselbe Profil verschieden benannten.
-- =====================================================================

create or replace function public.community_highlights()
returns jsonb
language sql stable security definer set search_path = public
as $$
  with sichtbar as (
    select id, display_name, created, community_visibility
      from public.profiles
     where coalesce(community_visibility, 'public') <> 'private'
  ),
  -- Anzeigename gemäß Stufe: „anonymous“ bekommt keinen, der Client setzt
  -- dann seine übersetzte Ersatzbezeichnung ein. Gilt für ALLES, was jemand
  -- TUT — Karten, Preise, größte Sammlung.
  benannt as (
    select id,
           case when community_visibility = 'anonymous' then null
                else nullif(trim(display_name), '') end as name,
           created
      from sichtbar
  ),
  -- Die MITGLIEDERLISTE dagegen kennt keine Stufen: Weder wird hier
  -- gefiltert, noch der Name unterdrückt. Sie sagt nicht, was jemand tut,
  -- sondern nur, dass es ihn gibt.
  mitglieder as (
    select id, nullif(trim(display_name), '') as name, created
      from public.profiles
  ),
  karten as (
    select c.* from public.cards c
     join sichtbar s on s.id = c.user_id
     where c.qty > 0
  ),
  karte_json as (
    select jsonb_build_object(
      'id', c.id, 'scryfall_id', c.scryfall_id, 'oracle_id', c.oracle_id,
      'name', c.name, 'printed_name', c.printed_name,
      'set_code', c.set_code, 'set_name', c.set_name, 'cn', c.cn,
      'img', c.img, 'lang', c.lang, 'condition', c.condition, 'foil', c.foil,
      'qty', c.qty, 'price', c.price, 'type_line', c.type_line,
      'rarity', c.rarity, 'mana_cost', c.mana_cost, 'cmc', c.cmc,
      'released', c.released, 'colors', c.colors, 'keywords', c.keywords,
      'oracle_text', c.oracle_text, 'faces', c.faces,
      'color_identity', c.color_identity, 'added', c.added,
      'owner', (select b.name from benannt b where b.id = c.user_id)
    ) as j, c.added, c.released, c.price
    from karten c
  )
  select jsonb_build_object(
    -- Aus `mitglieder`, nicht aus `benannt`: siehe oben.
    'newest_member', (
      select jsonb_build_object('name', m.name, 'since', m.created)
        from mitglieder m order by m.created desc nulls last limit 1),

    'biggest_collection', (
      select jsonb_build_object('name', b.name, 'cards', x.n)
        from (select c.user_id, sum(c.qty) as n from karten c group by c.user_id
               order by 2 desc limit 1) x
        join benannt b on b.id = x.user_id),

    'newest_card',   (select j from karte_json where added is not null
                       order by added desc limit 1),
    'oldest_card',   (select j from karte_json where released is not null
                       order by released asc limit 1),
    'priciest_card', (select j from karte_json where price is not null
                       order by price desc limit 1)
  );
$$;

revoke all on function public.community_highlights() from public, anon;
grant execute on function public.community_highlights() to authenticated;
