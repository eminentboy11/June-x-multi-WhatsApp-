/**
 * WaMe Command — extract a number from a quoted message and build a wa.me link
 * Shows full country name, flag, dial code and local number.
 *
 * Sources checked in order:
 *   1. Quoted message sender JID (participant)
 *   2. Phone number found in the quoted message text
 *   3. Args fallback: .wame 254712345678
 */

// Country-code map — longest prefix matched first (3 → 2 → 1 digit)
const COUNTRY_CODES = {
    // ── 3-digit codes ─────────────────────────────────────────────────────────
    '355': { name: 'Albania',                 flag: '🇦🇱' },
    '213': { name: 'Algeria',                 flag: '🇩🇿' },
    '376': { name: 'Andorra',                 flag: '🇦🇩' },
    '244': { name: 'Angola',                  flag: '🇦🇴' },
    '672': { name: 'Antarctica',              flag: '🇦🇶' },
    '374': { name: 'Armenia',                 flag: '🇦🇲' },
    '297': { name: 'Aruba',                   flag: '🇦🇼' },
    '994': { name: 'Azerbaijan',              flag: '🇦🇿' },
    '973': { name: 'Bahrain',                 flag: '🇧🇭' },
    '880': { name: 'Bangladesh',              flag: '🇧🇩' },
    '375': { name: 'Belarus',                 flag: '🇧🇾' },
    '501': { name: 'Belize',                  flag: '🇧🇿' },
    '229': { name: 'Benin',                   flag: '🇧🇯' },
    '975': { name: 'Bhutan',                  flag: '🇧🇹' },
    '591': { name: 'Bolivia',                 flag: '🇧🇴' },
    '387': { name: 'Bosnia & Herzegovina',    flag: '🇧🇦' },
    '267': { name: 'Botswana',                flag: '🇧🇼' },
    '673': { name: 'Brunei',                  flag: '🇧🇳' },
    '359': { name: 'Bulgaria',                flag: '🇧🇬' },
    '226': { name: 'Burkina Faso',            flag: '🇧🇫' },
    '257': { name: 'Burundi',                 flag: '🇧🇮' },
    '855': { name: 'Cambodia',                flag: '🇰🇭' },
    '237': { name: 'Cameroon',                flag: '🇨🇲' },
    '238': { name: 'Cape Verde',              flag: '🇨🇻' },
    '236': { name: 'Central African Republic',flag: '🇨🇫' },
    '235': { name: 'Chad',                    flag: '🇹🇩' },
    '269': { name: 'Comoros',                 flag: '🇰🇲' },
    '242': { name: 'Congo (Brazzaville)',      flag: '🇨🇬' },
    '243': { name: 'Congo (Kinshasa)',         flag: '🇨🇩' },
    '682': { name: 'Cook Islands',            flag: '🇨🇰' },
    '506': { name: 'Costa Rica',              flag: '🇨🇷' },
    '385': { name: 'Croatia',                 flag: '🇭🇷' },
    '357': { name: 'Cyprus',                  flag: '🇨🇾' },
    '420': { name: 'Czech Republic',          flag: '🇨🇿' },
    '253': { name: 'Djibouti',                flag: '🇩🇯' },
    '593': { name: 'Ecuador',                 flag: '🇪🇨' },
    '503': { name: 'El Salvador',             flag: '🇸🇻' },
    '240': { name: 'Equatorial Guinea',       flag: '🇬🇶' },
    '291': { name: 'Eritrea',                 flag: '🇪🇷' },
    '372': { name: 'Estonia',                 flag: '🇪🇪' },
    '268': { name: 'Eswatini',                flag: '🇸🇿' },
    '251': { name: 'Ethiopia',                flag: '🇪🇹' },
    '679': { name: 'Fiji',                    flag: '🇫🇯' },
    '358': { name: 'Finland',                 flag: '🇫🇮' },
    '594': { name: 'French Guiana',           flag: '🇬🇫' },
    '689': { name: 'French Polynesia',        flag: '🇵🇫' },
    '241': { name: 'Gabon',                   flag: '🇬🇦' },
    '220': { name: 'Gambia',                  flag: '🇬🇲' },
    '995': { name: 'Georgia',                 flag: '🇬🇪' },
    '233': { name: 'Ghana',                   flag: '🇬🇭' },
    '350': { name: 'Gibraltar',               flag: '🇬🇮' },
    '502': { name: 'Guatemala',               flag: '🇬🇹' },
    '224': { name: 'Guinea',                  flag: '🇬🇳' },
    '245': { name: 'Guinea-Bissau',           flag: '🇬🇼' },
    '592': { name: 'Guyana',                  flag: '🇬🇾' },
    '509': { name: 'Haiti',                   flag: '🇭🇹' },
    '504': { name: 'Honduras',                flag: '🇭🇳' },
    '354': { name: 'Iceland',                 flag: '🇮🇸' },
    '353': { name: 'Ireland',                 flag: '🇮🇪' },
    '972': { name: 'Israel',                  flag: '🇮🇱' },
    '962': { name: 'Jordan',                  flag: '🇯🇴' },
    '254': { name: 'Kenya',                   flag: '🇰🇪' },
    '686': { name: 'Kiribati',                flag: '🇰🇮' },
    '383': { name: 'Kosovo',                  flag: '🇽🇰' },
    '965': { name: 'Kuwait',                  flag: '🇰🇼' },
    '996': { name: 'Kyrgyzstan',              flag: '🇰🇬' },
    '856': { name: 'Laos',                    flag: '🇱🇦' },
    '371': { name: 'Latvia',                  flag: '🇱🇻' },
    '961': { name: 'Lebanon',                 flag: '🇱🇧' },
    '266': { name: 'Lesotho',                 flag: '🇱🇸' },
    '231': { name: 'Liberia',                 flag: '🇱🇷' },
    '218': { name: 'Libya',                   flag: '🇱🇾' },
    '423': { name: 'Liechtenstein',           flag: '🇱🇮' },
    '370': { name: 'Lithuania',               flag: '🇱🇹' },
    '352': { name: 'Luxembourg',              flag: '🇱🇺' },
    '261': { name: 'Madagascar',              flag: '🇲🇬' },
    '265': { name: 'Malawi',                  flag: '🇲🇼' },
    '960': { name: 'Maldives',                flag: '🇲🇻' },
    '223': { name: 'Mali',                    flag: '🇲🇱' },
    '356': { name: 'Malta',                   flag: '🇲🇹' },
    '692': { name: 'Marshall Islands',        flag: '🇲🇭' },
    '222': { name: 'Mauritania',              flag: '🇲🇷' },
    '230': { name: 'Mauritius',               flag: '🇲🇺' },
    '262': { name: 'Mayotte / Réunion',       flag: '🇾🇹' },
    '373': { name: 'Moldova',                 flag: '🇲🇩' },
    '377': { name: 'Monaco',                  flag: '🇲🇨' },
    '976': { name: 'Mongolia',                flag: '🇲🇳' },
    '382': { name: 'Montenegro',              flag: '🇲🇪' },
    '212': { name: 'Morocco',                 flag: '🇲🇦' },
    '258': { name: 'Mozambique',              flag: '🇲🇿' },
    '264': { name: 'Namibia',                 flag: '🇳🇦' },
    '674': { name: 'Nauru',                   flag: '🇳🇷' },
    '977': { name: 'Nepal',                   flag: '🇳🇵' },
    '687': { name: 'New Caledonia',           flag: '🇳🇨' },
    '505': { name: 'Nicaragua',               flag: '🇳🇮' },
    '227': { name: 'Niger',                   flag: '🇳🇪' },
    '234': { name: 'Nigeria',                 flag: '🇳🇬' },
    '683': { name: 'Niue',                    flag: '🇳🇺' },
    '968': { name: 'Oman',                    flag: '🇴🇲' },
    '680': { name: 'Palau',                   flag: '🇵🇼' },
    '970': { name: 'Palestine',               flag: '🇵🇸' },
    '507': { name: 'Panama',                  flag: '🇵🇦' },
    '675': { name: 'Papua New Guinea',        flag: '🇵🇬' },
    '595': { name: 'Paraguay',                flag: '🇵🇾' },
    '974': { name: 'Qatar',                   flag: '🇶🇦' },
    '389': { name: 'North Macedonia',         flag: '🇲🇰' },
    '250': { name: 'Rwanda',                  flag: '🇷🇼' },
    '685': { name: 'Samoa',                   flag: '🇼🇸' },
    '378': { name: 'San Marino',              flag: '🇸🇲' },
    '239': { name: 'São Tomé & Príncipe',     flag: '🇸🇹' },
    '966': { name: 'Saudi Arabia',            flag: '🇸🇦' },
    '221': { name: 'Senegal',                 flag: '🇸🇳' },
    '381': { name: 'Serbia',                  flag: '🇷🇸' },
    '248': { name: 'Seychelles',              flag: '🇸🇨' },
    '232': { name: 'Sierra Leone',            flag: '🇸🇱' },
    '421': { name: 'Slovakia',                flag: '🇸🇰' },
    '386': { name: 'Slovenia',                flag: '🇸🇮' },
    '677': { name: 'Solomon Islands',         flag: '🇸🇧' },
    '252': { name: 'Somalia',                 flag: '🇸🇴' },
    '211': { name: 'South Sudan',             flag: '🇸🇸' },
    '249': { name: 'Sudan',                   flag: '🇸🇩' },
    '597': { name: 'Suriname',                flag: '🇸🇷' },
    '268': { name: 'Swaziland',               flag: '🇸🇿' },
    '963': { name: 'Syria',                   flag: '🇸🇾' },
    '992': { name: 'Tajikistan',              flag: '🇹🇯' },
    '255': { name: 'Tanzania',                flag: '🇹🇿' },
    '670': { name: 'Timor-Leste',             flag: '🇹🇱' },
    '228': { name: 'Togo',                    flag: '🇹🇬' },
    '676': { name: 'Tonga',                   flag: '🇹🇴' },
    '216': { name: 'Tunisia',                 flag: '🇹🇳' },
    '993': { name: 'Turkmenistan',            flag: '🇹🇲' },
    '688': { name: 'Tuvalu',                  flag: '🇹🇻' },
    '256': { name: 'Uganda',                  flag: '🇺🇬' },
    '380': { name: 'Ukraine',                 flag: '🇺🇦' },
    '971': { name: 'United Arab Emirates',    flag: '🇦🇪' },
    '598': { name: 'Uruguay',                 flag: '🇺🇾' },
    '998': { name: 'Uzbekistan',              flag: '🇺🇿' },
    '678': { name: 'Vanuatu',                 flag: '🇻🇺' },
    '379': { name: 'Vatican City',            flag: '🇻🇦' },
    '967': { name: 'Yemen',                   flag: '🇾🇪' },
    '260': { name: 'Zambia',                  flag: '🇿🇲' },
    '263': { name: 'Zimbabwe',                flag: '🇿🇼' },

    // ── 2-digit codes ─────────────────────────────────────────────────────────
    '20': { name: 'Egypt',           flag: '🇪🇬' },
    '27': { name: 'South Africa',    flag: '🇿🇦' },
    '30': { name: 'Greece',          flag: '🇬🇷' },
    '31': { name: 'Netherlands',     flag: '🇳🇱' },
    '32': { name: 'Belgium',         flag: '🇧🇪' },
    '33': { name: 'France',          flag: '🇫🇷' },
    '34': { name: 'Spain',           flag: '🇪🇸' },
    '36': { name: 'Hungary',         flag: '🇭🇺' },
    '39': { name: 'Italy',           flag: '🇮🇹' },
    '40': { name: 'Romania',         flag: '🇷🇴' },
    '41': { name: 'Switzerland',     flag: '🇨🇭' },
    '43': { name: 'Austria',         flag: '🇦🇹' },
    '44': { name: 'United Kingdom',  flag: '🇬🇧' },
    '45': { name: 'Denmark',         flag: '🇩🇰' },
    '46': { name: 'Sweden',          flag: '🇸🇪' },
    '47': { name: 'Norway',          flag: '🇳🇴' },
    '48': { name: 'Poland',          flag: '🇵🇱' },
    '49': { name: 'Germany',         flag: '🇩🇪' },
    '51': { name: 'Peru',            flag: '🇵🇪' },
    '52': { name: 'Mexico',          flag: '🇲🇽' },
    '53': { name: 'Cuba',            flag: '🇨🇺' },
    '54': { name: 'Argentina',       flag: '🇦🇷' },
    '55': { name: 'Brazil',          flag: '🇧🇷' },
    '56': { name: 'Chile',           flag: '🇨🇱' },
    '57': { name: 'Colombia',        flag: '🇨🇴' },
    '58': { name: 'Venezuela',       flag: '🇻🇪' },
    '60': { name: 'Malaysia',        flag: '🇲🇾' },
    '61': { name: 'Australia',       flag: '🇦🇺' },
    '62': { name: 'Indonesia',       flag: '🇮🇩' },
    '63': { name: 'Philippines',     flag: '🇵🇭' },
    '64': { name: 'New Zealand',     flag: '🇳🇿' },
    '65': { name: 'Singapore',       flag: '🇸🇬' },
    '66': { name: 'Thailand',        flag: '🇹🇭' },
    '81': { name: 'Japan',           flag: '🇯🇵' },
    '82': { name: 'South Korea',     flag: '🇰🇷' },
    '84': { name: 'Vietnam',         flag: '🇻🇳' },
    '86': { name: 'China',           flag: '🇨🇳' },
    '90': { name: 'Turkey',          flag: '🇹🇷' },
    '91': { name: 'India',           flag: '🇮🇳' },
    '92': { name: 'Pakistan',        flag: '🇵🇰' },
    '93': { name: 'Afghanistan',     flag: '🇦🇫' },
    '94': { name: 'Sri Lanka',       flag: '🇱🇰' },
    '95': { name: 'Myanmar',         flag: '🇲🇲' },
    '98': { name: 'Iran',            flag: '🇮🇷' },

    // ── 1-digit codes ─────────────────────────────────────────────────────────
    '1': { name: 'USA / Canada',     flag: '🇺🇸' },
    '7': { name: 'Russia / Kazakhstan', flag: '🇷🇺' },
};

