/**
 * .creategc — Premium Group Creator v4
 * Smart phone detection: auto-processes international numbers,
 * interactively asks the user only when local/ambiguous numbers are found.
 */

const { downloadContentFromMessage } = require('@whiskeysockets/baileys');

// ─── Country code table ───────────────────────────────────────────────────────
// Format: 'countryCode': [minSubscriberDigits, maxSubscriberDigits]
// Sorted longest-first so prefix matching is greedy (e.g. '234' before '23')
const COUNTRY_CODES = {
    // ── Africa ────────────────────────────────────────────
    '234': [10, 10],  // Nigeria
    '254': [9,  9 ],  // Kenya
    '233': [9,  9 ],  // Ghana
    '256': [9,  9 ],  // Uganda
    '255': [9,  9 ],  // Tanzania
    '251': [9,  9 ],  // Ethiopia
    '252': [7,  8 ],  // Somalia
    '253': [8,  8 ],  // Djibouti
    '257': [8,  8 ],  // Burundi
    '258': [9,  9 ],  // Mozambique
    '260': [9,  9 ],  // Zambia
    '261': [9,  9 ],  // Madagascar
    '262': [9,  9 ],  // Reunion
    '263': [9,  9 ],  // Zimbabwe
    '264': [9,  9 ],  // Namibia
    '265': [9,  9 ],  // Malawi
    '266': [8,  8 ],  // Lesotho
    '267': [8,  8 ],  // Botswana
    '268': [8,  8 ],  // Swaziland
    '269': [7,  7 ],  // Comoros
    '237': [9,  9 ],  // Cameroon
    '236': [8,  8 ],  // Central African Republic
    '235': [8,  8 ],  // Chad
    '241': [7,  8 ],  // Gabon
    '242': [9,  9 ],  // Congo
    '243': [9,  9 ],  // DR Congo
    '244': [9,  9 ],  // Angola
    '245': [7,  9 ],  // Guinea-Bissau
    '248': [7,  7 ],  // Seychelles
    '249': [9,  9 ],  // Sudan
    '211': [9,  9 ],  // South Sudan
    '231': [7,  8 ],  // Liberia
    '232': [8,  8 ],  // Sierra Leone
    '220': [7,  7 ],  // Gambia
    '221': [9,  9 ],  // Senegal
    '222': [8,  8 ],  // Mauritania
    '223': [8,  8 ],  // Mali
    '224': [9,  9 ],  // Guinea
    '225': [10, 10],  // Ivory Coast
    '226': [8,  8 ],  // Burkina Faso
    '227': [8,  8 ],  // Niger
    '228': [8,  8 ],  // Togo
    '229': [8,  8 ],  // Benin
    '238': [7,  7 ],  // Cape Verde
    '239': [7,  7 ],  // Sao Tome
    '240': [9,  9 ],  // Equatorial Guinea
    '291': [7,  7 ],  // Eritrea
    '212': [9,  9 ],  // Morocco
    '213': [9,  9 ],  // Algeria
    '216': [8,  8 ],  // Tunisia
    '218': [9,  9 ],  // Libya
    '250': [9,  9 ],  // Rwanda
    '27':  [9,  9 ],  // South Africa
    '20':  [10, 10],  // Egypt
    // ── Americas ──────────────────────────────────────────
    '1':   [10, 10],  // USA / Canada
    '52':  [10, 10],  // Mexico
    '53':  [8,  8 ],  // Cuba
    '54':  [10, 11],  // Argentina
    '55':  [10, 11],  // Brazil
    '56':  [9,  9 ],  // Chile
    '57':  [10, 10],  // Colombia
    '58':  [10, 10],  // Venezuela
    '51':  [9,  9 ],  // Peru
    '591': [8,  8 ],  // Bolivia
    '592': [7,  7 ],  // Guyana
    '593': [9,  9 ],  // Ecuador
    '595': [9,  9 ],  // Paraguay
    '597': [7,  7 ],  // Suriname
    '598': [8,  9 ],  // Uruguay
    '502': [8,  8 ],  // Guatemala
    '503': [8,  8 ],  // El Salvador
    '504': [8,  8 ],  // Honduras
    '505': [8,  8 ],  // Nicaragua
    '506': [8,  8 ],  // Costa Rica
    '507': [8,  8 ],  // Panama
    '509': [8,  8 ],  // Haiti
    // ── Europe ────────────────────────────────────────────
    '44':  [10, 10],  // UK
    '33':  [9,  9 ],  // France
    '34':  [9,  9 ],  // Spain
    '39':  [9,  11],  // Italy
    '41':  [9,  9 ],  // Switzerland
    '43':  [10, 13],  // Austria
    '45':  [8,  8 ],  // Denmark
    '46':  [9,  9 ],  // Sweden
    '47':  [8,  8 ],  // Norway
    '48':  [9,  9 ],  // Poland
    '49':  [10, 12],  // Germany
    '30':  [10, 10],  // Greece
    '31':  [9,  9 ],  // Netherlands
    '32':  [9,  9 ],  // Belgium
    '351': [9,  9 ],  // Portugal
    '352': [9,  11],  // Luxembourg
    '353': [9,  9 ],  // Ireland
    '354': [7,  9 ],  // Iceland
    '355': [9,  9 ],  // Albania
    '356': [8,  8 ],  // Malta
    '357': [8,  8 ],  // Cyprus
    '358': [9,  10],  // Finland
    '359': [9,  9 ],  // Bulgaria
    '36':  [9,  9 ],  // Hungary
    '370': [8,  8 ],  // Lithuania
    '371': [8,  8 ],  // Latvia
    '372': [7,  8 ],  // Estonia
    '373': [8,  8 ],  // Moldova
    '374': [8,  8 ],  // Armenia
    '375': [9,  9 ],  // Belarus
    '380': [9,  9 ],  // Ukraine
    '381': [8,  9 ],  // Serbia
    '385': [8,  9 ],  // Croatia
    '386': [8,  8 ],  // Slovenia
    '387': [8,  8 ],  // Bosnia
    '420': [9,  9 ],  // Czech Republic
    '421': [9,  9 ],  // Slovakia
    '7':   [10, 10],  // Russia / Kazakhstan
    '90':  [10, 10],  // Turkey
    // ── Asia ──────────────────────────────────────────────
    '91':  [10, 10],  // India
    '92':  [10, 10],  // Pakistan
    '93':  [9,  9 ],  // Afghanistan
    '94':  [9,  9 ],  // Sri Lanka
    '95':  [8,  10],  // Myanmar
    '960': [7,  7 ],  // Maldives
    '961': [8,  8 ],  // Lebanon
    '962': [9,  9 ],  // Jordan
    '963': [9,  9 ],  // Syria
    '964': [10, 10],  // Iraq
    '965': [8,  8 ],  // Kuwait
    '966': [9,  9 ],  // Saudi Arabia
    '967': [9,  9 ],  // Yemen
    '968': [8,  8 ],  // Oman
    '971': [9,  9 ],  // UAE
    '972': [9,  9 ],  // Israel
    '973': [8,  8 ],  // Bahrain
    '974': [8,  8 ],  // Qatar
    '977': [10, 10],  // Nepal
    '98':  [10, 10],  // Iran
    '880': [10, 10],  // Bangladesh
    '81':  [10, 11],  // Japan
    '82':  [9,  10],  // South Korea
    '84':  [9,  10],  // Vietnam
    '855': [8,  9 ],  // Cambodia
    '856': [8,  9 ],  // Laos
    '60':  [9,  10],  // Malaysia
    '62':  [9,  12],  // Indonesia
    '63':  [10, 10],  // Philippines
    '65':  [8,  8 ],  // Singapore
    '66':  [9,  9 ],  // Thailand
    '86':  [11, 11],  // China
    '852': [8,  8 ],  // Hong Kong
    '853': [8,  8 ],  // Macau
    '886': [9,  9 ],  // Taiwan
    // ── Oceania ───────────────────────────────────────────
    '61':  [9,  9 ],  // Australia
    '64':  [8,  10],  // New Zealand
    '675': [8,  8 ],  // Papua New Guinea
    '679': [7,  7 ],  // Fiji
};

