/**
 * EventBridge - Simple helper for pushing data to FiveM clients
 *
 * Optional utility - use only if you want to sync data to clients.
 * Most data should stay server-side.
 */

/**
 * Push data to specific players via TriggerClientEvent
 */
export function sendToPlayers(
    eventName: string,
    data: any,
    players: number[] | "all"
): void {
    if (players === "all") {
        TriggerClientEvent(eventName, -1, data);
    } else {
        for (const playerId of players) {
            TriggerClientEvent(eventName, playerId, data);
        }
    }
}

/**
 * Set global state (all clients can read)
 */
export function setGlobalState(key: string, value: any): void {
    GlobalState[key] = value;
}

/**
 * Set player state (specific player can read)
 */
export function setPlayerState(playerId: number, key: string, value: any): void {
    const player = Player(playerId);
    if (player && player.state) {
        player.state.set(key, value, true);
    }
}

// Export helpers if users want them
if (typeof global.exports !== "undefined") {
    global.exports("sendToPlayers", sendToPlayers);
    global.exports("setGlobalState", setGlobalState);
    global.exports("setPlayerState", setPlayerState);
}