/**
 * Detect country from a full E.164 number (no +).
 * Tries 3-digit prefix first, then 2-digit, then 1-digit.
 * Returns { dialCode, local, country } or null.
 */
function detectCountry(num) {
    for (const len of [3, 2, 1]) {
        const prefix = num.substring(0, len);
        if (COUNTRY_CODES[prefix]) {
            return {
                dialCode: prefix,
                local:    num.substring(len),
                country:  COUNTRY_CODES[prefix],
            };
        }
    }
    return null;
}

module.exports = {
    name: 'wame',
    aliases: ['walink', 'whatslink', 'openwa'],
    category: 'utility',
    description: 'Generate a wa.me link from a quoted message or a number',
    usage: '.wame  (reply to a message)  OR  .wame <number>',

    async execute(sock, msg, args, extra) {
        try {
            let rawNumber = null;
            let source    = null;

            const ctx    = msg.message?.extendedTextMessage?.contextInfo;
            const quoted = ctx?.quotedMessage;

            // ── 1. Quoted message sender JID ──────────────────────────────────
            if (quoted && ctx?.participant) {
                rawNumber = ctx.participant.split('@')[0].replace(/[^0-9]/g, '');
                source    = 'quoted sender';
            }

            // ── 2. Phone number inside quoted message text ────────────────────
            if (!rawNumber && quoted) {
                const quotedText =
                    quoted.conversation ||
                    quoted.extendedTextMessage?.text ||
                    quoted.imageMessage?.caption ||
                    quoted.videoMessage?.caption ||
                    quoted.documentMessage?.caption || '';

                const match = quotedText.match(/\+?(\d[\d\s\-().]{6,}\d)/);
                if (match) {
                    rawNumber = match[1].replace(/\D/g, '');
                    source    = 'text in quoted message';
                }
            }

            // ── 3. Args fallback: .wame 254712345678 ─────────────────────────
            if (!rawNumber && args.length > 0) {
                rawNumber = args.join('').replace(/\D/g, '');
                source    = 'provided number';
            }

            // ── Nothing found ─────────────────────────────────────────────────
            if (!rawNumber || rawNumber.length < 7) {
                return extra.reply(
                    '❌ No phone number found.\n\n' +
                    '*Usage:*\n' +
                    '• Reply to any message → `.wame`\n' +
                    '• Direct number → `.wame 254712345678`'
                );
            }

            // ── Detect country ────────────────────────────────────────────────
            const info = detectCountry(rawNumber);
            const link = `https://wa.me/${rawNumber}`;

            let text = `🔗 *WhatsApp Link*\n\n`;

            if (info) {
                text += `${info.country.flag} *Country:* ${info.country.name}\n`;
                text += `📞 *Dial Code:* +${info.dialCode}\n`;
                text += `🔢 *Local Number:* ${info.local}\n`;
                text += `📱 *Full Number:* +${rawNumber}\n`;
            } else {
                text += `📱 *Number:* +${rawNumber}\n`;
            }

            text += `🌐 *Link:* ${link}\n\n`;
            text += `_Source: ${source}_`;

            await sock.sendMessage(extra.from, { text }, { quoted: msg });

        } catch (err) {
            console.error('[wame] error:', err);
            await extra.reply(`❌ Error: ${err.message}`);
        }
    }
};
