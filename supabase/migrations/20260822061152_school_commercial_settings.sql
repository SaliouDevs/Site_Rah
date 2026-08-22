-- White-label commercial settings for registration/payment.
alter table public.school_settings add column if not exists plan_name text not null default 'Formule Illimitée';
alter table public.school_settings add column if not exists registration_price integer not null default 2000 check(registration_price>=0 and registration_price<=10000000);
alter table public.school_settings add column if not exists wave_payment_url text;
alter table public.school_settings add column if not exists payments_enabled boolean not null default true;
update public.school_settings set wave_payment_url=coalesce(wave_payment_url,'https://pay.wave.com/m/M_sn_h8KvN46A4_zB/c/sn/') where id='global';
create or replace function public.save_school_settings(p_settings jsonb) returns public.school_settings language plpgsql security definer set search_path='' as $$
declare v_row public.school_settings; v_price integer;
begin
  if not public.is_admin() then raise exception 'Admin required' using errcode='42501'; end if;
  begin v_price:=nullif(p_settings->>'registration_price','')::integer; exception when others then v_price:=null; end;
  update public.school_settings set
    app_name=coalesce(nullif(btrim(p_settings->>'app_name'),''),app_name),school_name=coalesce(nullif(btrim(p_settings->>'school_name'),''),school_name),tagline=coalesce(nullif(btrim(p_settings->>'tagline'),''),tagline),hero_title=coalesce(nullif(btrim(p_settings->>'hero_title'),''),hero_title),hero_message=coalesce(nullif(btrim(p_settings->>'hero_message'),''),hero_message),phone=nullif(btrim(p_settings->>'phone'),''),phone_href=nullif(btrim(p_settings->>'phone_href'),''),whatsapp=nullif(regexp_replace(coalesce(p_settings->>'whatsapp',''),'[^0-9]','','g'),''),email=nullif(btrim(p_settings->>'email'),''),address=nullif(btrim(p_settings->>'address'),''),city=coalesce(nullif(btrim(p_settings->>'city'),''),city),logo_url=nullif(btrim(p_settings->>'logo_url'),''),primary_color=case when coalesce(p_settings->>'primary_color','')~'^#[0-9A-Fa-f]{6}$' then p_settings->>'primary_color' else primary_color end,accent_color=case when coalesce(p_settings->>'accent_color','')~'^#[0-9A-Fa-f]{6}$' then p_settings->>'accent_color' else accent_color end,plan_name=coalesce(nullif(btrim(p_settings->>'plan_name'),''),plan_name),registration_price=case when v_price between 0 and 10000000 then v_price else registration_price end,wave_payment_url=case when nullif(btrim(p_settings->>'wave_payment_url'),'') is null then wave_payment_url when btrim(p_settings->>'wave_payment_url')~'^https://pay\.wave\.com/' then btrim(p_settings->>'wave_payment_url') else wave_payment_url end,payments_enabled=case when p_settings ? 'payments_enabled' then coalesce((p_settings->>'payments_enabled')::boolean,payments_enabled) else payments_enabled end,updated_at=now(),updated_by=auth.uid()
  where id='global' returning * into v_row;
  return v_row;
end;
$$;
