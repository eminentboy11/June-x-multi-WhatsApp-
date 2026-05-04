/**
 * TicTacToe Game
 *  .ttt start           → open a room, wait for another player to join with .ttt start
 *  .ttt bot             → play 1v1 against the bot (unbeatable minimax)
 *  .ttt cancel          → cancel your waiting/active game
 *  .ttt <room name>     → open/join a named room
 *  .ttt                 → shows usage
 */

const TicTacToe = require(require('path').join(global.__CORE__, 'utils', 'tictactoe'));

// Sentinel JID for the AI opponent (never matches a real user)
const BOT_ID = 'bot@tictactoe.local';
const BOT_TAG = '🤖 Bot';

// Store games globally
const games = {};

// ───────────────────────── helpers ─────────────────────────
const SYMBOLS = {
    'X': '❎', 'O': '⭕',
    '1': '1️⃣', '2': '2️⃣', '3': '3️⃣',
    '4': '4️⃣', '5': '5️⃣', '6': '6️⃣',
    '7': '7️⃣', '8': '8️⃣', '9': '9️⃣',
};

const renderBoard = (game) => {
    const arr = game.render().map(v => SYMBOLS[v] || v);
    return `${arr.slice(0, 3).join('')}\n${arr.slice(3, 6).join('')}\n${arr.slice(6).join('')}`;
};

const playerLabel = (jid) => jid === BOT_ID ? BOT_TAG : `@${jid.split('@')[0]}`;
const mentionsOf  = (...jids) => jids.filter(j => j && j !== BOT_ID);

/** Minimax: returns the best move index (0-8) for `botSym` on `boardArr`. */
function bestBotMove(boardArr, botSym, humanSym) {
    const board = boardArr.slice();
    const checkWin = (b) => {
        const lines = [
            [0,1,2],[3,4,5],[6,7,8],
            [0,3,6],[1,4,7],[2,5,8],
            [0,4,8],[2,4,6],
        ];
        for (const [a,b2,c] of lines) {
            if (b[a] && b[a] === b[b2] && b[a] === b[c]) return b[a];
        }
        return null;
    };
    const minimax = (b, isMax, depth) => {
        const w = checkWin(b);
        if (w === botSym)   return 10 - depth;
        if (w === humanSym) return depth - 10;
        if (b.every(c => c)) return 0;

        let best = isMax ? -Infinity : Infinity;
        for (let i = 0; i < 9; i++) {
            if (b[i]) continue;
            b[i] = isMax ? botSym : humanSym;
            const score = minimax(b, !isMax, depth + 1);
            b[i] = null;
            best = isMax ? Math.max(best, score) : Math.min(best, score);
        }
        return best;
    };

    let bestScore = -Infinity;
    let bestMove  = board.findIndex(c => !c);
    for (let i = 0; i < 9; i++) {
        if (board[i]) continue;
        board[i] = botSym;
        const score = minimax(board, false, 0);
        board[i] = null;
        if (score > bestScore) {
            bestScore = score;
            bestMove  = i;
        }
    }
    return bestMove;
}

// ───────────────────────── command ─────────────────────────
module.exports = {
    games, // exported for handler access
    name:        'tictactoe',
    aliases:     ['ttt', 'xo'],
    category:    'fun',
    description: 'Play Tic-Tac-Toe (vs another player or vs the bot)',
    usage:       '.ttt start | .ttt bot | .ttt cancel',

    async execute(sock, msg, args, extra) {
        try {
            const { sender, from, reply } = extra;
            const sub = (args[0] || '').toLowerCase();

            // No args → show usage
            if (!sub) {
                return reply(
                    `🎮 *Tic-Tac-Toe*\n` +
                    `━━━━━━━━━━━━━━━\n` +
                    `▢ \`.ttt start\`  – open a room (another player runs the same to join)\n` +
                    `▢ \`.ttt bot\`    – play against the bot\n` +
                    `▢ \`.ttt cancel\` – cancel your waiting/active game\n\n` +
                    `During a game: type *1-9* to move, or *surrender* to give up.`
                );
            }

            // Find any existing room this sender is in
            const existingRoom = Object.values(games).find(r =>
                r.id.startsWith('tictactoe') &&
                [r.game.playerX, r.game.playerO].includes(sender)
            );

            // ── cancel ────────────────────────────────────────────────
            if (sub === 'cancel') {
                if (!existingRoom) return reply('❌ You are not in any game.');
                delete games[existingRoom.id];
                return reply('🛑 Your tic-tac-toe game has been cancelled.');
            }

            if (existingRoom && existingRoom.state === 'PLAYING') {
                return reply('❌ You are still in a game. Type *surrender* to quit, or *.ttt cancel*.');
            }
            if (existingRoom && existingRoom.state === 'WAITING') {
                return reply('⏳ You already have a room waiting. Type *.ttt cancel* to drop it.');
            }

            // ── play vs bot ───────────────────────────────────────────
            if (sub === 'bot') {
                const room = {
                    id:       'tictactoe-' + Date.now(),
                    x:        from,
                    o:        from,        // same chat (vs bot)
                    botMode:  true,
                    game:     new TicTacToe(sender, BOT_ID), // human=X, bot=O
                    state:    'PLAYING',
                };
                games[room.id] = room;

                await sock.sendMessage(from, {
                    text:
                        `🎮 *Tic-Tac-Toe vs ${BOT_TAG}*\n\n` +
                        `${renderBoard(room.game)}\n\n` +
                        `▢ You: ❎  |  Bot: ⭕\n` +
                        `▢ Your move first — type *1-9*\n` +
                        `▢ Type *surrender* to give up`,
                    mentions: mentionsOf(sender),
                }, { quoted: msg });
                return;
            }

            // ── start / named room (multiplayer) ──────────────────────
            const roomName = sub === 'start' ? (args.slice(1).join(' ').trim() || '') : args.join(' ').trim();

            // Look for existing waiting room
            const waiting = Object.values(games).find(r =>
                r.state === 'WAITING' &&
                r.id.startsWith('tictactoe') &&
                !r.botMode &&
                (roomName ? r.name === roomName : !r.name)
            );

            if (waiting) {
                // Join existing room
                waiting.o = from;
                waiting.game.playerO = sender;
                waiting.state = 'PLAYING';

                const text =
                    `🎮 *Tic-Tac-Toe Started!*\n\n` +
                    `${renderBoard(waiting.game)}\n\n` +
                    `▢ ❎ ${playerLabel(waiting.game.playerX)}\n` +
                    `▢ ⭕ ${playerLabel(waiting.game.playerO)}\n\n` +
                    `🎲 Turn: ${playerLabel(waiting.game.currentTurn)}\n` +
                    `▢ Type *1-9* to play, *surrender* to give up.`;

                await sock.sendMessage(from, {
                    text,
                    mentions: mentionsOf(waiting.game.playerX, waiting.game.playerO),
                });
                return;
            }

            // Create new waiting room
            const room = {
                id:    'tictactoe-' + Date.now(),
                x:     from,
                o:     '',
                game:  new TicTacToe(sender, 'o'), // playerO will be set on join
                state: 'WAITING',
            };
            if (roomName) room.name = roomName;
            games[room.id] = room;

            await reply(
                `⏳ *Waiting for an opponent…*\n` +
                `Have someone type *.ttt start${roomName ? ' ' + roomName : ''}* to join.\n\n` +
                `Or type *.ttt cancel* to drop the room.`
            );
        } catch (error) {
            console.error('Error in tictactoe command:', error);
            await extra.reply('❌ Error starting game. Please try again.');
        }
    },
};

