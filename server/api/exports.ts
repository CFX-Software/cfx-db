/**
 * JavaScript/TypeScript API Exports
 *
 * Simple API for using Convex from FiveM.
 */

import type { FunctionReference } from "convex/server";
import { ConnectionManager } from "../core/ConnectionManager";
import { SubscriptionManager } from "../core/SubscriptionManager";
import { CacheManager } from "../core/CacheManager";
import { BatchWriter } from "../core/BatchWriter";

/**
 * Execute a Convex query
 */
export async function query<T = any>(
    queryRef: FunctionReference<"query">,
    args: any = {}
): Promise<T> {
    const client = ConnectionManager.getInstance().getHttpClient();
    return client.query(queryRef, args);
}

/**
 * Execute a Convex mutation
 */
export async function mutation<T = any>(
    mutationRef: FunctionReference<"mutation">,
    args: any = {},
    options: { immediate?: boolean; priority?: "high" | "normal" | "low" } = {}
): Promise<T> {
    if (options.immediate) {
        const client = ConnectionManager.getInstance().getHttpClient();
        return client.mutation(mutationRef, args);
    }

    return BatchWriter.getInstance().queueWrite(
        mutationRef,
        args,
        options.priority || "normal"
    );
}

/**
 * Subscribe to a Convex query with real-time updates
 *
 * Convex automatically pushes updates when data changes.
 * Your callback is called with the new data.
 */
export function subscribe<T = any>(
    queryRef: FunctionReference<"query">,
    args: any,
    onUpdate: (data: T) => void,
    subscriberId?: string
): () => void {
    const subId = subscriberId || `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Create subscription - Convex handles the real-time sync
    const subManager = SubscriptionManager.getInstance();
    const subscriptionId = subManager.subscribe(queryRef, args, subId, onUpdate);

    // Return unsubscribe function
    return () => {
        subManager.unsubscribe(subscriptionId, subId);
    };
}

/**
 * Get cached data for a query
 */
export function getCached<T = any>(key: string): T | undefined {
    return CacheManager.getInstance().get<T>(key);
}

/**
 * Set cached data
 */
export function setCached<T = any>(key: string, value: T, ttl?: number): void {
    CacheManager.getInstance().set(key, value, ttl);
}

/**
 * Invalidate cache by pattern
 */
export function invalidateCache(pattern: string | RegExp): number {
    return CacheManager.getInstance().invalidate(pattern);
}

/**
 * Get the Convex subscription client (for advanced use)
 */
export function getConvexClient() {
    return ConnectionManager.getInstance().getSubscriptionClient();
}

/**
 * Get a Convex HTTP client from the pool (for advanced use)
 */
export function getConvexHttpClient() {
    return ConnectionManager.getInstance().getHttpClient();
}

/**
 * Get framework statistics
 */
export function getStats() {
    try {
        return {
            connection: ConnectionManager.hasInstance()
                ? ConnectionManager.getInstance().getHealthStatus()
                : { healthy: false, poolSize: 0, initialized: false, reconnecting: false, reconnectAttempts: 0 },
            cache: CacheManager.getInstance().getStats(),
            subscriptions: SubscriptionManager.hasInstance()
                ? SubscriptionManager.getInstance().getStats()
                : { activeSubscriptions: 0, totalSubscribers: 0, memoryEstimateMB: 0 },
            batchWriter: BatchWriter.hasInstance()
                ? BatchWriter.getInstance().getStats()
                : { queueSizes: { immediate: 0, high: 0, normal: 0, low: 0 }, totalQueued: 0 },
        };
    } catch (error) {
        console.error("[cfx-db] Error getting stats:", error);
        return {
            connection: { healthy: false, poolSize: 0, initialized: false, reconnecting: false, reconnectAttempts: 0 },
            cache: { items: 0, hitRate: 0, memoryMB: 0 },
            subscriptions: { activeSubscriptions: 0, totalSubscribers: 0, memoryEstimateMB: 0 },
            batchWriter: { queueSizes: { immediate: 0, high: 0, normal: 0, low: 0 }, totalQueued: 0 },
        };
    }
}

/**
 * Force a reconnection attempt
 */
export function forceReconnect(): void {
    if (ConnectionManager.hasInstance()) {
        ConnectionManager.getInstance().forceReconnect();
    } else {
        console.warn("[cfx-db] Cannot force reconnect - connection manager not initialized");
    }
}

/**
 * Check if the connection is healthy
 */
export function isHealthy(): boolean {
    if (!ConnectionManager.hasInstance()) {
        return false;
    }
    return ConnectionManager.getInstance().getHealthStatus().healthy;
}

/**
 * Check if the framework is ready
 */
export function isReady(): boolean {
    if (!ConnectionManager.hasInstance()) {
        return false;
    }
    return ConnectionManager.getInstance().isReady();
}

// Register all exports for FiveM
if (typeof global.exports !== "undefined") {
    global.exports("query", query);
    global.exports("mutation", mutation);
    global.exports("subscribe", subscribe);
    global.exports("getCached", getCached);
    global.exports("setCached", setCached);
    global.exports("invalidateCache", invalidateCache);
    global.exports("getConvexClient", getConvexClient);
    global.exports("getConvexHttpClient", getConvexHttpClient);
    global.exports("getStats", getStats);
    global.exports("forceReconnect", forceReconnect);
    global.exports("isHealthy", isHealthy);
    global.exports("isReady", isReady);
}
