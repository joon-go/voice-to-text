# Enterprise Elite — First Response

A mobile responder for the 15-minute first-response SLA. PagerDuty pages the
on-call engineer; they open this, hear the problem, **dictate an original first
response**, and post it — attributed to them — before the clock runs out.

## Flow

```
PagerDuty page ─▶ open app ─▶ pick/auth as engineer ─▶ tap ticket
   ─▶ hear AI problem summary ─▶ dictate original reply ─▶ Send ─▶ clock stops
```

The Send button stays locked until the engineer has written real content — the
first response must come from the live person, not a canned/auto reply.

## Stack

- **Frontend:** Vite + React, installable PWA (manifest + service worker), mobile-first.
- **Backend:** serverless functions in `/api` (Vercel-style; portable to any Node host).
- **Voice:** text-to-speech via the browser `speechSynthesis` (works on iOS/Android).
  Dictation uses the phone keyboard's mic on iOS (Web Speech recognition is blocked
  in an installed iOS PWA) and the Web Speech API on desktop Chrome. Server-side STT
  (Deepgram/Whisper) is the optional v2 upgrade — see `api/respond.js` for where it slots.
- **Summary:** Claude (`api/summarize.js`) condenses the thread to two spoken sentences.

## Run locally (no secrets)

```bash
npm install
npm run dev          # VITE_USE_MOCK=true by default → mock queue, real TTS/dictation
```

## Wire to live Pylon

1. `cp .env.example .env` and fill it in. Set `VITE_USE_MOCK=false`.
2. Key values: `PYLON_API_TOKEN` (admin), `PYLON_TIER_FIELD_SLUG` / `PYLON_TIER_VALUE`
   (the **custom field**, not a tag), `PYLON_BOT_IDS` (your two bots, excluded from the
   first-response check), `ANTHROPIC_API_KEY`, optional PagerDuty creds.
3. Deploy (Vercel): `vercel` — serves the static app and the `/api` functions together.

## How attribution works (the "from the live person" requirement)

Pylon API tokens are admin-only, so engineers can't each hold one. Instead the backend
uses a single org token and stamps every post with the signed-in engineer's Pylon
`user_id` (`api/_pylon.js → postFirstResponse`), so Pylon authors the message as that
engineer. The human still composes the text; this only fixes whose name it posts under.

## Open items to confirm against your tenant

- **Messages endpoint shape.** Verify the create-message endpoint accepts `user_id` for
  authoring (the Issues endpoint does). Adjust the field name in `_pylon.js` if needed.
- **Trustworthy identity.** `api/me.js` returns a roster to pick from — fine behind SSO.
  For production, front the app with Vercel/Cloudflare Access and derive the engineer
  from the verified session so a reply can't be attributed to someone who didn't write it.
- **SLA clock start.** Deadline is computed as `created_at + SLA_MINUTES`. If your SLA
  policy starts elsewhere (business hours, assignment time), set it in `_pylon.js`.
- **Custom field format.** `custom_fields` handling in `_pylon.js` covers object- and
  array-shaped responses; confirm which your tenant returns and trim the other branch.
