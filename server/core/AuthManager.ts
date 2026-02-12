import jwt from "jsonwebtoken";
import type { Config } from "../config";
import { getPlayerIdentifiersSafe } from "../utils/PlayerIdentifiers";

/**
 * AuthManager - Manages per-player JWT authentication
 *
 * Features:
 * - Generate JWTs for players
 * - Token refresh management
 * - Automatic cleanup on disconnect
 */

interface PlayerAuthContext {
    playerId: string;
    identifiers: string[];
    token: string;
    expiresAt: number;
}

interface JWTPayload {
    sub: string; // Primary identifier
    iss: string; // Issuer
    aud: string; // Convex deployment URL
    iat: number; // Issued at
    exp: number; // Expires at
    fivem: {
        identifiers: string[];
        serverId: string;
    };
}

export class AuthManager {
    private static instance: AuthManager;
    private playerTokens: Map<string, PlayerAuthContext> = new Map();
    private sourceToPlayerId: Map<number, string> = new Map();

    private constructor(private config: Config) {
        this.setupEventHandlers();
    }

    static getInstance(config?: Config): AuthManager {
        if (!AuthManager.instance) {
            if (!config) {
                throw new Error("Config required for first initialization");
            }
            AuthManager.instance = new AuthManager(config);
        }
        return AuthManager.instance;
    }

    /**
     * Setup FiveM event handlers
     */
    private setupEventHandlers(): void {
        on("playerConnecting", () => {
            const source = Number((global as any).source);
            this.cachePlayerId(source);
        });

        on("playerJoining", () => {
            const source = Number((global as any).source);
            this.cachePlayerId(source);
        });

        on("playerDropped", () => {
            const source = Number((global as any).source);
            const cachedId = this.sourceToPlayerId.get(source);
            const identifiers = getPlayerIdentifiersSafe(source);
            const liveId =
                identifiers && identifiers.length > 0
                    ? this.getPrimaryIdentifier(identifiers)
                    : null;

            const playerId = cachedId || liveId;
            if (playerId) {
                this.revokePlayer(playerId);
            }

            if (Number.isFinite(source) && source > 0) {
                this.sourceToPlayerId.delete(source);
            }
        });
    }

    /**
     * Cache player identifier while still connected.
     */
    private cachePlayerId(source: number): void {
        if (!Number.isFinite(source) || source <= 0) return;
        const identifiers = getPlayerIdentifiersSafe(source);
        if (!identifiers || identifiers.length === 0) return;
        this.sourceToPlayerId.set(source, this.getPrimaryIdentifier(identifiers));
    }

    /**
     * Generate a JWT token for a player
     */
    async generateToken(identifiers: string[]): Promise<string> {
        if (!identifiers || identifiers.length === 0) {
            throw new Error("No identifiers provided");
        }

        const primaryId = this.getPrimaryIdentifier(identifiers);
        const now = Math.floor(Date.now() / 1000);
        const exp = now + this.config.jwtExpirySeconds;

        const payload: JWTPayload = {
            sub: primaryId,
            iss: this.config.jwtIssuer,
            aud: this.config.convexUrl,
            iat: now,
            exp,
            fivem: {
                identifiers,
                serverId: this.config.fivemServerId,
            },
        };

        const token = jwt.sign(payload, this.config.jwtSecret, {
            algorithm: "HS256",
        });

        // Store token context
        this.playerTokens.set(primaryId, {
            playerId: primaryId,
            identifiers,
            token,
            expiresAt: exp * 1000,
        });

        return token;
    }

    /**
     * Get token for a player (refresh if needed)
     */
    async getPlayerToken(identifiers: string[]): Promise<string> {
        const primaryId = this.getPrimaryIdentifier(identifiers);
        const existing = this.playerTokens.get(primaryId);

        // Check if token exists and is valid
        if (existing && Date.now() < existing.expiresAt - 60000) {
            // 1 min buffer
            return existing.token;
        }

        // Generate new token
        return this.generateToken(identifiers);
    }

    /**
     * Revoke a player's token
     */
    revokePlayer(playerId: string): void {
        this.playerTokens.delete(playerId);
    }

    /**
     * Get primary identifier (prefer license, then steam, then first)
     */
    private getPrimaryIdentifier(identifiers: string[]): string {
        const license = identifiers.find((id) => id.startsWith("license:"));
        if (license) return license;

        const steam = identifiers.find((id) => id.startsWith("steam:"));
        if (steam) return steam;

        return identifiers[0]!;
    }

    /**
     * Validate a token (for internal use)
     */
    validateToken(token: string): JWTPayload | null {
        try {
            return jwt.verify(token, this.config.jwtSecret) as JWTPayload;
        } catch {
            return null;
        }
    }

    /**
     * Get statistics
     */
    getStats(): { activeSessions: number } {
        return {
            activeSessions: this.playerTokens.size,
        };
    }

    /**
     * Cleanup and dispose
     */
    dispose(): void {
        this.playerTokens.clear();
        this.sourceToPlayerId.clear();
    }
}
