/**
 * Set Welcome - Customize welcome message
 */

const db = require('../../database');

module.exports = {
  name: 'setwelcome',
  aliases: ['welcometext'],
  category: 'admin',
  desc: 'Set custom welcome/goodbye message or toggle no-profile-photo mode',
  usage: '.setwelcome <message> | .setwelcome nopp | .setwelcome reset',
  groupOnly: true,
  adminOnly: true,
  botAdminNeeded: true,
  execute: async (sock, msg, args) => {
    try {
      const groupId = msg.key.remoteJid;
      const groupSettings = db.getGroupSettings(groupId);

      // No args: show current settings
      if (!args.length) {
        const noppStatus = groupSettings.welcomeNoPP ? '✅ ON (text only)' : '❌ OFF (with profile photo)';
        return await sock.sendMessage(groupId, {
          text: `📝 *Welcome Settings*\n\n` +
                `*Message:*\n${groupSettings.welcomeMessage}\n\n` +
                `*No-photo mode (nopp):* ${noppStatus}\n\n` +
                `*Variables you can use:*\n` +
                `• @user — member's phone number\n` +
                `• @group — group name\n` +
                `• groupDesc — group description\n` +
                `• time — current time\n` +
                `• #memberCount — member count\n` +
                `• botName — bot name\n\n` +
                `*Commands:*\n` +
                `• .setwelcome <message> — set custom message\n` +
                `• .setwelcome nopp — toggle no-photo mode\n` +
                `• .setwelcome reset — restore default message`
        }, { quoted: msg });
      }

      const input = args.join(' ').trim();

      // nopp toggle
      if (input.toLowerCase() === 'nopp') {
        const newNoPP = !groupSettings.welcomeNoPP;
        db.updateGroupSettings(groupId, { welcomeNoPP: newNoPP });
        return await sock.sendMessage(groupId, {
          text: `🖼️ *No-photo mode* is now *${newNoPP ? 'ON' : 'OFF'}*.\n\n` +
                (newNoPP
                  ? 'Welcome & goodbye messages will be sent as *text only* (no profile photo).'
                  : 'Welcome & goodbye messages will include the *member profile photo* (or group photo as fallback).')
        }, { quoted: msg });
      }

      // reset to default
      if (input.toLowerCase() === 'reset') {
        const { defaultGroupSettings } = require('../../config');
        db.updateGroupSettings(groupId, { welcomeMessage: defaultGroupSettings.welcomeMessage });
        return await sock.sendMessage(groupId, {
          text: `✅ Welcome message reset to default.`
        }, { quoted: msg });
      }

      // Set custom message
      if (input.length > 500) {
        return await sock.sendMessage(groupId, {
          text: '❌ Welcome message is too long! Maximum 500 characters.'
        }, { quoted: msg });
      }

      db.updateGroupSettings(groupId, { welcomeMessage: input });

      const preview = input
        .replace(/@user/g, '@' + (msg.key.participant || msg.key.remoteJid).split('@')[0])
        .replace(/@group/g, 'This Group')
        .replace(/groupDesc/g, 'Group description here')
        .replace(/time/g, new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }))
        .replace(/#memberCount/g, '?')
        .replace(/botName/g, require('../../config').botName);

      await sock.sendMessage(groupId, {
        text: `✅ *Welcome message updated!*\n\n*Preview:*\n${preview}`,
        mentions: [msg.key.participant]
      }, { quoted: msg });

    } catch (error) {
      console.error('Set Welcome Error:', error);
      await sock.sendMessage(msg.key.remoteJid, {
        text: `❌ Error: ${error.message}`
      }, { quoted: msg });
    }
  }
};
