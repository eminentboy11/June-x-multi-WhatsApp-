'use strict';

/**
 * Perform one race-safe pairing-code request inside an existing cycle.
 *
 * The generation is captured before any wait. Immediately before WhatsApp is
 * called, the active generation/socket are revalidated and one attempt slot is
 * reserved synchronously. The response is checked again before delivery, so a
 * connection, replacement socket, .delbot, repair, or restart invalidates it.
 */
async function requestPairingCodeForCycle(options = {}) {
    const {
        bot,
        socket,
        maxAttempts = 5,
        stabilizeMs = 0,
        delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        requestCode = (phone) => socket.requestPairingCode(phone),
        onCode = async () => {},
        onExhausted = async () => {},
    } = options;

    if (!bot || !socket) return { ok: false, reason: 'missing-state' };

    const generation = bot.getPairingGeneration();
    if (!bot.isPairingSocketCurrent(generation, socket)) {
        return { ok: false, reason: 'inactive-or-stale', generation };
    }

    if (stabilizeMs > 0) await delay(stabilizeMs);

    // Stale requests must be rejected before requestPairingCode is invoked.
    if (!bot.isPairingSocketCurrent(generation, socket)) {
        return { ok: false, reason: 'inactive-or-stale', generation };
    }

    // Atomic synchronous reservation. This is the authoritative pre-call cap.
    const reservation = bot.reservePairingAttempt(maxAttempts, socket, generation);
    if (!reservation.ok) return reservation;

    let code;
    try {
        code = await requestCode(bot._pairingPhone || bot.phone);
    } catch (error) {
        return {
            ok: false,
            reason: 'request-failed',
            error,
            attempt: reservation.attempt,
            generation,
        };
    }

    // A request that became stale while WhatsApp was responding may never be
    // delivered to the user or mutate terminal state.
    if (!bot.isPairingRequestCurrent(reservation, socket)) {
        return {
            ok: false,
            reason: 'stale-after-request',
            generated: true,
            delivered: false,
            attempt: reservation.attempt,
            generation,
        };
    }

    await onCode(code, reservation);

    // onCode can itself await chat delivery; re-check before parking the bot.
    if (!bot.isPairingRequestCurrent(reservation, socket)) {
        return {
            ok: false,
            reason: 'stale-after-delivery',
            generated: true,
            delivered: true,
            attempt: reservation.attempt,
            generation,
        };
    }

    if (reservation.attempt >= reservation.limit) {
        bot.pairingExhausted = true;
        bot.botState = 'needs-login';
        await onExhausted(reservation);
    }

    return {
        ok: true,
        code,
        attempt: reservation.attempt,
        limit: reservation.limit,
        generation,
        exhausted: bot.pairingExhausted,
    };
}

module.exports = { requestPairingCodeForCycle };
