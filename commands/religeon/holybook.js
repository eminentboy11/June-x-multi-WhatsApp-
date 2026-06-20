/**
 * Religion Commands
 * APIs: bible-api.com | api.alquran.cloud/v1 | vedicscriptures.github.io
 * All free, no API key required.
 */

const axios = require('axios');

// ── Helpers ────────────────────────────────────────────────────────────────

const QURAN_BASE  = 'https://api.alquran.cloud/v1';
const GITA_BASE   = 'https://vedicscriptures.github.io';
const BIBLE_BASE  = 'https://bible-api.com';

// Quran surah names (1-114) — avoids an extra API round-trip
const SURAH_NAMES = [
  '', 'Al-Fatihah','Al-Baqarah','Ali Imran','An-Nisa','Al-Maidah',
  'Al-Anam','Al-Araf','Al-Anfal','At-Tawbah','Yunus','Hud','Yusuf',
  'Ar-Rad','Ibrahim','Al-Hijr','An-Nahl','Al-Isra','Al-Kahf','Maryam',
  'Ta-Ha','Al-Anbiya','Al-Hajj','Al-Muminun','An-Nur','Al-Furqan',
  'Ash-Shuara','An-Naml','Al-Qasas','Al-Ankabut','Ar-Rum','Luqman',
  'As-Sajdah','Al-Ahzab','Saba','Fatir','Ya-Sin','As-Saffat','Sad',
  'Az-Zumar','Ghafir','Fussilat','Ash-Shura','Az-Zukhruf','Ad-Dukhan',
  'Al-Jathiyah','Al-Ahqaf','Muhammad','Al-Fath','Al-Hujurat','Qaf',
  'Ad-Dhariyat','At-Tur','An-Najm','Al-Qamar','Ar-Rahman','Al-Waqiah',
  'Al-Hadid','Al-Mujadilah','Al-Hashr','Al-Mumtahanah','As-Saf',
  'Al-Jumuah','Al-Munafiqun','At-Taghabun','At-Talaq','At-Tahrim',
  'Al-Mulk','Al-Qalam','Al-Haqqah','Al-Maarij','Nuh','Al-Jinn',
  'Al-Muzzammil','Al-Muddathir','Al-Qiyamah','Al-Insan','Al-Mursalat',
  'An-Naba','An-Naziat','Abasa','At-Takwir','Al-Infitar','Al-Mutaffifin',
  'Al-Inshiqaq','Al-Buruj','At-Tariq','Al-Ala','Al-Ghashiyah','Al-Fajr',
  'Al-Balad','Ash-Shams','Al-Layl','Ad-Duha','Ash-Sharh','At-Tin',
  'Al-Alaq','Al-Qadr','Al-Bayyinah','Az-Zalzalah','Al-Adiyat',
  'Al-Qariah','At-Takathur','Al-Asr','Al-Humazah','Al-Fil','Quraysh',
  'Al-Maun','Al-Kawthar','Al-Kafirun','An-Nasr','Al-Masad','Al-Ikhlas',
  'Al-Falaq','An-Nas'
];

