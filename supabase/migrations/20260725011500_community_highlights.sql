-- =====================================================================
-- Community Foundation — Höhepunkte für die Community-Ansicht.
--
-- Fünf Kacheln: neuestes Mitglied, größte Sammlung, neueste Karte,
-- ältester Druck, teuerste Karte.
--
-- „Ältester Druck" meint cards.released, also das Erscheinungsdatum der
-- Auflage — nicht, wie lange eine Karte schon in einer Sammlung liegt.
--
-- Die Sichtbarkeitseinstellung gilt hier genauso wie im Aktivitätsstrom,
-- sonst hätte sie ein Loch: Wer auf „privat" steht, stünde trotzdem als
-- größte Sammlung oder als Besitzer der teuersten Karte da.
--   private    fällt vollständig heraus, auch die Karten.
--   anonymous  erscheint ohne Namen, die Karte selbst bleibt sichtbar.
--   public     wie gehabt.
--
-- Der Rückgabewert ist jsonb, weil die fünf Kacheln verschiedene Formen
-- haben; eine gemeinsame Tabellenzeile wäre nur eine Spalten-Wüste.
--
-- Von den Kartenspalten wird bewusst nur weitergegeben, was die
-- Detailansicht braucht. Draußen bleiben user_id (der Feed nennt Personen
-- über den Namen, nicht über eine ID) und hist (Preisverlauf, für eine
-- Kachel unnötig und groß).
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
  -- dann seine übersetzte Ersatzbezeichnung ein.
  benannt as (
    select id,
           case when community_visibility = 'anonymous' then null
                else nullif(trim(display_name), '') end as name,
           created
      from sichtbar
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
    'newest_member', (
      select jsonb_build_object('name', b.name, 'since', b.created)
        from benannt b order by b.created desc nulls last limit 1),

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
