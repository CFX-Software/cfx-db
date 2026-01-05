import { SubscriptionManager } from "../core/SubscriptionManager";

/**
 * PlayerSyncManager - Simple cleanup on player disconnect
 *
 * Automatically cleans up subscriptions when players leave.
 */

export class PlayerSyncManager {
    private static instance: PlayerSyncManager;

    private constructor() {
        this.setupEventHandlers();
    }

    static getInstance(): PlayerSyncManager {
        if (!PlayerSyncManager.instance) {
            PlayerSyncManager.instance = new PlayerSyncManager();
        }
        return PlayerSyncManager.instance;
    }

    /**
     * Setup FiveM event handlers
     */
    private setupEventHandlers(): void {
        // Clean up on player disconnect
        on("playerDropped", (reason: string) => {
            const source = (global as any).source;
            this.onPlayerDisconnect(source);
        });
    }

    /**
     * Handle player disconnect
     */
    private onPlayerDisconnect(source: number | string): void {
        const playerId = this.getPlayerId(source);
        if (!playerId) return;

        const subManager = SubscriptionManager.getInstance();
        const cleaned = subManager.cleanupSubscriber(playerId);

        if (cleaned > 0) {
            console.log(`[cfx-db] Cleaned up ${cleaned} subscriptions for player ${playerId}`);
        }
    }

    /**
     * Get a player's primary identifier
     */
    getPlayerId(source: number | string): string | null {
        const identifiers = GetPlayerIdentifiers(source);
        if (!identifiers || identifiers.length === 0) return null;

        // Prefer license, fall back to first identifier
        const license = identifiers.find((id) => id.startsWith("license:"));
        return license || identifiers[0] || null;
    }

    /**
     * Get all identifiers for a player
     */
    getPlayerIdentifiers(source: number | string): string[] {
        return GetPlayerIdentifiers(source) || [];
    }
}