const SORTED_CODES = Object.keys(COUNTRY_CODES).sort((a, b) => b.length - a.length);

const CC_LABELS = {
    '1':'🇺🇸 USA/Canada','7':'🇷🇺 Russia','20':'🇪🇬 Egypt','27':'🇿🇦 South Africa',
    '30':'🇬🇷 Greece','31':'🇳🇱 Netherlands','32':'🇧🇪 Belgium','33':'🇫🇷 France',
    '34':'🇪🇸 Spain','36':'🇭🇺 Hungary','39':'🇮🇹 Italy','41':'🇨🇭 Switzerland',
    '43':'🇦🇹 Austria','44':'🇬🇧 UK','45':'🇩🇰 Denmark','46':'🇸🇪 Sweden',
    '47':'🇳🇴 Norway','48':'🇵🇱 Poland','49':'🇩🇪 Germany','51':'🇵🇪 Peru',
    '52':'🇲🇽 Mexico','54':'🇦🇷 Argentina','55':'🇧🇷 Brazil','56':'🇨🇱 Chile',
    '57':'🇨🇴 Colombia','58':'🇻🇪 Venezuela','60':'🇲🇾 Malaysia','61':'🇦🇺 Australia',
    '62':'🇮🇩 Indonesia','63':'🇵🇭 Philippines','64':'🇳🇿 New Zealand',
    '65':'🇸🇬 Singapore','66':'🇹🇭 Thailand','81':'🇯🇵 Japan','82':'🇰🇷 South Korea',
    '84':'🇻🇳 Vietnam','86':'🇨🇳 China','90':'🇹🇷 Turkey','91':'🇮🇳 India',
    '92':'🇵🇰 Pakistan','94':'🇱🇰 Sri Lanka','98':'🇮🇷 Iran',
    '212':'🇲🇦 Morocco','213':'🇩🇿 Algeria','216':'🇹🇳 Tunisia','218':'🇱🇾 Libya',
    '220':'🇬🇲 Gambia','221':'🇸🇳 Senegal','223':'🇲🇱 Mali','224':'🇬🇳 Guinea',
    '225':'🇨🇮 Ivory Coast','226':'🇧🇫 Burkina Faso','227':'🇳🇪 Niger',
    '228':'🇹🇬 Togo','229':'🇧🇯 Benin','231':'🇱🇷 Liberia','232':'🇸🇱 Sierra Leone',
    '233':'🇬🇭 Ghana','234':'🇳🇬 Nigeria','235':'🇹🇩 Chad','237':'🇨🇲 Cameroon',
    '240':'🇬🇶 Equatorial Guinea','241':'🇬🇦 Gabon','242':'🇨🇬 Congo',
    '243':'🇨🇩 DR Congo','244':'🇦🇴 Angola','249':'🇸🇩 Sudan','250':'🇷🇼 Rwanda',
    '251':'🇪🇹 Ethiopia','252':'🇸🇴 Somalia','254':'🇰🇪 Kenya','255':'🇹🇿 Tanzania',
    '256':'🇺🇬 Uganda','257':'🇧🇮 Burundi','258':'🇲🇿 Mozambique','260':'🇿🇲 Zambia',
    '263':'🇿🇼 Zimbabwe','264':'🇳🇦 Namibia','265':'🇲🇼 Malawi',
    '351':'🇵🇹 Portugal','353':'🇮🇪 Ireland','358':'🇫🇮 Finland','380':'🇺🇦 Ukraine',
    '420':'🇨🇿 Czech Republic','421':'🇸🇰 Slovakia',
    '502':'🇬🇹 Guatemala','503':'🇸🇻 El Salvador','504':'🇭🇳 Honduras',
    '505':'🇳🇮 Nicaragua','506':'🇨🇷 Costa Rica','507':'🇵🇦 Panama','509':'🇭🇹 Haiti',
    '591':'🇧🇴 Bolivia','593':'🇪🇨 Ecuador','595':'🇵🇾 Paraguay','598':'🇺🇾 Uruguay',
    '852':'🇭🇰 Hong Kong','855':'🇰🇭 Cambodia','880':'🇧🇩 Bangladesh',
    '886':'🇹🇼 Taiwan','961':'🇱🇧 Lebanon','962':'🇯🇴 Jordan','964':'🇮🇶 Iraq',
    '965':'🇰🇼 Kuwait','966':'🇸🇦 Saudi Arabia','968':'🇴🇲 Oman',
    '971':'🇦🇪 UAE','972':'🇮🇱 Israel','973':'🇧🇭 Bahrain','974':'🇶🇦 Qatar',
};

