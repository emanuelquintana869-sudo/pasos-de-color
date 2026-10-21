-- Club Pasos de Color: datos 100% separados del sitio principal.
-- Tablas y funciones con prefijo club_; contraseña de admin y claves push propias.

create table public.club_participants (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  name        text not null check (char_length(name) between 2 and 80),
  email       text not null unique check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  instagram   text check (char_length(instagram) <= 60),
  club        text check (char_length(club) <= 60),
  city        text check (char_length(city) <= 80),
  phone       text check (char_length(phone) <= 30),
  channels    jsonb not null default '{}'::jsonb,
  ticket      text not null unique,
  referred_by text,
  active      boolean not null default true
);
create index club_participants_referred_by_idx on public.club_participants (referred_by);
alter table public.club_participants enable row level security;

create table public.club_rounds (
  id                 bigint generated always as identity primary key,
  title              text not null default 'Ronda',
  prize              text not null default 'Pack de medias Good is Good × Nikao',
  scheduled_at       timestamptz not null,
  status             text not null default 'scheduled' check (status in ('scheduled', 'live', 'done', 'cancelled')),
  countdown_ends_at  timestamptz,
  winner_name        text,
  winner_club        text,
  winner_city        text,
  winner_ticket      text,
  winner_participant uuid references public.club_participants (id) on delete set null,
  picked_at          timestamptz,
  created_at         timestamptz not null default now()
);
alter table public.club_rounds enable row level security;
create policy "club rondas visibles" on public.club_rounds for select to anon, authenticated using (true);
alter publication supabase_realtime add table public.club_rounds;

create table public.club_push_subscriptions (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  ticket     text
);
alter table public.club_push_subscriptions enable row level security;

create table private.club_admin (
  id        int primary key default 1 check (id = 1),
  pass_hash text not null
);
-- Contraseña (cargar a mano, NO commitear la real):
-- insert into private.club_admin (id, pass_hash) values (1, extensions.crypt('TU-CONTRASEÑA', extensions.gen_salt('bf')))
--   on conflict (id) do update set pass_hash = excluded.pass_hash;
-- Claves push propias en private.config: club_vapid_public, club_vapid_private, club_vapid_subject

-- ---------- Públicas ----------
create or replace function public.club_register_participant(
  p_name text, p_email text, p_instagram text default null, p_club text default null,
  p_city text default null, p_phone text default null, p_channels jsonb default '{}'::jsonb, p_ref text default null
) returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_email text := lower(trim(p_email)); v_row club_participants; v_ticket text; v_ref text;
begin
  select * into v_row from club_participants where email = v_email;
  if found then
    update club_participants set channels = coalesce(p_channels, channels),
           phone = coalesce(nullif(trim(p_phone), ''), phone), active = true where id = v_row.id;
    return json_build_object('ticket', v_row.ticket, 'existing', true,
      'chances', 1 + (select count(*) from club_participants where referred_by = v_row.ticket));
  end if;
  loop
    v_ticket := 'PDC-' || upper(substr(encode(gen_random_bytes(4), 'hex'), 1, 6));
    exit when not exists (select 1 from club_participants where ticket = v_ticket);
  end loop;
  select ticket into v_ref from club_participants where ticket = upper(trim(p_ref));
  insert into club_participants (name, email, instagram, club, city, phone, channels, ticket, referred_by)
  values (trim(p_name), v_email, nullif(trim(p_instagram), ''), nullif(trim(p_club), ''), nullif(trim(p_city), ''),
          nullif(trim(p_phone), ''), coalesce(p_channels, '{}'::jsonb), v_ticket, v_ref);
  return json_build_object('ticket', v_ticket, 'existing', false, 'chances', 1);
end $$;

create or replace function public.club_participant_status(p_ticket text)
returns json language sql security definer set search_path = public stable as $$
  select json_build_object('ticket', p.ticket, 'first_name', split_part(p.name, ' ', 1),
    'chances', 1 + (select count(*) from club_participants r where r.referred_by = p.ticket))
  from club_participants p where p.ticket = upper(trim(p_ticket));
$$;

create or replace function public.club_public_stats()
returns json language sql security definer set search_path = public stable as $$
  select json_build_object('participants', (select count(*) from club_participants where active));
$$;

create or replace function public.club_save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_ticket text default null)
returns void language sql security definer set search_path = public as $$
  insert into club_push_subscriptions (endpoint, p256dh, auth, ticket)
  values (p_endpoint, p_p256dh, p_auth, nullif(upper(trim(p_ticket)), ''))
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth,
    ticket = coalesce(excluded.ticket, club_push_subscriptions.ticket);
$$;

