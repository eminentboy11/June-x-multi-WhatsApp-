/**
 * Addbot Flow — pure helpers for the in-chat session-management flow.
 *
 * Covers `.addbot` UX (pairing code delivered in the same chat with
 * copy/cancel buttons, reactions as progress), `.delbot` registry removal,
 * session quotas (JUNE_MAX_SESSIONS + WhatsApp's per-number device cap) and
 * status messages. Pure module — no sockets, no DB; index.js and the owner
 * commands wire these helpers together through the existing hot-add pipeline.
 */

'use strict';

const BUTTON_COPY_PREFIX = 'addbot_copy_';
const BUTTON_CANCEL_PREFIX = 'addbot_cancel_';

const DEFAULT_MAX_SESSIONS = 10;
const WHATSAPP_DEVICE_CAP = 4; // linked devices per WhatsApp number

const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

/** JUNE_MAX_SESSIONS parser: whole number >= 1, else the default. */
function parseMaxSessions(raw) {
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n >= 1 ? n : DEFAULT_MAX_SESSIONS;
}

// ─── Pairing latency tuning ──────────────────────────────────────────────────
// requestPairingCode historically waits a fixed 3s "for the socket to
// stabilize". Baileys only emits the QR event once the socket is genuinely
// ready for requestPairingCode, so for LIVE flows (.addbot / .repairbot) the
// wait is capped much lower — the code reaches the chat noticeably faster
// while the legacy flow keeps the original default.

const DEFAULT_STABILIZE_MS = 3000;
const FLOW_STABILIZE_CAP_MS = 800;

/** JUNE_PAIRING_STABILIZE_MS parser: whole number >= 0, else 3000. */
function parseStabilizeMs(raw) {
    const n = Math.floor(Number(raw));
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_STABILIZE_MS;
}

/** Stabilize wait for this request — capped when a live flow is waiting. */
function flowStabilizeMs(base, flowPending) {
    const parsed = parseStabilizeMs(base);
    return flowPending ? Math.min(parsed, FLOW_STABILIZE_CAP_MS) : parsed;
}

function countSessionsForPhone(entries, phone) {
    const target = digitsOnly(phone);
    if (!target) return 0;
    return (Array.isArray(entries) ? entries : [])
        .filter((e) => digitsOnly(e.phone) === target).length;
}

/**
 * Pre-add quota checks (runtime .addbot only — the initial registry is
 * explicit config and never quota-checked).
 *   - global session cap: JUNE_MAX_SESSIONS (default 10)
 *   - WhatsApp device cap: max 4 linked devices per number
 */
function checkAddQuota({ registry = [], runningPhones = [], phone, max }) {
    const limit = parseMaxSessions(max);
    const total = Math.max(
        Array.isArray(registry) ? registry.length : 0,
        Array.isArray(runningPhones) ? runningPhones.length : 0
    );
    if (total >= limit) return { ok: false, reason: 'quota', limit, total };

    const samePhone = Math.max(
        countSessionsForPhone(registry, phone),
        (runningPhones || []).filter((p) => digitsOnly(p) === digitsOnly(phone)).length
    );
    if (samePhone >= WHATSAPP_DEVICE_CAP) {
        return { ok: false, reason: 'device-limit', limit: WHATSAPP_DEVICE_CAP, samePhone };
    }
    return { ok: true, limit };
}

/**
 * Pure registry removal: match by explicit id first, then by phone digits.
 * Never mutates the caller's array.
 */
function findRegistryEntryIndex(registry, identifier) {
    const list = Array.isArray(registry) ? registry : [];
    const raw = String(identifier || '').trim();
    const needle = /^\d+$/.test(raw) ? raw : '';
    const phoneOccurrences = new Map();

    for (let index = 0; index < list.length; index += 1) {
        const entry = list[index] || {};
        const phone = digitsOnly(entry.phone);
        let derivedId = String(entry.id || '').trim();
        if (!derivedId && phone) {
            const ordinal = (phoneOccurrences.get(phone) || 0) + 1;
            phoneOccurrences.set(phone, ordinal);
            derivedId = ordinal === 1 ? phone : `${phone}-${ordinal}`;
        }
        if (derivedId === raw || String(entry.id || '') === raw) return index;
        // A bare phone intentionally selects its first registry occurrence.
        if (needle && phone === needle) return index;
    }
    return -1;
}

function removeRegistryEntry(registry, identifier) {
    const list = Array.isArray(registry) ? [...registry] : [];
    const idx = findRegistryEntryIndex(list, identifier);
    if (idx === -1) return { ok: false, reason: 'unknown', registry: list };
    const [removed] = list.splice(idx, 1);
    return { ok: true, registry: list, removed };
}

