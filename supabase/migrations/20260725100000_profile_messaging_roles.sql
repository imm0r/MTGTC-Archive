-- =====================================================================
--  Nutzerverwaltung: Profil, Nachrichten, Personensuche, Rechte
--
--  Diese Datei haelt fest, was per MCP bereits eingespielt wurde. Sie ist
--  die Fassung, die zaehlt — laeuft sie erneut, ist das Ergebnis dasselbe.
-- =====================================================================

-- ---- Zwei weitere Pruefverfahren (Ergaenzung zu verify_cite/verify_model)
insert into feature_flags (key, enabled) values
  ('verify_cost', false),   -- Manakosten mitliefern: sie stehen NICHT im Regeltext,
                            -- deshalb konnte der Pruefer "kostet vier Mana" nie
                            -- bestaetigen und verwarf eine richtige Begruendung.
  ('verify_pair', false)    -- die vorgeschlagene Karte mitliefern: ohne sie ist
                            -- ein Vergleichssatz strukturell halb unbelegbar.
on conflict (key) do nothing;

-- ---- Profil: die Felder, die ein Forum ueblicherweise hat
alter table profiles
  add column if not exists bio              text,
  add column if not exists location         text,
  add column if not exists website          text,
  add column if not exists favourite_format text,
  add column if not exists last_seen        timestamptz,
  add column if not exists findable         boolean not null default true;

comment on column profiles.findable is
  'Darf ueber die Personensuche gefunden werden. Aus = nur noch ueber den Freundescode erreichbar.';

-- ---- Rechte: Rollen, Gruppen, Berechtigungen
create table if not exists roles (
  key text primary key, name text not null, rang int not null default 0);
create table if not exists role_perms (
  role_key text not null references roles(key) on delete cascade,
  perm text not null, primary key (role_key, perm));
create table if not exists user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_key text not null references roles(key) on delete cascade,
  granted timestamptz not null default now(), primary key (user_id, role_key));
create table if not exists groups (
  key text primary key, name text not null);
create table if not exists group_members (
  group_key text not null references groups(key) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined timestamptz not null default now(), primary key (group_key, user_id));
-- Eine Gruppe traegt Rollen; wer drin ist, erbt sie. Damit laesst sich
-- "alle Tester bekommen die Vorschau" in einem Zug regeln.
create table if not exists group_roles (
  group_key text not null references groups(key) on delete cascade,
  role_key text not null references roles(key) on delete cascade,
  primary key (group_key, role_key));

insert into roles (key, name, rang) values
  ('admin','Administrator',100), ('moderator','Moderator',60),
  ('tester','Tester',40), ('member','Mitglied',10)
on conflict (key) do nothing;

insert into role_perms (role_key, perm) values
  ('admin','admin.panel'), ('admin','users.manage'), ('admin','roles.manage'),
  ('admin','features.manage'), ('admin','community.moderate'), ('admin','messages.moderate'),
  ('moderator','community.moderate'), ('moderator','messages.moderate'),
  ('tester','features.preview')
on conflict do nothing;

insert into groups (key, name) values ('testers','Testgruppe') on conflict (key) do nothing;
insert into group_roles (group_key, role_key) values ('testers','tester') on conflict do nothing;

create or replace function my_perms()
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct rp.perm), array[]::text[])
  from role_perms rp
  where rp.role_key in (
    select ur.role_key from user_roles ur where ur.user_id = auth.uid()
    union
    select gr.role_key from group_roles gr
      join group_members gm on gm.group_key = gr.group_key
     where gm.user_id = auth.uid());
$$;

