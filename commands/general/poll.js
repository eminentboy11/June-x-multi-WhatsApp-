/**
 * Poll — native WhatsApp poll via sock.sendMessage({ poll })
 *
 * Usage:
 *   .poll Question | Option 1 | Option 2 [| Option 3...]
 *   .poll multi Question | Option 1 | Option 2
 *
 * Separators: |  or  /
 * Max 12 options (WhatsApp limit). Default: one vote each. multi = pick many.
 */

const MAX_OPTIONS = 12;
const MAX_QUESTION = 255;
const MAX_OPTION = 100;

function parsePollInput(args) {
    const raw = (args || []).join(' ').trim();
    if (!raw) return { error: 'usage' };

    const tokens = raw.split(/\s+/);
    let selectableCount = 1;
    let body = raw;

    const flag = (tokens[0] || '').toLowerCase();
    if (['multi', 'multiple', 'm', '--multi'].includes(flag)) {
        selectableCount = 0; // filled after options are known
        body = tokens.slice(1).join(' ').trim();
    }

    if (!body) return { error: 'usage' };

    const parts = body
        .split(/\s*[|\/]\s*/)
        .map(s => s.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    if (parts.length < 3) {
        return { error: 'need-options' };
    }

    const question = parts[0].slice(0, MAX_QUESTION);
    const seen = new Set();
    const values = [];
    for (const opt of parts.slice(1)) {
        const value = opt.slice(0, MAX_OPTION);
        const key = value.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        values.push(value);
        if (values.length >= MAX_OPTIONS) break;
    }

    if (values.length < 2) return { error: 'need-options' };

    if (selectableCount === 0) selectableCount = values.length;

    return { question, values, selectableCount };
}

module.exports = {
    name: 'poll',
    aliases: ['vote', 'createpoll', 'wapoll'],
    category: 'general',
    description: 'Create a native WhatsApp poll',
    usage: '.poll Question | Option 1 | Option 2',

    async execute(sock, msg, args, extra) {
        const parsed = parsePollInput(args);

        if (parsed.error) {
            return extra.reply(
                `📊 *Create a Poll*\n\n` +
                `*Usage:*\n` +
                `  .poll Question | Option 1 | Option 2\n` +
                `  .poll multi Question | A | B | C\n\n` +
                `*Rules:*\n` +
                `  • Separate question and options with \`|\`\n` +
                `  • Minimum 2 options, maximum ${MAX_OPTIONS}\n` +
                `  • \`multi\` lets people pick more than one\n\n` +
                `*Example:*\n` +
                `  .poll Dinner? | Rice | Beans | Pizza`
            );
        }

        try {
            if (extra.react) await extra.react('📊').catch(() => {});

            await sock.sendMessage(extra.from, {
                poll: {
                    name: parsed.question,
                    values: parsed.values,
                    selectableCount: parsed.selectableCount,
                    toAnnouncementGroup: false,
                },
            }, { quoted: msg });

            if (extra.react) await extra.react('✅').catch(() => {});
        } catch (error) {
            console.error('[poll]', error.message);
            if (extra.react) await extra.react('❌').catch(() => {});
            await extra.reply(`❌ Could not create the poll.\n${error.message || 'WhatsApp rejected the poll.'}`);
        }
    },
};
