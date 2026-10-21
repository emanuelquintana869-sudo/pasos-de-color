-- Verificar un número de pedido en el momento (antes de postular o apoyar).
-- No consume el pedido; los intentos fallidos cuentan para el límite (10/IP/hora, 5/pedido/hora).
create or replace function public.club_check_order(p_order text)
returns json language plpgsql security definer set search_path to 'public','private','extensions' as $$
declare
  v_ip text := private.club_client_ip();
  v_hash text := private.club_hash(private.club_norm_order(p_order));
  o private.club_orders;
begin
  if coalesce(trim(p_order),'') = '' then return json_build_object('status','invalid'); end if;
  if (select count(*) from private.club_order_attempts where ip = v_ip and not ok and at > now() - interval '1 hour') >= 10
     or (select count(*) from private.club_order_attempts where order_hash = v_hash and not ok and at > now() - interval '1 hour') >= 5 then
    return json_build_object('status','limit');
  end if;
  select * into o from private.club_orders where order_hash = v_hash
    and email_hash is null and phone_hash is null and code_hash is null;
  if not found then
    insert into private.club_order_attempts (ip, ok, order_hash) values (v_ip, false, v_hash);
    return json_build_object('status','invalid');
  end if;
  if o.used_by is not null then return json_build_object('status','used'); end if;
  return json_build_object('status','ok');
end $$;
revoke all on function public.club_check_order(text) from public;
grant execute on function public.club_check_order(text) to anon, authenticated;
