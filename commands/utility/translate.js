/**
 * Translate2 Command - Translate text with source→target language note
 */

const fetch = require('node-fetch');

// Map of ISO 639-1 codes to language names
const LANG_NAMES = {
  af:'Afrikaans', sq:'Albanian', am:'Amharic', ar:'Arabic', hy:'Armenian',
  az:'Azerbaijani', eu:'Basque', be:'Belarusian', bn:'Bengali', bs:'Bosnian',
  bg:'Bulgarian', ca:'Catalan', ceb:'Cebuano', ny:'Chichewa', zh:'Chinese',
  co:'Corsican', hr:'Croatian', cs:'Czech', da:'Danish', nl:'Dutch',
  en:'English', eo:'Esperanto', et:'Estonian', tl:'Filipino', fi:'Finnish',
  fr:'French', fy:'Frisian', gl:'Galician', ka:'Georgian', de:'German',
  el:'Greek', gu:'Gujarati', ht:'Haitian Creole', ha:'Hausa', haw:'Hawaiian',
  iw:'Hebrew', hi:'Hindi', hmn:'Hmong', hu:'Hungarian', is:'Icelandic',
  ig:'Igbo', id:'Indonesian', ga:'Irish', it:'Italian', ja:'Japanese',
  jw:'Javanese', kn:'Kannada', kk:'Kazakh', km:'Khmer', ko:'Korean',
  ku:'Kurdish', ky:'Kyrgyz', lo:'Lao', la:'Latin', lv:'Latvian',
  lt:'Lithuanian', lb:'Luxembourgish', mk:'Macedonian', mg:'Malagasy',
  ms:'Malay', ml:'Malayalam', mt:'Maltese', mi:'Maori', mr:'Marathi',
  mn:'Mongolian', my:'Myanmar', ne:'Nepali', no:'Norwegian', ps:'Pashto',
  fa:'Persian', pl:'Polish', pt:'Portuguese', pa:'Punjabi', ro:'Romanian',
  ru:'Russian', sm:'Samoan', gd:'Scots Gaelic', sr:'Serbian', st:'Sesotho',
  sn:'Shona', sd:'Sindhi', si:'Sinhala', sk:'Slovak', sl:'Slovenian',
  so:'Somali', es:'Spanish', su:'Sundanese', sw:'Swahili', sv:'Swedish',
  tg:'Tajik', ta:'Tamil', te:'Telugu', th:'Thai', tr:'Turkish',
  uk:'Ukrainian', ur:'Urdu', uz:'Uzbek', vi:'Vietnamese', cy:'Welsh',
  xh:'Xhosa', yi:'Yiddish', yo:'Yoruba', zu:'Zulu'
};

function getLangName(code) {
  if (!code || code === 'auto') return 'Auto-detected';
  return LANG_NAMES[code.toLowerCase()] || code.toUpperCase();
}

module.exports = {
  name: 'translate2',
  aliases: ['trt2', 'tr2'],
  category: 'utility',
  description: 'Translate text with source→target language note',
  usage: '.translate2 <lang> (reply) | .translate2 <text> <lang>',

  async execute(sock, msg, args) {
    try {
      const chatId = msg.key.remoteJid;
      await sock.sendPresenceUpdate('composing', chatId);

      let textToTranslate = '';
      let targetLang = '';

      const quotedMessage = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

      if (quotedMessage) {
        // Replying to a message — all args = target lang
        textToTranslate =
          quotedMessage.conversation ||
          quotedMessage.extendedTextMessage?.text ||
          quotedMessage.imageMessage?.caption ||
          quotedMessage.videoMessage?.caption || '';
        targetLang = args.join(' ').trim() || 'en'; // default to English
      } else {
        // Direct: .translate2 <text> <lang>  OR  .translate2 <text>  (→ en)
        if (args.length < 1) {
          return await sock.sendMessage(chatId, {
            text:
              `*TRANSLATOR 2*\n\n` +
              `*Usage:*\n` +
              `• Reply to a message: _.translate2 <lang>_\n` +
              `• Direct: _.translate2 <text> <lang>_\n` +
              `• No lang = defaults to English\n\n` +
              `*Examples:*\n` +
              `_.trt2 Bonjour fr_  →  translates to French\n` +
              `_.trt2 Hello_  →  translates to English\n\n` +
              `*Common codes:* en es fr de it pt ru ja ko zh ar hi sw`
          }, { quoted: msg });
        }

        // Detect if last arg is a lang code (2-5 chars, letters only)
        const lastArg = args[args.length - 1];
        const isLangCode = /^[a-zA-Z]{2,5}$/.test(lastArg) && args.length >= 2;

        if (isLangCode) {
          targetLang = lastArg.toLowerCase();
          textToTranslate = args.slice(0, -1).join(' ');
        } else {
          // No lang code provided — default to English
          targetLang = 'en';
          textToTranslate = args.join(' ');
        }
      }

      if (!textToTranslate.trim()) {
        return await sock.sendMessage(chatId, {
          text: '❌ No text to translate.'
        }, { quoted: msg });
      }

      // ── Translation with 3-API fallback ──────────────────────────────

      let translatedText = null;
      let detectedLang   = null;

      // API 1 — Google Translate (unofficial)
      try {
        const res = await fetch(
          `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&ld&q=${encodeURIComponent(textToTranslate)}`
        );
        if (res.ok) {
          const data = await res.json();
          if (data?.[0]?.[0]?.[0]) {
            translatedText = data[0].map(s => s?.[0] || '').join('');
            detectedLang   = data?.[2] || null; // detected source lang
          }
        }
      } catch { /* fall through */ }

      // API 2 — MyMemory
      if (!translatedText) {
        try {
          const res = await fetch(
            `https://api.mymemory.translated.net/get?q=${encodeURIComponent(textToTranslate)}&langpair=auto|${targetLang}`
          );
          if (res.ok) {
            const data = await res.json();
            if (data?.responseData?.translatedText) {
              translatedText = data.responseData.translatedText;
              // MyMemory returns "XX|YY" in langpair
              const lp = data?.responseData?.detectedLanguage;
              if (lp) detectedLang = lp.split('|')[0].toLowerCase();
            }
          }
        } catch { /* fall through */ }
      }

      // API 3 — dreaded.site
      if (!translatedText) {
        try {
          const res = await fetch(
            `https://api.dreaded.site/api/translate?text=${encodeURIComponent(textToTranslate)}&lang=${targetLang}`
          );
          if (res.ok) {
            const data = await res.json();
            if (data?.translated) translatedText = data.translated;
          }
        } catch { /* all failed */ }
      }

      if (!translatedText) {
        return await sock.sendMessage(chatId, {
          text: '❌ Translation failed. Please try again later.'
        }, { quoted: msg });
      }

      // ── Build reply ───────────────────────────────────────────────────

      const fromLabel = getLangName(detectedLang);
      const toLabel   = getLangName(targetLang);

      const reply =
        `${translatedText}\n\n` +
        `_(${fromLabel} → ${toLabel})_`;

      await sock.sendMessage(chatId, { text: reply }, { quoted: msg });

    } catch (error) {
      console.error('❌ Error in translate2 command:', error);
      await sock.sendMessage(msg.key.remoteJid, {
        text: '❌ Failed to translate. Please try again later.'
      }, { quoted: msg });
    }
  }
};
