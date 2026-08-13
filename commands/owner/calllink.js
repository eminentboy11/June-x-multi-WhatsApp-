/**
 * Call Link — sock.createCallLink('audio' | 'video', event?)
 * Creates a WhatsApp call link on the connected account.
 * Owner/sudo only — the link belongs to the bot number.
 *
 *   .calllink
 *   .calllink voice
 *   .calllink video
 *   .calllink video 18:30
 *   .calllink voice 2026-08-15 19:00
 */

const config = require('../../config');

function parseType(token) {
    const value = String(token || '').toLowerCase();
    if (['video', 'vid', 'v', 'cam'].includes(value)) return 'video';
    if (['voice', 'audio', 'call', 'a'].includes(value)) return 'audio';
    return null;
}

function formatInZone(unix, timeZone) {
    try {
        return new Date(unix * 1000).toLocaleString('en-GB', {
            timeZone,
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    } catch (_) {
        return new Date(unix * 1000).toISOString();
    }
}

function zoneUnix(year, month, day, hour, minute, timeZone) {
    const dtf = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
    const read = (ms) => {
        const parts = dtf.formatToParts(new Date(ms));
        const get = (type) => {
            const hit = parts.find(p => p.type === type);
            return hit ? parseInt(hit.value, 10) : 0;
        };
        return { y: get('year'), m: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute') };
    };

    let ms = Date.UTC(year, month - 1, day, hour, minute, 0);
    for (let i = 0; i < 4; i++) {
        const got = read(ms);
        const gotUtc = Date.UTC(got.y, got.m - 1, got.d, got.h, got.mi);
        const wantUtc = Date.UTC(year, month - 1, day, hour, minute);
        const delta = wantUtc - gotUtc;
        if (delta === 0) break;
        ms += delta;
    }
    return Math.floor(ms / 1000);
}

function parseStart(args, timeZone) {
    if (!args.length) return null;
    const raw = args.join(' ').trim();
    if (!raw) return null;

    const now = new Date();
    const todayParts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(now);
    const get = (type) => parseInt(todayParts.find(p => p.type === type).value, 10);
    let year = get('year');
    let month = get('month');
    let day = get('day');

    let hour;
    let minute;

    const full = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})$/);
    const clock = raw.match(/^(\d{1,2}):(\d{2})$/);
    if (full) {
        year = +full[1];
        month = +full[2];
        day = +full[3];
        hour = +full[4];
        minute = +full[5];
    } else if (clock) {
        hour = +clock[1];
        minute = +clock[2];
    } else {
        throw new Error('Time must look like `18:30` or `2026-08-15 19:00`');
    }

    if (hour > 23 || minute > 59 || month < 1 || month > 12 || day < 1 || day > 31) {
        throw new Error('That date/time is not valid.');
    }

    const unix = zoneUnix(year, month, day, hour, minute, timeZone);
    if (unix * 1000 < Date.now() - 60_000) {
        throw new Error('That time is already in the past.');
    }
    return unix;
}

function toCallUrl(type, token) {
    if (!token) return null;
    const value = String(token).trim();
    if (/^https?:\/\//i.test(value)) return value;
    const pathType = type === 'video' ? 'video' : 'voice';
    return `https://call.whatsapp.com/${pathType}/${value}`;
}

module.exports = {
    name: 'calllink',
    aliases: ['voicelink', 'videocalllink', 'wacall'],
    category: 'owner',
    description: 'Create a WhatsApp voice or video call link',
    usage: '.calllink [voice|video] [HH:MM | YYYY-MM-DD HH:MM]',
    ownerOnly: true,

    async execute(sock, msg, args, extra) {
        if (typeof sock.createCallLink !== 'function') {
            return extra.reply('❌ `createCallLink` is not available on this Baileys build. Need 7.0.0-rc14 or newer.');
        }

        const tokens = [...(args || [])];
        let type = parseType(tokens[0]);
        if (type) tokens.shift();
        else type = 'audio';

        const tz = config.timezone || 'Africa/Lagos';
        let startTime = null;
        try {
            startTime = parseStart(tokens, tz);
        } catch (parseError) {
            return extra.reply(
                `📞 *Call Link*\n\n${parseError.message}\n\n` +
                `Usage:\n` +
                `  .calllink\n` +
                `  .calllink video\n` +
                `  .calllink voice 18:30\n` +
                `  .calllink video 2026-08-15 19:00`
            );
        }

        try {
            if (extra.react) await extra.react('📞').catch(() => {});
            const event = startTime ? { startTime } : undefined;
            const token = await sock.createCallLink(type, event);
            const url = toCallUrl(type, token);
            if (!url) throw new Error('WhatsApp did not return a call token.');

            const kind = type === 'video' ? 'Video' : 'Voice';
            let text =
                `┏━━『 CALL LINK 』━━\n\n` +
                `➥ Type      ➜ ${kind}\n` +
                `➥ Link      ➜ ${url}\n`;
            if (startTime) {
                text += `➥ Starts    ➜ ${formatInZone(startTime, tz)}\n`;
                text += `➥ Timezone  ➜ ${tz}\n`;
            }
            text += `\n┗━━━━━━━━━━━━━━━━`;

            let sent = false;
            try {
                const { sendButtons } = require('gifted-btns');
                await sendButtons(sock, extra.from, {
                    text,
                    footer: `> Powered by ${config.botName || 'June-X Ultra'}`,
                    buttons: [
                        {
                            name: 'cta_url',
                            buttonParamsJson: JSON.stringify({
                                display_text: `📞 Join ${kind} Call`,
                                url,
                            }),
                        },
                        {
                            name: 'cta_copy',
                            buttonParamsJson: JSON.stringify({
                                display_text: '📋 Copy Link',
                                copy_code: url,
                            }),
                        },
                    ],
                }, { quoted: msg });
                sent = true;
            } catch (_) {}

            if (!sent) {
                await extra.reply(text);
            }
            if (extra.react) await extra.react('✅').catch(() => {});
        } catch (error) {
            console.error('[calllink]', error.message);
            if (extra.react) await extra.react('❌').catch(() => {});
            await extra.reply(`❌ Could not create call link: ${error.message}`);
        }
    },
};
