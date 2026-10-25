-- fix-audio-invite 3: an invite link is usable many times within its validity window.
--
-- * max_uses defaults to 20 (was 1) and may be chosen up to 100 when the link is created; the
--   host can revoke the link (invitations.revoked_at).
-- * accept_invitation is idempotent per (invitation, user): opening the link again takes the same
--   user to the same meeting without a second sponsored connection and without using up another
--   place. A new person can still use it while places remain.
-- * Revoked and expired links stop working for everyone except the inviter, including people who
--   accepted before (their sponsorship window, which is separate, keeps running).
-- * An invitation never creates a meeting or a session: re-opening the link only returns the
--   meeting id; the room page then opens (or reuses) the meeting's session, a new ready one if
--   the previous session ended (open_call_session).

alter table public.invitations alter column max_uses set default 20;
alter table public.invitations drop constraint if exists invitations_max_uses_check;
alter table public.invitations
  add constraint invitations_max_uses_check check (max_uses between 1 and 100);

drop function public.create_invitation(uuid, text, interval, uuid);
create function public.create_invitation(
  p_user uuid,
  p_token_hash text,
  p_window interval default interval '7 days',
  p_meeting uuid default null,
  p_max_uses int default 20
)
returns table (meeting_id uuid, invitation_id uuid, expires_at timestamptz, reused boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting uuid := p_meeting;
  v_reused boolean := p_meeting is not null;
  v_invitation uuid;
  v_expires timestamptz := now() + p_window;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_TOKEN_HASH';
  end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 100 then
    raise exception 'INVALID_MAX_USES';
  end if;
  if not private.has_verified_email(p_user) then
    raise exception 'EMAIL_NOT_VERIFIED';
  end if;
  if not public.has_available_minutes(p_user) then
    raise exception 'NO_MINUTES';
  end if;

  if v_meeting is null then
    v_meeting := private.current_meeting(p_user);
    v_reused := v_meeting is not null;
  end if;

  if v_meeting is null then
    insert into public.meetings (owner_id, room_name)
    values (p_user, 'm-' || replace(gen_random_uuid()::text, '-', ''))
    returning id into v_meeting;
  elsif not private.can_view_meeting(v_meeting, p_user) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.invitations (meeting_id, inviter_id, token_hash, sponsor_window, expires_at, max_uses)
  values (v_meeting, p_user, p_token_hash, p_window, v_expires, p_max_uses)
  returning id into v_invitation;

  return query select v_meeting, v_invitation, v_expires, v_reused;
end
$$;

create or replace function public.accept_invitation(p_token_hash text, p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv public.invitations;
begin
  select * into v_inv from public.invitations where token_hash = p_token_hash for update;
  if not found then
    raise exception 'INVITE_NOT_FOUND';
  end if;
  -- The inviter opening their own link just gets the meeting.
  if v_inv.inviter_id = p_user then
    return v_inv.meeting_id;
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'INVITE_REVOKED';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'INVITE_EXPIRED';
  end if;
  -- Idempotent per (invitation, user): the same person opening the link again gets the same
  -- meeting, whether or not places are left, and does not use up another place.
  if exists (
    select 1 from public.sponsored_connections
    where invitation_id = v_inv.id and guest_id = p_user
  ) then
    return v_inv.meeting_id;
  end if;
  if v_inv.used_count >= v_inv.max_uses then
    raise exception 'INVITE_USED';
  end if;

  insert into public.sponsored_connections (sponsor_id, guest_id, meeting_id, invitation_id, expires_at)
  values (v_inv.inviter_id, p_user, v_inv.meeting_id, v_inv.id, now() + v_inv.sponsor_window);

  update public.invitations set used_count = used_count + 1 where id = v_inv.id;

  insert into public.connections (user_id, contact_id, source) values
    (v_inv.inviter_id, p_user, 'invitation'),
    (p_user, v_inv.inviter_id, 'invitation')
  on conflict do nothing;

  return v_inv.meeting_id;
end
$$;

-- The host revokes a link they created: nobody (new or returning) can use it any more.
-- Connections already made keep their own sponsorship window. Returns whether it was revoked now.
create function public.revoke_invitation(p_user uuid, p_token_hash text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.invitations set revoked_at = now()
  where token_hash = p_token_hash and inviter_id = p_user and revoked_at is null;
  return found;
end
$$;

revoke execute on function
  public.create_invitation(uuid, text, interval, uuid, int),
  public.accept_invitation(text, uuid),
  public.revoke_invitation(uuid, text)
from public, anon, authenticated;
grant execute on function
  public.create_invitation(uuid, text, interval, uuid, int),
  public.accept_invitation(text, uuid),
  public.revoke_invitation(uuid, text)
to service_role;
