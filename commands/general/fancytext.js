/**
 * Fancy Text Command
 * Converts text to all 35 Unicode font/style variations locally — no API needed.
 * Reply to the output with .fancy <number> to get that style alone.
 */

const { FONTS } = require(require('path').join(global.__CORE__, 'utils', 'fontConverter'));

const NORMAL_LOWER  = 'abcdefghijklmnopqrstuvwxyz';
const NORMAL_UPPER  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NORMAL_DIGITS = '0123456789';

// ── 13 combining-character styles ─────────────────────────────────────────────
const COMBINING_STYLES = [
    { label: 'Underline',       char: '\u0332' },  // a̲b̲c̲
    { label: 'Double Underline',char: '\u0333' },  // a̳b̳c̳
    { label: 'Overline',        char: '\u0305' },  // a̅b̅c̅
    { label: 'Wavy Below',      char: '\u0330' },  // a̰b̰c̰
    { label: 'Dotted Above',    char: '\u0307' },  // ȧḃċ
    { label: 'Ring Above',      char: '\u030A' },  // åb̊c̊
    { label: 'Tilde Above',     char: '\u0303' },  // ãb̃c̃
    { label: 'Tilde Overlay',   char: '\u0334' },  // a̴b̴c̴
    { label: 'Acute Above',     char: '\u0301' },  // áb́ć
    { label: 'Grave Above',     char: '\u0300' },  // àb̀c̀
    { label: 'Circumflex',      char: '\u0302' },  // âb̂ĉ
    { label: 'Diaeresis',       char: '\u0308' },  // äb̈c̈
    { label: 'Slash Through',   char: '\u0338' },  // a̸b̸c̸
];

// ── Pretty labels for each character-font key ─────────────────────────────────
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

// ── Helpers ───────────────────────────────────────────────────────────────────
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
    // Character-replacement fonts
    for (const [key, font] of Object.entries(FONTS)) {
        if (key === 'normal') continue;
        const label = FONT_LABELS[key] || key;
        lines.push(`*${num}.* ${applyFontStyle(input, font)}  _[${label}]_`);
        num++;
    }
    // Combining-character styles
    for (const style of COMBINING_STYLES) {
        lines.push(`*${num}.* ${applyCombining(input, style.char)}  _[${style.label}]_`);
        num++;
    }
    return lines;
}

// Strip line metadata to return just the styled text
function extractStyledText(line) {
    return line
        .replace(/^\*\d+\.\*\s*/, '')      // remove "*N.* "
        .replace(/\s{2}_\[.+?\]_$/, '')    // remove "  _[Label]_"
        .trim();
}

// ── Command ───────────────────────────────────────────────────────────────────
module.exports = {
    name: 'fancy',
    aliases: ['fancytext', 'stylish', 'fonts'],
    category: 'general',
    description: 'Show text in all 35 Unicode font styles',
    usage: '.fancy <text>  |  reply to fancy list with .fancy <number>',

    async execute(sock, msg, args, extra) {
        const quotedMsg  = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
        const quotedText = quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '';

        // ── Mode 1: user replies to a fancy list with a single number ─────────
        const isFancyReply = quotedText.includes('Fancy Styles for:');
        const isSingleNum  = args.length === 1 && /^\d+$/.test(args[0]);

        if (isFancyReply && isSingleNum) {
            const pick = parseInt(args[0]);

            // Scan quoted lines for the one that starts with *pick.*
            const quotedLines = quotedText.split('\n');
            const prefix = `*${pick}.*`;
            const targetLine = quotedLines.find(l => l.trimStart().startsWith(prefix));

            if (!targetLine) {
                // Fallback: count total styles from quoted text and validate
                const maxStyle = quotedLines.filter(l => /^\*\d+\.\*/.test(l.trimStart())).length;
                const hint = maxStyle > 0 ? ` Pick a number between 1 and ${maxStyle}.` : '';
                return extra.reply(`❌ Style #${pick} not found.${hint}`);
            }

            const clean = extractStyledText(targetLine);
            return extra.reply(clean);
        }

        // ── Mode 2: generate the full fancy list ──────────────────────────────
        let input = args.join(' ').trim();
        if (!input && quotedText && !isFancyReply) {
            input = quotedText.trim();
        }

        if (!input) return extra.reply(
            '❌ Provide some text.\n\n' +
            'Example: *.fancy Hello World*\n' +
            'Or reply to any message with *.fancy*\n\n' +
            '_Then reply to the result with_ *.fancy <number>* _to pick one style._'
        );

        await extra.react('✨');

        const lines = buildLines(input);
        const total  = lines.length;

        const header = `✨ *Fancy Styles for:* _${input}_\n` +
                       `━━━━━━━━━━━━━━━ (${total} styles)\n\n`;
        const footer = `\n━━━━━━━━━━━━━━━\n` +
                       `_Reply to this message with_ *.fancy <number>* or <number>`;

        const fullText = header + lines.join('\n') + footer;

        const CHUNK_LIMIT = 60000;
        if (fullText.length <= CHUNK_LIMIT) {
            await extra.reply(fullText);
        } else {
            // Send header + as many lines as fit per chunk
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
