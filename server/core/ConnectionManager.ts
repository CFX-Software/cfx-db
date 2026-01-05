import { ConvexHttpClient, ConvexClient } from "convex/browser";
import type { Config } from "../config";

/**
 * ConnectionManager - Manages Convex client connections with pooling
 *
 * Features:
 * - Pool of HTTP clients for parallel queries/mutations
 * - Single subscription client for real-time updates
 * - Health checks and automatic reconnection with exponential backoff
 * - Round-robin load balancing
 */
export class ConnectionManager {
    private static instance: ConnectionManager | null = null;

    private httpClientPool: ConvexHttpClient[] = [];
    private subscriptionClient: ConvexClient | null = null;
    private poolIndex: number = 0;
    private healthCheckTimer: number | null = null;
    private isHealthy: boolean = false;
    private isInitialized: boolean = false;
    private isDisposed: boolean = false;

    // Reconnection state
    private reconnectAttempts: number = 0;
    private readonly MAX_RECONNECT_ATTEMPTS = 10;
    private readonly BASE_RECONNECT_DELAY_MS = 1000;
    private readonly MAX_RECONNECT_DELAY_MS = 30000;
    private reconnectTimer: number | null = null;
    private isReconnecting: boolean = false;

    private constructor(private config: Config) {}

    static getInstance(config?: Config): ConnectionManager {
        if (!ConnectionManager.instance || ConnectionManager.instance.isDisposed) {
            if (!config) {
                throw new Error("Config required for first initialization");
            }
            ConnectionManager.instance = new ConnectionManager(config);
        }
        return ConnectionManager.instance;
    }

    /**
     * Check if instance exists and is initialized
     */
    static hasInstance(): boolean {
        return ConnectionManager.instance !== null && !ConnectionManager.instance.isDisposed;
    }

    /**
     * Reset the singleton instance (for clean restarts)
     */
    static resetInstance(): void {
        if (ConnectionManager.instance) {
            ConnectionManager.instance.dispose();
        }
        ConnectionManager.instance = null;
    }

    /**
     * Initialize all clients
     */
    async initialize(): Promise<void> {
        if (this.isInitialized && !this.isDisposed) {
            console.log("[cfx-db] Connection manager already initialized");
            return;
        }

        console.log(`[cfx-db] Initializing connection pool (size: ${this.config.connectionPoolSize})`);

        // Reset state
        this.isDisposed = false;
        this.reconnectAttempts = 0;
        this.isReconnecting = false;

        // Create HTTP client pool
        this.httpClientPool = [];
        for (let i = 0; i < this.config.connectionPoolSize; i++) {
            const client = new ConvexHttpClient(this.config.convexUrl);
            this.httpClientPool.push(client);
        }

        // Create subscription client
        this.subscriptionClient = new ConvexClient(this.config.convexUrl);

        // Start health checks
        this.startHealthChecks();

        // Initial health check with retry
        await this.performHealthCheckWithRetry();

        this.isInitialized = true;
        console.log("[cfx-db] Connection manager initialized");
    }

    /**
     * Get an HTTP client from the pool (round-robin)
     */
    getHttpClient(): ConvexHttpClient {
        if (this.isDisposed) {
            throw new Error("Connection manager has been disposed");
        }

        if (this.httpClientPool.length === 0) {
            throw new Error("Connection pool not initialized");
        }

        // Trigger reconnection if unhealthy
        if (!this.isHealthy && !this.isReconnecting) {
            this.scheduleReconnect();
        }

        const client = this.httpClientPool[this.poolIndex];
        this.poolIndex = (this.poolIndex + 1) % this.httpClientPool.length;
        return client;
    }

    /**
     * Get the subscription client
     */
    getSubscriptionClient(): ConvexClient {
        if (this.isDisposed) {
            throw new Error("Connection manager has been disposed");
        }

        if (!this.subscriptionClient) {
            throw new Error("Subscription client not initialized");
        }

        // Trigger reconnection if unhealthy
        if (!this.isHealthy && !this.isReconnecting) {
            this.scheduleReconnect();
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
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }
        this.healthCheckTimer = setInterval(() => {
            this.performHealthCheck().catch((err) => {
                console.error("[cfx-db] Health check error:", err);
            });
        }, this.config.healthCheckIntervalMs);
    }