const GITA_CHAPTER_NAMES = [
  '', 'Arjuna Vishada Yoga','Sankhya Yoga','Karma Yoga',
  'Jnana Karma Sanyasa Yoga','Karma Vairagya Yoga','Abhyasa Yoga',
  'Paramahamsa Vijnana Yoga','Aksara Parabrahma Yoga','Raja Vidya Raja Guhya Yoga',
  'Vibhuti Yoga','Visvarupa Darsana Yoga','Bhakti Yoga',
  'Ksetra Ksetrajna Vibhaga Yoga','Gunatraya Vibhaga Yoga',
  'Purusottama Yoga','Daivasura Sampad Vibhaga Yoga',
  'Shraddhatraya Vibhaga Yoga','Moksha Sanyasa Yoga'
];

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = [

  // ════════════════════════════════════════════
  //  BIBLE — look up a verse / passage
  // ════════════════════════════════════════════
  {
    name: 'bible',
    aliases: ['verse', 'scripture', 'bibleverse'],
    category: 'religion',
    description: 'Look up a Bible verse or passage',
    usage: '.bible <reference>  e.g. .bible John 3:16',

    async execute(sock, msg, args, { reply, react }) {
      if (!args.length) return reply('❌ Usage: *.bible John 3:16*');
      await react('📖');
      const chatId = msg.key.remoteJid;
      try {
        const ref = args.join(' ').trim();
        const { data } = await axios.get(`${BIBLE_BASE}/${encodeURIComponent(ref)}`);
        const text =
          `📖 *The Holy Bible*\n` +
          `━━━━━━━━━━━━━━━\n` +
          `*Reference:* ${data.reference}\n` +
          `*Translation:* ${data.translation_name}\n` +
          `*Verses:* ${data.verses.length}\n\n` +
          `${data.text.trim()}`;
        await sock.sendMessage(chatId, { text }, { quoted: msg });
      } catch {
        reply('❌ Could not find that reference.\nExample: *.bible John 3:16*');
      }
    }
  },

  // ════════════════════════════════════════════
  //  BIBLELIST — full list of books with image
  // ════════════════════════════════════════════
  {
    name: 'biblelist',
    aliases: ['biblebooks'],
    category: 'religion',
    description: 'Show the complete list of Bible books',
    usage: '.biblelist',

    async execute(sock, msg, args, { reply }) {
      const chatId = msg.key.remoteJid;
      const list =
        `📜 *Old Testament (39 books)*\n` +
        `Genesis · Exodus · Leviticus · Numbers · Deuteronomy · Joshua · Judges · Ruth · 1 Samuel · 2 Samuel · 1 Kings · 2 Kings · 1 Chronicles · 2 Chronicles · Ezra · Nehemiah · Esther · Job · Psalms · Proverbs · Ecclesiastes · Song of Solomon · Isaiah · Jeremiah · Lamentations · Ezekiel · Daniel · Hosea · Joel · Amos · Obadiah · Jonah · Micah · Nahum · Habakkuk · Zephaniah · Haggai · Zechariah · Malachi\n\n` +
        `📖 *New Testament (27 books)*\n` +
        `Matthew · Mark · Luke · John · Acts · Romans · 1 Corinthians · 2 Corinthians · Galatians · Ephesians · Philippians · Colossians · 1 Thessalonians · 2 Thessalonians · 1 Timothy · 2 Timothy · Titus · Philemon · Hebrews · James · 1 Peter · 2 Peter · 1 John · 2 John · 3 John · Jude · Revelation`;

      try {
        await sock.sendMessage(chatId, {
          image: { url: 'https://files.catbox.moe/ptpl5c.jpeg' },
          caption: `📖 *Complete Bible Book List*\n\n${list}`
        }, { quoted: msg });
      } catch {
        reply(`📖 *Complete Bible Book List*\n\n${list}`);
      }
    }
  },

  // ════════════════════════════════════════════
  //  BIBLERANDOM — random Bible verse
  // ════════════════════════════════════════════
  {
    name: 'biblerandom',
    aliases: ['rvs', 'randomverse', 'devotion'],
    category: 'religion',
    description: 'Get a random Bible verse',
    usage: '.biblerandom',

    async execute(sock, msg, args, { reply, react }) {
      await react('🙏');
      const chatId = msg.key.remoteJid;
      // Popular verses pool for random selection
      const verses = [
        'John 3:16','Psalm 23:1','Proverbs 3:5','Romans 8:28',
        'Philippians 4:13','Isaiah 40:31','Jeremiah 29:11','Matthew 6:33',
        'Psalm 46:1','Romans 8:38','Joshua 1:9','1 Corinthians 13:4',
        'Psalm 121:1','John 14:6','Hebrews 11:1','Galatians 5:22',
        'Psalm 27:1','Matthew 5:9','Romans 12:2','2 Timothy 1:7'
      ];
      const ref = verses[Math.floor(Math.random() * verses.length)];
      try {
        const { data } = await axios.get(`${BIBLE_BASE}/${encodeURIComponent(ref)}`);
        const text =
          `✨ *Daily Bible Verse*\n` +
          `━━━━━━━━━━━━━━━\n` +
          `*${data.reference}*\n\n` +
          `_"${data.text.trim()}"_\n\n` +
          `📖 ${data.translation_name}`;
        await sock.sendMessage(chatId, { text }, { quoted: msg });
      } catch {
        reply('❌ Could not fetch a verse. Try again.');
      }
    }
  },

  // ════════════════════════════════════════════
  //  QURAN — surah by number (text + audio)
  // ════════════════════════════════════════════
  {
    name: 'quran',
    aliases: ['surah'],
    category: 'religion',
    description: 'Get a Quran surah with English translation and recitation audio',
    usage: '.quran <surah 1-114>',

    async execute(sock, msg, args, { reply, react }) {
      const chatId = msg.key.remoteJid;
      const num = parseInt(args[0]);
      if (!args[0] || isNaN(num) || num < 1 || num > 114) {
        return reply('❌ Usage: *.quran <number>*  (1–114)\nExample: *.quran 1*');
      }
      await react('🕌');
      try {
        // Fetch Arabic + English translation in one call
        const { data } = await axios.get(
          `${QURAN_BASE}/surah/${num}/editions/quran-uthmani,en.sahih`
        );
        const arabic  = data.data[0];
        const english = data.data[1];
        const name    = SURAH_NAMES[num] || arabic.englishName;

        // Build first 3 ayahs preview (WhatsApp has limits)
        const preview = english.ayahs.slice(0, 3)
          .map(a => `[${a.numberInSurah}] ${a.text}`)
          .join('\n');

        const text =
          `🕌 *Surah ${num}: ${name}*\n` +
          `━━━━━━━━━━━━━━━\n` +
          `*Arabic Name:* ${arabic.name}\n` +
          `*Revelation:* ${arabic.revelationType}\n` +
          `*Total Ayahs:* ${arabic.numberOfAyahs}\n\n` +
          `📝 *Translation (first 3 ayahs):*\n${preview}\n\n` +
          `_Use .ayah ${num}:<number> for a specific verse_`;

        await sock.sendMessage(chatId, { text }, { quoted: msg });

        // Audio — full surah from CDN (Mishary Alafasy, 128kbps)
        const audioUrl = `https://cdn.islamic.network/quran/audio-surah/128/ar.alafasy/${num}.mp3`;
        await sock.sendMessage(chatId, {
          audio: { url: audioUrl },
          mimetype: 'audio/mp4',
          ptt: true
        }, { quoted: msg });

      } catch (e) {
        reply(`❌ Error fetching Surah: ${e.message}`);
      }
    }
  },

  // ════════════════════════════════════════════
  //  AYAH — single Quran verse
  // ════════════════════════════════════════════
  {
    name: 'ayah',
    aliases: ['verse2', 'qverse'],
    category: 'religion',
    description: 'Get a specific Quran ayah with Arabic and English',
    usage: '.ayah <surah>:<ayah>  e.g. .ayah 2:255',

    async execute(sock, msg, args, { reply, react }) {
      const chatId = msg.key.remoteJid;
      const input  = args[0] || '';
      const match  = input.match(/^(\d+):(\d+)$/);
      if (!match) return reply('❌ Usage: *.ayah <surah>:<ayah>*\nExample: *.ayah 2:255*');

      const [, surahNum, ayahNum] = match;
      await react('📿');
      try {
        const { data } = await axios.get(
          `${QURAN_BASE}/ayah/${surahNum}:${ayahNum}/editions/quran-uthmani,en.sahih`
        );
        const arabic  = data.data[0];
        const english = data.data[1];
        const surahName = SURAH_NAMES[parseInt(surahNum)] || arabic.surah?.englishName || '';

        const text =
          `📿 *Quran — ${surahName} ${surahNum}:${ayahNum}*\n` +
          `━━━━━━━━━━━━━━━\n` +
          `🔤 *Arabic:*\n${arabic.text}\n\n` +
          `📖 *English (Sahih Int'l):*\n${english.text}`;

        await sock.sendMessage(chatId, { text }, { quoted: msg });
      } catch (e) {
        reply(`❌ Could not find that ayah.\nCheck: surah (1–114), ayah number.\nError: ${e.message}`);
      }
    }
  },

  // ════════════════════════════════════════════
  //  QURANRANDOM — random Quran ayah
  // ════════════════════════════════════════════
  {
    name: 'quranrandom',
    aliases: ['randomayah', 'qrandom'],
    category: 'religion',
    description: 'Get a random Quran ayah',
    usage: '.quranrandom',

    async execute(sock, msg, args, { reply, react }) {
      const chatId = msg.key.remoteJid;
      await react('🌙');
      // Random ayah number 1-6236
      const ayah = Math.floor(Math.random() * 6236) + 1;
      try {
        const { data } = await axios.get(
          `${QURAN_BASE}/ayah/${ayah}/editions/quran-uthmani,en.sahih`
        );
        const arabic  = data.data[0];
        const english = data.data[1];
        const ref     = `${arabic.surah.number}:${arabic.numberInSurah}`;
        const name    = SURAH_NAMES[arabic.surah.number] || arabic.surah.englishName;

        const text =
          `🌙 *Random Ayah — ${name} (${ref})*\n` +
          `━━━━━━━━━━━━━━━\n` +
          `🔤 *Arabic:*\n${arabic.text}\n\n` +
          `📖 *English:*\n_"${english.text}"_`;

        await sock.sendMessage(chatId, { text }, { quoted: msg });
      } catch (e) {
        reply(`❌ Error: ${e.message}`);
      }
    }
  },

  // ════════════════════════════════════════════
  //  GITA — Bhagavad Gita shlok
  // ════════════════════════════════════════════
  {
    name: 'gita',
    aliases: ['bhagavadgita', 'shlok', 'slok'],
    category: 'religion',
    description: 'Get a Bhagavad Gita shlok with Sanskrit, transliteration and meaning',
    usage: '.gita <chapter>:<verse>  e.g. .gita 2:47',

    async execute(sock, msg, args, { reply, react }) {
      const chatId = msg.key.remoteJid;
      const input  = args[0] || '';
      const match  = input.match(/^(\d+):(\d+)$/);
      if (!match) return reply('❌ Usage: *.gita <chapter>:<verse>*\nExample: *.gita 2:47* (18 chapters)');

      const [, ch, sl] = match;
      await react('🪔');
      try {
        const { data } = await axios.get(`${GITA_BASE}/slok/${ch}/${sl}`);
        if (!data || !data.slok) return reply('❌ Verse not found. Check chapter (1–18) and verse number.');

        const chapterName = GITA_CHAPTER_NAMES[parseInt(ch)] || `Chapter ${ch}`;
        const meaning = data.tej?.ht || data.siva?.et || data.purohit?.et || data.gambir?.et || '_(no English meaning available)_';

        const text =
          `🪔 *Bhagavad Gita ${ch}.${sl}*\n` +
          `📚 _${chapterName}_\n` +
          `━━━━━━━━━━━━━━━\n` +
          `🔤 *Sanskrit (Devanagari):*\n${data.slok}\n\n` +
          `🔡 *Transliteration:*\n${data.transliteration || '—'}\n\n` +
          `📖 *Meaning (English):*\n${meaning}`;

        await sock.sendMessage(chatId, { text }, { quoted: msg });
      } catch (e) {
        reply(`❌ Error fetching shlok: ${e.message}`);
      }
    }
  },

  // ════════════════════════════════════════════
  //  GITARANDOM — random Gita shlok
  // ════════════════════════════════════════════
  {
    name: 'gitarandom',
    aliases: ['randomshlok', 'krishna'],
    category: 'religion',
    description: 'Get a random Bhagavad Gita shlok',
    usage: '.gitarandom',

    async execute(sock, msg, args, { reply, react }) {
      const chatId = msg.key.remoteJid;
      await react('🪔');
      // Verses per chapter
      const chapterVerses = [0,47,72,43,42,29,47,30,28,34,42,55,20,35,27,20,24,28,78];
      const ch = Math.floor(Math.random() * 18) + 1;
      const sl = Math.floor(Math.random() * chapterVerses[ch]) + 1;
      try {
        const { data } = await axios.get(`${GITA_BASE}/slok/${ch}/${sl}`);
        if (!data?.slok) return reply('❌ Could not fetch a shlok. Try again.');

        const meaning = data.tej?.ht || data.siva?.et || data.purohit?.et || '_(no meaning available)_';
        const chapterName = GITA_CHAPTER_NAMES[ch] || `Chapter ${ch}`;

        const text =
          `🪔 *Bhagavad Gita ${ch}.${sl}*\n` +
          `📚 _${chapterName}_\n` +
          `━━━━━━━━━━━━━━━\n` +
          `🔤 *Sanskrit:*\n${data.slok}\n\n` +
          `📖 *Meaning:*\n_"${meaning}"_`;

        await sock.sendMessage(chatId, { text }, { quoted: msg });
      } catch (e) {
        reply(`❌ Error: ${e.message}`);
      }
    }
  },

  // ════════════════════════════════════════════
  //  GITACHAPTER — summary of a Gita chapter
  // ════════════════════════════════════════════
  {
    name: 'gitachapter',
    aliases: ['gitainfo', 'chapter'],
    category: 'religion',
    description: 'Get summary and details of a Bhagavad Gita chapter',
    usage: '.gitachapter <1-18>',

    async execute(sock, msg, args, { reply, react }) {
      const chatId = msg.key.remoteJid;
      const ch = parseInt(args[0]);
      if (!args[0] || isNaN(ch) || ch < 1 || ch > 18) {
        return reply('❌ Usage: *.gitachapter <number>*  (1–18)');
      }
      await react('📚');
      try {
        const { data } = await axios.get(`${GITA_BASE}/chapter/${ch}`);
        if (!data) return reply('❌ Chapter not found.');

        const text =
          `📚 *Bhagavad Gita — Chapter ${ch}*\n` +
          `━━━━━━━━━━━━━━━\n` +
          `*Name:* ${data.translation || GITA_CHAPTER_NAMES[ch]}\n` +
          `*Sanskrit:* ${data.name || '—'}\n` +
          `*Transliteration:* ${data.transliteration || '—'}\n` +
          `*Total Verses:* ${data.verses_count || '—'}\n\n` +
          `📖 *Summary:*\n${(data.summary?.en || '—').slice(0, 700)}...`;

        await sock.sendMessage(chatId, { text }, { quoted: msg });
      } catch (e) {
        reply(`❌ Error: ${e.message}`);
      }
    }
  }

];
