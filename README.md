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

# define your sessions (see sessions.example.json)
nano sessions.json

npm start
```

### Define your sessions

Three ways, in priority order:

**1. `sessions.json`** at the project root (recommended):

```json
{ "sessions": [
  { "id": "main",   "name": "June Main",   "sessionId": "JUNE-MD:~<base64>", "phone": "" },
  { "id": "backup", "name": "June Backup", "sessionId": "", "phone": "254700000000" }
] }
```

**2. `JUNE_SESSIONS` env** (JSON) — ideal for hosted panels:

```json
[{"id":"main","name":"Main","sessionId":"JUNE-MD:~...","phone":""},{"id":"backup","name":"Backup","sessionId":"","phone":"254700000000"}]
```

**3. Legacy `SESSION_ID`** in `.env` — single session, exactly like before.

| Field | Required | Meaning |
|---|---|---|
| `id` | no | unique session id (default: `JUNE_BOT_ID` / `BOT_ID` / `OWNER_NUMBER` / `default`) |
| `name` | no | display name — also becomes that bot's `botName` |
| `sessionId` | no | `JUNE-MD:~…`, `Ultra-X:~…`, `June-Ultra:~…` or `June::~…` (auto-login) |
| `phone` | no | phone with country code → **pairing-code login**, code printed in logs |

No `sessionId` and no `phone` → session is parked as `needs-login` on the dashboard until you add one.

**🎯 Bonus — combine both:** with `sessionId` + `phone`, the bot tries the session ID first and **automatically falls back to pairing-code login** whenever it's invalid, revoked, or the session logs out. Self-healing, no `needs-login` parking. Details in [MULTI_SESSION.md](MULTI_SESSION.md).

---

## 🖥️ Dashboard & health

- `GET /` — live dashboard, one card per session (state, account, connected time), auto-refresh
- `GET /health` — plain OK
- `GET /health/details` — JSON: all sessions, database health, auth stats, telemetry

---

## ⚡ Features

- **~300 commands in 21 categories** — admin (59), owner (52), general (41), design (30), media (25), fun (20), textmaker (19), tools (18), stalker, anime, ai, aivideo, ephoto, convert, notes, sports, reaction, religion, movies, utility
- **Anti-features**: antilink, antispam, antibadword, antibot, antiviewonce, antiforward, antitag, antidelete (+ status), anticall, antigif/image/sticker/video/audio/contact, autosticker, welcome/goodbye, hide-tag, and more
- **Auth**: SQLite-backed Signal keys with integrity validation, backups, quarantines, session-ID fingerprints, remote auth mirror (Postgres / MongoDB) with recovery
- **Notes system** (`addnote` / `mynotes`) per user, per bot
- Group stats, warning system, muting, bot modes, font styles, sticker tools, yt/media downloaders, TTS, ephoto360/textmaker/design logos
- Auto status view/react, always-online, auto-download status, pairing-code login with **sessionId+phone auto-fallback**, per-session **pairing-code budget**, **hot-add/hot-remove sessions without restart**, `.env`/registry watchers, graceful shutdown

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
sessions.example.json        (new)
MULTI_SESSION.md             (new)
test/multi-session.test.js   (new)
```

Then restart. Existing installs keep their `session/` folder and `june-ultra.db` untouched.

### Environment variables

| Variable | Purpose |
|---|---|
| `SESSION_ID` | legacy single-session id |
| `JUNE_SESSIONS` | multi-session registry (JSON) |
| `JUNE_PAIRING_NUMBER` | legacy single-session pairing phone |
| `JUNE_BOT_ID` | default session id / mirror `bot_id` |
| `DATABASE_URL` / `MONGODB_URI` | optional remote mirrors |
| `JUNE_DB_FILE` / `JUNE_DB_DIR` | database path for the default session |
| `JUNE_FORCE_SESSION_BOOTSTRAP` | `true` = force re-bootstrap from `sessionId` |
| `JUNE_EXPORT_SESSION_TO_ENV` | `true` = auto-export refreshed creds (`.env` / `sessions.json`) |
| `JUNE_PAIRING_MAX_ATTEMPTS` | pairing codes per login/recovery cycle (default **5**); after the limit the session parks as `needs-login` until `.restart`/process restart |
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
