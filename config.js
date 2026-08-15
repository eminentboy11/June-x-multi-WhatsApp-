/**
 * June X Config — multi-session aware.
 *
 * The static object below is the BASE configuration (identical to the
 * original single-session config.js). Each running bot session gets its own
 * copy created with createBotConfig(), so per-bot settings (prefix, botName,
 * timezone, owner numbers, toggles…) never leak between sessions.
 *
 * `require('./config')` returns a Proxy that forwards every property read /
 * write to the config of the CURRENTLY EXECUTING bot (see utils/botContext).
 * This keeps every existing `config.prefix` usage in commands working
 * unchanged, while resolving per bot.
 */

'use strict';

const { getCurrentBotId, DEFAULT_BOT_ID } = require('./utils/botContext');

const baseConfig = {
    ownerNumber: ['254798570132','254792021944','2348072642047'],
    ownerName: ['supreme', 'Odofin', 'ˢᵘᵖʳᵉᵐᵉ ᴸᵒʳᵈ'],
    
    botName: 'JuneX-Ultra',
    prefix: '.',
    version: '3.3.2',
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

// ─── Per-bot config registry ──────────────────────────────────────────────────

const botConfigs = new Map(); // botId -> config object

function cloneConfig() {
    return JSON.parse(JSON.stringify(baseConfig));
}

/**
 * Create a fresh, independent config object for one bot session.
 * Overrides (prefix, botName, timezone, owner…) are applied on top.
 */
function createBotConfig(overrides = {}) {
    const cfg = cloneConfig();
    for (const [key, value] of Object.entries(overrides || {})) {
        if (value !== null && value !== undefined) cfg[key] = value;
    }
    return cfg;
}

function registerBotConfig(botId, cfg) {
    botConfigs.set(String(botId), cfg);
    return cfg;
}

function unregisterBotConfig(botId) {
    botConfigs.delete(String(botId));
}

function getBotConfig(botId) {
    return botConfigs.get(String(botId)) || baseConfig;
}

function hasBotConfig(botId) {
    return botConfigs.has(String(botId));
}

function getBaseConfig() {
    return baseConfig;
}

// ─── Context-aware Proxy ───────────────────────────────────────────────────────

function resolveConfig() {
    return botConfigs.get(getCurrentBotId()) || baseConfig;
}

// Separate target object so proxy statics never pollute baseConfig.
const proxy = new Proxy(Object.create(null), {
    get(_target, prop) {
        if (prop === '__baseConfig') return baseConfig;
        if (prop === '__createBotConfig') return createBotConfig;
        if (prop === '__registerBotConfig') return registerBotConfig;
        if (prop === '__unregisterBotConfig') return unregisterBotConfig;
        if (prop === '__getBotConfig') return getBotConfig;
        if (prop === '__getBaseConfig') return getBaseConfig;
        return resolveConfig()[prop];
    },
    set(_target, prop, value) {
        // Statics land on the target, never on a bot config or the base.
        if (typeof prop === 'string' && prop.startsWith('__')) {
            _target[prop] = value;
            return true;
        }
        const cfg = botConfigs.get(getCurrentBotId());
        if (cfg) cfg[prop] = value;
        else baseConfig[prop] = value; // no bot context yet — mutate the base
        return true;
    },
    has(_target, prop) {
        return prop in resolveConfig();
    },
    ownKeys() {
        return Reflect.ownKeys(resolveConfig());
    },
    getOwnPropertyDescriptor(_target, prop) {
        return Object.getOwnPropertyDescriptor(resolveConfig(), prop);
    },
});

// Statics used by tooling / tests without triggering bot resolution.
proxy.__baseConfig = baseConfig;
proxy.__createBotConfig = createBotConfig;
proxy.__registerBotConfig = registerBotConfig;
proxy.__unregisterBotConfig = unregisterBotConfig;
proxy.__getBotConfig = getBotConfig;
proxy.__getBaseConfig = getBaseConfig;
proxy.__DEFAULT_BOT_ID = DEFAULT_BOT_ID;

module.exports = proxy;
