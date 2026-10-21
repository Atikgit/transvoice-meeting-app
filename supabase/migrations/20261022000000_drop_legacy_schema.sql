-- Legacy MVP schema reset.
--
-- DECISION PENDING (docs/PROMPT.md §13): this file implements "test users only → fresh schema".
-- If real paying users exist, replace it with a data-preserving migration that copies
-- profiles.minutes_balance into billing_accounts before dropping anything.
--
-- Existing auth.users rows are kept; the next migrations backfill their profiles and billing accounts.

drop trigger if exists on_auth_user_created on auth.users;

do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('add_user_minutes', 'deduct_user_minutes', 'handle_new_user')
  loop
    execute format('drop function if exists %s cascade', fn);
  end loop;
end
$$;

drop table if exists public.profiles cascade;
