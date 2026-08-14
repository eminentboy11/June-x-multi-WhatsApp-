const axios = require('axios');
const config = require('../../config');
const APIs = require('../../utils/api');
const getFooter = () => `Powered by ${config.botName}`;

module.exports = {
    name: 'tiktokstalk',
    aliases: ['ttstalk', 'tikstalk', 'tiktokinfo'],
    description: 'Stalk a TikTok user profile',
    category: 'Stalker Commands',

    async execute(sock, m, args, extra) {
        const jid = m.key.remoteJid;
        const prefix = config.prefix || '.';

        if (!args || !args[0]) {
            return sock.sendMessage(jid, {
                text: `╭─⌈ 🔍 *TIKTOK STALKER* ⌋\n│\n├─⊷ *${prefix}tiktokstalk <username>*\n│  └⊷ Stalk a TikTok profile\n│\n├─⊷ *Example:*\n│  └⊷ ${prefix}tiktokstalk maskedwolf908\n│\n╰───────────────\n> *${config.botName} STALKER*`
            }, { quoted: m });
        }

        const username = args[0].replace('@', '').trim();
        await sock.sendMessage(jid, { react: { text: '🔍', key: m.key } });

        try {
            const d = await APIs.stalkTikTok(username);

            let avatarBuffer = null;
            if (d.avatar) {
                try {
                    const imgRes = await axios.get(d.avatar, { responseType: 'arraybuffer', timeout: 10000 });
                    if (imgRes.data.length > 500) avatarBuffer = Buffer.from(imgRes.data);
                } catch {}
            }

            const lines = [
                `╭─⌈ 🎵 *TIKTOK PROFILE* ⌋`,
                `│`,
                `├─⊷ *👤 Name:* ${d.name}`,
                `├─⊷ *🏷️ Username:* @${d.username}`,
                `├─⊷ *📝 Bio:* ${d.bio}`,
                `├─⊷ *👥 Followers:* ${Number(d.followers).toLocaleString()}`,
                `├─⊷ *👤 Following:* ${Number(d.following).toLocaleString()}`,
                `├─⊷ *❤️ Likes:* ${Number(d.likes).toLocaleString()}`,
            ];
            if (d.videos !== null) lines.push(`├─⊷ *🎬 Videos:* ${d.videos}`);
            lines.push(`├─⊷ *✅ Verified:* ${d.verified ? 'Yes ✔️' : 'No'}`);
            lines.push(`├─⊷ *🔒 Private:* ${d.private ? 'Yes' : 'No'}`);
            if (d.profileUrl) lines.push(`├─⊷ *🔗 Profile:* ${d.profileUrl}`);
            lines.push(`│`, `╰⊷ ${getFooter(m.key.participant || m.key.remoteJid)}`, `> 🐺 *${config.botName} STALKER*`);

            const caption = lines.join('\n');

            if (avatarBuffer) {
                await sock.sendMessage(jid, { image: avatarBuffer, caption }, { quoted: m });
            } else {
                await sock.sendMessage(jid, { text: caption }, { quoted: m });
            }

            await sock.sendMessage(jid, { react: { text: '✅', key: m.key } });

        } catch (error) {
            console.error('❌ [TIKTOKSTALK] Error:', error.message);
            await sock.sendMessage(jid, { react: { text: '❌', key: m.key } });
            await sock.sendMessage(jid, {
                text: `❌ *TikTok Stalk Failed*\n\n⚠️ ${error.message}\n\n💡 Check the username and try again.`
            }, { quoted: m });
        }
    }
};
