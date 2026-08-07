# Terminal Assistant ("Junior") — How It Works

This document explains the AI chat assistant built into XAUUSD Terminal, so
any AI assistant or developer reading this repo can understand it quickly
and help with it.

## What it is

"Terminal Assistant" (displayed name in the UI: **Junior**) is a custom,
self-hosted AI chatbot built specifically for this project. It is **not**
a third-party product/plugin — the code, hosting, and model are all under
the owner's own accounts.

- **Model:** Llama 3.3 70B Instruct (open-source, by Meta)
- **Hosted on:** Cloudflare Workers AI (free tier)
- **Worker name:** `xauusd-chatbot`
- **Worker URL:** `https://xauusd-chatbot.searchoption00.workers.dev`
- **Bot source code:** lives outside this repo, on the owner's local machine
  under a separate `xauusd-chatbot` Cloudflare Workers project (not yet
  version-controlled in this repo — see "Known gap" below).

## Where things live in this repo

| Piece | Path |
|---|---|
| Chat UI page | `artifacts/trading-journal/src/pages/HelpPage.tsx` |
| Sidebar "Need help?" / "Feedback" buttons | `artifacts/trading-journal/src/components/AppLayout.tsx` |
| Chat history API (get/save messages, feedback) | `artifacts/api-server/src/routes/assistant.ts` |
| DB tables (`assistant_messages`, `assistant_probe_flags`) | created via `artifacts/api-server/src/lib/migrate.ts` (raw SQL, runs on every server start — **not** via drizzle-kit) |
| Drizzle schema for `assistant_messages` | `lib/db/src/schema/assistantMessages.ts` |
| Admin page showing bot feedback | `artifacts/admin-panel/src/pages/TerminalAssistantPage.tsx` (route `/assistant`) |
| Admin ON/OFF toggle for the whole assistant | `system_settings.assistant_enabled` column; toggle UI in `artifacts/admin-panel/src/pages/SettingsPage.tsx`; enforced via `GET /api/assistant/status` |

## How a chat message flows

1. User types in `/help` (`HelpPage.tsx`).
2. Frontend calls the Cloudflare Worker **directly** (not through the main
   Express API) at `POST https://xauusd-chatbot.searchoption00.workers.dev/chat`
   with `{ message, history, context }`.
   - `context` is an optional string built from `GET /api/dashboard/summary`
     (the user's own trade stats) so the bot can answer personalized
     questions like "what's my win rate this month?".
3. The Worker merges a system prompt + history + the user's message and
   calls Workers AI (`env.AI.run(...)`).
4. The reply is parsed on the frontend for a trailing
   `<suggestions>a|b|c</suggestions>` block (follow-up question chips) — see
   `parseReply()` in `HelpPage.tsx`.
5. Both the user's message and the bot's reply are saved via
   `POST /api/assistant/history` (Express backend, Postgres) so the
   conversation persists across devices/browsers for that Clerk user.

## System prompt — behavior rules baked into the bot

Defined in the Worker's `index.ts` (`SYSTEM_PROMPT` constant). Current rules:

- **Name:** Always answers "Junior" if asked its name.
- **Tone:** Humble, never boastful; mirrors the user's energy/vibe
  (Gen-Z casual, minimal, formal, etc.) without becoming rude to anyone.
- **Language matching:** Replies in whatever mix of Bengali/English the user
  just used, but always with clean/proper words (no slang), matching the
  *language mix*, not the sloppiness.
- **Page links:** When relevant, includes an in-app link using
  `[Label](/path)` markdown syntax, which the frontend renders as a
  clickable SPA link (see `MessageContent` component in `HelpPage.tsx`).
- **Answer depth:** Broad "how do I use X" questions get a full numbered
  step-by-step walkthrough by default; narrow questions stay concise.
- **Secrets:** Never reveals API keys, DB credentials, source code, backend
  infra, or which AI/provider is used — deflects with a light joke instead
  of a serious refusal.
- **Abuse detection:** If a user repeatedly probes for secrets/backend info
  (regex-matched in `assistant.ts`), every 6th attempt sends a Telegram
  alert to the site owner via `ADMIN_TELEGRAM_BOT_TOKEN` /
  `ADMIN_TELEGRAM_CHAT_ID` env vars (optional — silently skipped if unset).

## Features implemented

- Cross-device chat history (Postgres-backed, per Clerk user)
- Admin ON/OFF kill-switch for the whole assistant
- Quick-reply buttons on first load
- Follow-up suggestion chips after each reply
- Thumbs up/down feedback with an optional category dropdown + free-text
  note, visible to admins on `/assistant` in the admin panel
- "Talk to a human" handoff button → links to the existing support chat
  on `/settings`
- Personalized answers using the user's own trade stats
- Basic client-observed rate limiting (Cloudflare native rate-limit binding
  on the Worker, `CHAT_RATE_LIMITER`, 15 requests/min per IP)
- General app feedback (star rating, separate from the bot) is also
  available on-demand from the sidebar "Feedback" button, not just after
  trial expiry.

## Known gaps / things to pick up next

- The Cloudflare Worker's own source (`index.ts`, `wrangler.jsonc`) is
  **not yet committed to this repo** — it only exists on the owner's local
  `xauusd-chatbot` folder and Cloudflare's deployed copy. If continuing
  this work, consider adding a `bot/` or `services/xauusd-chatbot/` folder
  here so Worker changes are version-controlled and deployed the same way
  as everything else.
- Screenshot/image attach in chat has not been built yet (would need a
  vision-capable Workers AI model, e.g. `@cf/llava-hf/llava-1.5-7b-hf`).
- `ADMIN_TELEGRAM_BOT_TOKEN` / `ADMIN_TELEGRAM_CHAT_ID` are optional env
  vars on Render (`xauusd-terminal-api` service) — not set by default, so
  the abuse-alert Telegram message is currently a no-op until configured.