function ccLabel(cc) {
    return CC_LABELS[cc] ? `+${cc} (${CC_LABELS[cc]})` : `+${cc}`;
}

// ─── Number classifier ────────────────────────────────────────────────────────

function classifyRaw(digits) {
    if (!digits) return null;

    for (const cc of SORTED_CODES) {
        if (!digits.startsWith(cc)) continue;

        const subscriber = digits.slice(cc.length);
        const [min, max] = COUNTRY_CODES[cc];

        if (subscriber.length >= min && subscriber.length <= max) {
            return { type: 'international', cc, number: digits };
        } else {
            return { type: 'invalid_international', cc, number: digits };
        }
    }

    if (digits.startsWith('0') && digits.length >= 7 && digits.length <= 13) {
        return { type: 'local', raw: digits };
    }

    if (digits.length >= 5 && digits.length <= 12) {
        return { type: 'local', raw: digits };
    }

    return null;
}

function classifyNumber(phoneNumber) {
    if (!phoneNumber) return null;
    let raw = String(phoneNumber).replace(/[^\d+]/g, '');
    if (!raw) return null;

    if (raw.startsWith('+'))    raw = raw.slice(1);
    else if (raw.startsWith('00'))   raw = raw.slice(2);
    else if (raw.startsWith('011'))  raw = raw.slice(3);

    if (!raw || raw.length < 5) return null;
    return classifyRaw(raw);
}

