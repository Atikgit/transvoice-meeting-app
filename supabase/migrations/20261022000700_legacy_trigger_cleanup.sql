-- Legacy signup triggers, second pass (Phase 1.1).
--
-- Production ran the v0 schema (profiles.minutes_balance, a signup trigger granting 10 minutes)
-- until the Phase 1 migrations were pushed. 0000 originally dropped only the trigger named
-- on_auth_user_created, so a legacy trigger under another name could survive, keep granting v0
-- minutes, or make every signup fail once profiles.minutes_balance was gone. This pass removes
-- them on databases where 0000 already ran (0000 now contains the same block).
--
-- It also makes ensure_user_account() the only code path that creates accounts and grants the
-- trial: the Phase 1 auth.users triggers now call it instead of duplicating its logic.

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

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_user_account(new.id);
  return new;
end
$$;

create or replace function private.handle_user_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ensure_user_account(new.id);
  return new;
end
$$;

revoke execute on function private.handle_new_user() from public, anon, authenticated;
revoke execute on function private.handle_user_email_confirmed() from public, anon, authenticated;

-- Users who signed up while the v0 trigger was live: make sure each has an account and,
-- if verified, exactly one trial (idempotent).
select public.ensure_user_account(id) from auth.users;
