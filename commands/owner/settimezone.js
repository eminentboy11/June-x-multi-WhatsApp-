/**
 * Set Timezone — persists via database/bot-settings.json
 */
const config = require('../../config');
const db = require('../../database');

const COMMON_TIMEZONES = [
  'Africa/Nairobi', 'Africa/Lagos', 'Africa/Cairo', 'Africa/Johannesburg',
  'Asia/Kolkata', 'Asia/Dubai', 'Asia/Shanghai', 'Asia/Tokyo', 'Asia/Jakarta',
  'Asia/Singapore', 'Asia/Manila', 'Asia/Karachi', 'Asia/Dhaka',
  'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Australia/Sydney', 'Pacific/Auckland'
];

module.exports = {
  name: 'settimezone',
  aliases: ['settz', 'timezone'],
  category: 'owner',
  description: 'Set bot timezone for time display',
  usage: '.settimezone <timezone>',
  ownerOnly: true,

  async execute(sock, msg, args, extra) {
    try {
      if (!args.length || args[0].toLowerCase() === 'list') {
        let text = `🌍 *Set Timezone*\n\nCurrent: *${config.timezone}*\n\n`;
        text += `*Common Timezones:*\n`;
        COMMON_TIMEZONES.forEach(tz => {
          const marker = tz === config.timezone ? ' ✅' : '';
          try {
            const time = new Date().toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: true });
            text += `• ${tz} — ${time}${marker}\n`;
          } catch {
            text += `• ${tz}${marker}\n`;
          }
        });
        text += `\nUsage: *${config.prefix}settimezone Asia/Kolkata*`;
        return extra.reply(text);
      }

      const newTz = args.join(' ').trim();

      try {
        new Date().toLocaleString('en-US', { timeZone: newTz });
      } catch {
        return extra.reply(`❌ Invalid timezone: *${newTz}*\n\nUse *${config.prefix}settimezone list* to see valid options.`);
      }

      // Persist to database and update runtime config
      db.setBotSetting('timezone', newTz);
      config.timezone = newTz;

      const now = new Date().toLocaleString('en-US', { timeZone: newTz, dateStyle: 'full', timeStyle: 'long' });
      await extra.reply(`✅ Timezone set to: *${newTz}*\n\n🕐 Current time: ${now}`);
    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
