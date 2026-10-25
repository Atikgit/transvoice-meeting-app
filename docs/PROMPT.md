# Claude Code Expert Prompt — TransVoice Live Voice Translator Meeting App (FINAL)

> Save this file as `docs/PROMPT.md` in the repo root, then tell Claude Code: **"Read docs/PROMPT.md and execute Phase 0."**

---

## 0. Your role

You are a **senior full-stack engineer and real-time media architect** (Next.js App Router, TypeScript, Supabase/Postgres, LiveKit WebRTC, Web Audio, payments). You write production-grade, secure, typed, tested code. You work **in phases**: for each phase, first write a short plan, then implement, then run `pnpm typecheck && pnpm lint && pnpm test`, then report what changed and what's left. Never skip a phase's acceptance criteria. Ask me only when a decision is genuinely blocking; otherwise state your assumption in the commit notes and continue.

---

## 1. Product context

**TransVoice Meeting** is a multi-user meeting platform where each participant speaks their own language and hears everyone else as **translated neural voice** in near real time (target end-to-end < 1.5 s; the API itself < 1 s).

- Translation engine: **TransVoice Speech API** (Whisper ASR → gpt-4o-mini translation → Azure Neural TTS), served by **NVIDIA Triton Inference Server on a Microsoft Azure VM**. One HTTP call returns transcript + translation + TTS audio. (Azure is infrastructure only; there is no Azure billing or Azure Marketplace in this app.)
- Use cases: business meetings, connections from LinkedIn/social media, and **freelance marketplace buyer ↔ worker calls** across languages (Bangla ↔ English first; 140+ languages supported).
- Brand: TransVoice (TransVoice LLC). Dark UI, cyan accent (`#0b0e16` background, `cyan-300` primary). Keep the existing look of the current `page.tsx`.

### 1.1 Core business rules (non-negotiable)

**Rule 1 — Whoever sends the invitation is the Host (Sponsor) of that connection.**
- Any user with **available minutes** can generate an invitation link and send it to anyone. This includes **new free-trial users using their 15 free signup minutes** — this is the main growth loop.
- A user with 0 available minutes (trial used up, no paid plan) cannot create invitations until they subscribe.
- The receiver opens the link → **must sign up / sign in** → joins the inviter's room. New signups get their own 15 free minutes and can immediately invite others.
- If a guest invites someone else, that guest becomes Host/Sponsor of the new connection and the new person is their guest.

**Rule 2 — Per-participant payer.** Each participant in a call has exactly one `payer`:
- joined through a **valid invitation** → payer = the user who sent that invitation (sponsor);
- started the call themselves outside a valid sponsored connection → payer = themselves (needs available minutes).

The sponsor pays only for their own time and for the guests *they* invited. Other participants are billed to their own payer.

**Rule 3 — Sponsored connection window (call / redial rights).**
- An invitation creates a *sponsored connection*, valid until `expires_at` (sponsor chooses 1 h / 24 h / 7 d / 30 d; default 7 d).
- While the window is valid, **either side (host or guest) can press "Call"** to start or restart the meeting; minutes are always billed to the **sponsor**.
- A guest-initiated call **rings the sponsor; it starts only when the sponsor accepts**. A guest can never use a sponsor's minutes alone.
- After the window expires, a guest **can call only if they have their own available minutes** (paid plan or remaining trial minutes); that call is a new session where the guest is Host and payer.
- A free guest with an expired window and no minutes sees two options: **"Subscribe"** (Lemon Squeezy checkout) or **"Message"** (opens the normal free chat with the former host, who can send a new invitation link in that chat). No special "Request invite" button or chat actions are needed.

**Rule 4 — When billing runs.** Billing starts only when the call is accepted **and ≥ 2 users are connected at the same time**, and stops the moment fewer than 2 remain. Ringing, missed, declined and waiting-alone time is never billed. While ≥ 2 are connected, every connected minute is billed — **no silence detection or silence discount**.

