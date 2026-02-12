import { SubscriptionManager } from "../core/SubscriptionManager";
import { getPlayerIdentifiersSafe } from "../utils/PlayerIdentifiers";

/**
 * PlayerSyncManager - Simple cleanup on player disconnect
 *
 * Automatically cleans up subscriptions when players leave.
 */

export class PlayerSyncManager {
    private static instance: PlayerSyncManager;
    private sourceToPlayerId: Map<number, string> = new Map();

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
        // Cache identifiers early while they are still available.
        on("playerConnecting", () => {
            const source = Number((global as any).source);
            this.cachePlayerId(source);
        });

        on("playerJoining", () => {
            const source = Number((global as any).source);
            this.cachePlayerId(source);
        });

        // Clean up on player disconnect
        on("playerDropped", () => {
            const source = Number((global as any).source);
            this.onPlayerDisconnect(source);
        });
    }

    /**
     * Cache a player's primary identifier by source.
     */
    private cachePlayerId(source: number): void {
        if (!Number.isFinite(source) || source <= 0) return;
        const playerId = this.getPlayerId(source);
        if (playerId) {
            this.sourceToPlayerId.set(source, playerId);
        }
    }

    /**
     * Handle player disconnect
     */
    private onPlayerDisconnect(source: number): void {
        const subManager = SubscriptionManager.getInstance();
        let cleaned = 0;

        // Always clean up source-scoped subscribers.
        cleaned += subManager.cleanupSubscriber(`src:${source}`);

        // Prefer cached identifier because GetPlayerIdentifiers can be empty on playerDropped.
        const playerId = this.sourceToPlayerId.get(source) || this.getPlayerId(source);
        if (playerId) {
            cleaned += subManager.cleanupSubscriber(playerId);
        }

        this.sourceToPlayerId.delete(source);

        if (cleaned > 0) {
            console.log(`[cfx-db] Cleaned up ${cleaned} subscriptions for source ${source}`);
        }
    }

    /**
     * Get a player's primary identifier
     */
    getPlayerId(source: number | string): string | null {
        const identifiers = getPlayerIdentifiersSafe(source);
        if (!identifiers || identifiers.length === 0) return null;

        // Prefer license, fall back to first identifier
        const license = identifiers.find((id) => id.startsWith("license:"));
        return license || identifiers[0] || null;
    }

    /**
     * Get all identifiers for a player
     */
    getPlayerIdentifiers(source: number | string): string[] {
        return getPlayerIdentifiersSafe(source);
    }
}
