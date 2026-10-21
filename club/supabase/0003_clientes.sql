-- Club Pasos de Color · v3: clientes con número de pedido.
-- Cuidados:
--  * Pedido + un dato más (mail o últimos 4 del teléfono de la compra).
--  * Cada pedido se usa una sola vez.
--  * Solo se guarda lo mínimo y encriptado (hash con "pepper" secreto): ni nombres, ni montos, ni direcciones.
--  * Límite de intentos fallidos por IP (10 por hora) para que no se puedan probar números al azar.
-- Beneficio: el cliente apoya a un club y su apoyo vale x3 chances, con etiqueta "Cliente".

-- Secreto para los hash (generado una vez; NO commitear el valor real)
insert into private.config (key, value)
values ('club_order_pepper', encode(extensions.gen_random_bytes(24), 'hex'))
on conflict (key) do nothing;

create table private.club_orders (
  id          uuid primary key default gen_random_uuid(),
  order_hash  text not null unique,
  email_hash  text,
  phone_hash  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  used_by     uuid references public.club_supporters (id) on delete set null,
  used_at     timestamptz
);

create table private.club_order_attempts (
  id  bigint generated always as identity primary key,
  ip  text not null,
  ok  boolean not null,
  at  timestamptz not null default now()
);
create index club_order_attempts_ip_at on private.club_order_attempts (ip, at);

alter table public.club_supporters
  add column if not exists is_client boolean not null default false,
  add column if not exists order_id uuid;

-- ---------- Ayudas (privadas) ----------
create or replace function private.club_norm_order(t text) returns text
language sql immutable as $$ select upper(regexp_replace(coalesce(t, ''), '[\s#\-]', '', 'g')) $$;

create or replace function private.club_hash(t text) returns text
language sql stable security definer set search_path = private, extensions as $$
  select encode(extensions.digest((select value from private.config where key = 'club_order_pepper') || ':' || t, 'sha256'), 'hex')
$$;

create or replace function private.club_client_ip() returns text
language sql stable as $$
  select coalesce(split_part(nullif(current_setting('request.headers', true), '')::json->>'x-forwarded-for', ',', 1), 'sin-ip')
$$;

-- ---------- Conteos con clientes ----------
create or replace function public.club_team_json(t public.club_teams)
returns json language sql stable security definer set search_path = public as $$
  with c as (
    select count(*) as people, count(*) filter (where s.is_client) as clients
    from club_supporters s where s.team_id = t.id
  )
  select json_build_object(
    'code', t.code, 'name', t.name, 'sport', t.sport, 'barrio', t.barrio, 'city', t.city, 'province', t.province,
    'color1', t.color1, 'color2', t.color2, 'story', t.story, 'instagram', t.team_instagram,
    'supporters', case when t.is_demo then t.demo_supporters else c.people end,
    'clients', case when t.is_demo then 0 else c.clients end,
    'chances', case when t.is_demo then t.demo_supporters else c.people + 2 * c.clients end,
    'demo', t.is_demo,
    'won', exists (select 1 from club_rounds r where r.winner_team = t.id and r.status = 'done'),
    'created_at', t.created_at)
  from c;
$$;
revoke execute on function public.club_team_json(public.club_teams) from public, anon, authenticated;

create or replace function public.club_public_teams()
returns json language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(j order by (j->>'demo')::boolean, (j->>'chances')::int desc, j->>'created_at'), '[]'::json)
  from (select club_team_json(t) j from club_teams t where t.visible) x;
$$;

create or replace function public.club_public_stats()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'teams', (select count(*) from club_teams where visible and not is_demo),
    'supporters', (select count(*) from club_supporters s join club_teams t on t.id = s.team_id where t.visible and not t.is_demo),
    'clients', (select count(*) from club_supporters s join club_teams t on t.id = s.team_id where t.visible and not t.is_demo and s.is_client),
    'cities', (select count(distinct lower(city)) from club_teams where visible and not is_demo));
$$;

create or replace function public.club_admin_pick_winner(p_pass text, p_round_id bigint, p_allow_repeat boolean default false)
returns public.club_rounds language plpgsql security definer set search_path = public as $$
declare v_tid uuid; t club_teams; v club_rounds;
begin
  perform private.club_assert_admin(p_pass);
  select w.id into v_tid from (
    select tt.id, greatest(1, (select count(*) + 2 * count(*) filter (where s.is_client) from club_supporters s where s.team_id = tt.id)) as weight
    from club_teams tt
    where tt.visible and not tt.is_demo
      and (p_allow_repeat or not exists (select 1 from club_rounds x where x.winner_team = tt.id and x.status = 'done'))
  ) w order by -ln(1 - random()) / w.weight limit 1;
  if v_tid is null then raise exception 'No hay clubes reales para elegir'; end if;
  select * into t from club_teams where id = v_tid;
  update club_rounds set status = 'done', winner_team = t.id, winner_participant = null,
    winner_name = t.name, winner_club = t.sport, winner_barrio = t.barrio, winner_city = t.city || ', ' || t.province,
    winner_ticket = t.code, winner_color1 = t.color1, winner_color2 = t.color2, picked_at = now()
  where id = p_round_id returning * into v;
  if not found then raise exception 'Ronda inexistente'; end if;
  return v;