**Rule 5 — Network drop recovery.** On disconnect, LiveKit auto-reconnect runs for a grace period (`RECONNECT_GRACE_SEC`, default 60 s) inside the same session; a disconnected participant's time is not billed. If the session is lost, a **"Call again"** button appears for everyone who has call rights under Rule 3; no new invitation is needed while the window is valid.

**Rule 6 — Chat is free.** Text chat between registered users (meeting chat and DMs between connections) is outside billing, for all users including free users with 0 minutes.

**Rule 7 — Groups.** Rooms support 2 → N participants (MVP: up to 8). Each participant chooses their own spoken language and listening language. Each participant's payer is resolved independently per Rule 2.

---

## 2. Current codebase (audit this first)

Existing files (Next.js App Router + Tailwind v4 + shadcn, generated with v0, deployed on Vercel at `transvoice-meeting-app.vercel.app`):

```
app/layout.tsx
app/globals.css
app/page.tsx                          // ~825 lines, one client component: Dashboard, JoinScreen, Meeting, modals, Lemon Squeezy plans
app/api/livekit/token/route.ts        // LiveKit AccessToken
app/api/transvoice/translate/route.ts // proxy to Triton API + minute deduction
app/api/lemonsqueezy/webhook/route.ts // HMAC verify + add minutes
```
Imported but **missing** from the repo: `@/lib/supabase`, `@/lib/voice-settings` (`languageOptions`, `getVoiceName`). Recreate them.

Existing TransVoice API contract (keep compatible, wrap in a typed client):
```
POST ${TRANSVOICE_API_URL}/
Authorization: Bearer ${TRANSVOICE_MASTER_API_KEY}
{ "audio": "<base64 webm/opus or wav>", "src_lang": "auto"|"bn"|..., "tgt_lang": "bn"|"en"|..., "azure_voice": "en-US-AvaNeural" }
→ 200 { "original_text": string, "translated_text": string, "tts_audio": "<base64 wav>" }
→ 200 { "error": "Silence" }   // no speech detected
```
Add `session_id` and `speaker_id` fields to each request so the API server can tag its usage reports (see §6.2).

Existing Lemon Squeezy plans: Bronze Starter $4.44/mo → 120 min, Diamond Pro $8.88/mo → 300 min, Business Standard $17.77/mo → 600 min. New signups get 15 free minutes. Keep these checkout URLs.

### 2.1 Known problems you must fix (do not carry them forward)
| # | Problem in current code | Required fix |
|---|---|---|
| 1 | `userId` comes from the client body/query → anyone can bill or impersonate any user | Derive identity **only** from the Supabase session server-side (`@supabase/ssr` cookies). Never trust a client `userId`. |
| 2 | `audioDurationSeconds: 3.0` hardcoded by client and billing done per translate request | Billing is done by the server-side minute meter from connection time (§6), never from client values. |
| 3 | Guests not billed correctly | Resolve a **payer per participant** at join (Rule 2); meter each participant against their payer. |
| 4 | LiveKit token issued to any `username`, any `room`, no auth | Token only for authenticated users who are the host or hold a valid sponsored connection / membership for that room. Identity = user UUID, name in metadata. |
| 5 | Invite link is `?room=xyz&view=join` (guessable, no expiry, no signup) | Random, expiring invitation tokens stored hashed in DB (`/invite/[token]`), with max uses and revoke. |
| 6 | Speaker translates into **their own** target language | Translate into each **listener's** language. Group listeners by distinct target language; one API call per distinct target language per utterance. |
| 7 | Fixed-interval `MediaRecorder` stop/start chunks → cut words, latency | Client-side **VAD** (`@ricky0123/vad-web`) cuts utterances at natural pauses; don't upload silence. |
| 8 | TTS base64 broadcast over Supabase Realtime (payload limits, everyone gets every language) | Deliver results via **LiveKit data messages** from the server, only to listeners of that language. |
| 9 | Webhook maps plan by product **name substring**, no idempotency | Map by Lemon Squeezy **variant_id** from config; store event/order id in `payment_events` (unique); ignore duplicates. |
| 10 | Balance check → API call → deduction is not atomic | Postgres functions with row locks + usage ledger. |
| 11 | One 825-line `page.tsx` | Split into routes, server components, feature folders, hooks. |

