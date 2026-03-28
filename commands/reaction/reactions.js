const axios = require('axios');

async function sendReaction(sock, msg, endpoint) {
    const chatId = msg.key.remoteJid;
    try {
        const { data } = await axios.get(`https://api.waifu.pics/sfw/${endpoint}`);
        if (!data?.url) throw new Error('No image URL returned');
        await sock.sendMessage(chatId, {
            image: { url: data.url },
            caption: `_${endpoint.charAt(0).toUpperCase() + endpoint.slice(1)}_`
        }, { quoted: msg });
    } catch (e) {
        await sock.sendMessage(chatId, { text: `❌ Failed to fetch reaction: ${e.message}` }, { quoted: msg });
    }
}

function reactionCmd(name, aliases, endpoint, description) {
    return {
        name,
        aliases,
        category: 'tools',
        description,
        usage: `.${name}`,
        async execute(sock, msg) {
            await sendReaction(sock, msg, endpoint);
        }
    };
}

module.exports = [
    reactionCmd('kiss',        ['cium', 'beso'],    'kiss',      'Send a kiss reaction GIF'),
    reactionCmd('cry',         [],                  'cry',       'Send a cry reaction GIF'),
    reactionCmd('blush',       [],                  'blush',     'Send a blush reaction GIF'),
    reactionCmd('dance',       [],                  'dance',     'Send a dance reaction GIF'),
    reactionCmd('kill',        [],                  'kill',      'Send a kill reaction GIF'),
    reactionCmd('hug',         [],                  'hug',       'Send a hug reaction GIF'),
    reactionCmd('kick',        ['kick3'],            'kick3',     'Send a kick reaction GIF'),
    reactionCmd('slap',        [],                  'slap',      'Send a slap reaction GIF'),
    reactionCmd('happy',       [],                  'happy',     'Send a happy reaction GIF'),
    reactionCmd('bully',       [],                  'bully',     'Send a bully reaction GIF'),
    reactionCmd('pat',         ['headpat'],          'pat',       'Send a head pat reaction GIF'),
    reactionCmd('wink',        [],                  'wink',      'Send a wink reaction GIF'),
    reactionCmd('poke',        [],                  'poke',      'Send a poke reaction GIF'),
    reactionCmd('cuddle',      [],                  'cuddle',    'Send a cuddle reaction GIF'),
    reactionCmd('highfive',    ['hi5'],              'highfive',  'Send a high five reaction GIF'),
    reactionCmd('smile',       [],                  'smile',     'Send a smile reaction GIF'),
    reactionCmd('wave',        [],                  'wave',      'Send a wave reaction GIF'),
    reactionCmd('bite',        [],                  'bite',      'Send a bite reaction GIF'),
    reactionCmd('lick',        [],                  'lick',      'Send a lick reaction GIF'),
    reactionCmd('bonk',        [],                  'bonk',      'Send a bonk reaction GIF'),
    reactionCmd('yeet',        [],                  'yeet',      'Send a yeet reaction GIF'),
    reactionCmd('glomp',       [],                  'glomp',     'Send a glomp reaction GIF'),
    reactionCmd('stab',        [],                  'stab',      'Send a stab reaction GIF'),
    reactionCmd('nom',         [],                  'nom',       'Send a nom reaction GIF'),
    reactionCmd('tickle',      [],                  'tickle',    'Send a tickle reaction GIF'),
    reactionCmd('throw',       [],                  'throw',     'Send a throw reaction GIF'),
    reactionCmd('facepalm',    [],                  'facepalm',  'Send a facepalm reaction GIF'),
    reactionCmd('feed',        [],                  'feed',      'Send a feed reaction GIF'),
    reactionCmd('spank',       [],                  'spank',     'Send a spank reaction GIF'),
    reactionCmd('handhold',    ['holdhands'],        'handhold',  'Send a handhold reaction GIF'),
    reactionCmd('shoot',       [],                  'shoot',     'Send a shoot reaction GIF'),
    reactionCmd('punch',       [],                  'punch',     'Send a punch reaction GIF'),
    reactionCmd('stare',       [],                  'stare',     'Send a stare reaction GIF'),
    reactionCmd('comfort',     [],                  'comfort',   'Send a comfort reaction GIF'),
    reactionCmd('boop',        ['boopnose'],         'boop',      'Send a boop reaction GIF'),
    reactionCmd('sleep',       [],                  'sleep',     'Send a sleep reaction GIF'),
    reactionCmd('shrug',       [],                  'shrug',     'Send a shrug reaction GIF'),
    reactionCmd('sip',         [],                  'sip',       'Send a sip reaction GIF'),
    reactionCmd('clap',        [],                  'clap',      'Send a clap reaction GIF'),
    reactionCmd('nervous',     [],                  'nervous',   'Send a nervous reaction GIF'),
    reactionCmd('scream',      [],                  'scream',    'Send a scream reaction GIF'),
    reactionCmd('pout',        [],                  'pout',      'Send a pout reaction GIF'),
    reactionCmd('bored',       [],                  'bored',     'Send a bored reaction GIF'),
    reactionCmd('laugh',       [],                  'laugh',     'Send a laugh reaction GIF'),
    reactionCmd('shy',         [],                  'shy',       'Send a shy reaction GIF'),
    reactionCmd('confused',    [],                  'confused',  'Send a confused reaction GIF'),
    reactionCmd('angry',       [],                  'angry',     'Send an angry reaction GIF'),
    reactionCmd('excited',     [],                  'excited',   'Send an excited reaction GIF'),
    reactionCmd('fear',        [],                  'fear',      'Send a fear reaction GIF'),
    reactionCmd('surprised',   [],                  'surprised', 'Send a surprised reaction GIF'),
    reactionCmd('thinking',    [],                  'thinking',  'Send a thinking reaction GIF'),
    reactionCmd('embarrassed', [],                  'embarrassed','Send an embarrassed reaction GIF'),
    reactionCmd('tired',       [],                  'tired',     'Send a tired reaction GIF'),
    reactionCmd('sad',         [],                  'sad',       'Send a sad reaction GIF'),
    reactionCmd('love',        [],                  'love',      'Send a love reaction GIF'),
    reactionCmd('peace',       [],                  'peace',     'Send a peace reaction GIF'),
    reactionCmd('victory',     ['victorysign'],      'victory',   'Send a victory reaction GIF'),
    reactionCmd('point',       [],                  'point',     'Send a point reaction GIF'),
];