// ───────────────────────── move handler ─────────────────────────
async function handleTicTacToeMove(sock, msg, extra) {
    try {
        const { sender, from } = extra;
        const text = (msg.message?.conversation ||
                      msg.message?.extendedTextMessage?.text || '').trim();

        const room = Object.values(games).find(r =>
            r.id.startsWith('tictactoe') &&
            [r.game.playerX, r.game.playerO].includes(sender) &&
            r.state === 'PLAYING'
        );
        if (!room) return false;

        const isSurrender = /^(surrender|give up)$/i.test(text);
        if (!isSurrender && !/^[1-9]$/.test(text)) return false;

        // Surrender bypasses turn check
        if (sender !== room.game.currentTurn && !isSurrender) {
            await sock.sendMessage(from, { text: '❌ Not your turn!' });
            return true;
        }

        if (isSurrender) {
            const winner = sender === room.game.playerX ? room.game.playerO : room.game.playerX;
            await sock.sendMessage(from, {
                text: `🏳️ ${playerLabel(sender)} surrendered! ${playerLabel(winner)} wins!`,
                mentions: mentionsOf(sender, winner),
            });
            delete games[room.id];
            return true;
        }

        // Apply the human move
        const ok = room.game.turn(sender === room.game.playerO, parseInt(text) - 1);
        if (!ok) {
            await sock.sendMessage(from, { text: '❌ Invalid move! That position is already taken.' });
            return true;
        }

        // If bot mode and it's the bot's turn (and game not over), make the bot move
        if (room.botMode &&
            !room.game.winner &&
            room.game.turns < 9 &&
            room.game.currentTurn === BOT_ID) {
            const botSym   = 'O';
            const humanSym = 'X';
            const idx = bestBotMove(room.game.board, botSym, humanSym);
            room.game.turn(true, idx); // bot is playerO
        }

        await sendBoard(sock, room);

        if (room.game.winner || (room.game.turns === 9 && !room.game.winner)) {
            delete games[room.id];
        }
        return true;
    } catch (error) {
        console.error('Error in tictactoe move:', error);
        return false;
    }
}

async function sendBoard(sock, room) {
    const winner = room.game.winner;
    const isTie  = room.game.turns === 9 && !winner;

    let status;
    if (winner) {
        status = winner === BOT_ID
            ? `🤖 ${BOT_TAG} wins! Better luck next time.`
            : `🎉 ${playerLabel(winner)} wins the game!`;
    } else if (isTie) {
        status = `🤝 It's a draw!`;
    } else {
        const sym = room.game.currentTurn === room.game.playerX ? '❎' : '⭕';
        status = `🎲 Turn: ${playerLabel(room.game.currentTurn)} (${sym})`;
    }

    const text =
        `🎮 *Tic-Tac-Toe${room.botMode ? ' vs ' + BOT_TAG : ''}*\n\n` +
        `${status}\n\n` +
        `${renderBoard(room.game)}\n\n` +
        `▢ ❎ ${playerLabel(room.game.playerX)}\n` +
        `▢ ⭕ ${playerLabel(room.game.playerO)}` +
        (!winner && !isTie ? `\n\n• Type *1-9* to move\n• Type *surrender* to give up` : '');

    const mentions = mentionsOf(
        room.game.playerX,
        room.game.playerO,
        winner || room.game.currentTurn,
    );

    await sock.sendMessage(room.x, { text, mentions });
    if (!room.botMode && room.x !== room.o) {
        await sock.sendMessage(room.o, { text, mentions });
    }
}

module.exports.handleTicTacToeMove = handleTicTacToeMove;