---

## 3. Target stack

- **Next.js 15 App Router**, TypeScript strict, React 19, Tailwind v4, shadcn/ui, lucide-react
- **Supabase**: Auth (email+password, Google, LinkedIn OIDC), Postgres + RLS, Realtime (presence, chat, billing meter updates), Storage (chat files), `pg_cron`
- **LiveKit Cloud** (WebRTC SFU) for audio/video + data messages; `livekit-client`, `@livekit/components-react`, `livekit-server-sdk` (incl. webhooks for join/leave)
- **TransVoice Speech API** (Triton on Azure VM) — called server-side only from a Next.js Route Handler (Node runtime)
- **Lemon Squeezy** for all payments (prepaid packs + postpaid usage-based subscription)
- Validation **zod**; server state **TanStack Query**; rate limiting **Upstash Redis** (`@upstash/ratelimit`); i18n **next-intl** (English, Bangla)
- Testing: **Vitest** (unit), **Playwright** (e2e with `--use-fake-device-for-media-stream`), **msw** to mock the TransVoice API
- pnpm; Docker image on a Hetzner server for production, Vercel for branch previews (see §9.1)

---

## 4. Architecture

```
Browser (speaker)                                            Browser (listeners)
 mic → VAD (utterance) → POST /api/translate ──────┐           ▲  play TTS for MY language
       (sessionId; targets derived server-side)    │           │  show captions (original + translated)
                                                   ▼           │
                Next.js Route Handler (auth, rate limit,       │
                resolve listener languages)                    │
                → TransVoice API (Triton/Azure VM) × N langs   │
                ← {original, translated, tts}                  │
                → LiveKit RoomServiceClient.sendData ──────────┘  destinationIdentities = listeners of that lang
                → insert transcript row

LiveKit SFU: original audio/video between participants (speaker's original voice ducked to ~15% while their translation plays)
LiveKit webhooks (participant_joined / participant_left) → participant_segments (source of truth for billing time)
Supabase Realtime: presence, chat (free), call ringing, live minute meter
pg_cron every minute → apply_minute_tick (billing)
```

Rules:
- If a listener's language equals the speaker's spoken language → no API call for that listener.
- Per speaker, queue utterances so translated playback stays in order; drop clips older than 6 s.
- Original-audio mode per listener: off / duck / mute.

---

## 5. Data model (Supabase SQL migrations in `supabase/migrations/`)

RLS enabled on every table. Suggested schema (improve if needed and explain changes):

