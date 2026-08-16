# June X — Multi-Session Guide

June X now runs **any number of WhatsApp sessions inside one process**. Each
session is a fully independent bot: its own socket, its own reconnect state
machine, its own settings, and its own SQLite database.

## Quick start

### 1. Define your sessions

`JUNE_SESSIONS` in `.env` (or as a panel variable) is the **only** session
registry — one line of JSON. One entry behaves exactly like the old
single-session mode; multiple entries boot independently.

```env
# single session
JUNE_SESSIONS=[{"sessionId":"JUNE-MD:~...","phone":"2348154853640"}]

# pairing-only
JUNE_SESSIONS=[{"sessionId":"","phone":"2348154853640"}]

# multiple sessions
JUNE_SESSIONS=[{"sessionId":"JUNE-MD:~...","phone":"2348154853640"},{"sessionId":"","phone":"2348165321909"}]
```

Rules:

- The value **must be one line of JSON** — multi-line values do not parse in `.env`.
- **Hot-reload**: editing the line while the bot runs is detected within
  seconds (file watcher + a `JUNE_SESSIONS_POLL_MS` fallback poll). New ids
  are hot-added, removed ids are hot-removed; unchanged sessions are never
  touched. No restart needed.
- An invalid JSON line is logged and ignored until fixed — a typo can never
  tear down running sessions.
- When `.env` has no `JUNE_SESSIONS` line at all, the platform/panel value is
  used and file edits change nothing.
- Emptying the value hot-removes every registry-managed session.
- With no registry anywhere, one default session boots the first-run login
  flow (interactive menu, or a clear exit message headless).

Session entry fields:

| Field       | Required  | Meaning                                                        |
|-------------|-----------|----------------------------------------------------------------|
| `sessionId` | no        | One of `JUNE-MD:~…`, `Ultra-X:~…`, `June-Ultra:~…`, `June::~…` (auto-login) |
| `phone`     | expected  | Digits with country code — pairing-code login + the self-healing fallback; the bot's identity key |
| `id`        | **auto**  | Derived from the phone; duplicate numbers get `-2`, `-3` suffixes automatically (two sessions may share one number). Optional explicit override for a stable id |
| `name`      | **auto**  | Derived as `June X <last3>` (e.g. `June X 640`) for dashboard/logs. An explicit name also changes that bot's `botName` |

Login combinations:

- Only `phone` → fresh pairing-code login (code in the logs).
- Only `sessionId` → classic auto-login (no fallback without a phone).
- **Both** → sessionId first, phone auto-fallback.
- **Neither** → parked as `needs-login` until you add one.

The old full format (`id`/`name`/`sessionId`/`phone` on every entry) still
works unchanged — `id`/`name` are simply treated as overrides.

### 🎯 Bonus: sessionId + phone (auto-fallback)

A session may carry **both** fields:

```json
{ "sessionId": "JUNE-MD:~...", "phone": "2348154853640" }
```

The bot always tries the `sessionId` first (legacy bootstrap flow). If that
path breaks, it **automatically falls back to pairing-code login** with the
phone — no manual intervention, no `needs-login` parking:

| Situation | What happens |
|---|---|
| `sessionId` invalid / creds rejected at bootstrap | fingerprint revoked, session quarantined, a fresh pairing code is printed from `phone` |
| `sessionId` was revoked by WhatsApp (logged out) | falls straight to pairing with `phone` |
| connected session gets logged out later | session cleared, then pairing code re-issued from `phone` |
| pairing succeeds | bot connects; the fallback arms reset automatically |

A QR event while a phone is configured also triggers a pairing code even when
the `sessionId` path produced it — so the combo self-heals end to end.

#### `.addbot` — hot-add a session from WhatsApp (Super Owner)

```
.addbot <phone> <sessionId?>
.addbot 2348165321909 JUNE-MD:~xxxxx
```

**Live in-chat flow** (everything happens in the chat where you ran it):

1. `.addbot …` → ⏳ reaction on your command message — no processing spam
2. 🔑 pairing-code message delivered into the same chat with quick-reply
   buttons (📋 Copy Code / ❌ Cancel — the panel-proven `{ id, text }` style
   botinfo.js uses). If button delivery ever fails, the same message falls
   back to plain text automatically, so the code always arrives.
3. terminal status in the same chat: ✅ connected, ⚠️ pairing limit,
   ❌ cancelled/failed — with a final ✅/⚠️ reaction on the command

- Validates phone + sessionId formats; the sessionId is optional (pairing
  login without it).
- Appends to the existing `JUNE_SESSIONS` registry and reuses the SAME
  hot-add pipeline — no restart, existing sessions untouched.
- Duplicates rejected (same phone = same storage identity, same sessionId =
  same credential).
