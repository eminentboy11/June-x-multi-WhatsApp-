'use strict';

//const { getFooter } = require('../../utils/menuHelper');

let giftedBtns;
try { giftedBtns = require('gifted-btns'); } catch (_) { giftedBtns = null; }

async function resolveJid(sock, inputJid, chatJid = null) {
  if (!inputJid) return inputJid;
  if (/@(g\.us|newsletter|s\.whatsapp\.net)$/.test(inputJid)) return inputJid;
  if (inputJid.endsWith('@lid')) {
    if (chatJid?.endsWith('@g.us')) {
      try {
        const participant = (await sock.groupMetadata(chatJid)).participants?.find(p => p.id === inputJid);
        if (participant?.phoneNumber) return resolveJid(sock, participant.phoneNumber);
      } catch (_) {}
    }
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(inputJid);
      if (pn) return resolveJid(sock, pn);
    } catch (_) {}
    const cached = global.lidPhoneCache?.get(inputJid.split('@')[0]);
    return cached ? `${cached}@s.whatsapp.net` : inputJid;
  }
  const number = inputJid.split('@')[0].split(':')[0].replace(/\D/g, '');
  return number.length >= 7 ? `${number}@s.whatsapp.net` : inputJid;
}

async function sendJid(sock, msg, jid) {
  const chat = msg.key.remoteJid;
  const text = `*JID*\n\`${jid}\`\n${getFooter(chat)}`;
  if (giftedBtns?.sendInteractiveMessage) {
    try {
      return giftedBtns.sendInteractiveMessage(sock, chat, {
        text, interactiveButtons: [{ name: 'cta_copy', buttonParamsJson: JSON.stringify({ display_text: '📋 Copy JID', copy_code: jid }) }]
      });
    } catch (_) {}
  }
  return sock.sendMessage(chat, { text }, { quoted: msg });
}

const command = {
  name: 'getjid',
  aliases: ['jid', 'id'],
  category: 'utility',
  description: 'Get the JID of a chat, user, group or channel',
  async execute(sock, msg, args) {
    const chat = msg.key.remoteJid;
    try {
      const ctx = msg.message?.extendedTextMessage?.contextInfo;
      const mention = ctx?.mentionedJid?.[0];
      const quoted = ctx?.participant;
      let jid = chat;
      if (quoted || mention) jid = await resolveJid(sock, quoted || mention, chat);
      else if (args.length) {
        const raw = args.join(' ');
        const channel = raw.match(/(?:whatsapp\.com\/channel|chat\.whatsapp\.com\/channel)\/([\w-]+)/i);
        const group = raw.match(/chat\.whatsapp\.com\/([\w-]+)/i);
        if (channel) jid = (await sock.newsletterMetadata('invite', channel[1])).id;
        else if (group) jid = (await sock.groupGetInviteInfo(group[1])).id;
        else jid = await resolveJid(sock, raw, chat);
      } else if (!chat.endsWith('@g.us')) jid = await resolveJid(sock, msg.key.participant || chat, chat);
      return sendJid(sock, msg, jid);
    } catch (error) {
      return sock.sendMessage(chat, { text: `❌ ${error.message}` }, { quoted: msg });
    }
  },
  resolveJid
};

module.exports = command;
module.exports.resolveJid = resolveJid;