-- is_admin() bleibt der harte Rueckfall auf den Eigentuemer: sonst koennte
-- eine falsch gesetzte Rolle den Betreiber aus seiner Instanz aussperren.
create or replace function has_perm(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select is_admin() or p = any(my_perms());
$$;

revoke all on function my_perms() from public;
revoke all on function has_perm(text) from public;
grant execute on function my_perms() to authenticated;
grant execute on function has_perm(text) to authenticated;

alter table roles enable row level security;
alter table role_perms enable row level security;
alter table user_roles enable row level security;
alter table groups enable row level security;
alter table group_members enable row level security;
alter table group_roles enable row level security;

do $$ declare t text; begin
  foreach t in array array['roles','role_perms','user_roles','groups','group_members','group_roles'] loop
    execute format('drop policy if exists %I_read on %I', t, t);
    execute format('create policy %I_read on %I for select using (auth.uid() is not null)', t, t);
    execute format('drop policy if exists %I_write on %I', t, t);
    execute format('create policy %I_write on %I for all using (has_perm(''roles.manage'')) with check (has_perm(''roles.manage''))', t, t);
  end loop;
end $$;

-- ---- Nachrichten (1:1)
--  Die beiden Teilnehmer stehen kanonisch sortiert (a < b). Damit erzwingt ein
--  einziger Unique-Index genau EIN Gespraech je Paar, egal wer es anlegt.
create table if not exists dm_threads (
  id bigserial primary key,
  a uuid not null references auth.users(id) on delete cascade,
  b uuid not null references auth.users(id) on delete cascade,
  created timestamptz not null default now(),
  last_message timestamptz,
  constraint dm_threads_sortiert check (a < b),
  constraint dm_threads_paar unique (a, b));

create table if not exists dm_messages (
  id bigserial primary key,
  thread_id bigint not null references dm_threads(id) on delete cascade,
  sender uuid not null references auth.users(id) on delete cascade,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created timestamptz not null default now(),
  read_at timestamptz,
  deleted boolean not null default false);

create index if not exists dm_messages_thread_idx on dm_messages (thread_id, created desc);
create index if not exists dm_threads_a_idx on dm_threads (a);
create index if not exists dm_threads_b_idx on dm_threads (b);

alter table dm_threads enable row level security;
alter table dm_messages enable row level security;

drop policy if exists dm_threads_own on dm_threads;
create policy dm_threads_own on dm_threads for select using (auth.uid() in (a, b));
drop policy if exists dm_threads_insert on dm_threads;
create policy dm_threads_insert on dm_threads for insert with check (auth.uid() in (a, b));
drop policy if exists dm_threads_update on dm_threads;
create policy dm_threads_update on dm_threads for update using (auth.uid() in (a, b)) with check (auth.uid() in (a, b));

drop policy if exists dm_messages_read on dm_messages;
create policy dm_messages_read on dm_messages for select using (exists (
  select 1 from dm_threads t where t.id = thread_id and auth.uid() in (t.a, t.b)));

-- Senden nur im eigenen Namen UND nur in eigenen Gespraechen. Beides pruefen:
-- sonst koennte man im Namen anderer schreiben.
drop policy if exists dm_messages_send on dm_messages;
create policy dm_messages_send on dm_messages for insert with check (
  sender = auth.uid() and exists (
    select 1 from dm_threads t where t.id = thread_id and auth.uid() in (t.a, t.b)));

drop policy if exists dm_messages_update on dm_messages;
create policy dm_messages_update on dm_messages for update using (exists (
  select 1 from dm_threads t where t.id = thread_id and auth.uid() in (t.a, t.b)));

create or replace function dm_thread_with(p_other uuid)
returns bigint language plpgsql security definer set search_path = public as $$
declare ich uuid := auth.uid(); x uuid; y uuid; tid bigint;
begin
  if ich is null then raise exception 'Nicht angemeldet'; end if;
  if p_other is null or p_other = ich then raise exception 'Kein gueltiger Empfaenger'; end if;
  if not exists (select 1 from profiles where id = p_other) then raise exception 'Unbekannter Empfaenger'; end if;
  if ich < p_other then x := ich; y := p_other; else x := p_other; y := ich; end if;
  insert into dm_threads (a, b) values (x, y) on conflict (a, b) do nothing;
  select id into tid from dm_threads where a = x and b = y;
  return tid;
end $$;

create or replace function dm_inbox()
returns table (thread_id bigint, other_id uuid, other_name text, other_avatar text,
               last_body text, last_created timestamptz, last_sender uuid, unread bigint)
language sql stable security definer set search_path = public as $$
  select t.id, p.id, p.display_name, p.avatar_url, lm.body, lm.created, lm.sender,
         (select count(*) from dm_messages m
           where m.thread_id = t.id and m.sender <> auth.uid()
             and m.read_at is null and not m.deleted)
  from dm_threads t
  join profiles p on p.id = case when t.a = auth.uid() then t.b else t.a end
  left join lateral (select body, created, sender from dm_messages m
                      where m.thread_id = t.id and not m.deleted
                      order by created desc limit 1) lm on true
  where auth.uid() in (t.a, t.b)
  order by coalesce(lm.created, t.created) desc;
$$;

create or replace function dm_unread_total()
returns bigint language sql stable security definer set search_path = public as $$
  select count(*) from dm_messages m join dm_threads t on t.id = m.thread_id
   where auth.uid() in (t.a, t.b) and m.sender <> auth.uid()
     and m.read_at is null and not m.deleted;
$$;

create or replace function dm_mark_read(p_thread bigint)
returns void language sql security definer set search_path = public as $$
  update dm_messages set read_at = now()
   where thread_id = p_thread and sender <> auth.uid() and read_at is null
     and exists (select 1 from dm_threads t where t.id = p_thread and auth.uid() in (t.a, t.b));
$$;

create or replace function dm_touch_thread() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update dm_threads set last_message = new.created where id = new.thread_id;
  return new;
end $$;
drop trigger if exists trg_dm_touch on dm_messages;
create trigger trg_dm_touch after insert on dm_messages
for each row execute function dm_touch_thread();

-- ---- Personensuche: der Ersatz fuer die Weitergabe des Freundescodes
--  Liefert den Freundschaftsstatus gleich mit, damit die Oberflaeche direkt
--  den richtigen Knopf zeigt statt nachzufragen.
create or replace function search_people(q text)
returns table (id uuid, display_name text, avatar_url text, status text)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.avatar_url,
         coalesce((select case when f.status = 'accepted' then 'friend'
                               when f.requester = auth.uid() then 'sent'
                               else 'incoming' end
                     from friendships f
                    where (f.requester = p.id and f.addressee = auth.uid())
                       or (f.addressee = p.id and f.requester = auth.uid())
                    limit 1), 'none')
  from profiles p
  where auth.uid() is not null and p.id <> auth.uid()
    and coalesce(p.findable, true) and p.display_name is not null
    and length(btrim(coalesce(q, ''))) >= 2
    and p.display_name ilike '%' || btrim(q) || '%'
  order by case when p.display_name ilike btrim(q) || '%' then 0 else 1 end, p.display_name
  limit 25;
$$;

-- Gleiche Semantik und Rueckgabewerte wie send_friend_request, nur ohne den
-- Umweg ueber den Code. Der Code bleibt als zweiter Weg fuer alle, die sich
-- aus der Suche ausgetragen haben.
create or replace function send_friend_request_to(p_user uuid)
returns text language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); target uuid := p_user;
begin
  if me is null then return 'unauth'; end if;
  if target is null then return 'notfound'; end if;
  if not exists (select 1 from profiles where id = target) then return 'notfound'; end if;
  if target = me then return 'self'; end if;
  if exists (select 1 from friendships where status='accepted'
      and ((requester=me and addressee=target) or (requester=target and addressee=me)))
    then return 'already'; end if;
  if exists (select 1 from friendships where requester=target and addressee=me and status='pending') then
    update friendships set status='accepted' where requester=target and addressee=me;
    return 'accepted';
  end if;
  if exists (select 1 from friendships where requester=me and addressee=target and status='pending') then
    return 'pending';
  end if;
  insert into friendships(requester, addressee, status) values (me, target, 'pending');
  return 'sent';
