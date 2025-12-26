import { ConvexHttpClient, ConvexClient } from "convex/browser";
import type { Config } from "../config";

/**
 * ConnectionManager - Manages Convex client connections with pooling
 *
 * Features:
 * - Pool of HTTP clients for parallel queries/mutations
 * - Single subscription client for real-time updates
 * - Health checks and automatic reconnection
 * - Round-robin load balancing
 */
export class ConnectionManager {
    private static instance: ConnectionManager;

    private httpClientPool: ConvexHttpClient[] = [];
    private subscriptionClient: ConvexClient | null = null;
    private poolIndex: number = 0;
    private healthCheckTimer: number | null = null;
    private isHealthy: boolean = false;

    private constructor(private config: Config) {}

    static getInstance(config?: Config): ConnectionManager {
        if (!ConnectionManager.instance) {
            if (!config) {
                throw new Error("Config required for first initialization");
            }
            ConnectionManager.instance = new ConnectionManager(config);
        }
        return ConnectionManager.instance;
    }

    /**
     * Initialize all clients
     */
    async initialize(): Promise<void> {
        console.log(`[cfx-db] Initializing connection pool (size: ${this.config.connectionPoolSize})`);

        // Create HTTP client pool
        for (let i = 0; i < this.config.connectionPoolSize; i++) {
            const client = new ConvexHttpClient(this.config.convexUrl);
            this.httpClientPool.push(client);
        }

        // Create subscription client
        this.subscriptionClient = new ConvexClient(this.config.convexUrl);

        // Start health checks
        this.startHealthChecks();

        // Initial health check
        await this.performHealthCheck();

        console.log("[cfx-db] Connection manager initialized");
    }

    /**
     * Get an HTTP client from the pool (round-robin)
     */
    getHttpClient(): ConvexHttpClient {
        if (this.httpClientPool.length === 0) {
            throw new Error("Connection pool not initialized");
        }

        const client = this.httpClientPool[this.poolIndex];
        this.poolIndex = (this.poolIndex + 1) % this.httpClientPool.length;
        return client;
    }

    /**
     * Get the subscription client
     */
    getSubscriptionClient(): ConvexClient {
        if (!this.subscriptionClient) {
            throw new Error("Subscription client not initialized");
        }
        return this.subscriptionClient;
    }

    /**
     * Set auth token for all clients
     */
    setGlobalAuth(token: string): void {
        for (const client of this.httpClientPool) {
            client.setAuth(token);
        }
        if (this.subscriptionClient) {
            this.subscriptionClient.setAuth(token);
        }
    }

    /**
     * Clear auth for all clients
     */
    clearAuth(): void {
        for (const client of this.httpClientPool) {
            client.clearAuth();
        }
        if (this.subscriptionClient) {
            this.subscriptionClient.clearAuth();
        }
    }

    /**
     * Start periodic health checks
     */
    private startHealthChecks(): void {
        this.healthCheckTimer = setInterval(() => {
            this.performHealthCheck().catch((err) => {
                console.error("[cfx-db] Health check failed:", err);
            });
        }, this.config.healthCheckIntervalMs);
    }

    /**
     * Perform a health check
     */
    private async performHealthCheck(): Promise<void> {
        try {
            // Simple ping using the first HTTP client
            const client = this.httpClientPool[0];
            // Try a lightweight operation
            await Promise.race([
                client.query("functions/generic:getAll" as any, { table: "keyValue", limit: 1 }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Health check timeout")), 5000)
                ),
            ]);

            if (!this.isHealthy) {
                console.log("[cfx-db] Connection healthy");
                this.isHealthy = true;
            }
        } catch (error) {
            console.error("[cfx-db] Health check failed:", error);
            this.isHealthy = false;
        }
    }

    /**
     * Get health status
     */
    getHealthStatus(): { healthy: boolean; poolSize: number } {
        return {
            healthy: this.isHealthy,
            poolSize: this.httpClientPool.length,
        };
    }

    /**
     * Cleanup and dispose
     */
    dispose(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }

        if (this.subscriptionClient) {
            this.subscriptionClient.close();
            this.subscriptionClient = null;
        }

        this.httpClientPool = [];
        this.isHealthy = false;

        console.log("[cfx-db] Connection manager disposed");
    }
}
