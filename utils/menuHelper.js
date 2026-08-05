'use strict';

const fs = require('fs');
const path = require('path');

function getBotName() { return global.BOT_NAME || process.env.BOT_NAME || 'June-X Ultra'; }
function getOwnerName() { return global.OWNER_NAME || process.env.OWNER_NAME || 'June_Ultra'; }
function getFooter() { return '⚡ *Engineered by June_Ultra*'; }
function getBotMode() { return process.env.BOT_MODE === 'silent' ? '🔇 Silent' : '🌍 Public'; }
function getBotVersion() { return global.VERSION || process.env.VERSION || '2.8.8'; }
function getDeploymentPlatform() {
  if (process.env.RENDER_SERVICE_ID || process.env.RENDER) return { name: 'Render', icon: '⚡' };
  if (process.env.REPL_ID || process.env.REPLIT_DB_URL) return { name: 'Replit', icon: '🌀' };
  return { name: process.platform === 'win32' ? 'Windows' : 'Linux', icon: process.platform === 'win32' ? '💻' : '🐧' };
}
function formatUptime(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = Math.floor(seconds % 60);
  return h ? `${h}h ${m}m ${s}s` : m ? `${m}m ${s}s` : `${s}s`;
}
function buildMenuHeader(label, prefix) {
  const ram = process.memoryUsage();
  return `╭─⌈ \`${getBotName()}\` ⌋\n┃ Menu: *${label}*\n┃ Owner: ${getOwnerName()}\n┃ Mode: ${getBotMode()}\n┃ Prefix: [ ${prefix || global.prefix || '.'} ]\n┃ Version: ${getBotVersion()}\n┃ Panel: ${getDeploymentPlatform().icon} ${getDeploymentPlatform().name}\n┃ Uptime: ${formatUptime(process.uptime())}\n┃ Memory: ${Math.round(ram.heapUsed / 1024 / 1024)}MB\n╰─⊷`;
}
function createFadedEffect(text) { return String(text); }
function createReadMoreEffect(a, b) { return `${a}\n${b}`; }
function invalidateMenuHelperCache() {}
function createFakeContact(message) { return message; }
async function sendLoadingMessage(sock, jid, name, m) {
  await sock.sendMessage(jid, { text: `⚡ ${getBotName()} ${name} loading...` }, { quoted: m });
  return m;
}
async function getMenuMedia() { return null; }
async function getMenuImageBuffer() { return null; }
async function sendMenuMessage(sock, jid, header, body, m) {
  return sock.sendMessage(jid, { text: `${header}\n\n${body}\n\n${getFooter()}` }, { quoted: m });
}
async function sendSubMenu(sock, jid, label, body, m, prefix) {
  return sendMenuMessage(sock, jid, buildMenuHeader(label, prefix), body, m);
}

module.exports = {
  getBotName, getOwnerName, getFooter, getBotMode, getBotVersion,
  getDeploymentPlatform, formatUptime, buildMenuHeader, createFakeContact,
  createFadedEffect, createReadMoreEffect, sendLoadingMessage,
  invalidateMenuHelperCache, getMenuMedia, getMenuImageBuffer,
  sendMenuMessage, sendSubMenu
};