```sql
profiles(id uuid pk references auth.users, full_name, avatar_url, headline, linkedin_url,
         spoken_lang text default 'en', listen_lang text default 'en', voice_gender text default 'female',
         created_at)

billing_accounts(user_id uuid pk references profiles,
         billing_type text check (billing_type in ('free','prepaid','postpaid')) default 'free',
         plan text default 'trial',
         prepaid_minutes_remaining numeric(12,4) default 15,   -- 15 free trial minutes live here
         postpaid_minutes_accrued numeric(12,4) default 0,     -- current period, invoiced monthly
         postpaid_credit_limit_minutes numeric(12,4) null,     -- safety cap
         ls_customer_id text, ls_subscription_id text, ls_subscription_item_id text,
         period_start timestamptz, period_end timestamptz, status text default 'active')

meetings(id uuid pk, owner_id uuid references profiles, title, room_name text unique,  -- LiveKit room
         max_participants int default 8, created_at)

invitations(id uuid pk, meeting_id, inviter_id, token_hash text unique, email text null,
         max_uses int default 1, used_count int default 0, expires_at timestamptz, revoked_at, created_at)

sponsored_connections(id uuid pk, sponsor_id uuid, guest_id uuid, meeting_id, invitation_id,
         expires_at timestamptz, revoked_at, created_at, unique(sponsor_id, guest_id, invitation_id))

connections(user_id, contact_id, source text, created_at, primary key(user_id, contact_id))  -- two-way, auto-created on invite accept

call_sessions(id uuid pk, meeting_id, host_id uuid, initiated_by uuid,
         status text check (status in ('ringing','live','ended','missed','declined')),
         started_at, ended_at, end_reason text)

meeting_participants(session_id, user_id, role text check (role in ('host','guest')),
         payer_id uuid not null, sponsored_connection_id uuid null,
         spoken_lang, listen_lang, primary key(session_id, user_id))

participant_segments(id bigserial, session_id, user_id, payer_id, connected_at, disconnected_at null)

usage_ledger(id bigserial, payer_id uuid, session_id, participant_id uuid,
         minute_bucket timestamptz, lang_multiplier int, billed_minutes numeric,
         billing_type text, kind text check (kind in ('debit','accrual','credit','refund')),
         synced_to_ls_at timestamptz null, reason text, created_at,
         unique(session_id, participant_id, minute_bucket, kind))      -- idempotent ticks

api_usage_events(id bigserial, request_id text unique, session_id, speaker_id, target_lang,
         speech_seconds numeric, created_at)     -- pushed by the API server, for cost/margin reporting only

chat_messages(id uuid pk, meeting_id null, sender_id, recipient_id null, body text,
         attachment_path null, created_at)        -- free

transcripts(id, session_id, speaker_id, src_lang, original_text, translations jsonb, created_at)

payment_events(id text pk, user_id, variant_id, event_name, minutes int, payload jsonb, created_at)
```

Postgres functions (SECURITY DEFINER, pinned `search_path`, executable only by service role):
- `has_available_minutes(p_user uuid) returns boolean` — prepaid/free: `prepaid_minutes_remaining > 0`; postpaid: active and under credit limit.
- `create_invitation(...)` — refuses with `NO_MINUTES` if `has_available_minutes(inviter)` is false.
- `accept_invitation(p_token_hash text, p_user uuid) returns uuid` — validates expiry/uses/revoked, creates sponsored connection + two-way connection.
- `resolve_payer(p_session uuid, p_user uuid) returns uuid` — valid sponsored connection → sponsor; else self if `has_available_minutes`; else raise `NO_MINUTES`.
- `apply_minute_tick(p_bucket timestamptz) returns jsonb` — see §6.2.
- `credit_minutes(p_user uuid, p_minutes int, p_event_id text, p_variant text)` — idempotent via `payment_events`.

RLS: users read/update their own profile; read their own billing account (never write it); participants read their session, participants, transcripts and chat; connections can DM each other; nobody writes `billing_accounts`, `usage_ledger` or `participant_segments` from the client.

---

## 6. Billing (simple connected-minute model)

### 6.1 Formula
- `BILLING_MODE=wallclock` (default and only active mode for now; keep the flag so a `speech` mode can be added later).
- For every 1-minute bucket in which **≥ 2 participants were connected simultaneously**, each connected participant is billed to their payer:
  `billed_minutes = connected_fraction_of_bucket × L`
  - `connected_fraction_of_bucket` = that participant's connected seconds in the bucket ÷ 60 (from `participant_segments`, overlapping with at least one other participant).
  - `L` = **language multiplier** (`LANG_MULTIPLIER_ENABLED=true`): number of distinct listener languages in the room that differ from the participant's spoken language, minimum 1. Example: a bn speaker with en + es listeners → ×2.
- No silence detection, no discounts. Connected = billed.
- Store `api_speech_seconds` (from `api_usage_events`) per session for my cost/margin dashboard only; it never affects what users pay.

