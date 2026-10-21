-- Club Pasos de Color · v2: los que juegan son los CLUBES DE BARRIO.
-- Un club se postula (dirigente/jugador) y los hinchas lo apoyan: cada hincha = 1 chance para su club.
-- El premio (medias personalizadas) se define en cada ronda desde el panel.

create table public.club_teams (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  code          text not null unique,
  name          text not null check (char_length(name) between 2 and 80),
  sport         text check (char_length(sport) <= 40),
  barrio        text check (char_length(barrio) <= 80),
  city          text not null check (char_length(city) between 2 and 80),
  province      text not null check (char_length(province) between 2 and 60),
  color1        text not null default '#5B2BB5' check (color1 ~ '^#[0-9A-Fa-f]{6}$'),
  color2        text not null default '#FFFFFF' check (color2 ~ '^#[0-9A-Fa-f]{6}$'),
  story         text check (char_length(story) <= 400),
  rep_name      text not null check (char_length(rep_name) between 2 and 80),
  rep_role      text check (char_length(rep_role) <= 40),
  rep_email     text not null check (rep_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  rep_phone     text check (char_length(rep_phone) <= 30),
  rep_instagram text check (char_length(rep_instagram) <= 60),
  team_instagram text check (char_length(team_instagram) <= 60),
  channels      jsonb not null default '{}'::jsonb,
  visible       boolean not null default true
);
create unique index club_teams_name_city_uq on public.club_teams (lower(name), lower(city));
alter table public.club_teams enable row level security;

create table public.club_supporters (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  team_id    uuid not null references public.club_teams (id) on delete cascade,
  name       text not null check (char_length(name) between 2 and 80),
  email      text not null unique check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  city       text check (char_length(city) <= 80),
  instagram  text check (char_length(instagram) <= 60),
  channels   jsonb not null default '{}'::jsonb
);
create index club_supporters_team_idx on public.club_supporters (team_id);
alter table public.club_supporters enable row level security;

alter table public.club_rounds
  add column winner_team   uuid references public.club_teams (id) on delete set null,
  add column winner_barrio text,
  add column winner_color1 text,
  add column winner_color2 text;

-- ---------- Públicas ----------
create or replace function public.club_team_json(t public.club_teams)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'code', t.code, 'name', t.name, 'sport', t.sport, 'barrio', t.barrio, 'city', t.city, 'province', t.province,
    'color1', t.color1, 'color2', t.color2, 'story', t.story, 'instagram', t.team_instagram,
    'supporters', (select count(*) from club_supporters s where s.team_id = t.id),
    'won', exists (select 1 from club_rounds r where r.winner_team = t.id and r.status = 'done'),
    'created_at', t.created_at);
$$;

create or replace function public.club_register_team(
  p_name text, p_sport text, p_barrio text, p_city text, p_province text, p_color1 text, p_color2 text,
  p_story text, p_rep_name text, p_rep_role text, p_rep_email text, p_rep_phone text default null,
  p_rep_instagram text default null, p_team_instagram text default null, p_channels jsonb default '{}'::jsonb
) returns json language plpgsql security definer set search_path = public, extensions as $$
declare t club_teams; v_code text; v_email text := lower(trim(p_rep_email));
begin
  select * into t from club_teams where lower(name) = lower(trim(p_name)) and lower(city) = lower(trim(p_city));
  if found then
    return json_build_object('existing', true, 'team', club_team_json(t));
  end if;
  loop
    v_code := 'CLB-' || upper(substr(encode(gen_random_bytes(3), 'hex'), 1, 5));
    exit when not exists (select 1 from club_teams where code = v_code);
  end loop;
  insert into club_teams (code, name, sport, barrio, city, province, color1, color2, story, rep_name, rep_role,
                          rep_email, rep_phone, rep_instagram, team_instagram, channels)
  values (v_code, trim(p_name), nullif(trim(p_sport), ''), nullif(trim(p_barrio), ''), trim(p_city), trim(p_province),
          coalesce(nullif(p_color1, ''), '#5B2BB5'), coalesce(nullif(p_color2, ''), '#FFFFFF'), nullif(trim(p_story), ''),
          trim(p_rep_name), nullif(trim(p_rep_role), ''), v_email, nullif(trim(p_rep_phone), ''),
          nullif(trim(p_rep_instagram), ''), nullif(trim(p_team_instagram), ''), coalesce(p_channels, '{}'::jsonb))
  returning * into t;
  -- quien postula es el primer hincha del club (si todavía no apoya a otro)
  insert into club_supporters (team_id, name, email, city, instagram, channels)
  values (t.id, trim(p_rep_name), v_email, trim(p_city), nullif(trim(p_rep_instagram), ''), coalesce(p_channels, '{}'::jsonb))
  on conflict (email) do nothing;
  return json_build_object('existing', false, 'team', club_team_json(t));
end $$;

create or replace function public.club_support_team(
  p_code text, p_name text, p_email text, p_city text default null, p_instagram text default null, p_channels jsonb default '{}'::jsonb
) returns json language plpgsql security definer set search_path = public as $$
declare t club_teams; s club_supporters; other club_teams;
begin
  select * into t from club_teams where code = upper(trim(p_code)) and visible;
  if not found then raise exception 'Club no encontrado'; end if;
  select * into s from club_supporters where email = lower(trim(p_email));
  if found then
    if s.team_id = t.id then
      return json_build_object('status', 'existing', 'team', club_team_json(t));
    end if;
    select * into other from club_teams where id = s.team_id;
    return json_build_object('status', 'other', 'team', club_team_json(other));
  end if;
  insert into club_supporters (team_id, name, email, city, instagram, channels)
  values (t.id, trim(p_name), lower(trim(p_email)), nullif(trim(p_city), ''), nullif(trim(p_instagram), ''), coalesce(p_channels, '{}'::jsonb));
  return json_build_object('status', 'new', 'team', club_team_json(t));
