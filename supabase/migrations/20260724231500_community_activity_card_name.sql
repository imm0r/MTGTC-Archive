-- =====================================================================
-- Community Foundation — Kartenname im Aktivitätsstrom.
--
-- Bis hier hielt die Tabelle bewusst KEINE Kartendaten: der Feed nannte nur
-- Aktion, Person und Zeitpunkt. Diese Migration lockert das für einen Fall
-- gezielt — der Feed zeigt jetzt, WELCHE Karte erfasst wurde, damit daneben
-- eine Kartenvorschau stehen kann.
--
-- Bewusst eng gehalten:
--   * Nur 'card_added'. Decks und Termine bleiben namenlos.
--   * Nur Name und Bild-URL. Kein Preis, kein Zustand, keine Stückzahl,
--     keine Sprache — nichts, was Rückschlüsse auf den Wert oder den
--     Zuschnitt einer fremden Sammlung erlaubt.
--   * Der Name ist der englische Kartenname (cards.name), nicht der
--     gedruckte. Kartendaten werden in dieser Anwendung nie übersetzt.
--
-- Bestehende Zeilen bekommen nichts nachgetragen: welche Karte damals
-- gemeint war, steht nirgends mehr fest. Die Oberfläche fällt für sie auf
-- die bisherige Formulierung ohne Namen zurück.
-- =====================================================================

create or replace function public.log_card_added_activity()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.qty > old.qty then
    perform public.record_community_activity(new.user_id, 'card_added',
      jsonb_strip_nulls(jsonb_build_object('name', new.name, 'img', new.img)));
  end if;
  return new;
end;
$$;
