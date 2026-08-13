module.exports = {
    ownerNumber: ['254798570132','254792021944','2348072642047'],
    ownerName: ['supreme', 'Odofin', 'ˢᵘᵖʳᵉᵐᵉ ᴸᵒʳᵈ'],
    
    botName: 'JuneX-Ultra',
    prefix: '.',
    version: '2.9.0',
    sessionName: '',
    sessionID: process.env.SESSION_ID || '',
    newsletterJid: '',
    JUNE_API_URL: 'https://june-ultra-ai-test-model.onrender.com',
    JUNE_BOT_ID:  'june-ultra-main',
    updateZipUrl: 'https://github.com/Vinpink2/June-X-Ultra/archive/refs/heads/main.zip',
    
    packname: '',
    telegramToken: '8316875590:AAGXXYbt2OIn_hORS0s9RlW5n3e5W5-0YPQ',
    
    selfMode: false,
    autoRead: false,
    autoTyping: false,
    autoBio: false,
    autoSticker: false,
    autoReact: false,
    autoReactMode: 'bot',
    autoRecording: false,
    autoRecordType: false,
    
    // Anti-call message presets
    anticallPresets: [
      {
        id: 1,
        emoji: '📵',
        message: 'Sorry, I don\'t accept WhatsApp calls. Please send a message.'
      },
      {
        id: 2,
        emoji: '💬',
        message: 'I\'m currently unavailable. Kindly text me instead.'
      },
      {
        id: 3,
        emoji: '🚫',
        message: 'Calls are disabled. Please chat with me here.'
      },
      {
        id: 4,
        emoji: '🤖',
        message: 'This account doesn\'t accept calls. Send a message to continue.'
      },
      {
        id: 5,
        emoji: '🌙',
        message: 'Do Not Disturb. I\'ll reply when available.'
      }
    ],
    
    defaultGroupSettings: {
      antilink: false,
      antilinkAction: 'delete',
      antitag: false,
      antitagAction: 'delete',
      antiviewonce: false,
      antibot: false,
      anticall: false,
      anticallAction: 'decline',
      anticallMessage: null,  // null = use default preset 1, string = custom message
      anticallNotify: true,   // whether to send message when declining/blocking calls
      antigroupmention: false,
      antigroupmentionAction: 'delete',
      antigroupstatus: false,
      antigroupstatusAction: 'delete',
      welcome: false,
      welcomeMessage: ' 𝚆𝙴𝙻𝙲𝙾𝙼𝙴: @user 👋\n Member count: #memberCount\n 𝚃𝙸𝙼𝙴: time⏰\n\n\n*@user* Welcome to *@group*! 🎉\n*Group 𝙳𝙴𝚂𝙲𝚁𝙸𝙿𝚃𝙸𝙾𝙽*\ngroupDesc\n\n> *ᴘᴏᴡᴇʀᴇᴅ ʙʏ botName*',
      welcomeNoPP: false,
      goodbye: false,
      goodbyeMessage: 'Goodbye @user 👋 We will never miss you!',
      antiSpam: false,
      antiSpamLimit: 5,
      antiSpamWindow: 5,
      antiSpamAction: 'delete',
      nsfw: false,
      detect: false,
      chatbot: false,
      autosticker: false,
      antiimage: false,
      antiimageAction: 'delete',
      antisticker: false,
      antistickerAction: 'delete',
      antiaudio: false,
      antiaudioAction: 'delete',
      antibadword: false,
      antibadwordAction: 'warn',
      badwords: [],
      anticontact: false,
      anticontactAction: 'delete',
      antigif: false,
      antigifAction: 'delete',
    },
    
    apiKeys: {
      openai: '',
      deepai: '',
      remove_bg: ''
    },
    
    messages: {
      wait: '⏳ Please wait...',
      success: '✅ Success!',
      error: '❌ Error occurred!',
      ownerOnly: '👑 This command is only for bot owner!',
      adminOnly: '🛡️ This command is only for group admins!',
      groupOnly: '👥 This command can only be used in groups!',
      privateOnly: '💬 This command can only be used in private chat!',
      botAdminNeeded: '🚫 Bot needs to be admin to execute this command!',
      invalidCommand: '❓ Invalid command! Type .menu for help'
    },
    
    timezone: 'Africa/Nairobi',
    
    maxWarnings: 3,
    
    social: {
      github: 'https://github.com/Vinpink2/June-Ultra',
      instagram: 'https://instagram.com/activator_negative',
      youtube: 'http://youtube.com/@suprem_e_lord'
    }
};
