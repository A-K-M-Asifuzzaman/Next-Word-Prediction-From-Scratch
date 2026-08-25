-- PostgREST exposes everything in `public` as an RPC endpoint, including
-- trigger functions that were never meant to be called directly. Each admin_*
-- function already re-checks is_admin() and raises 42501, so authorisation was
-- never actually open -- but an unauthenticated caller should not be able to
-- reach them at all. Defence in depth.

-- Trigger functions: callable by nobody over the API.
revoke all on function public.handle_new_user()  from anon, authenticated, public;
revoke all on function public.touch_document()   from anon, authenticated, public;

-- RLS helpers: the `authenticated` role must keep EXECUTE because policy
-- expressions are evaluated as the querying role. anon never needs them --
-- no anon-facing policy calls either one.
revoke execute on function public.is_admin()  from anon, public;
revoke execute on function public.is_active() from anon, public;

-- Admin RPCs: signed-in admins only.
revoke execute on function public.admin_overview()                from anon, public;
revoke execute on function public.admin_daily_series(integer)     from anon, public;
revoke execute on function public.admin_top_tokens(integer)       from anon, public;
revoke execute on function public.admin_latency_buckets()         from anon, public;
revoke execute on function public.admin_user_list(text, integer, integer)
                                                                  from anon, public;
revoke execute on function public.admin_activate_model(uuid)      from anon, public;
revoke execute on function
  public.admin_set_user(uuid, public.user_role, public.account_status)
                                                                  from anon, public;

-- User-facing analytics are SECURITY INVOKER and pin user_id = auth.uid(),
-- so they stay available to signed-in users only.
revoke execute on function public.user_stats(integer)        from anon, public;
revoke execute on function public.user_daily_series(integer) from anon, public;