- Quotas: `JUNE_MAX_SESSIONS` global cap (default 10) and WhatsApp's
  4-linked-devices-per-number cap.

#### `.delbot` — hot-remove a session (Super Owner)

```
.delbot <phone|id>
```

Removes the registry entry and hot-removes ONLY that session (socket,
timers, DB handle, adapter pools) via the existing reconciliation pipeline.
If it kills an in-flight `.addbot` flow, the flow reports ❌ cancelled.

#### `.bots` — fleet status card (Super Owner)

Shows every session: 🟢 connected / 🟡 connecting / 🔴 needs-login, masked
account, pairing attempts and connection time. Read-only.

#### `.repairbot` — re-arm a parked session (Super Owner)

```
.repairbot <phone|id>
```

Reboots a parked session (needs-login / pairing-exhausted) with a FRESH
pairing cycle — the new code and the connection status arrive in the same
chat. Connected sessions are left untouched.

#### Startup report is a single-session feature

- Process starts with **exactly 1 session** → the full startup report prints
  as before.
- Process starts with **2+ sessions** → the report box is skipped entirely
  (no per-session copies).
- **Hot-added** sessions never print the report — only their normal
  session/login/connection logs.
- If the session count later drops from 2 to 1, the report still does **not**
  appear — it is an initial-startup, single-session presentation feature.

#### Pairing-code budget (configurable)

Every login/recovery cycle issues at most **5 pairing codes**
(`JUNE_PAIRING_MAX_ATTEMPTS`, default 5). If none of them is paired:

- the session stops generating codes and reconnecting,
- it parks as `needs-login` (dashboard shows "pairing limit reached"),
- it stays parked until an explicit re-trigger: `.restart` from that session,
  or a process restart.

The counter is **per session** and resets automatically after a successful
pairing. A new WhatsApp logout after a previously successful pairing starts a
**fresh 5-code cycle automatically** — the configured phone number is never
cleared, so no process restart is ever needed.

### 🔥 Hot-add / hot-remove sessions (no restart)

The `JUNE_SESSIONS` line in `.env` is reconciled live (instantly via the
file watcher, plus a `JUNE_SESSIONS_POLL_MS` fallback poll, default 15 s):

- **Add a session** → the new session is registered, gets its own SQLite
  database, session dir, config, pairing state, reconnect timers and counters,
  and boots — **the running sessions are not touched and stay connected**.
- **Remove a session** → ONLY that session stops: its socket closes, its
  intervals and reconnect timers are cleared, and its database connection and
  remote adapter pools are flushed and closed. Its data files stay on disk.
  Every other session keeps running.
- Renaming an `id` counts as remove + add.

`.env` edits no longer kill the process — non-session variables simply need a
restart to apply.

### 2. Pair / connect

- A `sessionId` session bootstraps itself — same as the original bot.
- A `phone` session prints a pairing code in the logs:
  `🔑 [backup] Your Pairing Code: XXXX-XXXX` — enter it in WhatsApp →
  Settings → Linked Devices → Link a Device.
- The legacy default session still supports the interactive TTY login menu.

### 3. Dashboard

`GET /` shows every session's live state (connected / connecting / needs-login),
account number and connection time. `GET /health/details` returns the same data
as JSON.

## How isolation works

| Resource | Per session |
|----------|-------------|
| WhatsApp socket, auth (Signal keys/creds) | `session/` for the default bot, `sessions/<id>/` for the rest |
| SQLite database | `database/june-<id>.db` (default bot keeps `june-ultra.db` so existing data migrates) |
| Settings (`prefix`, `botName`, `botMode`, auto-react, presence, anti-features…) | each bot's own `bot_settings` table |
| KV data (`user_notes` from `mynote.js`, warnings, chat profiles…) | each bot's own `kv_store` / tables |
| Reconnect state machine (408/503/500/409/440 counters, conflict throttling) | per-bot counters persisted in each bot's DB |
| Postgres / MongoDB mirror | per-bot `bot_id` rows and per-bot adapter pools |

### External databases (PostgreSQL / MongoDB)

Optional mirrors for auth state, settings and data — enabled with **global**
env vars; every bot's rows are then separated by its `bot_id` automatically
(each session opens its own adapter pool):

```env
DATABASE_URL=postgres://user:pass@host:5432/june_x
MONGODB_URI=mongodb+srv://user:pass@cluster/june_x
```

- Startup log per bot: `[ PG ] Connected; remote persistence enabled for bot_id=main`
- Recovery is per bot: a lost local DB restores **its own** remote auth state
- A logout/session-clear deletes only that bot's remote auth rows
- Full template (both session styles + tuning) in **`.env.example`**
| In-memory caches (group metadata, bot-admin, view-once, LID map, auto-react) | AsyncLocalStorage-scoped per bot |
| Status auto-view/react queues, message store, presence store | per bot |
| Always-online heartbeat, anti-spam tracker, anti-delete status store | per bot |

