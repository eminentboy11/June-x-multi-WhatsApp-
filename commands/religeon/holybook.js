const axios = require('axios');

module.exports = [
    {
        name: 'bible',
        aliases: ['verse', 'scripture'],
        category: 'tools',
        description: 'Look up a Bible verse or chapter',
        usage: '.bible John 3:16',

        async execute(sock, msg, args, { reply, react }) {
            if (!args.length) return reply(`❌ Please specify a reference.\nExample: *.bible John 3:16*`);
            await react('📖');
            const chatId = msg.key.remoteJid;
            try {
                const ref = args.join('').trim();
                const { data } = await axios.get(`https://bible-api.com/${encodeURIComponent(ref)}`);
                const text =
                    `📖 *The Holy Bible*\n` +
                    `━━━━━━━━━━━━━━━\n` +
                    `*Reference:* ${data.reference}\n` +
                    `*Translation:* ${data.translation_name}\n` +
                    `*Verses:* ${data.verses.length}\n\n` +
                    `${data.text.trim()}`;
                await sock.sendMessage(chatId, { text }, { quoted: msg });
            } catch (e) {
                reply(`❌ Could not find that reference. Example: *.bible John 3:16*`);
            }
        }
    },

    {
        name: 'biblelist',
        aliases: ['biblebooks'],
        category: 'tools',
        description: 'Show the complete list of Bible books',
        usage: '.biblelist',

        async execute(sock, msg, args, { reply }) {
            const chatId = msg.key.remoteJid;
            const list =
                `📜 *Old Testament*\n` +
                `1. Genesis\n2. Exodus\n3. Leviticus\n4. Numbers\n5. Deuteronomy\n` +
                `6. Joshua\n7. Judges\n8. Ruth\n9. 1 Samuel\n10. 2 Samuel\n` +
                `11. 1 Kings\n12. 2 Kings\n13. 1 Chronicles\n14. 2 Chronicles\n15. Ezra\n` +
                `16. Nehemiah\n17. Esther\n18. Job\n19. Psalms\n20. Proverbs\n` +
                `21. Ecclesiastes\n22. Song of Solomon\n23. Isaiah\n24. Jeremiah\n25. Lamentations\n` +
                `26. Ezekiel\n27. Daniel\n28. Hosea\n29. Joel\n30. Amos\n` +
                `31. Obadiah\n32. Jonah\n33. Micah\n34. Nahum\n35. Habakkuk\n` +
                `36. Zephaniah\n37. Haggai\n38. Zechariah\n39. Malachi\n\n` +
                `📖 *New Testament*\n` +
                `1. Matthew\n2. Mark\n3. Luke\n4. John\n5. Acts\n` +
                `6. Romans\n7. 1 Corinthians\n8. 2 Corinthians\n9. Galatians\n10. Ephesians\n` +
                `11. Philippians\n12. Colossians\n13. 1 Thessalonians\n14. 2 Thessalonians\n15. 1 Timothy\n` +
                `16. 2 Timothy\n17. Titus\n18. Philemon\n19. Hebrews\n20. James\n` +
                `21. 1 Peter\n22. 2 Peter\n23. 1 John\n24. 2 John\n25. 3 John\n` +
                `26. Jude\n27. Revelation`;

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

    {
        name: 'quran',
        aliases: ['surah'],
        category: 'tools',
        description: 'Look up a Quran surah with tafsir and recitation',
        usage: '.quran <surah number>',

        async execute(sock, msg, args, { reply, react }) {
            const chatId = msg.key.remoteJid;
            const num = parseInt(args[0]);
            if (!args[0] || isNaN(num)) {
                return reply(`❌ Usage: *.quran <surah number>*\nExample: *.quran 1*`);
            }
            await react('🕌');
            try {
                const { data } = await axios.get(`https://apis.davidcyriltech.my.id/quran?surah=${num}`);
                if (!data.success) {
                    return reply('❌ Could not fetch that Surah. Please check the number and try again.');
                }
                const { number, name, type, ayahCount, tafsir, recitation } = data.surah;
                const text =
                    `🕌 *Surah ${name.english}* (${name.arabic})\n` +
                    `━━━━━━━━━━━━━━━\n` +
                    `*Surah Number:* ${number}\n` +
                    `*Type:* ${type}\n` +
                    `*Ayahs:* ${ayahCount}\n\n` +
                    `📝 *Tafsir:*\n${tafsir.id}`;

                await sock.sendMessage(chatId, { text }, { quoted: msg });
                await sock.sendMessage(chatId, {
                    audio: { url: recitation },
                    mimetype: 'audio/mp4',
                    ptt: true
                }, { quoted: msg });
            } catch (e) {
                reply(`❌ Error fetching Surah: ${e.message}`);
            }
        }
    }
];
