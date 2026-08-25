-- ---------------------------------------------------------------------------
-- Analytics RPCs.
--
-- These run as SECURITY INVOKER, so RLS still applies -- but the user-facing
-- ones additionally pin user_id = auth.uid(), because an admin's RLS policy
-- would otherwise widen "my stats" to "everyone's stats".
-- ---------------------------------------------------------------------------

create or replace function public.user_stats(days integer default 30)
returns table (
  predictions      bigint,
  accepted         bigint,
  acceptance_rate  numeric,
  chars_saved      bigint,
  avg_latency_ms   numeric,
  p95_latency_ms   numeric,
  active_days      bigint,
  documents        bigint,
  words_written    bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ev as (
    select * from public.prediction_events
    where user_id = (select auth.uid())
      and created_at >= now() - (days || ' days')::interval
  )
  select
    (select count(*) from ev),
    (select count(*) from ev where accepted),
    (select round(100.0 * count(*) filter (where accepted)
                  / nullif(count(*), 0), 2) from ev),
    (select coalesce(sum(chars_saved), 0) from ev where accepted),
    (select round(avg(latency_ms), 2) from ev),
    (select round(percentile_cont(0.95) within group (order by latency_ms)::numeric, 2) from ev),
    (select count(distinct date_trunc('day', created_at)) from ev),
    (select count(*) from public.documents where user_id = (select auth.uid())),
    (select coalesce(sum(word_count), 0) from public.documents
      where user_id = (select auth.uid()));
$$;

create or replace function public.user_daily_series(days integer default 30)
returns table (
  day             date,
  predictions     bigint,
  accepted        bigint,
  chars_saved     bigint,
  avg_latency_ms  numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    d::date,
    count(e.id),
    count(e.id) filter (where e.accepted),
    coalesce(sum(e.chars_saved) filter (where e.accepted), 0),
    round(avg(e.latency_ms), 2)
  from generate_series(
         (current_date - (days - 1))::timestamptz, current_date::timestamptz,
         '1 day') d
  left join public.prediction_events e
    on e.user_id = (select auth.uid())
   and e.created_at >= d and e.created_at < d + interval '1 day'
  group by d
  order by d;
$$;

-- ------------------------------------------------------------- admin -------

create or replace function public.admin_overview()
returns table (
  total_users        bigint,
  active_7d          bigint,
  new_7d             bigint,
  suspended          bigint,
  total_predictions  bigint,
  predictions_24h    bigint,
  acceptance_rate    numeric,
  p50_latency_ms     numeric,
  p95_latency_ms     numeric,
  total_documents    bigint,
  chars_saved        bigint,
  active_models      bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    (select count(*) from public.profiles),
    (select count(distinct e.user_id) from public.prediction_events e
      where e.created_at >= now() - interval '7 days'),
    (select count(*) from public.profiles where created_at >= now() - interval '7 days'),
    (select count(*) from public.profiles where status = 'suspended'),
    (select count(*) from public.prediction_events),
    (select count(*) from public.prediction_events
      where created_at >= now() - interval '24 hours'),
    (select round(100.0 * count(*) filter (where accepted) / nullif(count(*), 0), 2)
       from public.prediction_events),
    (select round(percentile_cont(0.5) within group (order by latency_ms)::numeric, 2)
       from public.prediction_events),
    (select round(percentile_cont(0.95) within group (order by latency_ms)::numeric, 2)
       from public.prediction_events),
    (select count(*) from public.documents),
    (select coalesce(sum(chars_saved), 0) from public.prediction_events where accepted),
    (select count(*) from public.models where status = 'active');
end;
$$;

create or replace function public.admin_daily_series(days integer default 30)
returns table (
  day             date,
  predictions     bigint,
  accepted        bigint,
  active_users    bigint,
  new_users       bigint,
  avg_latency_ms  numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    d::date,
    count(e.id),
    count(e.id) filter (where e.accepted),
    count(distinct e.user_id),
    (select count(*) from public.profiles p
      where p.created_at >= d and p.created_at < d + interval '1 day'),
    round(avg(e.latency_ms), 2)
  from generate_series(
         (current_date - (days - 1))::timestamptz, current_date::timestamptz,
         '1 day') d
  left join public.prediction_events e
    on e.created_at >= d and e.created_at < d + interval '1 day'
  group by d
  order by d;
end;
$$;

-- Which words the model actually suggests, and how often people take them.
create or replace function public.admin_top_tokens(n integer default 20)
returns table (token text, suggested bigint, accepted bigint, accept_pct numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select e.top1_token,
         count(*),
         count(*) filter (where e.accepted),
         round(100.0 * count(*) filter (where e.accepted) / nullif(count(*), 0), 1)
  from public.prediction_events e
  where e.top1_token is not null
  group by e.top1_token
  order by count(*) desc
  limit n;
end;
$$;

create or replace function public.admin_latency_buckets()
returns table (bucket text, lo numeric, n bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  with b(label, lo, hi) as (
    values ('<5ms', 0, 5), ('5-10', 5, 10), ('10-25', 10, 25), ('25-50', 25, 50),
           ('50-100', 50, 100), ('100-250', 100, 250), ('250ms+', 250, 1e9)
  )
  select b.label, b.lo::numeric,
         (select count(*) from public.prediction_events e
           where e.latency_ms >= b.lo and e.latency_ms < b.hi)
  from b order by b.lo;
end;
$$;

-- Paginated user table for the admin panel, joined with per-user usage.
create or replace function public.admin_user_list(
  search text default '', lim integer default 50, off integer default 0)
returns table (
  id uuid, email text, display_name text, role public.user_role,
  status public.account_status, created_at timestamptz, last_seen_at timestamptz,
  predictions bigint, accepted bigint, documents bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select p.id, p.email, p.display_name, p.role, p.status, p.created_at, p.last_seen_at,
         (select count(*) from public.prediction_events e where e.user_id = p.id),
         (select count(*) from public.prediction_events e
           where e.user_id = p.id and e.accepted),
         (select count(*) from public.documents d where d.user_id = p.id)
  from public.profiles p
  where search = ''
     or p.email ilike '%' || search || '%'
     or p.display_name ilike '%' || search || '%'
  order by p.created_at desc
  limit lim offset off;
end;
$$;

-- Admin mutation with an audit trail, so role changes are never silent.
create or replace function public.admin_set_user(
  target uuid, new_role public.user_role default null,
  new_status public.account_status default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if target = (select auth.uid()) and new_role = 'user' then
    raise exception 'refusing to demote yourself' using errcode = '22023';
  end if;

  update public.profiles
     set role   = coalesce(new_role, role),
         status = coalesce(new_status, status)
   where id = target;

  insert into public.audit_log (actor_id, action, target_type, target_id, meta)
  values ((select auth.uid()), 'user.update', 'profile', target::text,
          jsonb_build_object('role', new_role, 'status', new_status));
end;
$$;

-- Promoting a model to active demotes the previous one in the same
-- transaction, so there is never a window with two active models.
create or replace function public.admin_activate_model(target uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update public.models set status = 'archived', traffic_pct = 0
    where status = 'active' and id <> target;
  update public.models set status = 'active', traffic_pct = 100
    where id = target;

  insert into public.audit_log (actor_id, action, target_type, target_id)
  values ((select auth.uid()), 'model.activate', 'model', target::text);
end;
$$;

grant execute on function public.user_stats(integer)          to authenticated;
grant execute on function public.user_daily_series(integer)   to authenticated;
grant execute on function public.admin_overview()             to authenticated;
grant execute on function public.admin_daily_series(integer)  to authenticated;
grant execute on function public.admin_top_tokens(integer)    to authenticated;
grant execute on function public.admin_latency_buckets()      to authenticated;
grant execute on function public.admin_user_list(text, integer, integer) to authenticated;
grant execute on function public.admin_set_user(uuid, public.user_role, public.account_status) to authenticated;
grant execute on function public.admin_activate_model(uuid)   to authenticated;

-- ------------------------------------------------------------- seed --------
insert into public.feature_flags (key, enabled, rollout_pct, description) values
  ('ghost_text',        true,  100, 'Inline grey completion in the editor'),
  ('lattice_view',      true,  100, 'Token probability lattice visualisation'),
  ('surprisal_scope',   true,  100, 'Per-token surprisal strip under the editor'),
  ('public_api',        true,  100, 'REST prediction endpoint with API keys'),
  ('server_inference',  false,  0,  'Route inference server-side instead of in-browser'),
  ('signups_open',      true,  100, 'Allow new account registration')
on conflict (key) do nothing;
