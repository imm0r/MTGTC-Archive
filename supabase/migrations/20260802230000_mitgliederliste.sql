-- =====================================================================
-- Die Mitgliederliste.
--
-- Bisher gab es nur eine Kachel („neuestes Mitglied") und die Personensuche,
-- die einen Namen VERLANGT, bevor sie etwas zeigt. Wer wissen wollte, wer
-- sonst noch da ist, hatte keine Stelle dafür.
--
-- WAS SIE ZEIGT. Je Mitglied Name, Avatar, seit wann dabei, wann zuletzt
-- gesehen, die Rollen und das Verhältnis zum Aufrufer (befreundet, angefragt,
-- eingehend, nichts) — Letzteres gleich mit, damit die Zeile sofort den
-- richtigen Knopf zeigt, statt erst auf einen Klick hin nachzufragen. Dieselbe
-- Überlegung wie bei search_people.
--
-- FINDABLE WIRD RESPEKTIERT. Wer den Schalter „In der Personensuche auffindbar"
-- ausgeschaltet hat, steht auch hier nicht — die Zusage dazu lautet „Du bist
-- nur noch über deinen Freundescode erreichbar", und eine durchsuchbare
-- Mitgliederliste wäre genau das, wovor sie schützt. Das ist der Unterschied
-- zu community_visibility: Die Stufen regeln, was jemand TUT; findable regelt,
-- ob er in Listen auftaucht. Voreingestellt ist findable true, es geht also
-- niemand verloren, der nichts anderes gewählt hat.
--
-- OHNE ANZEIGENAMEN steht die Zeile trotzdem da, nur ohne Namen — der Client
-- setzt seine Ersatzbezeichnung ein. Seit der Anzeigename Pflicht ist, sind
-- das nur noch Konten, die sich seither nicht wieder angemeldet haben; sie
-- ganz wegzulassen hieße, die Liste unvollständig zu machen, ohne dass jemand
-- es merkte.
--
-- DIE GESAMTZAHL kommt als Spalte je Zeile mit (count(*) over ()), nicht als
-- zweite Abfrage: Sonst zählte man einen anderen Stand als den, den man zeigt.
-- Bei leerer Antwort gibt es keine Zeile und damit keine Zahl — dann ist sie
-- null, und das ist richtig so: null Treffer.
--
-- SORTIERT NACH BEITRITT, neueste zuerst. Das ist die Ordnung, in der eine
-- Mitgliederliste gelesen wird, und dieselbe, aus der die Kachel „neuestes
-- Mitglied" ihren einen Eintrag nimmt.
-- =====================================================================

drop function if exists public.member_list(text, integer, integer);
create function public.member_list(q text default null,
                                   p_limit integer default 24,
                                   p_offset integer default 0)
returns table (id uuid, display_name text, avatar_url text,
               created timestamptz, last_seen timestamptz,
               roles text[], status text, gesamt bigint)
language sql stable security definer set search_path = public as $$
  with sichtbar as (
    select p.* from public.profiles p
     where auth.uid() is not null
       and coalesce(p.findable, true)
       and (nullif(btrim(coalesce(q, '')), '') is null
            or p.display_name ilike '%' || btrim(q) || '%')
  )
  select s.id, s.display_name, s.avatar_url, s.created, s.last_seen,
         coalesce((select array_agg(r.name order by r.rang desc)
                     from user_roles ur join roles r on r.key = ur.role_key
                    where ur.user_id = s.id), array[]::text[]),
         coalesce((select case when f.status = 'accepted' then 'friend'
                               when f.requester = auth.uid() then 'sent'
                               else 'incoming' end
                     from friendships f
                    where (f.requester = s.id and f.addressee = auth.uid())
                       or (f.addressee = s.id and f.requester = auth.uid())
                    limit 1), case when s.id = auth.uid() then 'self' else 'none' end),
         count(*) over () as gesamt
    from sichtbar s
   order by s.created desc nulls last, s.id
   limit greatest(1, least(coalesce(p_limit, 24), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;
revoke all on function public.member_list(text, integer, integer) from public, anon;
grant execute on function public.member_list(text, integer, integer) to authenticated;
