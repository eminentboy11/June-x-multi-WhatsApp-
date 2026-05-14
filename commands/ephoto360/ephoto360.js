/**
 * Ephoto360 Text Effects
 */

const axios = require('axios');
const cheerio = require('cheerio');
const config = require('../../config');

async function ephoto(url, text) {
    let form = new FormData();
    let gT = await axios.get(url, {
        headers: {
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36',
        },
    });
    let $ = cheerio.load(gT.data);
    let token = $('input[name=token]').val();
    let build_server = $('input[name=build_server]').val();
    let build_server_id = $('input[name=build_server_id]').val();
    form.append('text[]', text);
    form.append('token', token);
    form.append('build_server', build_server);
    form.append('build_server_id', build_server_id);
    let res = await axios({
        url,
        method: 'POST',
        data: form,
        headers: {
            Accept: '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36',
            cookie: gT.headers['set-cookie']?.join('; '),
            'Content-Type': 'multipart/form-data',
        },
    });
    let $$ = cheerio.load(res.data);
    let json = JSON.parse($$('input[name=form_value_input]').val());
    json['text[]'] = json.text;
    delete json.text;
    let { data } = await axios.post(
        'https://en.ephoto360.com/effect/create-image',
        new URLSearchParams(json),
        {
            headers: {
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36',
                cookie: gT.headers['set-cookie'].join('; '),
            },
        }
    );
    return build_server + data.image;
}

function makeEphotoCmd(name, aliases, url, description) {
    return {
        name,
        aliases,
        category: 'textmaker',
        description,
        usage: `.${name} <text>`,
        async execute(sock, msg, args, extra) {
            const { from, reply } = extra || {};
            const chatId = from || msg.key.remoteJid;
            const text = args.join(' ');
            const prefix = config.prefix || '.';
            if (!text) {
                const replyFn = reply || ((t) => sock.sendMessage(chatId, { text: t }, { quoted: msg }));
                return replyFn(`*Example: ${prefix}${name} vin*`);
            }
            try {
                const result = await ephoto(url, text);
                await sock.sendMessage(chatId, {
                    image: { url: result },
                    caption: config.botName,
                }, { quoted: msg });
            } catch (err) {
                console.error(`Error in ${name} command:`, err);
                const replyFn = reply || ((t) => sock.sendMessage(chatId, { text: t }, { quoted: msg }));
                replyFn('*❌ An error occurred while generating the effect.*');
            }
        },
    };
}

function makeApiCmd(name, aliases, buildUrl, description, waitMsg) {
    return {
        name,
        aliases,
        category: 'textmaker',
        description,
        usage: `.${name} <text>`,
        async execute(sock, msg, args, extra) {
            const { from, reply } = extra || {};
            const chatId = from || msg.key.remoteJid;
            const text = args.join(' ');
            const prefix = config.prefix || '.';
            const replyFn = reply || ((t) => sock.sendMessage(chatId, { text: t }, { quoted: msg }));
            if (!text) return replyFn(`*Example: ${prefix}${name} vin*`);
            try {
                await replyFn(waitMsg);
                const apiUrl = buildUrl(encodeURIComponent(text));
                await sock.sendMessage(chatId, {
                    image: { url: apiUrl },
                    caption: config.botName,
                }, { quoted: msg });
            } catch (err) {
                console.error(`Error in ${name} command:`, err);
                replyFn('❌ Error generating effect. Please try again later.');
            }
        },
    };
}

