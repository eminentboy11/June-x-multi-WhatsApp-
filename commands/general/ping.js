const config = require('../../config');

module.exports = {
    name: 'ping',
    aliases: ['p'],
    category: 'general',
    description: 'Check bot response time',
    usage: '.ping',
    
    async execute(sock, msg, args, extra) {
      try {
        const start = performance.now();
        const sent = await extra.reply('🏓 Pinging...');
        const end = performance.now();
        
        const responseTime = (end - start).toFixed(3);
        const botName = config.botName || 'June Ultra';
        
        await sock.sendMessage(extra.from, {
          text: `🏓 *${botName} Speed ${responseTime}ms*`,
          edit: sent.key
        });
        
      } catch (error) {
        await extra.reply(`❌ Error: ${error.message}`);
      }
    }
  };