### 6.2 Minute meter pipeline
1. **LiveKit webhooks** (`participant_joined`, `participant_left`) + client heartbeat every 20 s maintain `participant_segments`. A segment with no heartbeat for 45 s is closed at the last heartbeat (covers crashed tabs).
2. **pg_cron every minute** (no Vercel Cron, see §9.1; `/api/internal/meter-tick`, protected by `CRON_SECRET`, remains for manual re-runs) runs `apply_minute_tick` for the last closed minute. For each billable participant: lock the payer's `billing_accounts` row, then
   - **free / prepaid** → decrement `prepaid_minutes_remaining` (`kind='debit'`);
   - **postpaid** → add to `postpaid_minutes_accrued` (`kind='accrual'`).
   Idempotent via the ledger unique key; safe to re-run.
3. The **TransVoice API server** posts batched usage every 60 s to `POST /api/internal/usage` (HMAC with `USAGE_INGEST_SECRET`) → `api_usage_events` (idempotent on `request_id`). Reporting only.
4. Each tick broadcasts on Realtime channel `billing:{payer_id}` so the payer's live meter updates.

### 6.3 Billing types
| Type | Tick effect | Collection |
|---|---|---|
| **Free (trial)** | Decrements the 15 free minutes. Can invite and sponsor guests while > 0. At 0 → cannot start or sponsor calls; chat still works. | — |
| **Prepaid** (Lemon Squeezy packs: 120 / 300 / 600 min) | Decrements `prepaid_minutes_remaining`. | Checkout → webhook credits minutes (idempotent, by `variant_id`). |
| **Postpaid** (Lemon Squeezy usage-based subscription) | Adds to `postpaid_minutes_accrued`; optional credit limit. | Daily job `/api/internal/postpaid-sync` reports usage quantity to Lemon Squeezy **usage records** on `ls_subscription_item_id`; Lemon Squeezy sends the **monthly invoice** and collects. Mark ledger rows synced; reset accrual on the new period (`subscription_payment_success`). |

### 6.4 Limits & UX
- Payer rights checked at call start and every tick.
- Warn the payer at 5 and 1 remaining minutes. At 0 (or postpaid credit limit): that payer's participants' translation pauses with a 60 s notice; call and chat continue; payer gets a one-click top-up. A sponsored guest sees "Host's minutes have run out" with **Subscribe** / **Message host**.
- Guests never see balance prompts for sponsored calls.
- `/dashboard/billing`: billing type, remaining minutes (free/prepaid) or accrued this period (postpaid), usage by session and **by sponsored guest**, Lemon Squeezy customer portal link.

---

## 7. Routes & screens

```
/                         landing (hero, how it works, use cases: business / freelance / social, pricing)
/login, /signup           Supabase auth (email, Google, LinkedIn); preserve ?next=
/invite/[token]           validate → not logged in → signup/login (next=/invite/[token]) → accept → /m/[meetingId]/lobby
/dashboard                meetings, "New meeting", "Invite" (disabled with Subscribe CTA when 0 minutes), minutes card, recent connections, incoming calls
/dashboard/contacts       connections with sponsorship status (valid until …), Call / Message
/dashboard/chat           free DMs (Supabase Realtime)
/dashboard/billing        plans, minutes, usage ledger
/dashboard/settings       profile, spoken/listen language, voice gender, original-audio mode
/m/[meetingId]/lobby      camera/mic preview, device pickers, language selectors, Join
/m/[meetingId]            meeting room (keep current UI: tiles, "Translating" badge, live captions, Live translation
                          dropdown, chat/files sidebar, mic/cam/share/leave, live minute meter for payer, Call again)
```

API route handlers (zod-validated, session-authenticated, rate-limited):
```
POST   /api/meetings                         create meeting
POST   /api/meetings/[id]/invitations        create invite (requires available minutes) → returns URL once
DELETE /api/invitations/[id]                 revoke
POST   /api/invitations/accept               { token }
POST   /api/calls                            start/redial { meetingId } → checks call rights (Rule 3); guest-initiated → 'ringing'
POST   /api/calls/[id]/accept | decline      sponsor answers
POST   /api/calls/[id]/end                   host ends session
GET    /api/livekit/token?sessionId=         authz → token (identity=user.id, metadata={name, spoken_lang, listen_lang})
POST   /api/livekit/webhook                  join/leave → participant_segments
POST   /api/translate                        multipart audio + sessionId → fan-out per listener language → sendData (no billing here)
POST   /api/heartbeat                        { sessionId } every 20 s
POST   /api/internal/usage                   HMAC, from TransVoice API server
POST   /api/internal/meter-tick              cron
POST   /api/internal/postpaid-sync           cron (daily)
POST   /api/lemonsqueezy/webhook             HMAC verify (keep timingSafeEqual), variant_id map, idempotent
```

