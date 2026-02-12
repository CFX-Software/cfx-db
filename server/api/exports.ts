/**
 * JavaScript/TypeScript API Exports - OPTIMIZED VERSION
 *
 * Simple API for using Convex from FiveM with request coalescing
 * for maximum performance.
 */

import type { FunctionReference } from "convex/server";
import { ConnectionManager } from "../core/ConnectionManager";
import { SubscriptionManager } from "../core/SubscriptionManager";
import { CacheManager } from "../core/CacheManager";
import { BatchWriter } from "../core/BatchWriter";
import { RequestCoalescer } from "../core/RequestCoalescer";
import { Logger } from "../utils/Logger";

type QueryRef = FunctionReference<"query"> | string;
type MutationRef = FunctionReference<"mutation"> | string;
type ResultCallback<T = any> = (success: boolean, result: T | string) => void;
type StatsCallback<T = any> = (stats: T) => void;
type MutationPriority = "high" | "normal" | "low";

export interface MutationOptions {
    immediate?: boolean;
    priority?: MutationPriority;
}

// Get singleton instance
const coalescer = RequestCoalescer.getInstance();
const managedSubscriptions = new Map<string, () => void>();

/**
 * Execute a Convex query with request coalescing
 * Identical queries in-flight share the same HTTP request
 */
async function queryInternal<T = any>(
    queryRef: QueryRef,
    args: any = {}
): Promise<T> {
    // Generate coalescing key
    const key = RequestCoalescer.generateKey(queryRef.toString(), args);

    // Use coalescer to deduplicate in-flight requests
    return coalescer.execute(key, async () => {
        const client = ConnectionManager.getInstance().getHttpClient();
        return client.query(queryRef as any, args);
    });
}

/**
 * Execute a Convex mutation with optional batching
 */
async function mutationInternal<T = any>(
    mutationRef: MutationRef,
    args: any = {},
    options: MutationOptions = {}
): Promise<T> {
    if (options.immediate) {
        const client = ConnectionManager.getInstance().getHttpClient();
        return client.mutation(mutationRef as any, args);
    }

    return BatchWriter.getInstance().queueWrite(
        mutationRef as any,
        args,
        options.priority || "normal"
    );
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return String(error);
}

function withResultCallback<T>(
    promise: Promise<T>,
    callback?: ResultCallback<T>
): Promise<T> | void {
    if (!callback) {
        return promise;
    }

    promise
        .then((result) => callback(true, result))
        .catch((error) => callback(false, toErrorMessage(error)));
}

function resolveMutationOptions<T>(
    optionsOrCallback?: MutationOptions | ResultCallback<T>,
    callback?: ResultCallback<T>
): { options: MutationOptions; callback?: ResultCallback<T> } {
    if (typeof optionsOrCallback === "function") {
        return { options: {}, callback: optionsOrCallback };
    }

    if (callback) {
        return {
            options: optionsOrCallback ?? {},
            callback,
        };
    }

    return { options: optionsOrCallback ?? {} };
}

/**
 * Query export that supports:
 * - Promise style (JavaScript/TypeScript): await query("functions/x:get", args)
 * - Callback style (Lua): query("functions/x:get", args, function(success, result) ... end)
 */
export function query<T = any>(
    queryRef: QueryRef,
    args: any = {},
    callback?: ResultCallback<T>
): Promise<T> | void {
    return withResultCallback(queryInternal<T>(queryRef, args), callback);
}

/**
 * Promise-only query helper for internal TypeScript modules.
 */
export function queryAsync<T = any>(
    queryRef: QueryRef,
    args: any = {}
): Promise<T> {
    return queryInternal<T>(queryRef, args);
}

/**
 * Mutation export that supports:
 * - Promise style: await mutation("functions/x:set", args, { priority = "high" })
 * - Callback style: mutation("functions/x:set", args, function(success, result) ... end)
 */
export function mutation<T = any>(
    mutationRef: MutationRef,
    args: any = {},
    optionsOrCallback?: MutationOptions | ResultCallback<T>,
    callback?: ResultCallback<T>
): Promise<T> | void {
    const resolved = resolveMutationOptions(optionsOrCallback, callback);
    return withResultCallback(
        mutationInternal<T>(mutationRef, args, resolved.options),
        resolved.callback
    );
}