/** Mark one persistent registry entry paused/active without deleting it. */
function setRegistryPaused(registry, identifier, paused) {
    const list = (Array.isArray(registry) ? registry : []).map(entry => ({ ...entry }));
    const idx = findRegistryEntryIndex(list, identifier);
    if (idx === -1) return { ok: false, reason: 'unknown', registry: list };

    const current = list[idx]?.paused === true;
    const next = paused === true;
    if (current === next) {
        return {
            ok: false,
            reason: next ? 'already-paused' : 'already-active',
            registry: list,
            entry: list[idx],
        };
    }

    if (next) list[idx].paused = true;
    else delete list[idx].paused;
    return { ok: true, registry: list, entry: list[idx], paused: next };
}

/**
 * The in-chat pairing-code message.
 *
 * The TEXT always carries the code (so the message is fully usable even
 * without buttons). `withButtons: true` asks the delivery layer to attach the
 * panel-proven quick-reply buttons (buildSimpleButtons) — the exact
 * { id, text } style that commands/general/botinfo.js sends through
 * gifted-btns and which renders on real panels. If button delivery fails for
 * any reason, the plain text alone is delivered.
 */
function buildCodeMessage({ code, attempt = 1, max = 3, phone = '', botId }) {
    return {
        text:
            `🔑 *Pairing Code* (${attempt}/${max})\n\n` +
            `📱 Phone: ${phone}\n` +
            `🔢 Code: \`\`\`${code}\`\`\`\n` +
            (attempt > 1
                ? `♻️ *All earlier pairing codes are expired. Only this newest code is active.*\n\n`
                : `\n`) +
            `📲 *How to link:*\n` +
            `1️⃣ Open WhatsApp → Settings\n` +
            `2️⃣ Linked Devices → *Link a Device*\n` +
            `3️⃣ Enter the code above\n\n` +
            `⏳ _Waiting for pairing…_`,
        withButtons: true,
        code,
        attempt,
        max,
        phone,
        botId,
    };
}

/**
 * Build the content object for the native-flow buttons message.
 *
 * This repo's Baileys (rc14) has no built-in native-flow button support, and
 * the gifted-btns wrapper has proven unreliable on some panels (obfuscated
 * internals crashing at send time). The content is therefore built directly
 * and sent with generateWAMessageFromContent + relayMessage — the EXACT
 * pattern used by commands/general/menu.js menuStyle '5' (the repo's default
 * menu style, proven to render on real panels). Relaying raw content without
 * that wrapper makes WhatsApp's server silently drop the message (no local
 * error, nothing delivered) — which is what happened with the first attempt.
 *
 * @param {object} proto  Baileys' WAProto (`require('@whiskeysockets/baileys').proto`)
 */
function buildNativeFlowContent(proto, payload) {
    const IM = proto.Message.InteractiveMessage;
    return {
        viewOnceMessage: {
            message: {
                interactiveMessage: IM.create({
                    body: IM.Body.create({ text: payload.text }),
                    footer: IM.Footer.create({ text: payload.footer || '' }),
                    nativeFlowMessage: IM.NativeFlowMessage.create({
                        buttons: (payload.buttons || []).map((b) => ({
                            name: b.name,
                            buttonParamsJson: b.buttonParamsJson,
                        })),
                    }),
                }),
            },
        },
    };
}

/**
 * Quoted-message object for generateWAMessageFromContent (same minimal shape
 * menu.js passes via createFakeContact, but carrying the REAL .addbot command
 * key when available so the reply quotes the requesting message).
 */
function buildFlowQuoted(quotedKey) {
    if (!quotedKey || !quotedKey.id) return undefined;
    return {
        key: {
            remoteJid: quotedKey.remoteJid || '0@s.whatsapp.net',
            fromMe: false,
            id: quotedKey.id,
            participant: quotedKey.participant || undefined,
        },
        message: { conversation: ' ' },
    };
}

/**
 * Quote options for a flow message — the REGRESSION GUARD for the original
 * delivery bug. Baileys' sendMessage quote path calls
 * normalizeMessageContent(quoted.message): passing only { key } crashes with
 * 'Cannot read properties of undefined'. Only quote when the full message
 * payload is present (the same shape as every working repo reply).
 *
 * @returns {{ quoted: object } | {}}
 */
function buildFlowQuoteOptions(quotedMsg) {
    return (quotedMsg && quotedMsg.message) ? { quoted: quotedMsg } : {};
}

