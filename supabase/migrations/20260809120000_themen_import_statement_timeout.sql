-- Themen-Import: statement_timeout je Funktion anheben.
--
-- tag_import_commit tauscht den ganzen Bestand in EINEM Aufruf (delete ~231.000
-- card_tags + delete tags + beides neu aus dem Zwischenlager). Über PostgREST
-- ist ein RPC eine einzige Anweisung, also zählt die Summe all dieser
-- Operationen gegen die statement_timeout. Die greift beim service_role-Aufruf
-- über die authenticator-Rolle mit 8s — zu wenig für ~460.000 Zeilen, der Lauf
-- brach mit 57014 („canceling statement due to statement timeout") ab.
--
-- tag_rollup_berechnen (~472.000 Zeilen, gemessen ~10s) lief in dieselbe Grenze;
-- sein Fehler wurde im Skript (themen.mjs) nur still verschluckt, die wirksamen
-- Kartenzahlen blieben also ohnehin vom vorletzten Lauf stehen.
--
-- Beide bekommen eine funktionslokale, großzügige Grenze. Sie gilt nur während
-- die jeweilige Funktion läuft und überschreibt die 8s für deren Dauer; ein
-- Missbrauch ist ausgeschlossen, weil beide bereits nur der service_role
-- offenstehen (siehe die revokes in 20260803180000_themen_index.sql). 3 Minuten
-- sind ein Vielfaches der gemessenen ~10–40s und fangen auch künftiges Wachsen.
alter function public.tag_import_commit(text, timestamptz) set statement_timeout = '3min';
alter function public.tag_rollup_berechnen()               set statement_timeout = '3min';
