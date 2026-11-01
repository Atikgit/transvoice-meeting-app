-- Why does an account have (or not have) the free trial? The dashboard shows the reason.
-- Read-only: it never grants anything (private.grant_trial / ensure_user_account do that).
--   granted      this account received the trial
--   unconfirmed  the email is not verified yet; the trial is granted when it is confirmed
--   already_used a trial was already granted to this address (or an alias of it: +tag, Gmail dots),
--                possibly by an account that was deleted since
--   pending      verified and never granted: ensure_user_account has not run for this user yet
create function public.trial_status(p_user uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  if exists (select 1 from private.trial_grants where user_id = p_user) then
    return 'granted';
  end if;
  select email into v_email from auth.users where id = p_user;
  if not found then
    raise exception 'NO_SUCH_USER';
  end if;
  if not private.has_verified_email(p_user) then
    return 'unconfirmed';
  end if;
  if v_email is not null and exists (
    select 1 from private.trial_grants
    where email_hash = encode(sha256(convert_to(private.normalize_email(v_email), 'UTF8')), 'hex')
  ) then
    return 'already_used';
  end if;
  return 'pending';
end
$$;

revoke execute on function public.trial_status(uuid) from public, anon, authenticated;
grant execute on function public.trial_status(uuid) to service_role;