function applyCountryCode(localRaw, cc) {
    let digits = localRaw.replace(/[^\d]/g, '');
    if (digits.startsWith('0')) digits = digits.slice(1);
    return cc + digits;
}

// ─── VCF parser ───────────────────────────────────────────────────────────────

function parseVCF(vcfContent) {
    const international        = [];
    const local                = [];
    const invalidInternational = [];

    for (const line of vcfContent.split('\n')) {
        if (!line.startsWith('TEL') && !line.includes('TEL:')) continue;
        const colonIdx = line.lastIndexOf(':');
        if (colonIdx === -1) continue;
        const rawValue = line.slice(colonIdx + 1).trim();
        const match    = rawValue.match(/[\+\d][\d\s\-\(\)\.]{4,}/);
        if (!match) continue;

        const classified = classifyNumber(match[0]);
        if (!classified) continue;

        if (classified.type === 'international') {
            if (!international.includes(classified.number))
                international.push(classified.number);
        } else if (classified.type === 'invalid_international') {
            if (!invalidInternational.includes(classified.number))
                invalidInternational.push(classified.number);
        } else {
            if (!local.includes(classified.raw))
                local.push(classified.raw);
        }
    }
    return { international, local, invalidInternational };
}

// ─── Interactive reply waiter ─────────────────────────────────────────────────

/**
 * Wait for the next text message from `senderJid` in `chatJid`.
 * FIX: compares the participant/remoteJid directly against senderJid
 * (normalising the :device suffix) instead of comparing bare numbers,
 * which could false-match different participants sharing a number prefix.
 */
function waitForReply(sock, chatJid, senderJid, ms = 60000) {
    const normalize = (jid) => (jid || '').split(':')[0];
    const wantJid    = normalize(senderJid);

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            sock.ev.off('messages.upsert', handler);
            reject(new Error('TIMEOUT'));
        }, ms);

        function handler({ messages, type }) {
            if (type !== 'notify') return;
            for (const m of messages) {
                if (m.key.remoteJid !== chatJid) continue;

                const fromJid = normalize(m.key.participant || m.key.remoteJid);
                if (fromJid !== wantJid) continue;

                const text = (
                    m.message?.conversation ||
                    m.message?.extendedTextMessage?.text ||
                    ''
                ).trim();

                if (!text) continue;

                clearTimeout(timer);
                sock.ev.off('messages.upsert', handler);
                resolve(text);
                return;
            }
        }

        sock.ev.on('messages.upsert', handler);
    });
}

// ─── Misc helpers ─────────────────────────────────────────────────────────────

function progressBar(done, total, size = 10) {
    const filled = Math.round((done / total) * size);
    return '▰'.repeat(filled) + '▱'.repeat(size - filled);
}

