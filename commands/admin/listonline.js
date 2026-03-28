/**
 * List Online Command
 * Shows group members who are currently active/online
 * Uses WhatsApp presence subscription to detect status
 */

module.exports = {
    name: 'listonline',
    aliases: ['activemembers', 'online'],
    category: 'admin',
    description: 'Show currently online/active members in the group',
    usage: '.listonline',
    groupOnly: true,
    adminOnly: true,

    async execute(sock, msg, args, extra) {
        try {
            const participants = extra.groupMetadata?.participants || []
            if (!participants.length) return extra.reply('❌ Could not fetch group members.')

            await extra.reply('🔍 Checking member presence, please wait...')

            // Subscribe to every member's presence so WhatsApp pushes updates
            const botId = sock.user?.id?.split(':')[0] + '@s.whatsapp.net'
            for (const p of participants) {
                if (p.id === botId) continue
                try { await sock.presenceSubscribe(p.id) } catch (_) {}
            }

            // Wait for presence updates to arrive
            await new Promise(r => setTimeout(r, 7000))

            if (!global.presenceStore) global.presenceStore = {}

            const online = []
            const offline = []

            for (const p of participants) {
                if (p.id === botId) continue
                const record = global.presenceStore[p.id]
                const number = p.id.split('@')[0]
                const entry = `• @${number}`

                if (record && record.status === 'available') {
                    online.push({ entry, jid: p.id })
                } else {
                    offline.push({ entry, jid: p.id })
                }
            }

            let text = `🟢 *Online Members (${online.length}/${participants.length - 1})*\n\n`

            if (online.length === 0) {
                text += '_No members appear online right now._\n'
                text += '_Note: Members with privacy settings hide their presence._'
            } else {
                text += online.map(m => m.entry).join('\n')
            }

            await sock.sendMessage(extra.from, {
                text,
                mentions: online.map(m => m.jid)
            }, { quoted: msg })

        } catch (error) {
            console.error('ListOnline error:', error)
            await extra.reply('❌ Failed to fetch member presence: ' + error.message)
        }
    }
}
