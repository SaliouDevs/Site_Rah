create table if not exists public.runtime_settings (
  id text primary key,
  maintenance_enabled boolean not null default false,
  maintenance_message text,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.runtime_settings enable row level security;

insert into public.runtime_settings (id, maintenance_enabled, maintenance_message)
values (
  'global',
  false,
  'Nous effectuons actuellement des améliorations sur eAutoecole. Merci de réessayer dans quelques instants.'
)
on conflict (id) do nothing;

drop policy if exists "runtime_settings_read_all" on public.runtime_settings;
create policy "runtime_settings_read_all"
on public.runtime_settings
for select
using (true);

drop policy if exists "runtime_settings_admin_write" on public.runtime_settings;
create policy "runtime_settings_admin_write"
on public.runtime_settings
for all
using (public.is_admin())
with check (public.is_admin());

create or replace function public.set_runtime_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_runtime_settings_updated_at on public.runtime_settings;
create trigger set_runtime_settings_updated_at
before update on public.runtime_settings
for each row
execute function public.set_runtime_settings_updated_at();