function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ─── Flag parser (no --country needed anymore) ────────────────────────────────
function parseFlags(args) {
    const raw    = args.join(' ');
    const result = {
        name:         '',
        numbers:      '',
        desc:         null,
        msg:          null,
        lock:         false,
        admin:        false,
        adminNumbers: [],
        random:       null,
    };

    const descMatch = raw.match(/--desc\s+([\s\S]+?)(?=--|$)/);
    if (descMatch) result.desc = descMatch[1].trim();

    const msgMatch = raw.match(/--msg\s+([\s\S]+?)(?=--|$)/);
    if (msgMatch) result.msg = msgMatch[1].trim();

    result.lock = /--lock/.test(raw);

    const adminMatch = raw.match(/--admin(?:\s+([\d,\s+]+?))?(?=--|$)/);
    if (adminMatch) {
        result.admin = true;
        if (adminMatch[1]) {
            result.adminNumbers = adminMatch[1]
                .split(',')
                .map(n => {
                    const c = classifyNumber(n.trim());
                    return c?.type === 'international' ? c.number : null;
                })
                .filter(Boolean);
        }
    }

    const randomMatch = raw.match(/--random\s+(\d+)/);
    if (randomMatch) result.random = parseInt(randomMatch[1]);

    const stripped = raw
        .replace(/--desc\s+[\s\S]+?(?=--|$)/, '')
        .replace(/--msg\s+[\s\S]+?(?=--|$)/, '')
        .replace(/--admin(?:\s+[\d,\s+]+?)?(?=--|$)/, '')
        .replace(/--random\s+\d+/, '')
        .replace(/--lock/, '')
        .trim();

    const parts    = stripped.split(/\s+/);
    result.name    = parts[0] || '';
    result.numbers = parts.slice(1).join(' ');

    return result;
}

// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
    name:        'creategc',
    aliases:     ['creategroup', 'newgroup'],
    category:    'owner',
    description: 'Premium group creator — smart phone detection, interactive local-number resolution',
    usage:       '.creategc <name> [numbers] [--desc text] [--msg text] [--lock] [--admin] [--random N]',

    async execute(sock, msg, args, extra) {
        const { reply, react, from, sender } = extra;

        if (!args.length) {
            return reply(
                `📱 *creategc v4 — Premium Group Creator*\n\n` +
                `*Basic:*\n` +
                `• \`.creategc Isaac\` — empty group\n` +
                `• \`.creategc Isaac +2348012345678,+254712345678\` — with members\n` +
                `• Reply to VCF: \`.creategc Isaac\`\n\n` +
                `*Flags:*\n` +
                `• \`--desc <text>\` — set group description\n` +
                `• \`--msg <text>\` — send welcome message\n` +
                `• \`--lock\` — only admins can send\n` +
                `• \`--admin\` — promote all added members\n` +
                `• \`--random N\` — pick N random members from VCF\n\n` +
                `*Smart phone handling:*\n` +
                `Numbers with a country code (+234, 254, +44...) are processed automatically.\n` +
                `Local numbers (07xxx, 08xxx) trigger an interactive prompt — no flag needed!`
            );
        }

        const flags = parseFlags(args);
        if (!flags.name) return reply('❌ Group name is required.\nUsage: `.creategc <name>`');

        try {
            await react('⏳');

            const quoted =
                msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ||
                msg.message?.imageMessage?.contextInfo?.quotedMessage ||
                msg.message?.videoMessage?.contextInfo?.quotedMessage;

            // ── Collect & classify all numbers ────────────────────────────
            let internationalNums        = [];
            let localNums                = [];
            let invalidInternationalNums = [];

            // From VCF
            if (quoted?.documentMessage) {
                const doc      = quoted.documentMessage;
                const fileName = doc.fileName || '';
                if (fileName.endsWith('.vcf') || doc.mimetype === 'text/vcard') {
                    try {
                        const stream = await downloadContentFromMessage(doc, 'document');
                        let buffer   = Buffer.from([]);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                        const parsed = parseVCF(buffer.toString('utf-8'));
                        internationalNums.push(...parsed.international);
                        localNums.push(...parsed.local);
                        invalidInternationalNums.push(...parsed.invalidInternational);
                    } catch (_) {
                        await reply('⚠️ Could not read VCF — continuing with manual numbers only.');
                    }
                }
            }

            // From manual args
            if (flags.numbers) {
                for (const part of flags.numbers.split(',')) {
                    const c = classifyNumber(part.trim());
                    if (!c) continue;
                    if (c.type === 'international') {
                        if (!internationalNums.includes(c.number))
                            internationalNums.push(c.number);
                    } else if (c.type === 'invalid_international') {
                        if (!invalidInternationalNums.includes(c.number))
                            invalidInternationalNums.push(c.number);
                    } else {
                        if (!localNums.includes(c.raw))
                            localNums.push(c.raw);
                    }
                }
            }

            // Deduplicate
            internationalNums        = [...new Set(internationalNums)];
            invalidInternationalNums = [...new Set(invalidInternationalNums)];
            const totalFound         = internationalNums.length + localNums.length + invalidInternationalNums.length;

            if (totalFound === 0) {
                return reply('❌ No numbers found. Provide numbers directly or reply to a VCF.');
            }

            // ── Scan summary — always shown when numbers exist ─────────────
            const hasAmbiguity = localNums.length > 0 || invalidInternationalNums.length > 0;
            let resolvedLocals = [];

            if (hasAmbiguity) {
                let invalidSection = '';
                if (invalidInternationalNums.length > 0) {
                    const sample  = invalidInternationalNums.slice(0, 5)
                        .map(n => {
                            let matchedCC = '?';
                            for (const cc of SORTED_CODES) {
                                if (n.startsWith(cc)) { matchedCC = cc; break; }
                            }
                            const sub = n.slice(matchedCC.length);
                            const [min, max] = COUNTRY_CODES[matchedCC] || ['?', '?'];
                            return `  • +${n}  _(+${matchedCC} expects ${min}${min !== max ? `–${max}` : ''} digits, got ${sub.length})_`;
                        })
                        .join('\n');
                    const more = invalidInternationalNums.length > 5
                        ? `\n  _...and ${invalidInternationalNums.length - 5} more_` : '';
                    invalidSection = `\n\n*❌ Invalid international (skipped):*\n${sample}${more}`;
                }

                let localSection = '';
                if (localNums.length > 0) {
                    const sample = localNums.slice(0, 5).map(n => `  • ${n}`).join('\n');
                    const more   = localNums.length > 5
                        ? `\n  _...and ${localNums.length - 5} more_` : '';
                    localSection = `\n\n*Sample local numbers:*\n${sample}${more}`;
                }

                await reply(
                    `📇 *Found ${totalFound} contact${totalFound !== 1 ? 's' : ''}*\n\n` +
                    `✅ *International:*          ${internationalNums.length}\n` +
                    `⚠️ *Local/Uncategorised:*    ${localNums.length}\n` +
                    `❌ *Invalid International:*  ${invalidInternationalNums.length}` +
                    invalidSection +
                    (localNums.length > 0
                        ? localSection +
                          `\n\n❓ *What should I do with the local numbers?*\n\n` +
                          `1️⃣ Skip them\n` +
                          `2️⃣ Treat as 🇳🇬 Nigeria (+234)\n` +
                          `3️⃣ Treat as 🇰🇪 Kenya (+254)\n` +
                          `4️⃣ 🌍 Other country (I'll ask for the code)\n` +
                          `5️⃣ ❌ Cancel\n\n` +
                          `_Reply with a number within 60 seconds._`
                        : `\n\n_Invalid international numbers are automatically skipped. Proceeding..._`)
                );

                if (localNums.length > 0) {
                    let choice;
                    try {
                        choice = await waitForReply(sock, from, sender, 60000);
                    } catch (_) {
                        await react('⌛');
                        return reply('⌛ Timed out waiting for your choice. Operation cancelled.');
                    }

                    // FIX: use startsWith so replies like "2 nigeria" still match
                    const choiceTrimmed = choice.trim();

                    if (choiceTrimmed.startsWith('5')) {
                        await react('❌');
                        return reply('❌ Group creation cancelled.');
                    }

                    if (choiceTrimmed.startsWith('1')) {
                        await reply(`⏭️ Skipping ${localNums.length} local number${localNums.length !== 1 ? 's' : ''}.`);

                    } else if (choiceTrimmed.startsWith('2') || choiceTrimmed.startsWith('3')) {
                        const cc = choiceTrimmed.startsWith('2') ? '234' : '254';
                        resolvedLocals = localNums.map(n => applyCountryCode(n, cc));
                        await reply(`🌍 Converting ${localNums.length} local numbers to ${ccLabel(cc)}.`);

                    } else if (choiceTrimmed.startsWith('4')) {
                        await reply(
                            `🌍 *Enter the country calling code* (digits only, no +)\n\n` +
                            `Examples: \`44\` for UK, \`91\` for India, \`1\` for USA\n\n` +
                            `_Reply within 60 seconds._`
                        );

                        let customCode;
                        try {
                            customCode = await waitForReply(sock, from, sender, 60000);
                        } catch (_) {
                            await react('⌛');
                            return reply('⌛ Timed out. Operation cancelled.');
                        }

                        customCode = customCode.replace(/\D/g, '');
                        if (!customCode || customCode.length < 1 || customCode.length > 4) {
                            await react('❌');
                            return reply('❌ Invalid country code. Operation cancelled.');
                        }

                        resolvedLocals = localNums.map(n => applyCountryCode(n, customCode));
                        await reply(`🌍 Converting ${localNums.length} local numbers to ${ccLabel(customCode)}.`);

                    } else {
                        await reply(`⚠️ Unrecognised choice. Skipping ${localNums.length} local number${localNums.length !== 1 ? 's' : ''} and continuing.`);
                    }
                }
            }

            // ── Merge and deduplicate all participants ─────────────────────
            let participants = [...new Set([...internationalNums, ...resolvedLocals])];

            // ── Random selection ───────────────────────────────────────────
            if (flags.random && flags.random < participants.length) {
                participants = shuffle(participants).slice(0, flags.random);
                await reply(`🎲 Randomly selected *${participants.length}* contacts.`);
            }

            // ── Country breakdown (display) ────────────────────────────────
            if (participants.length > 0) {
                const ccMap = new Map();
                for (const num of participants) {
                    let matched = 'Unknown';
                    for (const cc of SORTED_CODES) {
                        if (num.startsWith(cc)) { matched = cc; break; }
                    }
                    ccMap.set(matched, (ccMap.get(matched) || 0) + 1);
                }

                if (ccMap.size > 1) {
                    const breakdown = [...ccMap.entries()]
                        .sort((a, b) => b[1] - a[1])
                        .map(([cc, n]) => `  ${ccLabel(cc)}: ${n}`)
                        .join('\n');
                    await reply(`🌍 *Number breakdown by country:*\n${breakdown}`);
                }
            }

            // ── FIX: warn if proceeding with zero participants ─────────────
            if (participants.length === 0) {
                await reply('⚠️ No participants to add — creating an empty group with just the bot.');
            }

            // ── WhatsApp validation with progress ──────────────────────────
            const validParticipants = [];
            const invalidNumbers    = [];

            if (participants.length > 0) {
                await reply(`🔍 Validating *${participants.length}* number${participants.length !== 1 ? 's' : ''} on WhatsApp...`);

                const CHUNK   = 20;
                const total   = participants.length;
                let   done    = 0;
                let   lastPct = 0;

                for (let i = 0; i < total; i += CHUNK) {
                    const chunk = participants.slice(i, i + CHUNK);

                    await Promise.all(chunk.map(async (num) => {
                        try {
                            const [res] = await sock.onWhatsApp(num);
                            if (res?.exists) validParticipants.push(num + '@s.whatsapp.net');
                            else             invalidNumbers.push(num);
                        } catch (_) { invalidNumbers.push(num); }
                    }));

                    done      += chunk.length;
                    const pct  = Math.round((done / total) * 100);

                    if (pct - lastPct >= 25 || done === total) {
                        await reply(`⏳ ${progressBar(done, total)} ${pct}%`);
                        lastPct = pct;
                    }

                    // FIX: small delay between chunks to avoid tripping WA anti-spam
                    if (i + CHUNK < total) await sleep(400);
                }

                const failedList = invalidNumbers.slice(0, 10).map(n => `• +${n}`).join('\n');
                const moreLine   = invalidNumbers.length > 10
                    ? `\n_...and ${invalidNumbers.length - 10} more_` : '';

                await reply(
                    `📊 *Validation Report*\n` +
                    `━━━━━━━━━━━━━━━━━\n` +
                    `✅ Valid WhatsApp:  *${validParticipants.length}*\n` +
                    `❌ Invalid/No WA:   *${invalidNumbers.length}*\n` +
                    (invalidNumbers.length > 0
                        ? `\n*Failed:*\n${failedList}${moreLine}`
                        : '')
                );
            }

            // ── Create group ───────────────────────────────────────────────
            const groupData = await sock.groupCreate(flags.name, validParticipants);
            if (!groupData?.id) throw new Error('Group creation returned invalid data');
            const gid = groupData.id;

            // ── Set description ────────────────────────────────────────────
            if (flags.desc) {
                try { await sock.groupUpdateDescription(gid, flags.desc); } catch (_) {}
            }

            // ── Set group photo ────────────────────────────────────────────
            let photoSet    = false;
            let photoBuffer = null;

            // FIX: cap photo buffer size (5MB) to avoid memory spikes on free-tier hosting
            const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

            if (msg.message?.imageMessage) {
                try {
                    const stream = await downloadContentFromMessage(msg.message.imageMessage, 'image');
                    let buf = Buffer.from([]);
                    for await (const chunk of stream) {
                        buf = Buffer.concat([buf, chunk]);
                        if (buf.length > MAX_PHOTO_BYTES) { buf = null; break; }
                    }
                    photoBuffer = buf;
                } catch (_) {}
            }
            if (!photoBuffer && quoted?.imageMessage) {
                try {
                    const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
                    let buf = Buffer.from([]);
                    for await (const chunk of stream) {
                        buf = Buffer.concat([buf, chunk]);
                        if (buf.length > MAX_PHOTO_BYTES) { buf = null; break; }
                    }
                    photoBuffer = buf;
                } catch (_) {}
            }
            if (photoBuffer) {
                try { await sock.updateProfilePicture(gid, photoBuffer); photoSet = true; } catch (_) {}
            }

            // ── Lock group ─────────────────────────────────────────────────
            if (flags.lock) {
                try { await sock.groupSettingUpdate(gid, 'announcement'); } catch (_) {}
            }

            // ── Promote admins ─────────────────────────────────────────────
            let promotedCount   = 0;
            let skippedAdminReq = 0;
            if (flags.admin && validParticipants.length > 0) {
                let toPromote;
                if (flags.adminNumbers.length > 0) {
                    toPromote = flags.adminNumbers
                        .map(n => n + '@s.whatsapp.net')
                        .filter(j => validParticipants.includes(j));
                    // FIX: track how many requested admins weren't actually in the group
                    skippedAdminReq = flags.adminNumbers.length - toPromote.length;
                } else {
                    toPromote = validParticipants;
                }
                try {
                    await sock.groupParticipantsUpdate(gid, toPromote, 'promote');
                    promotedCount = toPromote.length;
                } catch (_) {}
            }

            // ── Invite link ────────────────────────────────────────────────
            let groupLink = 'Unable to generate';
            try {
                const code = await sock.groupInviteCode(gid);
                groupLink  = `https://chat.whatsapp.com/${code}`;
            } catch (_) {}

            // ── Welcome message ────────────────────────────────────────────
            const welcomeText = flags.msg || `🎉 Welcome to *"${flags.name}"*!\n🔗 ${groupLink}`;
            await sock.sendMessage(gid, { text: welcomeText });

            // ── Final summary ──────────────────────────────────────────────
            await react('✅');
            return reply(
                `🎉 *Group Created Successfully!*\n` +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `📱 *Name:*     ${flags.name}\n` +
                `👥 *Members:* ${validParticipants.length + 1} (including bot)\n` +
                (promotedCount   ? `👑 *Admins:*   ${promotedCount} promoted\n`                       : '') +
                (skippedAdminReq ? `⚠️ *Admin req skipped:* ${skippedAdminReq} (not in group)\n`      : '') +
                (photoSet        ? `🖼️  *Photo:*    ✅ Set\n`                                          : '') +
                (flags.desc      ? `📝 *Desc:*     ✅ Set\n`                                           : '') +
                (flags.lock      ? `🔒 *Locked:*   ✅ Admins only\n`                                   : '') +
                `━━━━━━━━━━━━━━━━━━━━\n` +
                `🔗 *Link:*\n${groupLink}`
            );

        } catch (err) {
            await react('❌');
            let errorMsg = '❌ Failed to create group!';
            if (err.message?.includes('not-authorized'))
                errorMsg += '\n\n⚠️ Bot lacks permission to create groups.';
            else if (err.message?.includes('rate-limit'))
                errorMsg += '\n\n⏰ Rate limited. Please wait and try again.';
            else
                errorMsg += `\n\n🔍 Error: ${err.message}`;
            return reply(errorMsg);
        }
    }
};
