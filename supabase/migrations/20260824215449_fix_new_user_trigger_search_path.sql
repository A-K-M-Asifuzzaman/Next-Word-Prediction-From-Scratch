-- handle_new_user pins search_path = '' (per Supabase security guidance), so
-- every function it calls must be schema-qualified. gen_random_bytes lives in
-- the `extensions` schema, and the unqualified call meant the trigger raised
-- 42883 on *every* signup.
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
    encode(extensions.gen_random_bytes(8), 'hex'),
    assigned
  )
  on conflict (id) do nothing;

  return new;
end;
$$;
