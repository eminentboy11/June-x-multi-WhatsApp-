# June X — Multi-WhatsApp Bot (Multi-Session Edition)

> WhatsApp MD-style multi-command bot built on **Baileys** — now running **multiple WhatsApp sessions in ONE process**.
> Forked from [supreme-Lord2/xjx](https://github.com/supreme-Lord2/xjx) (June X Ultra). This edition adds a complete multi-session core.

---

## ✨ What's new — Multi-Session

Run 2, 3, 10… WhatsApp numbers from a single deployment. Every session is a fully independent bot:

| Per session | Details |
|---|---|
| 🔌 Socket & auth | own Baileys socket, Signal keys, creds — `session/` (main) or `sessions/<id>/` |
| 🗄️ Database | own SQLite file `database/june-<id>.db` — notes, settings, warnings, anti-features are fully isolated |
| ⚙️ Settings | own prefix, botName, bot mode, auto-react, presence, menu style |
| 🔁 Reconnect | own 408/503/500/409/440 backoff & conflict state machine — one bot reconnecting never touches the others |
| ☁️ Remote mirror | own `bot_id` rows in Postgres / MongoDB |
| 📦 Memory | per-bot caches, message stores, status queues, heartbeat |

**Commands needed zero changes.** Every command (including `commands/notes/mynote.js`) reads `config.` and `database.` through a context layer (`utils/botContext.js`), so it automatically operates on the bot that received the message.

📖 Full guide: **[MULTI_SESSION.md](MULTI_SESSION.md)** · Tests: `node test/multi-session.test.js`

---

## 🚀 Quick start (local / VPS)

```bash
git clone https://github.com/eminentboy11/June-x-multi-WhatsApp-.git
cd June-x-multi-WhatsApp-
npm install

# optional: copy .env.example -> .env and fill in your JUNE_SESSIONS registry
nano .env

npm start
```

### Define your sessions

`JUNE_SESSIONS` is the **only** session configuration mechanism. One session
and multiple sessions use exactly the same registry and boot pipeline — the
only difference is the number of entries.

**`JUNE_SESSIONS` in `.env`** (or as a panel variable) is the **only** registry.
The value is one line of JSON:

```env
JUNE_SESSIONS=[{"sessionId":"JUNE-MD:~...","phone":"2348154853640"},{"sessionId":"","phone":"2348165321909"}]
```

- **Hot-reload**: editing the `JUNE_SESSIONS` line in `.env` while the bot
  runs adds/removes sessions live (within seconds) — no restart.
- The line **must be one line of JSON** (multi-line values do not parse in `.env`).
- With no registry at all, the bot boots a single default session with the
  first-run login flow (interactive menu, or a clear exit message headless).

#### Session entry fields

| Field | Required | Meaning |
|---|---|---|
| `sessionId` | no | `JUNE-MD:~…`, `Ultra-X:~…`, `June-Ultra:~…` or `June::~…` (auto-login) |
| `phone` | expected | digits with country code → **pairing-code login** + self-healing fallback; the bot's identity key |
| `id` | **auto** | derived from the phone; duplicate numbers get `-2`, `-3` suffixes automatically. Optional explicit override for a stable id (e.g. client bots) |
| `name` | **auto** | derived as `June X <last3>` (e.g. `June X 640`) for the dashboard/logs. An explicit name also changes that bot's `botName` |

- Only `phone` given → fresh pairing-code login.
- Only `sessionId` given → classic auto-login (no self-healing fallback).
- **Both** → sessionId first, phone auto-fallback.
- **Neither** → session is parked as `needs-login` on the dashboard.
- The old full format (`id`/`name`/`sessionId`/`phone` on every entry) still
  works unchanged — `id`/`name` are just overrides now.

## 🖥️ Dashboard & health

- `GET /` — live dashboard, one card per session (state, account, connected time), auto-refresh
- `GET /health` — plain OK
- `GET /health/details` — JSON: all sessions, database health, auth stats, telemetry

---

## ⚡ Features

- **~300 commands in 22 categories** — botmanager (5), admin (59), owner (52), general (41), design (30), media (25), fun (20), textmaker (19), tools (18), stalker, anime, ai, aivideo, ephoto, convert, notes, sports, reaction, religion, movies, utility
- **Anti-features**: antilink, antispam, antibadword, antibot, antiviewonce, antiforward, antitag, antidelete (+ status), anticall, antigif/image/sticker/video/audio/contact, autosticker, welcome/goodbye, hide-tag, and more
- **Auth**: SQLite-backed Signal keys with integrity validation, backups, quarantines, session-ID fingerprints, remote auth mirror (Postgres / MongoDB) with recovery
- **Notes system** (`addnote` / `mynotes`) per user, per bot
- Group stats, warning system, muting, bot modes, font styles, sticker tools, yt/media downloaders, TTS, ephoto360/textmaker/design logos
- Auto status view/react, always-online, auto-download status, pairing-code login with **sessionId+phone auto-fallback**, per-session **pairing-code budget**, **hot-add/hot-remove sessions without restart** — from WhatsApp too: `.addbot` (in-chat pairing code with copy/cancel buttons + reaction progress), `.delbot`, `.bots`, `.repairbot`, per-session **console log prefixes** (`[ JUNEX ULTRA 909 ]`), `.env` watcher, graceful shutdown
- **Startup report** is a single-session presentation feature: shown only when the process starts with exactly 1 session — skipped entirely with 2+ sessions, and never shown for runtime hot-added sessions
- **Deployment Super Owner**: established once from the first initial session's verified WhatsApp number, locked in the anchor database — platform commands (`.addbot`) resolve only against it; the connected message shows `Super Owner: ✅/❌` per session (details in [MULTI_SESSION.md](MULTI_SESSION.md))

---

## 📦 Deploy (panel ZIP upload)

If you update an existing June X deployment via ZIP upload, upload/overwrite these files at the matching paths:

```text
config.js
database.js
handler.js
index.js
.gitignore
commands/admin/antispam.js
commands/owner/alwaysonline.js
commands/owner/antidelete.js
commands/owner/antideletestatus.js
commands/owner/autostatusemoji.js
commands/owner/autostatusreact.js
commands/owner/autostatusview.js
utils/groupstats.js
utils/jidHelper.js
utils/juneDb/mongoAdapter.js
utils/juneDb/pgAdapter.js
utils/botContext.js          (new)
utils/sessionManager.js      (new)
MULTI_SESSION.md             (new)
test/multi-session.test.js   (new)
```

Then restart. Existing installs keep their `session/` folder and `june-ultra.db` untouched.

### Environment variables

See **`.env.example`** for a ready-to-copy template (single legacy session, multi-session, external databases, pairing tuning). The bot auto-creates the same template as `.env` on first boot when none exists.

| Variable | Purpose |
|---|---|
| `JUNE_SESSIONS` | the sole session registry (JSON, one line in `.env`) — hot-reloadable live |
| `JUNE_BOT_ID` | default session id / mirror `bot_id` |
| `DATABASE_URL` | PostgreSQL mirror (per-bot rows separated by `bot_id` automatically) |
| `MONGODB_URI` / `MONGO_URL` | MongoDB mirror (per-bot `botId` records) |
| `JUNE_DB_FILE` / `JUNE_DB_DIR` | database path for the default session |
| `JUNE_FORCE_SESSION_BOOTSTRAP` | `true` = force re-bootstrap from `sessionId` |
| `JUNE_EXPORT_SESSION_TO_ENV` | `true` = auto-export refreshed creds back to `.env`'s `JUNE_SESSIONS` line |
| `JUNE_PAIRING_MAX_ATTEMPTS` | pairing codes per login/recovery cycle (default **3**); after the limit the session parks as `needs-login` until `.restart`/`.repairbot`/process restart |
| `JUNE_PAIRING_STABILIZE_MS` | socket-stabilize wait before requesting a pairing code (default 3000); live `.addbot`/`.repairbot` flows are automatically capped at 800 |
| `JUNE_MAX_SESSIONS` | runtime `.addbot` quota — max total sessions (default **10**); per-number WhatsApp device cap (4) always applies |
| `JUNE_SESSIONS_POLL_MS` | hot-add/hot-remove registry poll interval (default 15000) |
| `PORT` | dashboard port (default 5000) |

---

## 🗄️ External auth mirror (unchanged from June X)

Verified local SQLite auth rows (`session_creds`, `session_keys`, `session_auth_meta`) are mirrored directly to configured PostgreSQL (`session_auth_state` table) and/or MongoDB (`auth-state` record in `june_mirror_records`), per bot. If local auth is lost and no usable file session exists, the latest remote auth state is restored before startup. A deliberate logout/session clear deletes the remote auth state too.

---

## 🧪 Tests

```bash
node test/multi-session.test.js
```

Covers ALS routing, per-bot databases/KV (notes), settings, config proxy, handler caches, `mynote.js` end-to-end isolation, registry parsing and per-bot adapters.

---

## 👑 Credits

- Original June X Ultra: **Supreme** ([github.com/supreme-Lord2](https://github.com/supreme-Lord2))
- Multi-session core: this fork
- Built with [Baileys](https://github.com/WhiskeySockets/Baileys), better-sqlite3, express

License: MIT