-- ---------- Admin ----------
create or replace function private.club_assert_admin(p_pass text)
returns void language plpgsql security definer set search_path = private, extensions as $$
begin
  if not exists (select 1 from private.club_admin where pass_hash = crypt(coalesce(p_pass, ''), pass_hash)) then
    perform pg_sleep(0.5);
    raise exception 'Contraseña incorrecta' using errcode = '28P01';
  end if;
end $$;

create or replace function public.club_admin_login(p_pass text)
returns boolean language plpgsql security definer set search_path = public as $$
begin perform private.club_assert_admin(p_pass); return true; end $$;

create or replace function public.club_admin_create_round(p_pass text, p_scheduled_at timestamptz, p_prize text default null, p_title text default null)
returns public.club_rounds language plpgsql security definer set search_path = public as $$
declare v club_rounds;
begin
  perform private.club_assert_admin(p_pass);
  insert into club_rounds (scheduled_at, prize, title)
  values (p_scheduled_at, coalesce(nullif(trim(p_prize), ''), 'Pack de medias Good is Good × Nikao'), coalesce(nullif(trim(p_title), ''), 'Ronda'))
  returning * into v;
  return v;
end $$;

create or replace function public.club_admin_start_live(p_pass text, p_round_id bigint, p_seconds int default 30)
returns public.club_rounds language plpgsql security definer set search_path = public as $$
declare v club_rounds;
begin
  perform private.club_assert_admin(p_pass);
  update club_rounds set status = 'live',
    countdown_ends_at = now() + make_interval(secs => greatest(5, least(coalesce(p_seconds, 30), 600))),
    winner_name = null, winner_club = null, winner_city = null, winner_ticket = null, winner_participant = null, picked_at = null
  where id = p_round_id returning * into v;
  if not found then raise exception 'Ronda inexistente'; end if;
  return v;
end $$;

create or replace function public.club_admin_pick_winner(p_pass text, p_round_id bigint, p_allow_repeat boolean default false)
returns public.club_rounds language plpgsql security definer set search_path = public as $$
declare v_pid uuid; p club_participants; v club_rounds; v_last text;
begin
  perform private.club_assert_admin(p_pass);
  select w.id into v_pid from (
    select pp.id, 1 + (select count(*) from club_participants r where r.referred_by = pp.ticket) as weight
    from club_participants pp
    where pp.active and (p_allow_repeat or not exists (select 1 from club_rounds x where x.winner_participant = pp.id))
  ) w order by -ln(1 - random()) / w.weight limit 1;
  if v_pid is null then raise exception 'No hay participantes para elegir'; end if;
  select * into p from club_participants where id = v_pid;
  v_last := split_part(trim(p.name), ' ', 2);
  update club_rounds set status = 'done', winner_participant = p.id,
    winner_name = split_part(trim(p.name), ' ', 1) || case when v_last <> '' then ' ' || upper(left(v_last, 1)) || '.' else '' end,
    winner_club = p.club, winner_city = p.city, winner_ticket = p.ticket, picked_at = now()
  where id = p_round_id returning * into v;
  if not found then raise exception 'Ronda inexistente'; end if;
  return v;
end $$;

create or replace function public.club_admin_set_round_status(p_pass text, p_round_id bigint, p_status text)
returns public.club_rounds language plpgsql security definer set search_path = public as $$
declare v club_rounds;
begin
  perform private.club_assert_admin(p_pass);
  update club_rounds set status = p_status,
    countdown_ends_at = case when p_status = 'scheduled' then null else countdown_ends_at end
  where id = p_round_id returning * into v;
  return v;
end $$;

create or replace function public.club_admin_winner_contact(p_pass text, p_round_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare r json;
begin
  perform private.club_assert_admin(p_pass);
  select json_build_object('name', p.name, 'email', p.email, 'instagram', p.instagram, 'phone', p.phone,
    'city', p.city, 'club', p.club, 'ticket', p.ticket) into r
  from club_rounds x join club_participants p on p.id = x.winner_participant where x.id = p_round_id;
  return r;
end $$;

create or replace function public.club_admin_list_participants(p_pass text)
returns table (created_at timestamptz, name text, email text, instagram text, club text, city text,
               phone text, channels jsonb, ticket text, referred_by text, chances bigint)
language plpgsql security definer set search_path = public as $$
begin
  perform private.club_assert_admin(p_pass);
  return query select p.created_at, p.name, p.email, p.instagram, p.club, p.city, p.phone, p.channels, p.ticket, p.referred_by,
    1 + (select count(*) from club_participants r where r.referred_by = p.ticket)
  from club_participants p order by p.created_at desc;
end $$;

revoke execute on function private.club_assert_admin(text) from public, anon, authenticated;
