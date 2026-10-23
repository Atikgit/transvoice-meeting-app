-- Trial on first sign-in.
--
-- The auth.users triggers grant the trial when the email is confirmed, which already covers
-- OAuth signups that Supabase Auth marks confirmed. public.ensure_user_account() is the second
-- line of defence: the auth callback routes call it on every sign-in (email confirmation and
-- OAuth), and /dashboard calls it if the billing account is missing. It creates a missing
-- profile/billing account and grants the trial to verified users: a confirmed email, or a
-- Google/LinkedIn identity whose provider verified the address. private.grant_trial still allows
-- one trial per normalized email, so repeated calls are no-ops.

create function private.has_verified_email(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users where id = p_user and email_confirmed_at is not null)
    or exists (
      select 1 from auth.identities
      where user_id = p_user
        and provider in ('google', 'linkedin_oidc')
        and identity_data ->> 'email_verified' = 'true'
    )
$$;

-- Returns true if this call granted the trial.
create function public.ensure_user_account(p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_meta jsonb;
begin
  select email, raw_user_meta_data into v_email, v_meta from auth.users where id = p_user;
  if not found then
    raise exception 'NO_SUCH_USER';
  end if;

  insert into public.profiles (id, full_name, avatar_url)
  values (
    p_user,
    left(coalesce(v_meta ->> 'full_name', v_meta ->> 'name'), 120),
    left(coalesce(v_meta ->> 'avatar_url', v_meta ->> 'picture'), 2048)
  )
  on conflict (id) do nothing;

  insert into public.billing_accounts (user_id) values (p_user)
  on conflict (user_id) do nothing;

  if private.has_verified_email(p_user) then
    return private.grant_trial(p_user, v_email);
  end if;
  return false;
end
$$;

revoke execute on function private.has_verified_email(uuid) from public, anon, authenticated;
revoke execute on function public.ensure_user_account(uuid) from public, anon, authenticated;
grant execute on function public.ensure_user_account(uuid) to service_role;

-- Backfill: every existing auth user gets a profile and billing account, and verified users get
-- the trial (once per normalized email). Safe to re-run.
select public.ensure_user_account(id) from auth.users;