Because commands read `config.` and `database.` through a context-aware layer
(`utils/botContext`), **command files did not need to change** — `mynote.js`,
`addnote.js` and the other ~300 commands automatically read/write the correct
bot's data.

## Operations

- **Add a session**: append an entry to the `JUNE_SESSIONS` line in `.env` —
  it is **hot-added** within seconds (or on the next poll tick): wired, booted
  and ready to pair. No restart, running sessions stay connected.
- **Remove a session**: delete its entry from the line — it is **hot-removed**:
  only that session's socket, timers, database handle and adapter pools are
  released.
- **Restart one session**: `.restart` from that bot restarts **only that
  session** — its socket is torn down and rebooted from stored auth while the
  other sessions keep running untouched (falls back to a full process restart
  only when the per-session hook is unavailable). `.restart` also acts as the
  explicit re-trigger for a session parked after exhausting its pairing codes.
- **Replace a session**: change its `sessionId` (optionally
  `JUNE_FORCE_SESSION_BOOTSTRAP=true` to force re-bootstrap from the id).
- **A session logs out**: only that session's auth is quarantined/cleared and
  it returns to its own login flow; the others keep running.
- **Session export**: with `JUNE_EXPORT_SESSION_TO_ENV=true`, refreshed creds
  are written back to the `.env` `JUNE_SESSIONS` line every 30 minutes.
- **Logs**: every session-scoped line is tagged with its id, e.g.
  `[ sessionId:backup ]`, `[ CONFLICT:backup ]`, `[ AUTH:backup ]`. In
  multi-session mode the console prefix itself is also per session —
  `[ JUNEX ULTRA 909 ]` — using the last 3 digits of the session's WhatsApp
  number (`[ JUNEX ULTRA main ]` before the number is known). Single-session /
  legacy mode keeps the classic `[ JUNEX ULTRA ]`. The CMD log box header
  carries the same tag.

## 👑 Deployment Super Owner (security foundation)

Every fresh deployment establishes its **own** Super Owner — it never comes
from hardcoded source numbers, a WhatsApp command, or a session setting.

- **Establishment**: the first **initial session** (present in `JUNE_SESSIONS`
  at process startup) that successfully connects — its **verified WhatsApp
  number** is persisted as the deployment's Super Owner.
- **Locked**: stored in the anchor database's `platform_settings` table
  (`database/june-ultra.db`) with an atomic first-wins claim. It is never
  recalculated on startup, never overwritten, and never cleared when sessions
  disconnect, get removed, reordered or replaced.
- **Hot-added sessions** (`.addbot`, `.env` hot-reload additions) can never
  claim the Super Owner — eligibility is reserved for initial sessions only.
- **Platform-level commands** (`superOwnerOnly`, currently `.addbot`) resolve
  ONLY against the persisted Super Owner. Before establishment, the legacy
  `config.ownerNumber` list authorizes as a bootstrap fallback; afterwards it
  loses platform authority.
- **No fromMe shortcut**: messaging a bot from its own account grants only
  SESSION-level owner rights — never platform authority. A session's account
  holder who is not the Super Owner cannot run `.addbot`, even from the bot's
  own "Message yourself" chat (regression-tested).
- **Session-level commands** (`ownerOnly`) remain the union of
  `config.ownerNumber` (future session owners) + the Super Owner.
- **Privacy**: the Super Owner number is never printed in logs or the
  connected message — sessions only display `Super Owner: ✅/❌`.
- **Test command**: `.superowner` tells the sender whether THEY are the
  Super Owner (`✅` / `❌` / `—`) — deliberately ungated and leak-free; it can
  never change the Super Owner.

No change, reset or recovery command exists — and none is planned yet.

## Known shared-state caveats (intentional)

These remain shared across sessions because the data is identical for both
bots or the guard is transient:

- per-chat download/dedupe sets in `media/*`, `general/apk.js` (same message
  would be downloaded identically by both bots),
- the 6-second correction guards in `antidemote`/`antipromote` (both bots see
  the same event),
- `tictactoe`/`bomb` game boards (keyed by chat; two bots in one group share
  the game).

## Compatibility

- Single-session deployments behave exactly as before (same session dir, same
  `june-ultra.db`, same logs, same exit behaviour when nothing is configured).
- `JUNE_DB_FILE` / `JUNE_DB_DIR` / `JUNE_DB_BACKUP_FILE` still apply to the
  default session; extra sessions always use `database/june-<id>.db`.
- `global.__JUNE_SHUTDOWN` now stops every session and flushes every database.
