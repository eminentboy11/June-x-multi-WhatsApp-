/**
 * List Command
 * Show all commands with descriptions in a table format
 */

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const { loadCommands } = require('../../utils/commandLoader');
const { sendButtons } = require('gifted-btns');

module.exports = {
  name: 'list',
  aliases: [],
  description: 'List all commands with descriptions',
  usage: '.list',
  category: 'general',
  
  async execute(sock, msg, args, extra) {
    try {
      const prefix = config.prefix;
      const commands = loadCommands();
      const categories = {};
      
      // Group commands by category
      commands.forEach((cmd, name) => {
        if (cmd.name === name) { // Only count main command names, not aliases
          const category = (cmd.category || 'other').toLowerCase();
          if (!categories[category]) {
            categories[category] = [];
          }
          // Build a nice command string with aliases
          let cmdString = `${prefix}${cmd.name}`;
          if (cmd.aliases && cmd.aliases.length > 0) {
            cmdString += ` (${cmd.aliases.map(a => prefix + a).join(', ')})`;
          }
          categories[category].push({
            cmd: cmdString,
            desc: cmd.description || 'No description'
          });
        }
      });
      
      // Calculate max width for command column
      let maxCmdLen = 0;
      const allEntries = [];
      for (const cat in categories) {
        for (const entry of categories[cat]) {
          maxCmdLen = Math.max(maxCmdLen, entry.cmd.length);
          allEntries.push(entry);
        }
      }
      // Add some padding
      maxCmdLen = Math.min(maxCmdLen + 2, 40); // Cap at 40 characters
      
      // Build the table inside a code block
      let table = '```\n';
      // Header
      table += `${'COMMAND'.padEnd(maxCmdLen)} | DESCRIPTION\n`;
      table += `${'-'.repeat(maxCmdLen)}-+-${'-'.repeat(30)}\n`;
      
      const orderedCats = Object.keys(categories).sort();
      for (const cat of orderedCats) {
        table += `\n📂 ${cat.toUpperCase()}\n`;
        for (const entry of categories[cat]) {
          const paddedCmd = entry.cmd.padEnd(maxCmdLen);
          // Wrap description if too long? For simplicity, we keep it as is.
          table += `${paddedCmd} | ${entry.desc}\n`;
        }
      }
      table += '```';
      
      // Send message with buttons using gifted-btns
      await sendButtons(sock, extra.from, {
        title: `*${config.botName} - Commands List*`,
        text: table,
        footer: `> *Powered by ${config.botName}*`,
        buttons: [
          {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: 'Youtube',
              url: config.social?.youtube || 'http://youtube.com'
            })
          },
          {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: 'Visit Bot Repo',
              url: config.social?.github || 'https://github.com/vinpink2/June_X_Ultra'
            })
          },
          {
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: 'Join Channel',
              url: 'https://whatsapp.com/channel/0029Va90zAnIHphOuO8Msp3A'
            })
          }
        ]
      }, { quoted: msg });
      
    } catch (err) {
      console.error('list.js error:', err);
      await extra.reply('❌ Failed to load commands list.');
    }
  }
};
