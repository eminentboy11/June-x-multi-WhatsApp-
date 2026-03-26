/**
 * Global Configuration for WhatsApp MD Bot
 */

module.exports = {
    // Bot Owner Configuration
    ownerNumber: ['254798952773','254792021944'], // Add your number without + or spaces (e.g., 919876543210)
    ownerName: ['Supreme', 'Agent Of Dusk'], // Owner names corresponding to ownerNumber array
    
    // Bot Configuration
    botName: 'June X Ultra',
    prefix: '+',
    sessionName: 'session',
    sessionID: process.env.SESSION_ID || '',
    newsletterJid: '@newsletter', // Newsletter JID for menu forwarding
    updateZipUrl: 'https://github.com/Vinpink2/June-X-Ultra/archive/refs/heads/main.zip', // URL to latest code zip for .update command
    
    // Sticker Configuration
    packname: 'June Ultra',
    
    // Bot Behavior
    selfMode: false, // Private mode - only owner can use commands
    autoRead: false,
    autoTyping: false,
    autoBio: false,
    autoSticker: false,
    autoReact: false,
    autoReactMode: 'bot', // set bot or all via cmd
    autoDownload: false,
    autoRecording: false,   // fake recording presence before responses
    autoRecordType: false,  // fake recording → typing presence before responses
    
    // Group Settings Defaults
    defaultGroupSettings: {
      antilink: false,
      antilinkAction: 'delete', // 'delete', 'kick', 'warn'
      antitag: false,
      antitagAction: 'delete',
      antiall: false, // Owner only - blocks all messages from non-admins
      antiviewonce: false,
      antibot: false,
      anticall: false, // Anti-call feature
      antigroupmention: false, // Anti-group mention feature
      antigroupmentionAction: 'delete', // 'delete', 'kick'
      antigroupstatus: false, // Anti-group status mention
      antigroupstatusAction: 'delete', // 'delete', 'kick', 'warn'
      welcome: false,
      welcomeMessage: '╭╼━•𝙽𝙴𝚆 𝙼𝙴𝙼𝙱𝙴𝚁•━╾╮\n┃𝚆𝙴𝙻𝙲𝙾𝙼𝙴: @user 👋\n┃Member count: #memberCount\n┃𝚃𝙸𝙼𝙴: time⏰\n╰━━━━━━━━━━━━━━━╯\n\n*@user* Welcome to *@group*! 🎉\n*Group 𝙳𝙴𝚂𝙲𝚁𝙸𝙿𝚃𝙸𝙾𝙽*\ngroupDesc\n\n> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ botName*',
      goodbye: false,
      goodbyeMessage: 'Goodbye @user 👋 We will never miss you!',
      antiSpam: false,
      antiSpamLimit: 5,   // messages
      antiSpamWindow: 5,  // seconds
      antiSpamAction: 'delete', // delete | warn | kick | mute
      antidelete: false,
      nsfw: false,
      detect: false,
      chatbot: false,
      autosticker: false, // Auto-convert images/videos to stickers
      antiimage: false,
      antiimageAction: 'delete',
      antisticker: false,
      antistickerAction: 'delete',
      antiaudio: false,
      antiaudioAction: 'delete'
    },
    
    // API Keys (add your own)
    apiKeys: {
      // Add API keys here if needed
      openai: '',
      deepai: '',
      remove_bg: ''
    },
    
    // Message Configuration
    messages: {
      wait: '⏳ Please wait...',
      success: '✅ Success!',
      error: '❌ Error occurred!',
      ownerOnly: '👑 This command is only for bot owner!',
      adminOnly: '🛡️ This command is only for group admins!',
      groupOnly: '👥 This command can only be used in groups!',
      privateOnly: '💬 This command can only be used in private chat!',
      botAdminNeeded: '🤖 Bot needs to be admin to execute this command!',
      invalidCommand: '❓ Invalid command! Type .menu for help'
    },
    
    // Timezone
    timezone: 'Africa/Nairobi',
    
    // Limits
    maxWarnings: 3,
    
    // Social Links (optional)
    social: {
      github: 'https://github.com/Vinpink2/June-X-Ultra',
      instagram: 'https://instagram.com/activator_negative',
      youtube: 'http://youtube.com/suprem_e_lord'
    }
};
  
