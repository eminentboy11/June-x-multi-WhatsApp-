/**
 * Global Configuration for WhatsApp MD Bot
 */

module.exports = {
    // Bot Owner Configuration
    ownerNumber: ['254798952773','254792021944'],
    ownerName: ['Supreme', 'Agent Of Dusk'],
    
    // Bot Configuration
    botName: 'June-X Ultra',
    prefix: '.',
    sessionName: 'session',
    sessionID: process.env.SESSION_ID || '',
    newsletterJid: '',
    updateZipUrl: 'https://github.com/Vinpink2/June-X-Ultra/archive/refs/heads/main.zip',
    
    // Sticker Configuration
    packname: '✮⃝𝐒ᵘᵖʳᵉᵐᵉ',
    
    // Bot Behavior
    selfMode: false,
    autoRead: false,
    autoTyping: false,
    autoBio: false,
    autoSticker: false,
    autoReact: false,
    autoReactMode: 'bot',
    autoDownload: false,
    autoRecording: false,
    autoRecordType: false,
    
    // Group Settings Defaults
    defaultGroupSettings: {
      antilink: false,
      antilinkAction: 'delete',
      antitag: false,
      antitagAction: 'delete',
      antiall: false,
      antiviewonce: false,
      antibot: false,
      anticall: false,
      antigroupmention: false,
      antigroupmentionAction: 'delete',
      antigroupstatus: false,
      antigroupstatusAction: 'delete',
      welcome: false,
      welcomeMessage: ' 𝚆𝙴𝙻𝙲𝙾𝙼𝙴: @user 👋\n Member count: #memberCount\n 𝚃𝙸𝙼𝙴: time⏰\n\n\n*@user* Welcome to *@group*! 🎉\n*Group 𝙳𝙴𝚂𝙲𝚁𝙸𝙿𝚃𝙸𝙾𝙽*\ngroupDesc\n\n> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ botName*',
      goodbye: false,
      goodbyeMessage: 'Goodbye @user 👋 We will never miss you!',
      antiSpam: false,
      antiSpamLimit: 5,
      antiSpamWindow: 5,
      antiSpamAction: 'delete',
      antidelete: false,
      nsfw: false,
      detect: false,
      chatbot: false,
      autosticker: false,
      antiimage: false,
      antiimageAction: 'delete',
      antisticker: false,
      antistickerAction: 'delete',
      antiaudio: false,
      antiaudioAction: 'delete'
    },
    
    // API Keys
    apiKeys: {
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
    
    // Social Links
    social: {
      github: 'https://github.com/Vinpink2/June_X_Ultra',
      instagram: 'https://instagram.com/activator_negative',
      youtube: 'http://youtube.com'
    }
};