end $$;

create or replace function public.club_public_teams()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(j order by (j->>'supporters')::int desc, j->>'created_at'), '[]'::json)
  from (select club_team_json(t) j from club_teams t where t.visible) x;
$$;

create or replace function public.club_team_status(p_code text)
returns json language sql stable security definer set search_path = public as $$
  select club_team_json(t) from club_teams t where t.code = upper(trim(p_code)) and t.visible;
$$;

create or replace function public.club_public_stats()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'teams', (select count(*) from club_teams where visible),
    'supporters', (select count(*) from club_supporters s join club_teams t on t.id = s.team_id where t.visible),
    'cities', (select count(distinct lower(city)) from club_teams where visible));
$$;

-- ---------- Admin ----------
create or replace function public.club_admin_pick_winner(p_pass text, p_round_id bigint, p_allow_repeat boolean default false)
returns public.club_rounds language plpgsql security definer set search_path = public as $$
declare v_tid uuid; t club_teams; v club_rounds;
begin
  perform private.club_assert_admin(p_pass);
  select w.id into v_tid from (
    select tt.id, greatest(1, (select count(*) from club_supporters s where s.team_id = tt.id)) as weight
    from club_teams tt
    where tt.visible and (p_allow_repeat or not exists (select 1 from club_rounds x where x.winner_team = tt.id and x.status = 'done'))
  ) w order by -ln(1 - random()) / w.weight limit 1;
  if v_tid is null then raise exception 'No hay clubes para elegir'; end if;
  select * into t from club_teams where id = v_tid;
  update club_rounds set status = 'done', winner_team = t.id, winner_participant = null,
    winner_name = t.name, winner_club = t.sport, winner_barrio = t.barrio, winner_city = t.city || ', ' || t.province,
    winner_ticket = t.code, winner_color1 = t.color1, winner_color2 = t.color2, picked_at = now()
  where id = p_round_id returning * into v;
  if not found then raise exception 'Ronda inexistente'; end if;
  return v;
end $$;

create or replace function public.club_admin_start_live(p_pass text, p_round_id bigint, p_seconds int default 30)
returns public.club_rounds language plpgsql security definer set search_path = public as $$
declare v club_rounds;
begin
  perform private.club_assert_admin(p_pass);
  update club_rounds set status = 'live',
    countdown_ends_at = now() + make_interval(secs => greatest(5, least(coalesce(p_seconds, 30), 600))),
    winner_name = null, winner_club = null, winner_city = null, winner_ticket = null, winner_participant = null,
    winner_team = null, winner_barrio = null, winner_color1 = null, winner_color2 = null, picked_at = null
  where id = p_round_id returning * into v;
  if not found then raise exception 'Ronda inexistente'; end if;
  return v;
end $$;

create or replace function public.club_admin_winner_contact(p_pass text, p_round_id bigint)
returns json language plpgsql security definer set search_path = public as $$
declare r json;
begin
  perform private.club_assert_admin(p_pass);
  select json_build_object('team', t.name, 'code', t.code, 'name', t.rep_name, 'role', t.rep_role, 'email', t.rep_email,
    'phone', t.rep_phone, 'instagram', coalesce(t.team_instagram, t.rep_instagram), 'city', t.city, 'province', t.province,
    'barrio', t.barrio, 'color1', t.color1, 'color2', t.color2,
    'supporters', (select count(*) from club_supporters s where s.team_id = t.id)) into r
  from club_rounds x join club_teams t on t.id = x.winner_team where x.id = p_round_id;
  return r;
end $$;

create or replace function public.club_admin_list_teams(p_pass text)
returns table (created_at timestamptz, code text, name text, sport text, barrio text, city text, province text,
               color1 text, color2 text, story text, rep_name text, rep_role text, rep_email text, rep_phone text,
               rep_instagram text, team_instagram text, visible boolean, supporters bigint)
language plpgsql security definer set search_path = public as $$
begin
  perform private.club_assert_admin(p_pass);
  return query select t.created_at, t.code, t.name, t.sport, t.barrio, t.city, t.province, t.color1, t.color2, t.story,
    t.rep_name, t.rep_role, t.rep_email, t.rep_phone, t.rep_instagram, t.team_instagram, t.visible,
    (select count(*) from club_supporters s where s.team_id = t.id)
  from club_teams t order by 18 desc, t.created_at;
end $$;

create or replace function public.club_admin_list_supporters(p_pass text)
returns table (created_at timestamptz, team_code text, team_name text, name text, email text, city text, instagram text)
language plpgsql security definer set search_path = public as $$
begin
  perform private.club_assert_admin(p_pass);
  return query select s.created_at, t.code, t.name, s.name, s.email, s.city, s.instagram
  from club_supporters s join club_teams t on t.id = s.team_id order by s.created_at desc;
end $$;

create or replace function public.club_admin_set_team_visible(p_pass text, p_code text, p_visible boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform private.club_assert_admin(p_pass);
  update club_teams set visible = p_visible where code = upper(trim(p_code));
end $$;

-- Las funciones de la v1 (participantes individuales) dejan de usarse.
revoke execute on function public.club_register_participant(text, text, text, text, text, text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.club_participant_status(text) from public, anon, authenticated;
revoke execute on function public.club_admin_list_participants(text) from public, anon, authenticated;
revoke execute on function public.club_team_json(public.club_teams) from public, anon, authenticated;
