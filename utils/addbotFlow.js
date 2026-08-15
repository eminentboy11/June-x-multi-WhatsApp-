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
function removeRegistryEntry(registry, identifier) {
    const list = Array.isArray(registry) ? [...registry] : [];
    const raw = String(identifier || '').trim();
    const needle = digitsOnly(identifier);
    const idx = list.findIndex((e) =>
        String(e.id || '') === raw ||
        (needle && digitsOnly(e.phone) === needle)
    );
    if (idx === -1) return { ok: false, reason: 'unknown', registry: list };
    const [removed] = list.splice(idx, 1);
    return { ok: true, registry: list, removed };
}

/** The in-chat pairing-code message with copy/cancel buttons. */
function buildCodeMessage({ code, attempt = 1, max = 5, phone = '', botId }) {
    const copyId = `${BUTTON_COPY_PREFIX}${botId}`;
    const cancelId = `${BUTTON_CANCEL_PREFIX}${botId}`;
    return {
        text:
            `🔑 *Pairing Code* (${attempt}/${max})\n\n` +
            `📱 Phone: ${phone}\n` +
            `🔢 Code: \`\`\`${code}\`\`\`\n\n` +
            `📲 *How to link:*\n` +
            `1️⃣ Open WhatsApp → Settings\n` +
            `2️⃣ Linked Devices → *Link a Device*\n` +
            `3️⃣ Enter the code above\n\n` +
            `⏳ _Waiting for pairing…_`,
        footer: 'June X — live pairing',
        buttons: [
            {
                name: copyId,
                buttonParamsJson: JSON.stringify({
                    display_text: '📋 Copy Code',
                    id: copyId,
                    copy_code: code,
                }),
            },
            {
                name: cancelId,
                buttonParamsJson: JSON.stringify({
                    display_text: '❌ Cancel',
                    id: cancelId,
                }),
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

module.exports = {
    BUTTON_COPY_PREFIX,
    BUTTON_CANCEL_PREFIX,
    DEFAULT_MAX_SESSIONS,
    WHATSAPP_DEVICE_CAP,
    digitsOnly,
    parseMaxSessions,
    countSessionsForPhone,
    checkAddQuota,
    removeRegistryEntry,
    buildCodeMessage,
    buildStatusMessage,
    parseAddbotButton,
};
