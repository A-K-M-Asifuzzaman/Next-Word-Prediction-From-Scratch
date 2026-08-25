-- Google OAuth puts the user's name in `full_name` (and `name`), while our
-- email/password signup form sends `display_name`. Reading only the latter
-- meant every Google user would land with a display name derived from the
-- local part of their email address. Also pick up the avatar Google supplies.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_first boolean;
  assigned public.user_role;
  meta     jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  chosen   text;
begin
  select count(*) = 0 into is_first from public.profiles;

  if is_first or new.email = 'zasif855@gmail.com' then
    assigned := 'admin';
  else
    assigned := 'user';
  end if;

  chosen := coalesce(
    nullif(meta->>'display_name', ''),
    nullif(meta->>'full_name', ''),
    nullif(meta->>'name', ''),
    split_part(coalesce(new.email, 'user@unknown'), '@', 1)
  );

  insert into public.profiles (id, email, display_name, avatar_seed, role)
  values (
    new.id,
    new.email,
    chosen,
    coalesce(
      nullif(meta->>'avatar_url', ''),
      nullif(meta->>'picture', ''),
      encode(extensions.gen_random_bytes(8), 'hex')
    ),
    assigned
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from anon, authenticated, public;
