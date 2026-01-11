/**
 * CFX-DB Main Entry Point
 *
 * Simple, focused framework for using Convex with FiveM.
 */

import { config as loadDotenv } from "dotenv";
import { resolve } from "path";
import { loadConfig, validateConfig } from "./config";
import { ConnectionManager } from "./core/ConnectionManager";
import { CacheManager } from "./core/CacheManager";
import { BatchWriter } from "./core/BatchWriter";
import { SubscriptionManager } from "./core/SubscriptionManager";
import { AuthManager } from "./core/AuthManager";
import { PlayerSyncManager } from "./sync/PlayerSyncManager";
import { WebhookManager } from "./core/WebhookManager";
import { QueryCache } from "./core/QueryCache";

// Import API exports (registers FiveM exports)
import "./api/exports";
import "./api/lua-bridge";
import "./core/EventBridge"; // Optional helpers

/**
 * Initialize cfx-db framework
 */
async function initialize() {
    // Load .env file first (FiveM globals are available now)
    try {
        const resourcePath = GetResourcePath(GetCurrentResourceName());
        const envPath = resolve(resourcePath, ".env");
        const result = loadDotenv({ path: envPath });

        // Manually assign to process.env (IIFE scope isolation workaround)
        if (result.parsed) {
            Object.assign(process.env, result.parsed);
            console.log(`[cfx-db] Loaded ${Object.keys(result.parsed).length} env variables from .env`);
        } else if (result.error) {
            console.log(`[cfx-db] .env not found, using convars/defaults`);
        }
    } catch (error) {
        console.log(`[cfx-db] .env loading failed:`, error);
    }

    console.log("=".repeat(50));
    console.log("CFX-DB - Convex Database for FiveM");
    console.log("=".repeat(50));

    try {
        // Clean up any existing instances (handles 'refresh' case)
        // Use hasInstance() to avoid creating new instances just to dispose them
        console.log("[cfx-db] Cleaning up existing instances...");

        if (SubscriptionManager.hasInstance()) {
            SubscriptionManager.resetInstance();
        }

        if (BatchWriter.hasInstance()) {
            // Flush pending writes before disposing
            try {
                await BatchWriter.getInstance().flushAll();
            } catch (e) {
                console.warn("[cfx-db] Warning: Could not flush pending writes:", e);
            }
            BatchWriter.resetInstance();
        }

        if (ConnectionManager.hasInstance()) {
            ConnectionManager.resetInstance();
        }

        // Small delay to ensure all cleanup is complete
        await new Promise(resolve => setTimeout(resolve, 100));

        // Load and validate configuration
        const config = loadConfig();
        validateConfig(config);

        console.log(`[cfx-db] Connecting to Convex: ${config.convexUrl}`);

        // Initialize core components
        ConnectionManager.getInstance(config);
        await ConnectionManager.getInstance().initialize();

        CacheManager.getInstance(config.cacheMaxMemoryMB, config.cacheDefaultTTL);
        BatchWriter.getInstance(config);
        SubscriptionManager.getInstance();
        AuthManager.getInstance(config);
        PlayerSyncManager.getInstance();

        // Initialize webhooks from Lua config
        try {
            // @ts-ignore - FiveM global
            const luaConfig = global.Config || {};
            if (luaConfig.Webhooks && Array.isArray(luaConfig.Webhooks)) {
                WebhookManager.getInstance().configure(luaConfig.Webhooks);
                console.log(`[cfx-db] ✓ Configured ${luaConfig.Webhooks.length} webhooks`);
            }

            // Configure query cache from Lua config
            if (luaConfig.Cache) {
                QueryCache.getInstance().configure(luaConfig.Cache);
                console.log(`[cfx-db] ✓ Configured query cache (TTL: ${luaConfig.Cache.defaultTTL}ms)`);
            }
        } catch (error) {
            console.log("[cfx-db] Note: No webhook/cache configuration found in shared/config.lua");
        }

        console.log("[cfx-db] ✓ All components initialized");

        // Start periodic cache cleanup
        setInterval(() => {
            const removed = CacheManager.getInstance().cleanup();
            if (removed > 0) {
                console.log(`[cfx-db] Cleaned up ${removed} expired cache entries`);
            }
        }, 60000); // Every minute

        // Log stats periodically if enabled
        if (config.logPerformanceMetrics) {
            setInterval(() => {
                const stats = {
                    connection: ConnectionManager.getInstance().getHealthStatus(),
                    cache: CacheManager.getInstance().getStats(),
                    subscriptions: SubscriptionManager.getInstance().getStats(),
                    batchWriter: BatchWriter.getInstance().getStats(),
                };

                console.log("[cfx-db] Stats:", JSON.stringify(stats, null, 2));
            }, 300000); // Every 5 minutes
        }

        console.log("=".repeat(50));
        console.log("[cfx-db] ✓ Ready! Use query(), mutation(), subscribe()");
        console.log("=".repeat(50));

        // Emit ready event
        emit("cfxdb:ready");
    } catch (error) {
        console.error("[cfx-db] ✗ Initialization failed:", error);
        console.error("[cfx-db] Check your .env and Convex deployment");
        throw error;
    }
}

/**
 * Cleanup on resource stop
 * NOTE: FiveM doesn't wait for async operations on resource stop,
 * so this must be synchronous. Flush is best-effort.
 */
function cleanup() {
    console.log("[cfx-db] Shutting down...");

    try {
        // Attempt to flush pending writes (best-effort, won't block)
        if (BatchWriter.hasInstance()) {
            BatchWriter.getInstance().flushAll()
                .then(() => console.log("[cfx-db] ✓ Flushed pending writes"))
                .catch((err) => console.error("[cfx-db] Error flushing writes:", err));
        }

        // Dispose components synchronously using resetInstance
        if (SubscriptionManager.hasInstance()) {
            SubscriptionManager.resetInstance();
        }

        if (BatchWriter.hasInstance()) {
            BatchWriter.resetInstance();
        }

        if (ConnectionManager.hasInstance()) {
            ConnectionManager.resetInstance();
        }

        // AuthManager doesn't have hasInstance, use try-catch
        try {
            AuthManager.getInstance().dispose();
        } catch (e) {
            // Ignore if not initialized
        }

        console.log("[cfx-db] ✓ Shutdown complete");
    } catch (error) {
        console.error("[cfx-db] Error during shutdown:", error);
    }
}

// Handle resource lifecycle
on("onResourceStart", (resourceName: string) => {
    if (resourceName === GetCurrentResourceName()) {
        initialize().catch((err) => {
            console.error("[cfx-db] Failed to start:", err);
        });
    }
});

on("onResourceStop", (resourceName: string) => {
    if (resourceName === GetCurrentResourceName()) {
        cleanup();
    }
});

// Export framework version
global.exports("getVersion", () => "1.0.0");
