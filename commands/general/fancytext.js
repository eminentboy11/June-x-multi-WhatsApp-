/**
 * Fancy Text Command
 * Converts text to all available Unicode font styles locally — no API needed.
 * Supports all fonts in fontConverter.js plus combining-character styles.
 */

const { FONTS } = require('../../utils/fontConverter');

const NORMAL_LOWER  = 'abcdefghijklmnopqrstuvwxyz';
const NORMAL_UPPER  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NORMAL_DIGITS = '0123456789';

// ── Extra combining-character styles (appended per non-space char) ────────────
const COMBINING_STYLES = [
    { label: 'Underline',    char: '\u0332' },
    { label: 'Overline',     char: '\u0305' },
    { label: 'Wavy',         char: '\u0330' },
    { label: 'Double Under', char: '\u0333' },
    { label: 'Dotted',       char: '\u0307' },
    { label: 'Ring Above',   char: '\u030A' },
];

// ── Pretty labels for each font key ──────────────────────────────────────────
const FONT_LABELS = {
    bold:            'Bold',
    italic:          'Italic',
    bolditalic:      'Bold Italic',
    serif:           'Serif Bold',
    serifitalic:     'Serif Italic',
    serifbolditalic: 'Serif Bold Italic',
    script:          'Script Bold',
    scriptlight:     'Script',
    gothic:          'Gothic',
    gothicbold:      'Gothic Bold',
    mono:            'Monospace',
    double:          'Double Struck',
    circled:         'Circled',
    squared:         'Squared',
    fullwidth:       'Full Width',
    smallcaps:       'Small Caps',
    superscript:     'Superscript',
    inverted:        'Inverted/Flip',
    bubbles:         'Bubbles',
    strikethrough:   'Strikethrough',
    sansserif:       'Sans Serif',
    parenthesized:   'Parenthesized',
};

function convertChar(char, font) {
    const lIdx = NORMAL_LOWER.indexOf(char);
    if (lIdx !== -1) { const arr = [...font.lower];  return arr[lIdx] || char; }
    const uIdx = NORMAL_UPPER.indexOf(char);
    if (uIdx !== -1) { const arr = [...font.upper];  return arr[uIdx] || char; }
    const dIdx = NORMAL_DIGITS.indexOf(char);
    if (dIdx !== -1) { const arr = [...font.digits]; return arr[dIdx] || char; }
    return char;
}

function applyFontStyle(text, font) {
    return [...text].map(ch => convertChar(ch, font)).join('');
}

function applyCombining(text, combChar) {
    return [...text].map(ch => /\s/.test(ch) ? ch : ch + combChar).join('');
}

function buildLines(input) {
    const lines = [];
    let num = 1;
    for (const [key, font] of Object.entries(FONTS)) {
        if (key === 'normal') continue;
        const label = FONT_LABELS[key] || key;
        lines.push(`*${num}.* ${applyFontStyle(input, font)}  _[${label}]_`);
        num++;
    }
    for (const style of COMBINING_STYLES) {
        lines.push(`*${num}.* ${applyCombining(input, style.char)}  _[${style.label}]_`);
        num++;
    }
    return lines;
}

module.exports = {
    name: 'fancy',
    aliases: ['fancytext', 'stylish', 'fonts'],
    category: 'general',
    description: 'Show text in every available Unicode font style',
    usage: '.fancy <text>  |  reply to fancy list with a number to pick a style',

    async execute(sock, msg, args, extra) {
        const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedText = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '';

        // ── Mode 1: user replied to a fancy list with a number ────────────────
        if (quotedText.includes('Fancy Styles for:') && args.length === 1 && /^\d+$/.test(args[0])) {
            // Rebuild from original input embedded in the header
            const headerMatch = quotedText.match(/Fancy Styles for:\*\s*_(.+?)_/);
            if (headerMatch) {
                const originalInput = headerMatch[1];
                const lines = buildLines(originalInput);
                const total = lines.length;
                const pick = parseInt(args[0]);
                if (pick < 1 || pick > total) return extra.reply(`❌ Pick a number between 1 and ${total}.`);
                const chosen = lines[pick - 1];
                const clean = chosen.replace(/^\*\d+\.\*\s*/, '').replace(/\s*_\[.*?\]_$/, '').trim();
                return extra.reply(clean);
            }
        }

        // ── Mode 2: generate the full fancy list ──────────────────────────────
        let input = args.join(' ').trim();
        if (!input && quotedText && !quotedText.includes('Fancy Styles for:')) {
            input = quotedText.trim();
        }
        if (!input) return extra.reply(
            '❌ Provide some text.\n\nExample: *.fancy Hello World*\nOr reply to a message with *.fancy*\n\nThen reply to the result with *.fancy <number>* to pick one style.'
        );

        await extra.react('✨');

        const lines = buildLines(input);
        const total = lines.length;

        const header = `✨ *Fancy Styles for:* _${input}_\n` +
                       `━━━━━━━━━━━━━━━ (${total} styles)\n\n`;
        const footer = `\n━━━━━━━━━━━━━━━\n_Reply to this message with a number to get that style alone._`;

        const fullText = header + lines.join('\n') + footer;

        // Split into chunks if the message is too long
        const CHUNK_LIMIT = 60000;
        if (fullText.length <= CHUNK_LIMIT) {
            await extra.reply(fullText);
        } else {
            let buf = header;
            for (const line of lines) {
                if ((buf + line + '\n').length > CHUNK_LIMIT) {
                    await extra.reply(buf.trimEnd());
                    buf = '';
                }
                buf += line + '\n';
            }
            if (buf.trim()) await extra.reply(buf.trimEnd() + footer);
        }
    }
};