module.exports = [

    makeEphotoCmd('luxurygold', ['goldtext', 'goldfx'],
        'https://en.ephoto360.com/create-a-luxury-gold-text-effect-online-594.html',
        'Create a luxury gold text effect'),

    makeEphotoCmd('advancedglow', ['aglow'],
        'https://en.ephoto360.com/advanced-glow-effects-74.html',
        'Create an advanced glow text effect'),

    makeEphotoCmd('blackpinklogo', ['bplogo'],
        'https://en.ephoto360.com/create-blackpink-logo-online-free-607.html',
        'Create a Blackpink logo style text'),

    makeEphotoCmd('blackpinkstyle', ['bpstyle'],
        'https://en.ephoto360.com/online-blackpink-style-logo-maker-effect-711.html',
        'Create a Blackpink style text effect'),

    makeEphotoCmd('cartoonstyle', ['cartoonfx'],
        'https://en.ephoto360.com/create-a-cartoon-style-graffiti-text-effect-online-668.html',
        'Create a cartoon style graffiti text effect'),

    makeEphotoCmd('deadpool', ['deadpoolfx'],
        'https://en.ephoto360.com/create-light-effects-green-neon-online-429.html',
        'Create a green neon light text effect'),

    makeEphotoCmd('effectclouds', ['cloudsfx'],
        'https://en.ephoto360.com/write-text-effect-clouds-in-the-sky-online-619.html',
        'Write text in clouds in the sky'),

    makeEphotoCmd('flagtext', ['flagfx'],
        'https://en.ephoto360.com/nigeria-3d-flag-text-effect-online-free-753.html',
        'Create a 3D flag text effect'),

    makeEphotoCmd('freecreate', ['freefx'],
        'https://en.ephoto360.com/free-create-a-3d-hologram-text-effect-441.html',
        'Create a 3D hologram text effect'),

    makeEphotoCmd('galaxystyle', ['galaxyfx'],
        'https://en.ephoto360.com/create-galaxy-style-free-name-logo-438.html',
        'Create a galaxy style name logo'),

    makeEphotoCmd('galaxywallpaper', ['galaxywp'],
        'https://en.ephoto360.com/create-galaxy-wallpaper-mobile-online-528.html',
        'Create a galaxy wallpaper with your text'),

    makeEphotoCmd('makingneon', ['makeneon'],
        'https://en.ephoto360.com/making-neon-light-text-effect-with-galaxy-style-521.html',
        'Create neon light text with galaxy style'),

    makeEphotoCmd('matrixfx', ['matrixtext'],
        'https://en.ephoto360.com/matrix-text-effect-154.html',
        'Create a matrix style text effect'),

    makeEphotoCmd('royaltext', ['royalfx'],
        'https://en.ephoto360.com/royal-text-effect-online-free-471.html',
        'Create a royal text effect'),

    makeEphotoCmd('sandfx', ['sandtext'],
        'https://en.ephoto360.com/write-in-sand-summer-beach-online-576.html',
        'Write text in sand on a beach'),

    makeEphotoCmd('summerbeach', ['beachfx'],
        'https://en.ephoto360.com/write-in-sand-summer-beach-online-free-595.html',
        'Write text on a summer beach'),

    makeEphotoCmd('topography', ['topofx'],
        'https://en.ephoto360.com/create-typography-text-effect-on-pavement-online-774.html',
        'Create typography text effect on pavement'),

    makeEphotoCmd('typography', ['typefx'],
        'https://en.ephoto360.com/create-typography-text-effect-on-pavement-online-774.html',
        'Create a typography pavement text effect'),

    makeEphotoCmd('flag3dtext', ['flag3d'],
        'https://en.ephoto360.com/free-online-american-flag-3d-text-effect-generator-725.html',
        'Create a 3D American flag text effect'),

    makeEphotoCmd('glitchtext', ['textglitch'],
        'https://en.ephoto360.com/create-digital-glitch-text-effects-online-767.html',
        'Create a digital glitch text effect'),

    makeEphotoCmd('dragonball', ['dragonballfx'],
        'https://en.ephoto360.com/create-dragon-ball-style-text-effects-online-809.html',
        'Create a Dragon Ball style text effect'),

    makeEphotoCmd('multicoloredneon', ['multicneon'],
        'https://en.ephoto360.com/create-multicolored-neon-light-signatures-591.html',
        'Create multicolored neon light signatures'),

    makeEphotoCmd('neonglitch', ['neonglitchfx'],
        'https://en.ephoto360.com/create-impressive-neon-glitch-text-effects-online-768.html',
        'Create impressive neon glitch text effect'),

    makeEphotoCmd('papercutstyle', ['papercutfx'],
        'https://en.ephoto360.com/multicolor-3d-paper-cut-style-text-effect-658.html',
        'Create a 3D multicolor paper cut style text'),

    makeEphotoCmd('pixelglitch', ['pixelglitchfx'],
        'https://en.ephoto360.com/create-pixel-glitch-text-effect-online-769.html',
        'Create a pixel glitch text effect'),

    makeEphotoCmd('glowingtext', ['glowtxt'],
        'https://en.ephoto360.com/create-glowing-text-effects-online-706.html',
        'Create glowing text effect'),

    makeEphotoCmd('gradienttext', ['gradienttxt'],
        'https://en.ephoto360.com/create-3d-gradient-text-effect-online-600.html',
        'Create a 3D gradient text effect'),

    makeEphotoCmd('graffiti', ['graffitifx'],
        'https://en.ephoto360.com/cute-girl-painting-graffiti-text-effect-667.html',
        'Create a graffiti text effect'),

    makeEphotoCmd('incandescent', ['incandescentfx'],
        'https://en.ephoto360.com/text-effects-incandescent-bulbs-219.html',
        'Create incandescent bulb text effect'),

    makeEphotoCmd('lighteffects', ['lightfx'],
        'https://en.ephoto360.com/create-light-effects-green-neon-online-429.html',
        'Create light/neon text effects'),

    makeEphotoCmd('logomaker', ['logomake'],
        'https://en.ephoto360.com/free-bear-logo-maker-online-673.html',
        'Create a bear logo with text'),

    makeApiCmd('royal', ['royal2'],
        (t) => `https://api.nekolabs.my.id/ephoto/royal-text?text=${t}`,
        'Create a royal logo (via external API)',
        '👑 Creating royal logo... Please wait ⏳'),

    makeApiCmd('textonwetglass', ['wetglass', 'wetfx'],
        (t) => `https://api.nekolabs.web.id/ephoto/text-on-wet-glass?text=${t}`,
        'Create a wet glass text effect (via external API)',
        '💧 Creating text on wet glass effect... Please wait ⏳'),

    makeApiCmd('bear', ['bearlogo'],
        (t) => `https://api.nekolabs.my.id/ephoto/bear-logo?text=${t}`,
        'Create a bear logo (via external API)',
        '🐻 Creating bear logo... Please wait ⏳'),

    makeApiCmd('papercut', ['3dpaper', 'paper3d'],
        (t) => `https://api.nekolabs.my.id/ephoto/3d-paper-cut-style?text=${t}`,
        'Create a 3D paper cut style (via external API)',
        '✂️ Creating 3D paper cut style... Please wait ⏳'),

    makeApiCmd('hologram', ['3dhologram', 'hologram3d'],
        (t) => `https://api.nekolabs.my.id/ephoto/3d-hologram-text?text=${t}`,
        'Create a 3D hologram text (via external API)',
        '✨ Creating 3D hologram text... Please wait ⏳'),
];
