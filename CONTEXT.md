# CONTEXT — voice-to-text (Enterprise Elite first-response responder)

Handoff for continuing in Claude Code. Read this, then `README.md`.

## Goal
Mobile app a support engineer opens after a PagerDuty page to beat the **15-minute
first-response SLA** for Enterprise Elite customers. They hear the problem, dictate an
original first response, and post it (attributed to themselves) before the clock runs out.

## Hard requirements (do not relitigate)
- First response must be **original content the engineer composes each time** — no canned
  text, no auto-responder. The system never posts on its own. UI enforces this (Send locked
  until real content exists).
- The posted message must be **attributed to the live engineer**, not a bot/service identity.
- Must work **on a phone** — that's the whole point (responding on the go).

## Decisions locked
- **Hosting:** mobile PWA (installable, manifest + service worker). Not a Pylon-embedded
  iframe — that's desktop-only. Native (Expo) only if PagerDuty/Slack push later proves
  insufficient; not needed now.
- **Alerting:** already solved — Pylon → PagerDuty pages the engineer. We do NOT build
  notifications. App is the respond-fast action layer. Deep-link from the PD incident → ticket.
- **Voice:** TTS = browser `speechSynthesis` (works iOS/Android). Dictation = phone keyboard
  mic on iOS (Web Speech recognition is blocked in an installed iOS PWA), Web Speech API on
  desktop Chrome. Server STT (Deepgram/Whisper) is a v2 upgrade, not in v1.
- **Summary:** Claude condenses the thread to two spoken sentences (`api/summarize.js`).
- **No OpenAI dependency** anywhere. v1 needs no paid voice vendor at all.
- **Stack:** Vite + React frontend, serverless `/api` functions (Vercel-style, portable).

## Rejected (so Claude Code doesn't suggest them)
- One-tap canned acknowledgement — fails the "original, from the live person" requirement.
- Auto-posting a first response from a webhook — same reason.
- Per-engineer Pylon API tokens — Pylon tokens are admin-only; engineers can't hold them.

## Attribution mechanism (the crux)
Backend holds ONE admin Pylon token and stamps each post with the signed-in engineer's
Pylon `user_id`, so Pylon authors the message as that engineer. See
`api/_pylon.js → postFirstResponse`. The human still writes the text; this only sets the
authoring identity.

## Repo state — what's real vs. stub
- `src/` — full responder UI: identity sign-in, SLA queue with live color-coded countdowns
  (teal→amber→red), ticket view with read-aloud + dictation + send. Real and build-verified.
- `src/api.js` — client wrapper with `VITE_USE_MOCK` flag. Mock mode runs the whole UI with
  no backend/secrets (TTS + dictation still real).
- `api/queue.js` + `_pylon.js` — pulls open issues, filters by the `support_tier` CUSTOM
  FIELD (not tags — tag search misses Elite tickets), then keeps only those needing a first
  response: no message with `is_private:false AND from_customer:false AND author NOT IN bot IDs`.
- `api/summarize.js` — real Anthropic call.
- `api/respond.js` — posts as engineer (`user_id`) + acks the PagerDuty incident. Has a
  server-side guard rejecting <3-word bodies.
- `api/me.js` — returns Pylon user roster for the identity picker.

## Open items to resolve (verify against the live tenant)
1. Confirm the create-message endpoint accepts `user_id` for authoring (Issues endpoint does;
   verify Messages). Fix the field in `_pylon.js` if it differs.
2. `custom_fields` shape: `_pylon.js` handles both object- and array-keyed responses — confirm
   which the tenant returns, drop the dead branch.
3. SLA clock start is `created_at + SLA_MINUTES`. Replace if the real policy starts elsewhere
   (business hours, assignment time).
4. Identity trust: `api/me.js` is a pick-list — fine behind SSO. Front the app with
   Vercel/Cloudflare Access and derive the engineer from the verified session for production,
   so a reply can't be attributed to someone who didn't write it.
5. Get the Pylon issue ID into the PagerDuty incident payload so the page deep-links to the ticket.

## Immediate next steps
1. Fill `.env` (see `.env.example`), set `VITE_USE_MOCK=false`, run against live Pylon.
2. Resolve open items 1–2 (they block correct queue + posting).
3. Add SSO in front before any real use (item 4).
4. Deploy to Vercel; wire the PD deep link (item 5).
5. Optional v2: server-side STT for a hands-free in-app mic button.

## Known facts about the environment
- Enterprise tier lives in the `support_tier` custom field, not tags.
- First-response message filter excludes two bot author IDs (AI Support Agent + auto-reminder).
- Engineers are the same group tracked by name in the L1/L2 dashboard — attribution matters
  for both SLA record and per-agent metrics.
