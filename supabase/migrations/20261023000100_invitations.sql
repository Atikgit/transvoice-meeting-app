-- Invitations (Rule 1 / Rule 3), pulled forward from Phase 2.
--
-- Writes go through these SECURITY DEFINER functions, called with the service role by the app's
-- server actions (clients have no INSERT/UPDATE on the tables). Tokens never reach the database:
-- only sha256(token) as hex.

-- Creates an invitation, in a new meeting owned by the inviter or in an existing meeting the
-- inviter can see (a guest inviting someone becomes that person's sponsor, Rule 1).
-- The link and the sponsored-connection window have the same length (1 h / 24 h / 7 d / 30 d).
create function public.create_invitation(
  p_user uuid,
  p_token_hash text,
  p_window interval default interval '7 days',
  p_meeting uuid default null
)
returns table (meeting_id uuid, invitation_id uuid, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_meeting uuid := p_meeting;
  v_invitation uuid;
  v_expires timestamptz := now() + p_window;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_TOKEN_HASH';
  end if;
  if not private.has_verified_email(p_user) then
    raise exception 'EMAIL_NOT_VERIFIED';
  end if;
  if not public.has_available_minutes(p_user) then
    raise exception 'NO_MINUTES';
  end if;

  if v_meeting is null then
    insert into public.meetings (owner_id, room_name)
    values (p_user, 'm-' || replace(gen_random_uuid()::text, '-', ''))
    returning id into v_meeting;
  elsif not private.can_view_meeting(v_meeting, p_user) then
    raise exception 'NOT_ALLOWED';
  end if;

  insert into public.invitations (meeting_id, inviter_id, token_hash, sponsor_window, expires_at)
  values (v_meeting, p_user, p_token_hash, p_window, v_expires)
  returning id into v_invitation;

  return query select v_meeting, v_invitation, v_expires;
end
$$;

-- Accepts an invitation for p_user and returns the meeting id. Idempotent for the same guest;
-- the inviter opening their own link just gets the meeting.
create function public.accept_invitation(p_token_hash text, p_user uuid)
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
  if v_inv.inviter_id = p_user then
    return v_inv.meeting_id;
  end if;
  if exists (
    select 1 from public.sponsored_connections
    where invitation_id = v_inv.id and guest_id = p_user
  ) then
    return v_inv.meeting_id;
  end if;
  if v_inv.revoked_at is not null then
    raise exception 'INVITE_REVOKED';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'INVITE_EXPIRED';
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

revoke execute on function public.create_invitation(uuid, text, interval, uuid)
  from public, anon, authenticated;
revoke execute on function public.accept_invitation(text, uuid) from public, anon, authenticated;
grant execute on function public.create_invitation(uuid, text, interval, uuid) to service_role;
grant execute on function public.accept_invitation(text, uuid) to service_role;
