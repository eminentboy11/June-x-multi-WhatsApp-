const { keithApi } = require(require('path').join(global.__CORE__, 'utils', 'keithApi'));

// Recursively extract an array of search results from any response shape
function extractResults(data) {
    if (!data) return [];

    // Common array keys
    for (const key of ['results', 'result', 'data', 'items', 'search', 'organic']) {
        if (Array.isArray(data[key]) && data[key].length > 0) return data[key];
    }

    // Root-level array
    if (Array.isArray(data) && data.length > 0) return data;

    // Single result object that looks like a search result
    if (data.title || data.url || data.link || data.snippet || data.description) {
        return [data];
    }

    return [];
}

// Safely pull a text field out of a result object
function getText(r, ...keys) {
    for (const k of keys) {
        if (r[k] && typeof r[k] === 'string' && r[k].trim()) return r[k].trim();
    }
    return '';
}

module.exports = {
    name: 'google',
    aliases: ['gsearch', 'search'],
    category: 'general',
    description: 'Search Google and get clean results',
    usage: '.google <query>',

    async execute(sock, msg, args, extra) {
        if (!args.length) return extra.reply('❌ Provide a search query.\n\nExample: *.google Node.js tutorial*');

        const query = args.join(' ');
        await extra.react('🔍');

        try {
            const data = await keithApi('/search/google', { q: query });

            const results = extractResults(data);

            // No usable results at all
            if (!results.length) {
                return extra.reply(`🔍 *Google: ${query}*\n━━━━━━━━━━━━━━━\n\n❌ No results found.`);
            }

            let text = `🔍 *Google: ${query}*\n━━━━━━━━━━━━━━━\n\n`;

            const top = results.slice(0, 6);
            for (let i = 0; i < top.length; i++) {
                const r = top[i];

                // Handle string items (some APIs return array of strings)
                if (typeof r === 'string') {
                    text += `${i + 1}. ${r}\n\n`;
                    continue;
                }

                const title   = getText(r, 'title', 'name', 'heading');
                const snippet = getText(r, 'snippet', 'description', 'body', 'content', 'text', 'summary');
                const url     = getText(r, 'url', 'link', 'href', 'source');

                if (!title && !snippet && !url) continue;

                text += `${i + 1}. *${title || 'Result'}*\n`;
                if (snippet) text += `${snippet.slice(0, 180)}${snippet.length > 180 ? '...' : ''}\n`;
                if (url)     text += `🔗 ${url}\n`;
                text += '\n';
            }

            await extra.reply(text.trim());

        } catch (e) {
            await extra.reply(`❌ Google search failed: ${e.message}`);
        }
    }
};
