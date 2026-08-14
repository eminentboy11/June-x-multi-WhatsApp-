# June X — Multi-Session Guide

June X now runs **any number of WhatsApp sessions inside one process**. Each
session is a fully independent bot: its own socket, its own reconnect state
machine, its own settings, and its own SQLite database.

## Quick start

### 1. Define your sessions

Three ways, in priority order:

**A. `JUNE_SESSIONS` env (JSON)** — best for hosted panels:

```json
[{"id":"main","name":"Main","sessionId":"JUNE-MD:~...","phone":""},
 {"id":"backup","name":"Backup","sessionId":"","phone":"254700000000"}]
```

**B. `sessions.json` at the project root** (see `sessions.example.json`):

```json
{
  "sessions": [
    { "id": "main",   "name": "June Main",   "sessionId": "JUNE-MD:~<base64>", "phone": "" },
    { "id": "backup", "name": "June Backup", "sessionId": "",                    "phone": "254700000000" }
  ]
}
```

**C. Legacy `SESSION_ID`** — nothing changes. The bot runs exactly as before as
one session with id `JUNE_BOT_ID` (or `BOT_ID`, `OWNER_NUMBER`, else `default`).

Entry fields:

| Field       | Required | Meaning                                                        |
|-------------|----------|----------------------------------------------------------------|
| `id`        | no*      | Unique session id (safe chars: letters, digits, `_.-`)         |
| `name`      | no       | Display name (also becomes that bot's `botName` config)        |
| `sessionId` | no       | Session ID — one of `JUNE-MD:~…`, `Ultra-X:~…`, `June-Ultra:~…`, `June::~…` |
| `phone`     | no       | Phone number with country code — triggers pairing-code login; also acts as an automatic fallback when `sessionId` fails (see below) |

\* defaults to the default bot id. `phone` without `sessionId` = pair with code
(the code is printed in the logs). Neither = session is parked as
`needs-login` until you add one.

### 🎯 Bonus: sessionId + phone (auto-fallback)

A session may carry **both** fields:

```json
{ "id": "main", "name": "Main", "sessionId": "JUNE-MD:~...", "phone": "2348154853640" }
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
| In-memory caches (group metadata, bot-admin, view-once, LID map, auto-react) | AsyncLocalStorage-scoped per bot |
| Status auto-view/react queues, message store, presence store | per bot |
| Always-online heartbeat, anti-spam tracker, anti-delete status store | per bot |

Because commands read `config.` and `database.` through a context-aware layer
(`utils/botContext`), **command files did not need to change** — `mynote.js`,
`addnote.js` and the other ~300 commands automatically read/write the correct
bot's data.

## Operations

- **Add a session**: append to `sessions.json` / `JUNE_SESSIONS` and restart
  (a watcher restarts the process automatically when `sessions.json` changes).
- **Restart one session**: `.restart` from that bot restarts **only that
  session** — its socket is torn down and rebooted from stored auth while the
  other sessions keep running untouched (falls back to a full process restart
  only when the per-session hook is unavailable).
- **Replace a session**: change its `sessionId` (optionally
  `JUNE_FORCE_SESSION_BOOTSTRAP=true` to force re-bootstrap from the id).
- **A session logs out**: only that session's auth is quarantined/cleared and
  it returns to its own login flow; the others keep running.
- **Session export**: with `JUNE_EXPORT_SESSION_TO_ENV=true`, refreshed creds
  are written back to `.env` (default session) or `sessions.json` (registry
  sessions) every 30 minutes.
- **Logs**: every session-scoped line is tagged with its id, e.g.
  `[ SESSION_ID:backup ]`, `[ CONFLICT:backup ]`, `[ AUTH:backup ]`. The CMD
  log box header is tagged per session with the last 3 digits of its WhatsApp
  number — `JUNE ULTRA 909` for `2348165321909` — so each bot's traffic is
  identifiable at a glance.

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
