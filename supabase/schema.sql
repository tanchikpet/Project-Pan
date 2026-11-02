-- Run once in the project's Supabase SQL Editor. Safe to run again.
begin;

create table if not exists public.pan_collections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  groups jsonb not null,
  revision bigint not null default 1 check (revision > 0),
  updated_at timestamptz not null default now(),
  constraint pan_groups_shape check (
    jsonb_typeof(groups) = 'object'
    and groups ?& array['tableBody','skFaceTableBody','skBodyTableBody']
    and jsonb_typeof(groups->'tableBody') = 'array'
    and jsonb_typeof(groups->'skFaceTableBody') = 'array'
    and jsonb_typeof(groups->'skBodyTableBody') = 'array'
  )
);

alter table public.pan_collections enable row level security;
revoke all on public.pan_collections from anon, authenticated;
grant select on public.pan_collections to authenticated;
drop policy if exists pan_read_own_collection on public.pan_collections;
create policy pan_read_own_collection on public.pan_collections
  for select to authenticated using ((select auth.uid()) = user_id);

-- All writes go through compare-and-swap. A stale device gets a conflict,
-- never a successful silent overwrite. No user ID is accepted from clients.
create or replace function public.pan_save_collection(p_groups jsonb, p_revision bigint)
returns setof public.pan_collections
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  result public.pan_collections;
begin
  if caller is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_groups is null or p_revision is null or p_revision < 0
     or pg_catalog.octet_length(p_groups::text) > 5000000 then
    raise exception 'Invalid collection' using errcode = '22023';
  end if;
  if p_revision = 0 then
    insert into public.pan_collections(user_id, groups)
    values(caller, p_groups) on conflict (user_id) do nothing
    returning * into result;
  else
    update public.pan_collections set groups = p_groups,
      revision = revision + 1, updated_at = pg_catalog.now()
    where user_id = caller and revision = p_revision
    returning * into result;
  end if;
  if result.user_id is null then
    raise exception 'Collection changed on another device' using errcode = '40001';
  end if;
  return next result;
end;
$$;
revoke all on function public.pan_save_collection(jsonb,bigint) from public, anon;
grant execute on function public.pan_save_collection(jsonb,bigint) to authenticated;

-- Deletes only the caller's account; collection is removed by the FK cascade.
create or replace function public.pan_delete_account()
returns void language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid();
begin
  if caller is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  delete from auth.users where id = caller;
end;
$$;
revoke all on function public.pan_delete_account() from public, anon;
grant execute on function public.pan_delete_account() to authenticated;
commit;
