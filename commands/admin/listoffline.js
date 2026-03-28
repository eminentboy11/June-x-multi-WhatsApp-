/**
 * List Offline Command
 * Shows group members who are currently offline/inactive
 * Uses WhatsApp presence subscription to detect status
 */

module.exports = {
    name: 'listoffline',
    aliases: ['inactivemembers', 'offline'],
    category: 'admin',
    description: 'Show currently offline/inactive members in the group',
    usage: '.listoffline',
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

            let text = `🔴 *Offline Members (${offline.length}/${participants.length - 1})*\n\n`

            if (offline.length === 0) {
                text += '_All members appear online right now!_'
            } else {
                text += offline.map(m => m.entry).join('\n')
                text += `\n\n_💡 Members with privacy settings may appear offline even when active._`
            }

            await sock.sendMessage(extra.from, {
                text,
                mentions: offline.map(m => m.jid)
            }, { quoted: msg })

        } catch (error) {
            console.error('ListOffline error:', error)
            await extra.reply('❌ Failed to fetch member presence: ' + error.message)
        }
    }
}
