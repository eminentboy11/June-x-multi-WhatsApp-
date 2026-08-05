'use strict';

const fs = require('fs');
const path = require('path');

const BASE = path.join(process.cwd(), 'data', 'chatbot', 'profiles');
const MAX_MEMORIES = 25;

const FACTS = [
  [/my name is ([A-Za-z][\w-]*)/i, 'name'],
  [/(?:i'm|i am) ([A-Za-z][\w-]*)(?:\s|$|,)/i, 'name'],
  [/call me ([A-Za-z][\w-]*)/i, 'name'],
  [/(?:i'm|i am) (\d{1,3})(?: years? old)?/i, 'age'],
  [/i work (?:as |at )([\w\s-]{3,40})/i, 'job'],
  [/i(?:'m| am) from ([A-Za-z\s]{3,30})/i, 'location'],
  [/i live in ([A-Za-z\s]{3,30})/i, 'location'],
  [/i (?:love|really like|like|enjoy) ([\w\s-]{3,40})/i, 'interest'],
  [/i (?:hate|dislike|can't stand) ([\w\s-]{3,40})/i, 'dislike']
];
const SKIP = new Set(['a', 'an', 'the', 'not', 'so', 'here', 'just', 'good', 'bad', 'fine', 'going', 'trying', 'using', 'happy', 'sad', 'tired', 'busy']);

function profilePath(botId, userId) {
  const dir = path.join(BASE, String(botId || 'default').replace(/[^\w-]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${String(userId).replace(/[^\w]/g, '_')}.json`);
}

function loadProfile(botId, userId) {
  try { return JSON.parse(fs.readFileSync(profilePath(botId, userId), 'utf8')); } catch (_) {}
  const now = new Date().toISOString();
  return { userId, name: null, age: null, location: null, job: null, interests: [], dislikes: [], memories: [], messageCount: 0, firstSeen: now, lastSeen: now };
}

function saveProfile(botId, userId, profile) {
  profile.lastSeen = new Date().toISOString();
  profile.messageCount = (profile.messageCount || 0) + 1;
  try { fs.writeFileSync(profilePath(botId, userId), JSON.stringify(profile, null, 2)); } catch (_) {}
}

function learnFromMessage(text, profile) {
  const result = { ...profile, memories: [...(profile.memories || [])], interests: [...(profile.interests || [])], dislikes: [...(profile.dislikes || [])] };
  for (const [regex, tag] of FACTS) {
    const match = String(text).match(regex);
    if (!match) continue;
    const raw = match[1].trim();
    if (!raw || raw.length > 60 || (tag === 'name' && SKIP.has(raw.toLowerCase()))) continue;
    const value = raw.charAt(0).toUpperCase() + raw.slice(1);
    if (['name', 'age', 'location', 'job'].includes(tag) && !result[tag]) result[tag] = tag === 'age' ? `${value} years old` : value;
    if (tag === 'interest' && !result.interests.includes(value)) result.interests = [...result.interests, value].slice(-10);
    if (tag === 'dislike' && !result.dislikes.includes(value)) result.dislikes = [...result.dislikes, value].slice(-10);
    const memory = `User's ${tag}: ${value}`;
    if (!result.memories.some(item => item.toLowerCase() === memory.toLowerCase())) result.memories.unshift(memory);
  }
  result.memories = result.memories.slice(0, MAX_MEMORIES);
  return result;
}

function buildProfileContext(profile) {
  if (!profile) return '';
  const lines = [];
  for (const field of ['name', 'age', 'location', 'job']) if (profile[field]) lines.push(`- ${field}: ${profile[field]}`);
  if (profile.interests?.length) lines.push(`- interests: ${profile.interests.slice(0, 5).join(', ')}`);
  if (profile.dislikes?.length) lines.push(`- dislikes: ${profile.dislikes.slice(0, 5).join(', ')}`);
  if (profile.messageCount > 1) lines.push('- This is a returning user.');
  return lines.length ? `\nWhat you know about the user:\n${lines.join('\n')}\n` : '';
}

function getPersonalizedGreeting(profile) {
  return profile?.name ? `Hey ${profile.name}!` : null;
}

module.exports = { loadProfile, saveProfile, learnFromMessage, buildProfileContext, getPersonalizedGreeting };