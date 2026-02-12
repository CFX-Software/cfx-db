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
import { AccessControl } from "./core/AccessControl";
import { AutoUpdater } from "./core/AutoUpdater";
import { Logger, LogLevel } from "./utils/Logger";

// Import API exports (registers FiveM exports)
import "./api/exports";
import "./api/unified";
import "./api/lua-bridge";
import "./core/EventBridge"; // Optional helpers

// Logger instance (initialized after config load)
let log = Logger.getInstance().scoped("init");
const VERSION = "1.1.1";
let autoUpdater: AutoUpdater | null = null;

/**
 * Initialize cfx-db framework
 */
async function initialize() {
    const resourceName = GetCurrentResourceName();
    const resourcePath = GetResourcePath(resourceName);

    // Load .env file first (FiveM globals are available now)
    try {
        const envPath = resolve(resourcePath, ".env");
        const result = loadDotenv({ path: envPath, quiet: true });

        // Manually assign to process.env (IIFE scope isolation workaround)
        if (result.parsed) {
            Object.assign(process.env, result.parsed);
        }
    } catch (error) {
        // .env loading is optional, silently continue
    }

    // Load config and initialize logger first
    const config = loadConfig();
    Logger.initialize(config);
    log = Logger.getInstance().scoped("init");

    log.info(`Starting cfx-db v${VERSION}`);

    autoUpdater = AutoUpdater.getInstance({
        resourceName,
        resourcePath,
        runtimeVersion: VERSION,
    });

    try {
        // Clean up any existing instances (handles 'refresh' case)
        log.debug("Cleaning up existing instances...");

        if (SubscriptionManager.hasInstance()) {
            SubscriptionManager.resetInstance();
        }

        if (BatchWriter.hasInstance()) {
            // Flush pending writes before disposing
            try {
                await BatchWriter.getInstance().flushAll();
            } catch (e) {
                log.warn("Could not flush pending writes", { error: String(e) });
            }
            BatchWriter.resetInstance();
        }

        if (ConnectionManager.hasInstance()) {
            ConnectionManager.resetInstance();
        }

        // Small delay to ensure all cleanup is complete
        await new Promise(resolve => setTimeout(resolve, 100));

        // Validate configuration
        validateConfig(config);

        log.debug("Connecting to Convex", { url: config.convexUrl });

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
                log.debug("Webhooks configured", { count: luaConfig.Webhooks.length });
            }

            if (luaConfig.TablePermissions) {
                AccessControl.getInstance().clearPermissions();
                let tableCount = 0;
                for (const [table, permissions] of Object.entries(luaConfig.TablePermissions)) {
                    AccessControl.getInstance().setTablePermissions(table, permissions as any);
                    tableCount++;
                }
                log.debug("Access control configured", { tables: tableCount });
            }

            // Configure query cache from Lua config
            if (luaConfig.Cache) {
                QueryCache.getInstance().configure(luaConfig.Cache);
                log.debug("Query cache configured", { ttl: luaConfig.Cache.defaultTTL });
            }

            if (luaConfig.AutoUpdater) {
                autoUpdater.configure({
                    enabled: luaConfig.AutoUpdater.enabled === true,
                    mode:
                        typeof luaConfig.AutoUpdater.mode === "string"
                            ? luaConfig.AutoUpdater.mode
                            : "notify",
                    checkIntervalMinutes:
                        typeof luaConfig.AutoUpdater.checkIntervalMinutes === "number"
                            ? luaConfig.AutoUpdater.checkIntervalMinutes
                            : 30,
                    remote:
                        typeof luaConfig.AutoUpdater.remote === "string"
                            ? luaConfig.AutoUpdater.remote
                            : "origin",
                    branch:
                        typeof luaConfig.AutoUpdater.branch === "string"
                            ? luaConfig.AutoUpdater.branch
                            : "main",
                    restartOnUpdate: luaConfig.AutoUpdater.restartOnUpdate === true,
                    requireCleanWorkTree:
                        luaConfig.AutoUpdater.requireCleanWorkTree !== false,
                    fetchTags: luaConfig.AutoUpdater.fetchTags !== false,
                    versionSource:
                        typeof luaConfig.AutoUpdater.versionSource === "string"
                            ? luaConfig.AutoUpdater.versionSource
                            : "hybrid",
                    includePrerelease: luaConfig.AutoUpdater.includePrerelease === true,
                    notifyOnUpToDate: luaConfig.AutoUpdater.notifyOnUpToDate === true,
                    githubReleasesApiUrl:
                        typeof luaConfig.AutoUpdater.githubReleasesApiUrl === "string"
                            ? luaConfig.AutoUpdater.githubReleasesApiUrl
                            : "https://api.github.com/repos/CFX-Software/cfx-db/releases",
                    commandTimeoutMs:
                        typeof luaConfig.AutoUpdater.commandTimeoutMs === "number"
                            ? luaConfig.AutoUpdater.commandTimeoutMs
                            : 10000,
                });
            } else {
                autoUpdater.configure({ enabled: false });
            }
        } catch (error) {
            log.debug("No webhook/cache configuration found in shared/config.lua");
        }

        autoUpdater.start();
        log.info("Core services initialized");

        // Start periodic cache cleanup
        setInterval(() => {
            const removed = CacheManager.getInstance().cleanup();
            if (removed > 0) {
                log.debug("Cache cleanup completed", { removed });
            }
        }, 60000); // Every minute

        // Log stats periodically if enabled (only at DEBUG level)
        if (config.logPerformanceMetrics) {
            setInterval(() => {
                if (Logger.getInstance().isEnabled("debug")) {
                    const stats = getStats();
                    log.debug("Performance metrics", stats);
                }
            }, 300000); // Every 5 minutes
        }

        log.info("Service ready");

        // Emit ready event
        emit("cfxdb:ready");
    } catch (error) {
        log.error("Initialization failed", { error: String(error) });
        log.error("Check your .env and Convex deployment");
        throw error;
    }
}