end $$;

-- ---------- Apoyar como cliente ----------
create or replace function public.club_support_team_client(
  p_code text, p_order text, p_contact text, p_name text, p_email text,
  p_city text default null, p_channels jsonb default '{}'::jsonb
) returns json language plpgsql security definer set search_path = public, private, extensions as $$
declare
  v_ip text := private.club_client_ip();
  v_fails int;
  t club_teams; o private.club_orders; s club_supporters; other club_teams;
  v_contact text := lower(trim(coalesce(p_contact, '')));
  v_ok boolean := false;
  v_email text := lower(trim(p_email));
begin
  select count(*) into v_fails from private.club_order_attempts where ip = v_ip and not ok and at > now() - interval '1 hour';
  if v_fails >= 10 then
    return json_build_object('status', 'limit');
  end if;

  select * into t from club_teams where code = upper(trim(p_code)) and visible and not is_demo;
  if not found then return json_build_object('status', 'no_team'); end if;

  select * into o from private.club_orders where order_hash = private.club_hash(private.club_norm_order(p_order));
  if found then
    if position('@' in v_contact) > 0 then
      v_ok := o.email_hash is not null and o.email_hash = private.club_hash(v_contact);
    else
      v_contact := right(regexp_replace(v_contact, '\D', '', 'g'), 4);
      v_ok := length(v_contact) = 4 and o.phone_hash is not null and o.phone_hash = private.club_hash(v_contact);
    end if;
  end if;

  insert into private.club_order_attempts (ip, ok) values (v_ip, v_ok);
  -- Se devuelve (no se lanza error) para que el intento fallido quede registrado
  if not v_ok then
    return json_build_object('status', 'invalid');
  end if;

  select * into s from club_supporters where email = v_email;

  if o.used_by is not null and (s.id is null or o.used_by <> s.id) then
    return json_build_object('status', 'used');
  end if;

  if s.id is not null and s.team_id <> t.id then
    select * into other from club_teams where id = s.team_id;
    return json_build_object('status', 'other', 'team', club_team_json(other));
  end if;

  if s.id is null then
    insert into club_supporters (team_id, name, email, city, channels, is_client, order_id)
    values (t.id, trim(p_name), v_email, nullif(trim(p_city), ''), coalesce(p_channels, '{}'::jsonb), true, o.id)
    returning * into s;
    update private.club_orders set used_by = s.id, used_at = now() where id = o.id;
    return json_build_object('status', 'new_client', 'team', club_team_json(t));
  end if;

  if s.is_client then
    return json_build_object('status', 'existing', 'team', club_team_json(t));
  end if;
  update club_supporters set is_client = true, order_id = o.id where id = s.id;
  update private.club_orders set used_by = s.id, used_at = now() where id = o.id;
  return json_build_object('status', 'upgraded', 'team', club_team_json(t));
end $$;

-- ---------- Panel: cargar pedidos ----------
-- p_rows: [{"o": "numero de pedido", "e": "mail", "p": "telefono"}, ...]  (e y p opcionales, al menos uno)
create or replace function public.club_admin_import_orders(p_pass text, p_rows jsonb)
returns json language plpgsql security definer set search_path = public, private, extensions as $$
declare r jsonb; v_o text; v_e text; v_p text; ins int := 0; upd int := 0; skip int := 0; was_insert boolean;
begin
  perform private.club_assert_admin(p_pass);
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then
    raise exception 'Mandá de a 2000 pedidos como máximo';
  end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_o := private.club_norm_order(r->>'o');
    v_e := nullif(lower(trim(coalesce(r->>'e', ''))), '');
    v_p := right(regexp_replace(coalesce(r->>'p', ''), '\D', '', 'g'), 4);
    if v_o = '' or (v_e is null and length(v_p) < 4) then skip := skip + 1; continue; end if;
    insert into private.club_orders (order_hash, email_hash, phone_hash)
    values (private.club_hash(v_o), case when v_e is not null then private.club_hash(v_e) end,
            case when length(v_p) = 4 then private.club_hash(v_p) end)
    on conflict (order_hash) do update set
      email_hash = coalesce(excluded.email_hash, private.club_orders.email_hash),
      phone_hash = coalesce(excluded.phone_hash, private.club_orders.phone_hash),
      updated_at = now()
    returning (xmax = 0) into was_insert;
    if was_insert then ins := ins + 1; else upd := upd + 1; end if;
  end loop;
  return json_build_object('inserted', ins, 'updated', upd, 'skipped', skip);
end $$;

create or replace function public.club_admin_orders_stats(p_pass text)
returns json language plpgsql security definer set search_path = public, private as $$
declare r json;
begin
  perform private.club_assert_admin(p_pass);
  select json_build_object('total', count(*), 'used', count(*) filter (where used_by is not null),
    'last_upload', max(updated_at)) into r from private.club_orders;
  return r;
end $$;

revoke execute on function private.club_hash(text) from public, anon, authenticated;
revoke execute on function private.club_norm_order(text) from public, anon, authenticated;
revoke execute on function private.club_client_ip() from public, anon, authenticated;