/**
 * Button set for the pairing-code message — traced from the repo's OWN
 * panel-proven copy flows (commands/owner/savestatus.js "📋 Copy Text" and
 * commands/general/pair.js "📋 Copy Code"):
 *
 *   - Copy Code  -> `cta_copy` with copy_code = the pairing code. WhatsApp
 *                   NATIVELY copies cta_copy buttons (no message is sent).
 *                   The earlier quick-reply version sent its label as a chat
 *                   message instead of copying — cta_copy is the only button
 *                   type with real clipboard semantics.
 *   - Cancel     -> quick-reply { id, text }: a tap MUST route back to the
 *                   bot, and quick-reply taps are delivered as button
 *                   responses (routed via the addbot_cancel_ id). It carries
 *                   the same mixed-shape pattern menu.js menuStyle '3' uses.
 */
function buildSimpleButtons(payload) {
    return {
        text: payload.text,
        footer: payload.footer || 'June X — live pairing',
        buttons: [
            {
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify({
                    display_text: '📋 Copy Code',
                    id: `${BUTTON_COPY_PREFIX}${payload.botId}`,
                    copy_code: payload.code,
                }),
            },
            {
                id: `${BUTTON_CANCEL_PREFIX}${payload.botId}`,
                text: '❌ Cancel',
            },
        ],
    };
}

/** Terminal status texts for the flow (sent in the same chat at the end). */
function buildStatusMessage(state, phone = '') {
    const p = phone ? `\n📱 Phone: ${phone}` : '';
    switch (state) {
        case 'connected':
            return `✅ *Bot session connected!*${p}\n🟢 Status: online — commands are live.`;
        case 'pairing-limit':
            return `⚠️ *Pairing limit reached*${p}\n🅿️ All pairing codes were used and the session is parked as needs-login.\nSend *.repairbot ${phone}* to start a fresh pairing cycle.`;
        case 'cancelled':
            return `❌ *Add cancelled*${p}\nThe session was removed — nothing was added.`;
        case 'failed':
            return `❌ *Session failed to start*${p}\nCheck the server logs for details.`;
        default:
            return `ℹ️ *Session status*${p}\n${state}`;
    }
}

/** Parse a live-flow button id: { action: 'copy'|'cancel', botId } or null. */
function parseAddbotButton(buttonId) {
    const raw = String(buttonId || '');
    if (raw.startsWith(BUTTON_COPY_PREFIX)) {
        return { action: 'copy', botId: raw.slice(BUTTON_COPY_PREFIX.length) };
    }
    if (raw.startsWith(BUTTON_CANCEL_PREFIX)) {
        return { action: 'cancel', botId: raw.slice(BUTTON_CANCEL_PREFIX.length) };
    }
    return null;
}

/**
 * Resolve a flow tap into { action, botId } — robust against WhatsApp's
 * button-reply variants:
 *   - id-based taps (addbot_copy_<id> / addbot_cancel_<id>)
 *   - LABEL-ONLY taps: some replies arrive with an empty selectedId and only
 *     the button's display text. Cancel then resolves the flow via the
 *     chat (chatBotId — the pending flow registered for that chat); Copy is
 *     a no-op action (WhatsApp already copied natively).
 *
 * @param {{ buttonId?: string, displayText?: string, chatBotId?: string }} tap
 * @returns {{ action: 'copy'|'cancel', botId?: string } | null}
 */
function resolveFlowTap({ buttonId, displayText, chatBotId }) {
    const parsed = parseAddbotButton(buttonId);
    if (parsed) return parsed;
    const label = String(displayText || '').toLowerCase();
    if (/cancel/.test(label)) {
        if (!chatBotId) return null;
        return { action: 'cancel', botId: chatBotId };
    }
    if (/copy/.test(label)) {
        return { action: 'copy' };
    }
    return null;
}

module.exports = {
    BUTTON_COPY_PREFIX,
    BUTTON_CANCEL_PREFIX,
    DEFAULT_MAX_SESSIONS,
    WHATSAPP_DEVICE_CAP,
    digitsOnly,
    parseMaxSessions,
    parseStabilizeMs,
    flowStabilizeMs,
    DEFAULT_STABILIZE_MS,
    FLOW_STABILIZE_CAP_MS,
    countSessionsForPhone,
    checkAddQuota,
    findRegistryEntryIndex,
    removeRegistryEntry,
    setRegistryPaused,
    buildCodeMessage,
    buildFlowQuoteOptions,
    buildNativeFlowContent,
    buildFlowQuoted,
    buildSimpleButtons,
    buildStatusMessage,
    parseAddbotButton,
    resolveFlowTap,
};