    /**
     * Perform a health check with automatic reconnection on failure
     */
    private async performHealthCheck(): Promise<boolean> {
        if (this.isDisposed || this.httpClientPool.length === 0) {
            return false;
        }

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

            const wasUnhealthy = !this.isHealthy;
            this.isHealthy = true;
            this.reconnectAttempts = 0; // Reset on success
            this.isReconnecting = false;

            if (wasUnhealthy) {
                console.log("[cfx-db] ✓ Connection restored");
            }
            return true;
        } catch (error) {
            const wasHealthy = this.isHealthy;
            this.isHealthy = false;

            if (wasHealthy) {
                console.error("[cfx-db] ✗ Connection lost:", error);
            }

            // Trigger reconnection
            if (!this.isReconnecting) {
                this.scheduleReconnect();
            }
            return false;
        }
    }

    /**
     * Perform health check with retry (used during initialization)
     */
    private async performHealthCheckWithRetry(): Promise<void> {
        const maxInitialRetries = 5;
        const initialRetryDelay = 1000;

        for (let attempt = 1; attempt <= maxInitialRetries; attempt++) {
            const success = await this.performHealthCheck();
            if (success) {
                return;
            }

            if (attempt < maxInitialRetries) {
                console.log(`[cfx-db] Initial connection attempt ${attempt}/${maxInitialRetries} failed, retrying in ${initialRetryDelay}ms...`);
                await new Promise(resolve => setTimeout(resolve, initialRetryDelay));
            }
        }

        console.warn("[cfx-db] Initial health check failed, will continue with reconnection attempts");
    }

    /**
     * Schedule a reconnection attempt with exponential backoff
     */
    private scheduleReconnect(): void {
        if (this.isDisposed || this.isReconnecting) {
            return;
        }

        if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
            console.error(`[cfx-db] Max reconnection attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached. Manual intervention required.`);
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;

        // Calculate exponential backoff delay
        const delay = Math.min(
            this.BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
            this.MAX_RECONNECT_DELAY_MS
        );

        console.log(`[cfx-db] Scheduling reconnection attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} in ${delay}ms...`);

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        this.reconnectTimer = setTimeout(() => {
            this.reconnect();
        }, delay) as any;
    }

    /**
     * Attempt to reconnect by recreating clients
     */
    private async reconnect(): Promise<void> {
        if (this.isDisposed) {
            return;
        }

        console.log(`[cfx-db] Attempting reconnection (attempt ${this.reconnectAttempts})...`);

        try {
            // Close existing subscription client
            if (this.subscriptionClient) {
                try {
                    this.subscriptionClient.close();
                } catch (e) {
                    // Ignore close errors
                }
            }

            // Recreate HTTP client pool
            this.httpClientPool = [];
            for (let i = 0; i < this.config.connectionPoolSize; i++) {
                const client = new ConvexHttpClient(this.config.convexUrl);
                this.httpClientPool.push(client);
            }

            // Recreate subscription client
            this.subscriptionClient = new ConvexClient(this.config.convexUrl);

            // Test the connection
            const success = await this.performHealthCheck();

            if (success) {
                console.log("[cfx-db] ✓ Reconnection successful");
                this.isReconnecting = false;
                this.reconnectAttempts = 0;

                // Emit reconnection event
                emit("cfxdb:reconnected");
            } else {
                // Schedule another attempt
                this.isReconnecting = false;
                this.scheduleReconnect();
            }
        } catch (error) {
            console.error("[cfx-db] Reconnection failed:", error);
            this.isReconnecting = false;
            this.scheduleReconnect();
        }
    }

    /**
     * Force an immediate reconnection attempt
     */
    forceReconnect(): void {
        console.log("[cfx-db] Force reconnection requested");
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.isHealthy = false;

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.reconnect();
    }

    /**
     * Get health status
     */
    getHealthStatus(): {
        healthy: boolean;
        poolSize: number;
        initialized: boolean;
        reconnecting: boolean;
        reconnectAttempts: number;
    } {
        return {
            healthy: this.isHealthy,
            poolSize: this.httpClientPool.length,
            initialized: this.isInitialized,
            reconnecting: this.isReconnecting,
            reconnectAttempts: this.reconnectAttempts,
        };
    }

    /**
     * Check if connection is ready for operations
     */
    isReady(): boolean {
        return this.isInitialized && !this.isDisposed && this.httpClientPool.length > 0;
    }

    /**
     * Cleanup and dispose
     */
    dispose(): void {
        if (this.isDisposed) {
            return;
        }

        this.isDisposed = true;
        this.isInitialized = false;

        // Clear timers
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        // Close subscription client
        if (this.subscriptionClient) {
            try {
                this.subscriptionClient.close();
            } catch (e) {
                // Ignore close errors
            }
            this.subscriptionClient = null;
        }

        // Clear pool
        this.httpClientPool = [];
        this.isHealthy = false;
        this.isReconnecting = false;
        this.poolIndex = 0;

        console.log("[cfx-db] Connection manager disposed");
    }
}
