const axios = require('axios');

module.exports = {
  name: 'wyr',
  aliases: ['wouldyourather'],
  category: 'fun',
  description: 'Would you rather question',
  usage: '.wyr',

  async execute(sock, msg, args, extra) {
    await extra.react('🤔');
    try {
      const { data } = await axios.get('https://api.truthordarebot.xyz/v1/wyr');

      const question = data.question;

      // The question comes as "Option A or Option B"
      const parts = question.split(' or ');
      const optA = parts[0]?.trim() || question;
      const optB = parts.slice(1).join(' or ')?.trim() || '';

      const text = optB
        ? `🤔 *Would You Rather...*\n\n🅰️ ${optA}\n\n*OR*\n\n🅱️ ${optB}`
        : `🤔 *Would You Rather...*\n\n${question}`;

      await extra.reply(text);
    } catch (e) {
      await extra.reply(`❌ Error: ${e.message}`);
    }
  }
};
