/**
 * Configuration loader for cfx-db
 */

export interface Config {
    // Convex
    convexUrl: string;
    convexDeployKey?: string;

    // Convex Plan (affects concurrency limits)
    // "free" = 16 concurrent queries/mutations
    // "professional" = 256 concurrent queries/mutations
    convexPlan: "free" | "professional";

    // JWT
    jwtSecret: string;
    jwtIssuer: string;
    jwtExpirySeconds: number;

    // Connection Pool
    connectionPoolSize: number;
    connectionTimeoutMs: number;
    healthCheckIntervalMs: number;

    // Cache
    cacheMaxMemoryMB: number;
    cacheDefaultTTL: number;

    // Batch Writer
    batchMaxSize: number;
    batchFlushIntervalMs: number;

    // Sync
    syncThrottleDefaultMs: number;
    syncStatebagPrefix: string;

    // Logging
    logLevel: "debug" | "info" | "warn" | "error";
    logStructured: boolean;
    logPerformanceMetrics: boolean;

    // Server
    fivemServerId: string;
}

/**
 * Load configuration from environment variables with defaults
 */
export function loadConfig(): Config {
    const getEnv = (key: string, defaultValue: string = ""): string => {
        // Priority: 1. process.env (from .env file), 2. FiveM convars, 3. default
        if (process.env[key]) {
            return process.env[key]!;
        }
        const convarValue = GetConvar(key, "");
        if (convarValue) {
            return convarValue;
        }
        return defaultValue;
    };

    const getEnvInt = (key: string, defaultValue: number): number => {
        const value = getEnv(key, "");
        return value ? parseInt(value, 10) : defaultValue;
    };

    return {
        // Convex
        convexUrl: getEnv("CONVEX_URL"),
        convexDeployKey: getEnv("CONVEX_DEPLOY_KEY"),

        // Convex Plan - affects concurrency limits
        // Set CONVEX_PLAN=professional for higher limits
        convexPlan: (getEnv("CONVEX_PLAN", "free") as "free" | "professional"),

        // JWT
        jwtSecret: getEnv("JWT_SECRET", "change-me-in-production"),
        jwtIssuer: getEnv("JWT_ISSUER", "cfx-db"),
        jwtExpirySeconds: getEnvInt("JWT_EXPIRY_SECONDS", 3600),

        // Connection Pool
        connectionPoolSize: getEnvInt("CONNECTION_POOL_SIZE", 5),
        connectionTimeoutMs: getEnvInt("CONNECTION_TIMEOUT_MS", 5000),
        healthCheckIntervalMs: getEnvInt("HEALTH_CHECK_INTERVAL_MS", 30000),

        // Cache
        cacheMaxMemoryMB: getEnvInt("CACHE_MAX_MEMORY_MB", 256),
        cacheDefaultTTL: getEnvInt("CACHE_DEFAULT_TTL_MS", 30000),

        // Batch Writer
        batchMaxSize: getEnvInt("BATCH_MAX_SIZE", 50),
        batchFlushIntervalMs: getEnvInt("BATCH_FLUSH_INTERVAL_MS", 50),

        // Sync
        syncThrottleDefaultMs: getEnvInt("SYNC_THROTTLE_DEFAULT_MS", 100),
        syncStatebagPrefix: getEnv("SYNC_STATEBAG_PREFIX", "cfxdb"),

        // Logging
        logLevel: (getEnv("LOG_LEVEL", "info") as "debug" | "info" | "warn" | "error") || "info",
        logStructured: getEnv("LOG_STRUCTURED", "false") === "true",
        logPerformanceMetrics:
            getEnv("LOG_PERFORMANCE_METRICS", "true") === "true",

        // Server
        fivemServerId: getEnv("FIVEM_SERVER_ID", GetCurrentResourceName()),
    };
}

/**
 * Validate configuration
 */
export function validateConfig(config: Config): void {
    if (!config.convexUrl) {
        throw new Error(
            "CONVEX_URL is required. Set it in your .env file or server.cfg"
        );
    }

    if (config.jwtSecret === "change-me-in-production") {
        console.warn(
            "[cfx-db] WARNING: Using default JWT secret. Set JWT_SECRET in production!"
        );
    }

    if (config.jwtSecret.length < 32) {
        throw new Error("JWT_SECRET must be at least 32 characters long");
    }
}
