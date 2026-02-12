import { ConvexHttpClient, ConvexClient } from "convex/browser";
import type { AuthTokenFetcher } from "convex/browser";
import type { Config } from "../config";
import { Logger, ScopedLogger } from "../utils/Logger";

const HEALTHCHECK_FUNCTION = "functions/system:ping" as any;

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
    private hasConnectedOnce: boolean = false;
    private isInitialized: boolean = false;
    private isDisposed: boolean = false;

    // Reconnection state
    private reconnectAttempts: number = 0;
    private readonly MAX_RECONNECT_ATTEMPTS = 10;
    private readonly BASE_RECONNECT_DELAY_MS = 1000;
    private readonly MAX_RECONNECT_DELAY_MS = 30000;
    private reconnectTimer: number | null = null;
    private isReconnecting: boolean = false;
    private authToken: string | null = null;

    // Logger for connection-related messages
    private log: ScopedLogger;

    private constructor(private config: Config) {
        this.log = Logger.getInstance().scoped("connection");
    }

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
     * Get effective pool size respecting plan limits.
     */
    private getEffectivePoolSize(): number {
        const maxPoolSize = this.config.convexPlan === "professional" ? 20 : 5;
        return Math.min(this.config.connectionPoolSize, maxPoolSize);
    }

    /**
     * Initialize all clients with connection warmup
     *
     * IMPORTANT: Convex has concurrent function limits:
     * - Free/Starter: 16 concurrent queries, 16 concurrent mutations
     * - Professional: 256 concurrent queries, 256 concurrent mutations
     *
     * Keep pool size conservative to avoid hitting these limits.
     * Default: 5 (safe for Free tier with headroom)
     */
    async initialize(): Promise<void> {
        if (this.isInitialized && !this.isDisposed) {
            this.log.debug("Connection manager already initialized");
            return;
        }

        // Pool size based on Convex plan limits:
        // - Free/Starter: 16 concurrent queries/mutations → pool of 5
        // - Professional: 256 concurrent → pool of 20
        const poolSize = this.getEffectivePoolSize();
        this.log.debug("Initializing connection pool", { poolSize, plan: this.config.convexPlan });

        // Reset state
        this.isDisposed = false;
        this.reconnectAttempts = 0;
        this.isReconnecting = false;
        this.hasConnectedOnce = false;

        // Create HTTP client pool
        this.httpClientPool = [];
        for (let i = 0; i < poolSize; i++) {
            const client = new ConvexHttpClient(this.config.convexUrl);
            if (this.authToken) {
                client.setAuth(this.authToken);
            }
            this.httpClientPool.push(client);
        }

        // Create subscription client
        this.subscriptionClient = new ConvexClient(this.config.convexUrl);
        if (this.authToken) {
            const fetchToken: AuthTokenFetcher = async () => this.authToken;
            this.subscriptionClient.setAuth(fetchToken);
        }

        // Start health checks
        this.startHealthChecks();

        // Initial health check with retry
        await this.performHealthCheckWithRetry();

        // Warm up connections by making parallel lightweight requests
        await this.warmupConnections();

        this.isInitialized = true;
        this.log.debug("Connection pool ready", { poolSize });
    }

    /**
     * Warm up all connections in the pool
     * This establishes HTTP connections ahead of time to reduce first-request latency
     */
    private async warmupConnections(): Promise<void> {
        this.log.debug("Warming up connections...");
        const warmupStart = Date.now();

        try {
            // Make parallel lightweight requests on all clients to establish connections
            await Promise.allSettled(
                this.httpClientPool.map(async (client, index) => {
                    try {
                        // Use a very lightweight query that returns minimal data
                        await Promise.race([
                            client.query(HEALTHCHECK_FUNCTION, {}),
                            new Promise((_, reject) =>
                                setTimeout(() => reject(new Error("Warmup timeout")), 3000)
                            ),
                        ]);
                    } catch (e) {
                        // Warmup failures are non-fatal
                    }
                })
            );

            const warmupTime = Date.now() - warmupStart;
            this.log.debug("Connection warmup completed", { warmupTimeMs: warmupTime });
        } catch (error) {
            this.log.warn("Connection warmup partially failed (non-fatal)");
        }
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
        if (!client) {
            throw new Error("Connection pool index out of bounds");
        }
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
        this.authToken = token;
        for (const client of this.httpClientPool) {
            client.setAuth(token);
        }
        if (this.subscriptionClient) {
            const fetchToken: AuthTokenFetcher = async () => token;
            this.subscriptionClient.setAuth(fetchToken);
        }
    }

    /**
     * Clear auth for all clients
     */
    clearAuth(): void {
        this.authToken = null;
        for (const client of this.httpClientPool) {
            client.clearAuth();
        }
        if (this.subscriptionClient) {
            const fetchToken: AuthTokenFetcher = async () => null;
            this.subscriptionClient.setAuth(fetchToken);
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
                this.log.error("Health check error", { error: String(err) });
            });
        }, this.config.healthCheckIntervalMs);
    }

    /**
     * Perform a health check with automatic reconnection on failure
     */
    private async performHealthCheck(): Promise<boolean> {
        if (this.isDisposed || this.httpClientPool.length === 0) {
            this.log.debug("Health check skipped: disposed or no pool");
            return false;
        }

        try {
            // Simple ping using the first HTTP client
            const client = this.httpClientPool[0];
            if (!client) {
                this.log.debug("Health check skipped: no HTTP client available");
                return false;
            }
            this.log.debug("Performing health check...");

            // Try a lightweight operation
            const result = await Promise.race([
                client.query(HEALTHCHECK_FUNCTION, {}),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Health check timeout after 5s")), 5000)
                ),
            ]);

            this.log.debug("Health check passed");

            const wasUnhealthy = !this.isHealthy;
            this.isHealthy = true;
            this.reconnectAttempts = 0; // Reset on success
            this.isReconnecting = false;

            if (!this.hasConnectedOnce) {
                this.hasConnectedOnce = true;
                this.log.info("Connected to Convex");
            } else if (wasUnhealthy) {
                this.log.info("Connection restored");
            }
            return true;
        } catch (error) {
            const wasHealthy = this.isHealthy;
            this.isHealthy = false;

            const errorMessage = error instanceof Error ? error.message : String(error);

            // Log failure - WARN for first failure, ERROR for subsequent
            if (wasHealthy) {
                this.log.warn("Health check failed - connection may be lost", { error: errorMessage });
            } else {
                this.log.debug("Health check still failing", { error: errorMessage });
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
                this.log.debug("Initial connection attempt failed, retrying", {
                    attempt,
                    maxAttempts: maxInitialRetries,
                    retryDelayMs: initialRetryDelay,
                });
                await new Promise(resolve => setTimeout(resolve, initialRetryDelay));
            }
        }

        this.log.warn("Initial health check failed, will continue with background reconnection");
    }

    /**
     * Schedule a reconnection attempt with exponential backoff
     */
    private scheduleReconnect(): void {
        if (this.isDisposed || this.isReconnecting) {
            return;
        }

        if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
            this.log.error("Max reconnection attempts reached - manual intervention required", {
                maxAttempts: this.MAX_RECONNECT_ATTEMPTS,
            });
            return;
        }

        this.isReconnecting = true;
        this.reconnectAttempts++;

        // Calculate exponential backoff delay
        const delay = Math.min(
            this.BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts - 1),
            this.MAX_RECONNECT_DELAY_MS
        );

        this.log.debug("Scheduling reconnection", {
            attempt: this.reconnectAttempts,
            maxAttempts: this.MAX_RECONNECT_ATTEMPTS,
            delayMs: delay,
        });

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

        this.log.debug("Attempting reconnection", { attempt: this.reconnectAttempts });

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
            const poolSize = this.getEffectivePoolSize();
            this.httpClientPool = [];
            for (let i = 0; i < poolSize; i++) {
                const client = new ConvexHttpClient(this.config.convexUrl);
                if (this.authToken) {
                    client.setAuth(this.authToken);
                }
                this.httpClientPool.push(client);
            }

            // Recreate subscription client
            this.subscriptionClient = new ConvexClient(this.config.convexUrl);
            if (this.authToken) {
                const fetchToken: AuthTokenFetcher = async () => this.authToken;
                this.subscriptionClient.setAuth(fetchToken);
            }

            // Test the connection
            const success = await this.performHealthCheck();

            if (success) {
                this.log.info("Reconnection successful");
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
            this.log.warn("Reconnection attempt failed", { error: String(error) });
            this.isReconnecting = false;
            this.scheduleReconnect();
        }
    }

    /**
     * Force an immediate reconnection attempt
     */
    forceReconnect(): void {
        this.log.info("Force reconnection requested");
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
        this.hasConnectedOnce = false;
        this.isReconnecting = false;
        this.poolIndex = 0;

        this.log.debug("Connection manager disposed");
    }
}