/**
 * Get current stats for all components
 */
function getStats() {
    return {
        connection: ConnectionManager.hasInstance()
            ? ConnectionManager.getInstance().getHealthStatus()
            : null,
        cache: CacheManager.getInstance().getStats(),
        subscriptions: SubscriptionManager.hasInstance()
            ? SubscriptionManager.getInstance().getStats()
            : null,
        batchWriter: BatchWriter.hasInstance()
            ? BatchWriter.getInstance().getStats()
            : null,
    };
}

/**
 * Cleanup on resource stop
 * NOTE: FiveM doesn't wait for async operations on resource stop,
 * so this must be synchronous. Flush is best-effort.
 */
function cleanup() {
    const shutdownLog = Logger.getInstance().scoped("shutdown");
    shutdownLog.info("Shutting down...");

    try {
        // Attempt to flush pending writes (best-effort, won't block)
        if (BatchWriter.hasInstance()) {
            BatchWriter.getInstance().flushAll()
                .then(() => shutdownLog.debug("Flushed pending writes"))
                .catch((err) => shutdownLog.warn("Error flushing writes", { error: String(err) }));
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

        if (autoUpdater) {
            autoUpdater.stop();
        }

        shutdownLog.info("Shutdown complete");
    } catch (error) {
        shutdownLog.error("Error during shutdown", { error: String(error) });
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
global.exports("getVersion", () => VERSION);
global.exports("getVersionStatus", () => (autoUpdater ? autoUpdater.getStatus() : null));
global.exports("checkForUpdates", (callback?: (success: boolean, result: any) => void) => {
    const updater = autoUpdater;
    if (!updater) {
        if (callback) {
            callback(false, "Auto-updater is not initialized");
            return;
        }
        return Promise.reject(new Error("Auto-updater is not initialized"));
    }

    const promise = updater.checkForUpdates({ manual: true, fetch: true });
    if (callback) {
        promise
            .then((status) => callback(true, status))
            .catch((error) => callback(false, String(error)));
        return;
    }
    return promise;
});
global.exports("applyUpdate", (
    forceOrCallback?: boolean | ((success: boolean, result: any) => void),
    callbackMaybe?: (success: boolean, result: any) => void
) => {
    const updater = autoUpdater;
    if (!updater) {
        const callback =
            typeof forceOrCallback === "function" ? forceOrCallback : callbackMaybe;
        if (callback) {
            callback(false, "Auto-updater is not initialized");
            return;
        }
        return Promise.reject(new Error("Auto-updater is not initialized"));
    }

    const force = forceOrCallback === true;
    const callback =
        typeof forceOrCallback === "function" ? forceOrCallback : callbackMaybe;
    const promise = updater.applyUpdate({ force });
    if (callback) {
        promise
            .then((result) => callback(result.success, result))
            .catch((error) => callback(false, String(error)));
        return;
    }
    return promise;
});

// ============================================================================
// Runtime Commands
// ============================================================================

/**
 * Command: cfxdb_stats
 * Print current stats to console on-demand
 */
RegisterCommand(
    "cfxdb_stats",
    () => {
        const stats = getStats();
        console.log("[cfx-db] Current Statistics:");
        console.log(JSON.stringify(stats, null, 2));
    },
    true // restricted - requires ace permissions
);

/**
 * Command: cfxdb_loglevel <level>
 * Change log level at runtime
 */
RegisterCommand(
    "cfxdb_loglevel",
    (source: number, args: string[]) => {
        const validLevels: LogLevel[] = ["debug", "info", "warn", "error"];
        const level = args[0] as LogLevel;

        if (!level) {
            console.log(`[cfx-db] Current log level: ${Logger.getInstance().getLevel()}`);
            console.log("[cfx-db] Usage: cfxdb_loglevel <debug|info|warn|error>");
            return;
        }

        if (validLevels.includes(level)) {
            Logger.getInstance().setLevel(level);
            console.log(`[cfx-db] Log level changed to: ${level}`);
        } else {
            console.log("[cfx-db] Invalid level. Valid levels: debug, info, warn, error");
        }
    },
    true // restricted - requires ace permissions
);

RegisterCommand(
    "cfxdb_update_status",
    () => {
        if (!autoUpdater) {
            console.log("[cfx-db] Auto-updater is not initialized");
            return;
        }

        const status = autoUpdater.getStatus();
        console.log("[cfx-db] Auto-updater status:");
        console.log(JSON.stringify(status, null, 2));
    },
    true
);

RegisterCommand(
    "cfxdb_update_check",
    () => {
        if (!autoUpdater) {
            console.log("[cfx-db] Auto-updater is not initialized");
            return;
        }

        autoUpdater
            .checkForUpdates({ manual: true, fetch: true })
            .then((status) => {
                if (status.updateAvailable) {
                    console.log(`[cfx-db] Update available: ${status.localVersionTag} -> ${status.latestVersionTag} (${status.updateLevel}, source=${status.updateSource})`);
                    if (status.latestReleaseUrl) {
                        console.log(`[cfx-db] Release notes: ${status.latestReleaseUrl}`);
                    }
                    if (status.deprecationsDetected) {
                        console.log("[cfx-db] WARNING: Possible deprecations/breaking changes detected:");
                        for (const warning of status.deprecationWarnings.slice(0, 5)) {
                            console.log(`[cfx-db]  - ${warning}`);
                        }
                    }
                } else {
                    console.log(`[cfx-db] Already up to date (${status.localVersionTag}, source=${status.updateSource})`);
                }
            })
            .catch((error) => {
                console.log(`[cfx-db] Update check failed: ${String(error)}`);
            });
    },
    true
);

RegisterCommand(
    "cfxdb_update_apply",
    (source: number, args: string[]) => {
        if (!autoUpdater) {
            console.log("[cfx-db] Auto-updater is not initialized");
            return;
        }

        const force = args[0] === "force";
        autoUpdater
            .applyUpdate({ force })
            .then((result) => {
                if (result.success) {
                    console.log(`[cfx-db] ${result.message}`);
                } else {
                    console.log(`[cfx-db] Update apply failed: ${result.message}`);
                }
            })
            .catch((error) => {
                console.log(`[cfx-db] Update apply failed: ${String(error)}`);
            });
    },
    true
);
