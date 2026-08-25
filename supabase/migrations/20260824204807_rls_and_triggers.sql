-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so the policies on `profiles` don't recurse when a policy
-- on profiles itself calls this. search_path is pinned per Supabase guidance.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and status = 'active'
  );
$$;

create or replace function public.is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and status = 'active'
  );
$$;

-- --------------------------------------------------------------------------
-- New-user provisioning
-- --------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_first boolean;
  assigned public.user_role;
begin
  select count(*) = 0 into is_first from public.profiles;

  -- The very first account to sign up owns the deployment, and the project
  -- owner's address is always an admin. Everyone else starts as a normal user
  -- and can only be promoted from the admin panel.
  if is_first or new.email = 'zasif855@gmail.com' then
    assigned := 'admin';
  else
    assigned := 'user';
  end if;

  insert into public.profiles (id, email, display_name, avatar_seed, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    encode(gen_random_bytes(8), 'hex'),
    assigned
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- keep documents.updated_at / word_count honest
create or replace function public.touch_document()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.word_count := coalesce(array_length(
    regexp_split_to_array(btrim(new.content), '\s+'), 1), 0);
  return new;
end;
$$;

create trigger documents_touch
  before insert or update on public.documents
  for each row execute function public.touch_document();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.models            enable row level security;
alter table public.training_runs     enable row level security;
alter table public.training_metrics  enable row level security;
alter table public.documents         enable row level security;
alter table public.prediction_events enable row level security;
alter table public.api_keys          enable row level security;
alter table public.feature_flags     enable row level security;
alter table public.audit_log         enable row level security;

-- profiles ------------------------------------------------------------------
create policy "read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "admins read all profiles" on public.profiles
  for select to authenticated using (public.is_admin());
-- A user may edit their own row, but the WITH CHECK re-reads role/status from
-- the existing row, so they cannot escalate themselves to admin.
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role   = (select p.role   from public.profiles p where p.id = (select auth.uid()))
    and status = (select p.status from public.profiles p where p.id = (select auth.uid()))
  );
create policy "admins manage profiles" on public.profiles
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- models: every signed-in client needs to know which model to download -------
create policy "read models" on public.models
  for select to authenticated using (true);
create policy "anon reads active models" on public.models
  for select to anon using (status = 'active');
create policy "admins write models" on public.models
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- training telemetry: readable by signed-in users, writable by admins --------
create policy "read runs" on public.training_runs
  for select to authenticated using (true);
create policy "admins write runs" on public.training_runs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "read metrics" on public.training_metrics
  for select to authenticated using (true);
create policy "admins write metrics" on public.training_metrics
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- documents -----------------------------------------------------------------
create policy "own documents" on public.documents
  for all to authenticated
  using (user_id = (select auth.uid()) and public.is_active())
  with check (user_id = (select auth.uid()) and public.is_active());
create policy "admins read documents" on public.documents
  for select to authenticated using (public.is_admin());

-- prediction events ---------------------------------------------------------
create policy "insert own events" on public.prediction_events
  for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_active());
create policy "read own events" on public.prediction_events
  for select to authenticated using (user_id = (select auth.uid()));
create policy "admins read events" on public.prediction_events
  for select to authenticated using (public.is_admin());

-- api keys ------------------------------------------------------------------
create policy "own api keys" on public.api_keys
  for all to authenticated
  using (user_id = (select auth.uid()) and public.is_active())
  with check (user_id = (select auth.uid()) and public.is_active());
create policy "admins read api keys" on public.api_keys
  for select to authenticated using (public.is_admin());

-- feature flags -------------------------------------------------------------
create policy "read flags" on public.feature_flags
  for select to authenticated using (true);
create policy "anon reads flags" on public.feature_flags
  for select to anon using (true);
create policy "admins write flags" on public.feature_flags
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- audit log -----------------------------------------------------------------
create policy "admins read audit" on public.audit_log
  for select to authenticated using (public.is_admin());
create policy "authenticated append audit" on public.audit_log
  for insert to authenticated with check (actor_id = (select auth.uid()));