/**
 * Promise-only mutation helper for internal TypeScript modules.
 */
export function mutationAsync<T = any>(
    mutationRef: MutationRef,
    args: any = {},
    options: MutationOptions = {}
): Promise<T> {
    return mutationInternal<T>(mutationRef, args, options);
}

/**
 * Subscribe to a Convex query with real-time updates
 *
 * Convex automatically pushes updates when data changes.
 * Your callback is called with the new data.
 */
export function subscribe<T = any>(
    queryRef: QueryRef,
    args: any,
    onUpdate: (data: T) => void,
    subscriberId?: string
): () => void {
    const subId = subscriberId || `sub_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    // Create subscription - Convex handles the real-time sync
    const subManager = SubscriptionManager.getInstance();
    const subscriptionId = subManager.subscribe(queryRef as any, args, subId, onUpdate);

    // Return unsubscribe function
    const unsubscribeFn = () => {
        subManager.unsubscribe(subscriptionId, subId);
        managedSubscriptions.delete(subId);
    };

    managedSubscriptions.set(subId, unsubscribeFn);
    return unsubscribeFn;
}

/**
 * Unsubscribe helper for cross-resource calls.
 * Accepts either:
 * - a function returned by subscribe()
 * - a subscriberId string used when subscribing
 */
export function unsubscribe(subscription: string | (() => void)): boolean {
    if (typeof subscription === "function") {
        subscription();
        return true;
    }

    const unsubscribeFn = managedSubscriptions.get(subscription);
    if (!unsubscribeFn) {
        return false;
    }

    unsubscribeFn();
    return true;
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
 * Get framework statistics including coalescing stats
 */
function getStatsInternal() {
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
            coalescing: coalescer.getStats(),
        };
    } catch (error) {
        Logger.getInstance().scoped("stats").error("Error getting stats", { error: String(error) });
        return {
            connection: { healthy: false, poolSize: 0, initialized: false, reconnecting: false, reconnectAttempts: 0 },
            cache: { items: 0, hitRate: 0, memoryMB: 0 },
            subscriptions: { activeSubscriptions: 0, totalSubscribers: 0, memoryEstimateMB: 0 },
            batchWriter: { queueSizes: { immediate: 0, high: 0, normal: 0, low: 0 }, totalQueued: 0 },
            coalescing: { totalRequests: 0, coalescedRequests: 0, httpRequestsMade: 0, pendingRequests: 0, savingsPercent: '0' },
        };
    }
}

export function getStats(callback?: StatsCallback): ReturnType<typeof getStatsInternal> | void {
    const stats = getStatsInternal();
    if (callback) {
        callback(stats);
        return;
    }
    return stats;
}

/**
 * Force a reconnection attempt
 */
export function forceReconnect(): void {
    if (ConnectionManager.hasInstance()) {
        ConnectionManager.getInstance().forceReconnect();
    } else {
        Logger.getInstance().scoped("connection").warn("Cannot force reconnect - connection manager not initialized");
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

/**
 * Get coalescing statistics
 */
function getCoalescingStatsInternal() {
    return coalescer.getStats();
}

export function getCoalescingStats(
    callback?: StatsCallback<ReturnType<typeof getCoalescingStatsInternal>>
): ReturnType<typeof getCoalescingStatsInternal> | void {
    const stats = getCoalescingStatsInternal();
    if (callback) {
        callback(stats);
        return;
    }
    return stats;
}

/**
 * Reset coalescing statistics
 */
export function resetCoalescingStats(): void {
    coalescer.resetStats();
}

// Register all exports for FiveM
if (typeof global.exports !== "undefined") {
    global.exports("query", query);
    global.exports("mutation", mutation);
    global.exports("subscribe", subscribe);
    global.exports("unsubscribe", unsubscribe);
    global.exports("getCached", getCached);
    global.exports("setCached", setCached);
    global.exports("invalidateCache", invalidateCache);
    global.exports("getConvexClient", getConvexClient);
    global.exports("getConvexHttpClient", getConvexHttpClient);
    global.exports("getStats", getStats);
    global.exports("forceReconnect", forceReconnect);
    global.exports("isHealthy", isHealthy);
    global.exports("isReady", isReady);
    global.exports("getCoalescingStats", getCoalescingStats);
    global.exports("resetCoalescingStats", resetCoalescingStats);
}