---

## 8. Real-time audio pipeline

- Capture with `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })`.
- **Echo safety:** never feed played-back TTS into the VAD; gate VAD while local TTS plays; add a test.
- VAD `@ricky0123/vad-web`, ~500 ms end-of-speech pause, max utterance 12 s (force split).
- Encode utterance as 16 kHz mono WAV (or Opus) and upload as `multipart/form-data` (max 2 MB, audio MIME only).
- Server: parallel target-language calls with `Promise.allSettled`, 4 s timeout, 1 retry on 5xx, circuit breaker when Triton is down (captions-only fallback message).
- Client playback: Web Audio queue per speaker; show captions as soon as text arrives; dev-mode latency badge (speech end → playback start).
- `/api/health` pings Triton.

---

## 9. Security & quality

- Server-only secrets: `TRANSVOICE_API_URL`, `TRANSVOICE_MASTER_API_KEY`, `LIVEKIT_URL/API_KEY/API_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `USAGE_INGEST_SECRET`, `CRON_SECRET`, `UPSTASH_*`. Config: `BILLING_MODE`, `LANG_MULTIPLIER_ENABLED`, `RECONNECT_GRACE_SEC`, `FREE_TRIAL_MINUTES=15`. Provide `.env.example` and a zod-typed `env.ts` that fails fast.
- Service-role Supabase client only in `lib/supabase/admin.ts` with `import 'server-only'`.
- Rate limits: translate 30/min/user, invitations 20/hour/user, calls 10/min/user, chat 60/min/user.
- Invite tokens: 32 random bytes, store SHA-256 hash only.
- Anti-abuse for free trials: one trial per verified email; email verification required before inviting; rate-limit signups per IP.
- Accessible, mobile-first (meetings must work in phone browsers). No `any`. ESLint + Prettier. Conventional commits.

### 9.1 Deployment & hosting (host-agnostic)

Production moves from Vercel to a self-managed **Hetzner** server. Vercel is used only for per-branch preview deployments. The app must run identically on both:

- `next.config` uses `output: 'standalone'`. Ship as a Docker image (`Dockerfile`, multi-stage, non-root, `node server.js`) run by `docker-compose.yml`: **app + Caddy** reverse proxy (automatic HTTPS). `NEXT_PUBLIC_*` values are build args; server secrets are runtime env, validated on start by `lib/env.ts`.
- **Scheduled jobs use only `pg_cron`** (with `pg_net` when a job must call an app endpoint, e.g. `/api/internal/postpaid-sync`, authenticated with `CRON_SECRET`). No Vercel Cron, and no in-process timers that assume a single long-lived instance.
- **No Vercel-only APIs** (`@vercel/kv`, `@vercel/blob`, Edge Config, Vercel Cron, `waitUntil` from `@vercel/functions`, etc.). `@vercel/analytics` is allowed only because it is a no-op off Vercel. Rate limiting uses Upstash Redis over HTTP.
- **No local-disk file storage.** Chat files and anything else persistent go to Supabase Storage. The container filesystem is disposable.
- Health: `GET /api/health` is the container healthcheck (liveness; Phase 3 adds the Triton check).
- Node `>=22.12`, pinned via `engines`; pnpm pinned via `packageManager`.

---

## 10. Folder structure

```
app/(marketing)/page.tsx
app/(auth)/login, signup
app/invite/[token]/page.tsx
app/dashboard/(…)
app/m/[meetingId]/lobby/page.tsx, page.tsx
app/api/(…)
components/meeting/   VideoTile, CaptionBar, ControlBar, LanguagePicker, ChatPanel, FilesPanel, MinuteMeter, IncomingCall
components/ui/        shadcn
features/translation/ useVad.ts, useTranslationUploader.ts, usePlaybackQueue.ts
features/calls/       useCallRights.ts, useHeartbeat.ts
lib/supabase/         client.ts, server.ts, admin.ts, middleware.ts
lib/transvoice/       client.ts, languages.ts, voices.ts   (replaces voice-settings)
lib/livekit/          token.ts, room-service.ts, webhook.ts
lib/billing/          config.ts, plans.ts (variant_id → minutes), lemonsqueezy.ts
supabase/migrations/
tests/unit, tests/e2e
```

---

## 11. Delivery phases (in order; stop and report after each)

**Phase 0 — Audit & scaffold.** Read existing files, confirm the §2.1 issues, set up pnpm, strict TS, lint, Vitest, Playwright, msw, env validation, `lib/supabase/*`, `lib/transvoice/languages.ts|voices.ts`. Move the current UI into components with no behaviour change. ✅ App builds; current UI renders.

**Phase 1 — Auth, profiles, billing accounts, DB.** Migrations, RLS, SQL functions, auth (email/Google/LinkedIn) with email verification, 15 trial minutes on signup, middleware protecting `/dashboard` and `/m/*`, settings page. ✅ RLS tests: a user cannot read others' data or write any billing table.

**Phase 2 — Invitations, sponsorship, calls.** Create/revoke invites (blocked at 0 minutes), `/invite/[token]` signup-then-join, sponsored connections + two-way connections, call/redial with ringing + accept/decline, LiveKit token authz, lobby, room with LiveKit components, reconnect grace + "Call again". ✅ E2E: (a) trial user invites → new user signs up via link → both in room; (b) guest redials within window → host accepts → connected; (c) free guest with expired window and 0 minutes sees Subscribe / Message only.

**Phase 3 — Live translation.** VAD → `/api/translate` → per-listener-language fan-out → LiveKit data delivery → playback queue, captions, ducking. ✅ Mocked API: bn speaker heard as en by en listener and es by es listener; same-language listener triggers no API call.

**Phase 4 — Minute meter & billing.** LiveKit webhooks + heartbeat → segments, `apply_minute_tick`, `/api/internal/usage`, live minute meter, low-balance flow. ✅ Tests: (a) sponsored guest's minutes debit the sponsor, guest unchanged; (b) a person invited by the guest is billed to the guest; (c) a lone participant / ringing / declined call bills nothing; (d) disconnect gap not billed; (e) multiplier ×2 with two foreign listener languages; (f) tick re-run is idempotent; (g) trial user can sponsor until 0, then invite is blocked.

**Phase 5 — Payments.** Refactor Lemon Squeezy webhook (variant_id map, idempotency, renewals), prepaid packs, postpaid usage-based subscription + daily usage-record sync + monthly invoice, billing page. ✅ Same webhook twice → credited once; postpaid accrued total equals synced quantity.

**Phase 6 — Chat & files (free).** Meeting chat + DMs between connections via Realtime, persisted; file sharing via Storage signed URLs. ✅ Chat never touches the ledger and works at 0 minutes.

**Phase 7 — Groups & polish.** Up to 8 participants, multi-language fan-out, active-speaker layout, host controls (mute, remove, lock room, end), transcript download, latency metrics, error/empty states, landing page. ✅ 3-language group test (bn/en/es) passes; Lighthouse ≥ 90 on landing.

---

## 12. Working rules for you (Claude Code)

1. Start every phase with a **plan** (files, migrations, risks), then implement.
2. Route handlers stay thin; logic lives in `lib/` and SQL functions.
3. Never call the real TransVoice API or Lemon Squeezy in CI; mock with msw using the exact contracts above.
4. After each phase: summary, commands to run, env vars needed, manual test steps, open questions.
5. If anything here conflicts with security or correctness best practice, follow best practice and tell me why.
6. Keep my Lemon Squeezy checkout URLs and the brand styling.
7. One branch per phase (`phase-1`, `phase-2`, …). Commit there; I merge to `main` after checking the Vercel preview.

---

## 13. Decisions log

Answers given after Phase 0. These override earlier sections where they conflict.

- **Plans are prepaid subscriptions.** The three Lemon Squeezy plans are subscriptions, mapped by numeric `variant_id` in `lib/billing/plans.ts`: Bronze Starter **2229952** → 120 min, Diamond Pro **2229957** → 300 min, Business Standard **2229969** → 600 min. Each paid period credits the plan's minutes (idempotent via `payment_events`): the first period on `subscription_created`, renewals on `subscription_payment_success` with `billing_reason` ≠ `initial`. The postpaid usage-based plan is a separate variant added in Phase 5.
- **No rollover.** Unused subscription minutes are reset at each renewal: the prepaid bucket is *set* to the plan's minutes, and the forfeited remainder is logged as a `usage_ledger` row with `kind='expire'`. The **15 free signup minutes never expire**: they live in a separate `trial_minutes_remaining` bucket. Debits use subscription minutes first, then trial minutes.
- **Free trial anti-abuse:** the trial is granted when the email is verified (OAuth signups arrive verified), once per normalized email hash (lowercase, `+tag` stripped, Gmail dots ignored). The hash is kept after account deletion.
- **Auth UI** shows email, Google and LinkedIn (OIDC). Each provider button is hidden unless `AUTH_GOOGLE_ENABLED` / `AUTH_LINKEDIN_ENABLED` is true (server-side flags, default off, so they change without an image rebuild).
- **Fresh schema approved (2026-10-22).** The Supabase project `uvgcaedyalkzsqykdhaw` only has test users, so `20261022000000_drop_legacy_schema.sql` drops the MVP tables and every auth user is backfilled with a profile, a billing account and (if verified) the trial.
- **Diamond Pro is monthly** in Lemon Squeezy, like Bronze Starter and Business Standard ($8.88/mo → 300 min per period).
- **Trial on first OAuth sign-in:** besides the auth.users triggers, `/auth/callback` and `/auth/confirm` call `ensure_user_account()` on every sign-in, which grants the trial to a confirmed email or a provider-verified Google/LinkedIn identity (still once per normalized email).
- **Languages:** the pickers list every Azure Neural TTS locale (154, from `lib/transvoice/languages.ts`) and the copy says "140+ languages & voices". "I speak" only offers languages Whisper can recognize; "I want to hear" offers all.
- **Signup country** (`profiles.country_code`, `country_name`, `signup_ip_hash`, `signup_at`) is analytics only: written once by the auth callbacks with the service role, never selectable or editable by clients, never shown in the UI. Offline GeoLite2 lookup (or Cloudflare `CF-IPCountry`); the raw IP is never stored.
- **Password reset** via `/forgot-password` → email → `/auth/reset`. Neutral responses (no account enumeration); 5/hour per IP and per email. Rate limits fall back to process memory when Upstash is not configured.
- **Hosting:** see §9.1.

Phase 3 decisions (full spec in `docs/PHASE-3.md`):

1. A sponsored connection's `expires_at` only controls starting/redialing a call. A call already in progress is never cut because the window expires.
2. Debit order for free/prepaid payers: subscription minutes first, then trial minutes. Never go negative.
3. A paid guest whose sponsor ran out of minutes can switch to paying for themselves for the rest of the session.
4. Usage events (speech seconds) are recorded by our own `/api/translate` route. No API-server push endpoint for now.
5. Latency targets, measured speech-end → translated audio start: p50 ≤ 1.8 s, p95 ≤ 3 s. Report measured values; never claim numbers that were not measured.
6. Translation stays behind `TRANSLATION_BETA_ALLOWLIST` until it is set to `"*"`.

**Begin with Phase 0 now.**
