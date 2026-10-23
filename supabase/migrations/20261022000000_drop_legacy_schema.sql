-- Legacy MVP schema reset.
--
-- DECIDED (docs/PROMPT.md §13): the project only has test users, so the fresh schema is approved
-- and legacy profiles.minutes_balance is not carried over.
--
-- Existing auth.users rows are kept; the next migrations backfill their profiles and billing accounts.

-- 20261022000200 creates a trigger with this name.
drop trigger if exists on_auth_user_created on auth.users;

-- Drop every legacy signup trigger on auth.users, whatever its name: any trigger whose function
-- (outside the `private` schema, where Phase 1's own triggers live) touches profiles or
-- minutes_balance. Its public function is dropped too.
do $$
declare
  r record;
begin
  for r in
    select t.tgname, p.oid::regprocedure as fn, n.nspname
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where t.tgrelid = 'auth.users'::regclass
      and not t.tgisinternal
      and n.nspname <> 'private'
      and (p.prosrc ilike '%minutes_balance%' or p.prosrc ilike '%profiles%')
  loop
    raise notice 'Dropping legacy trigger % on auth.users (%)', r.tgname, r.fn;
    execute format('drop trigger if exists %I on auth.users', r.tgname);
    if r.nspname = 'public' then
      execute format('drop function if exists %s cascade', r.fn);
    end if;
  end loop;

  -- Legacy helpers no longer attached to anything (add_user_minutes, deduct_user_minutes, …).
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname in ('add_user_minutes', 'deduct_user_minutes', 'handle_new_user')
           or p.prosrc ilike '%minutes_balance%')
  loop
    execute format('drop function if exists %s cascade', r.fn);
  end loop;
end
$$;

drop table if exists public.profiles cascade;
