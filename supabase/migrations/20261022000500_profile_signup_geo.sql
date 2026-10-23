-- Signup country tracking (analytics only; never shown in the UI).
--
-- Written once by the auth callback routes through public.record_signup_geo() (service role).
-- Clients can neither update nor select these columns: the table-level SELECT grant on profiles
-- is replaced by a column list, because profiles are also visible to connections and call
-- partners. Later migrations adding profile columns must add them to this list if the UI needs them.

alter table public.profiles
  add column country_code text check (country_code ~ '^[A-Z]{2}$'),       -- ISO 3166-1 alpha-2
  add column country_name text check (char_length(country_name) <= 100),
  add column signup_ip_hash text check (signup_ip_hash ~ '^[0-9a-f]{64}$'), -- sha256(ip + salt)
  add column signup_at timestamptz;

revoke select on public.profiles from authenticated;
grant select (
  id, full_name, avatar_url, headline, linkedin_url, spoken_lang, listen_lang, voice_gender,
  original_audio_mode, created_at, updated_at
) on public.profiles to authenticated;
-- UPDATE stays limited to the editable columns granted in 20261022000300.

-- Records the signup country only while country_code is still null. The IP hash and timestamp
-- keep their first value. Returns true if the row was updated.
create function public.record_signup_geo(
  p_user uuid,
  p_country_code text,
  p_country_name text,
  p_ip_hash text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set country_code = p_country_code,
      country_name = left(p_country_name, 100),
      signup_ip_hash = coalesce(signup_ip_hash, p_ip_hash),
      signup_at = coalesce(signup_at, now())
  where id = p_user and country_code is null;
  return found;
end
$$;

revoke execute on function public.record_signup_geo(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.record_signup_geo(uuid, text, text, text) to service_role;
