const config = require('../../config');

module.exports = {
  name: 'time',
  aliases: ['clock', 'date', 'now'],
  category: 'general',
  description: 'Show current date and time',
  usage: '.time or .time <timezone>',

  async execute(sock, msg, args, extra) {
    try {
      const tz = args.join(' ').trim() || config.timezone || 'Asia/Kolkata';

      let valid = true;
      try {
        new Date().toLocaleString('en-US', { timeZone: tz });
      } catch {
        valid = false;
      }

      if (!valid) {
        return extra.reply(`❌ Invalid timezone: *${tz}*\n\nExample: *${config.prefix}time Africa/Nairobi*`);
      }

      const now = new Date();
      const time = now.toLocaleString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
      const date = now.toLocaleString('en-US', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

      const hour = parseInt(now.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hour12: false }));
      let greeting, icon;
      if (hour >= 5 && hour < 12) { greeting = 'Good Morning'; icon = '🌅'; }
      else if (hour >= 12 && hour < 17) { greeting = 'Good Afternoon'; icon = '☀️'; }
      else if (hour >= 17 && hour < 21) { greeting = 'Good Evening'; icon = '🌇'; }
      else { greeting = 'Good Night'; icon = '🌙'; }

      const utcOffset = now.toLocaleString('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).split(' ').pop();

      let text = `🕐 *Current Time*\n━━━━━━━━━━━━━━━\n\n`;
      text += `${icon} ${greeting}!\n\n`;
      text += `⏰ *Time:* ${time}\n`;
      text += `📅 *Date:* ${date}\n`;
      text += `🌍 *Timezone:* ${tz}\n`;
      text += `🔄 *UTC Offset:* ${utcOffset}\n`;
      text += `\n━━━━━━━━━━━━━━━`;

      await extra.reply(text);
    } catch (error) {
      await extra.reply(`❌ Error: ${error.message}`);
    }
  }
};
