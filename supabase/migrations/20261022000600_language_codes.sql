-- The pickers now list every Azure Neural TTS locale (lib/transvoice/languages.ts), including
-- script and dialect subtags: "sr-Latn-RS", "iu-Cans-CA", "zh-CN-sichuan". Widen the format checks.

alter table public.profiles
  drop constraint profiles_spoken_lang_check,
  drop constraint profiles_listen_lang_check;

alter table public.profiles
  add constraint profiles_spoken_lang_check
    check (spoken_lang ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?(-[a-z]{4,8})?$'),
  add constraint profiles_listen_lang_check
    check (listen_lang ~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-[A-Z]{2})?(-[a-z]{4,8})?$');