end $$;

create or replace function public_profile(p_user uuid)
returns table (id uuid, display_name text, avatar_url text, created timestamptz,
               bio text, location text, website text, favourite_format text,
               last_seen timestamptz, roles text[], is_friend boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name, p.avatar_url, p.created,
         p.bio, p.location, p.website, p.favourite_format, p.last_seen,
         coalesce((select array_agg(r.name order by r.rang desc)
                     from user_roles ur join roles r on r.key = ur.role_key
                    where ur.user_id = p.id), array[]::text[]),
         exists (select 1 from friendships f where f.status='accepted'
                   and ((f.requester=auth.uid() and f.addressee=p.id)
                     or (f.addressee=auth.uid() and f.requester=p.id)))
  from profiles p where p.id = p_user and auth.uid() is not null;
$$;

create or replace function touch_last_seen()
returns void language sql security definer set search_path = public as $$
  update profiles set last_seen = now() where id = auth.uid();
$$;

create or replace function admin_people()
returns table (user_id uuid, display_name text, roles text[], groups text[])
language sql stable security definer set search_path = public as $$
  select p.id, p.display_name,
         coalesce((select array_agg(ur.role_key order by ur.role_key)
                     from user_roles ur where ur.user_id = p.id), array[]::text[]),
         coalesce((select array_agg(gm.group_key order by gm.group_key)
                     from group_members gm where gm.user_id = p.id), array[]::text[])
  from profiles p where has_perm('roles.manage')
  order by p.display_name nulls last;
$$;

do $$ declare f text; begin
  foreach f in array array['dm_thread_with(uuid)','dm_inbox()','dm_unread_total()','dm_mark_read(bigint)',
                           'search_people(text)','send_friend_request_to(uuid)','public_profile(uuid)',
                           'touch_last_seen()','admin_people()'] loop
    execute format('revoke all on function %s from public', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
