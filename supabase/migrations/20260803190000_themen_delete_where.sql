-- =====================================================================
-- tag_import_commit: DELETE braucht bei Supabase eine where-Klausel.
--
-- ANLASS. Der erste echte Lauf des Themen-Index scheiterte — und zwar erst
-- ganz am Ende, nachdem alle 4509 Themen und 230.993 Zuordnungen schon
-- übertragen waren:
--
--   tag_import_commit → HTTP 400
--   {"code":"21000","message":"DELETE requires a WHERE clause"}
--
-- Supabase führt die Erweiterung `safeupdate`. Die weist ein DELETE (und ein
-- UPDATE) ohne where-Klausel ab — gedacht als Schutz vor dem versehentlichen
-- „delete from kunden;" im SQL-Editor. Hier war das Leeren aber Absicht: Der
-- Tausch ersetzt den ganzen Bestand, weil Scryfall ihn nur ganz liefert.
--
-- `where true` genügt der Erweiterung und ändert an der Wirkung nichts.
--
-- WARUM ES DIE PRÜFUNG NICHT FAND. Die Migration lief vor dem Zusammenführen
-- gegen ein echtes Postgres 16, mit den echten 231.000 Zuordnungen — dort
-- fehlte `safeupdate` schlicht. Ein lokales Postgres ist eben nicht Supabase;
-- die Erweiterungen gehören zum Bild. Für den nächsten Fall dieser Art wäre
-- der Weg, sie mitzuinstallieren, statt sich auf „läuft lokal" zu verlassen.
--
-- WARUM EINE NEUE DATEI statt einer Korrektur in 20260803180000. Die ist
-- bereits eingespielt; eine bearbeitete Fassung würde von der Migrations-
-- verwaltung nicht erneut angewandt. Diese hier ist die Fassung, die zählt.
--
-- Am Rest der Funktion ändert sich nichts: delete statt truncate bleibt (nur
-- so sehen Lesende während des Tauschs den alten Bestand statt zu warten), die
-- Notbremse gegen ein zu dünnes Zwischenlager bleibt, die Reihenfolge bleibt.
-- =====================================================================
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
  -- dann das Vokabular. delete statt truncate, damit Lesende während des
  -- Tauschs den ALTEN Bestand sehen: truncate nimmt eine ACCESS EXCLUSIVE
  -- Sperre und ließe sie für die Dauer der Transaktion warten.
  --
  -- `where true` ist der Punkt dieser Migration — siehe oben.
  delete from public.card_tags where true;
  delete from public.tags where true;

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

-- Wie in der ersten Fassung: EXECUTE geht bei einer neu erzeugten Funktion von
-- selbst an PUBLIC. `create or replace` behält zwar die Rechte einer schon
-- vorhandenen Funktion, aber bei einer frischen Installation entsteht sie hier
-- zum ersten Mal — dann fehlte der Verschluss ohne diese Zeile.
revoke all on function public.tag_import_commit(text, timestamptz) from public, anon, authenticated;
