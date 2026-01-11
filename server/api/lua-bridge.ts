/**
 * Lua Bridge - Lua-compatible wrappers for the API - OPTIMIZED VERSION
 *
 * This provides callback-based APIs that work well with Lua's asynchronous patterns.
 * Includes request coalescing and optimized caching for maximum performance.
 */

import { randomBytes } from 'crypto';
import { query, mutation, subscribe as jsSubscribe } from "./exports";
import { RateLimiter } from "../core/RateLimiter";
import { AccessControl } from "../core/AccessControl";
import { PerformanceMonitor } from "../core/PerformanceMonitor";
import { QueryCache } from "../core/QueryCache";
import { EventEmitter } from "../core/EventEmitter";
import { WebhookManager } from "../core/WebhookManager";
import { SnapshotManager } from "../core/SnapshotManager";
import { RequestCoalescer } from "../core/RequestCoalescer";

// Track Lua subscriptions for cleanup
const luaSubscriptions = new Map<string, () => void>();

// Track subscriptions by resource for cleanup on resource stop
const resourceSubscriptions = new Map<string, Set<string>>();

// Get singleton instances
const rateLimiter = RateLimiter.getInstance();
const accessControl = AccessControl.getInstance();
const perfMonitor = PerformanceMonitor.getInstance();
const queryCache = QueryCache.getInstance();
const eventEmitter = EventEmitter.getInstance();
const webhookManager = WebhookManager.getInstance();
const snapshotManager = SnapshotManager.getInstance();
const requestCoalescer = RequestCoalescer.getInstance();

/**
 * Generate cryptographically secure subscription ID
 */
function generateSecureId(): string {
    return `sub_${randomBytes(16).toString('hex')}`;
}

/**
 * Lua-compatible query with callback - OPTIMIZED VERSION
 * Uses request coalescing and fast caching for maximum performance
 */
export async function luaQuery(
    queryName: string,
    args: any,
    callback: (success: boolean, result: any) => void
): Promise<void> {
    const startTime = Date.now();

    // Ensure args is always an object (Lua empty tables can become null)
    if (!args || typeof args !== "object" || Array.isArray(args)) {
        args = {};
    }

    // Get invoking resource for rate limiting
    const invokingResource = GetInvokingResource();
    if (!invokingResource) {
        callback(false, "Could not determine invoking resource");
        return;
    }

    // Check rate limit
    if (!rateLimiter.checkLimit(invokingResource)) {
        callback(false, "Rate limit exceeded. Please slow down.");
        return;
    }

    // Check access control (queries are read operations)
    if (args && args.table) {
        if (!accessControl.canAccess(invokingResource, args.table, 'read')) {
            callback(false, `Access denied: resource '${invokingResource}' cannot read from this table`);
            return;
        }
    }

    try {
        // Generate cache key using optimized method
        const cacheKey = args && args.table && args.operation
            ? queryCache.generateKeyCached(args.operation, args.table, args)
            : null;

        // Fast cache check
        if (cacheKey && queryCache.isEnabled()) {
            const cached = queryCache.get(cacheKey);
            if (cached !== null) {
                const duration = Date.now() - startTime;
                if (args && args.table && args.operation) {
                    perfMonitor.trackQuery(args.operation, args.table, args, duration);
                }
                callback(true, cached);
                return;
            }
        }

        // Cache miss - use request coalescing to deduplicate identical in-flight requests
        const coalescingKey = RequestCoalescer.generateKey(queryName, args);
        const result = await requestCoalescer.execute(coalescingKey, async () => {
            return query(queryName as any, args);
        });

        // Store in cache
        if (cacheKey && queryCache.isEnabled()) {
            const ttl = args.table ? queryCache.getTTL(args.table) : undefined;
            queryCache.set(cacheKey, result, ttl);

            // Prewarm cache for array results (single-record lookups)
            if (Array.isArray(result) && args.operation === 'select') {
                queryCache.prewarm('select', args.table, result);
            }
        }

        // Track performance
        const duration = Date.now() - startTime;
        if (args && args.table && args.operation) {
            perfMonitor.trackQuery(args.operation, args.table, args, duration);
        }

        callback(true, result);
    } catch (error: any) {
        // Track failed queries too
        const duration = Date.now() - startTime;
        if (args && args.table && args.operation) {
            perfMonitor.trackQuery(args.operation, args.table, args, duration);
        }

        callback(false, error.message || "Query failed");
    }
}

/**
 * Lua-compatible mutation with callback
 */
export async function luaMutation(
    mutationName: string,
    args: any,
    callback: (success: boolean, result: any) => void,
    priority?: "high" | "normal" | "low"
): Promise<void> {
    const startTime = Date.now();

    // Get invoking resource for rate limiting
    const invokingResource = GetInvokingResource();
    if (!invokingResource) {
        callback(false, "Could not determine invoking resource");
        return;
    }

    // Check rate limit
    if (!rateLimiter.checkLimit(invokingResource)) {
        callback(false, "Rate limit exceeded. Please slow down.");
        return;
    }

    // Check access control (mutations are write operations)
    if (args && args.table) {
        if (!accessControl.canAccess(invokingResource, args.table, 'write')) {
            callback(false, `Access denied: resource '${invokingResource}' cannot write to this table`);
            return;
        }
    }

    try {
        const result = await mutation(mutationName as any, args, { priority });

        // Invalidate cache for this table (mutations change data)
        if (args && args.table) {
            const invalidated = queryCache.invalidateTable(args.table);
            if (invalidated > 0) {
                console.log(`[cfx-db] Invalidated ${invalidated} cache entries for table: ${args.table}`);
            }
        }

        // Track performance
        const duration = Date.now() - startTime;
        if (args && args.table && args.operation) {
            perfMonitor.trackQuery(args.operation, args.table, args, duration);
        }

        // Emit events for successful mutations
        if (args && args.table && args.operation) {
            const eventName = `${args.table}:${args.operation}`;
            const eventData = {
                event: eventName,
                table: args.table,
                operation: args.operation,
                data: args.data || args.insert || args.update,
                where: args.where,
                results: result,
                timestamp: Date.now(),
                resourceName: invokingResource,
                playerId: (args as any)._meta?.playerId,
            };

            // Emit to internal event bus
            eventEmitter.emit(eventName, eventData);

            // Trigger webhooks
            webhookManager.trigger(eventData).catch((err) => {
                console.error('[cfx-db] Webhook trigger error:', err);
            });
        }

        callback(true, result);
    } catch (error: any) {
        // Track failed mutations too
        const duration = Date.now() - startTime;
        if (args && args.table && args.operation) {
            perfMonitor.trackQuery(args.operation, args.table, args, duration);
        }

        callback(false, error.message || "Mutation failed");
    }
}

/**
 * Lua-compatible subscription
 */
export function luaSubscribe(
    queryName: string,
    args: any,
    callback: (data: any) => void
): string {
    const subscriptionId = generateSecureId();
    const invokingResource = GetInvokingResource() || 'unknown';

    const unsubscribe = jsSubscribe(
        queryName as any,
        args,
        callback,
        subscriptionId
    );

    // Store unsubscribe function for later cleanup
    luaSubscriptions.set(subscriptionId, unsubscribe);

    // Track by resource for cleanup on resource stop
    if (!resourceSubscriptions.has(invokingResource)) {
        resourceSubscriptions.set(invokingResource, new Set());
    }
    resourceSubscriptions.get(invokingResource)!.add(subscriptionId);

    return subscriptionId;
}

/**
 * Lua-compatible unsubscribe
 */
export function luaUnsubscribe(subscriptionId: string): boolean {
    const unsubscribe = luaSubscriptions.get(subscriptionId);
    if (!unsubscribe) {
        return false;
    }

    unsubscribe();
    luaSubscriptions.delete(subscriptionId);

    // Remove from resource tracking
    for (const [resource, subs] of resourceSubscriptions.entries()) {
        if (subs.has(subscriptionId)) {
            subs.delete(subscriptionId);
            if (subs.size === 0) {
                resourceSubscriptions.delete(resource);
            }
            break;
        }
    }

    return true;
}

/**
 * Cleanup all subscriptions for a resource
 */
function cleanupResourceSubscriptions(resourceName: string): void {
    const subs = resourceSubscriptions.get(resourceName);
    if (!subs) return;

    let cleaned = 0;
    for (const subId of subs) {
        const unsubscribe = luaSubscriptions.get(subId);
        if (unsubscribe) {
            unsubscribe();
            luaSubscriptions.delete(subId);
            cleaned++;
        }
    }

    resourceSubscriptions.delete(resourceName);

    if (cleaned > 0) {
        console.log(`[cfx-db] Cleaned up ${cleaned} subscriptions for resource: ${resourceName}`);
    }
}

/**
 * Get performance statistics
 */
export function getPerformanceStats(callback: (stats: any) => void): void {
    const stats = perfMonitor.getStats();
    callback(stats);
}

/**
 * Get slowest queries
 */
export function getSlowestQueries(limit: number, callback: (queries: any) => void): void {
    const queries = perfMonitor.getSlowestQueries(limit);
    callback(queries);
}

/**
 * Get all slow queries with details
 */
export function getAllSlowQueries(limit: number, callback: (queries: any) => void): void {
    const queries = perfMonitor.getAllSlowQueries(limit);
    callback(queries);
}

/**
 * Reset performance metrics
 */
export function resetPerformanceMetrics(): void {
    perfMonitor.reset();
}

/**
 * Get cache statistics
 */
export function getCacheStats(callback: (stats: any) => void): void {
    const stats = queryCache.getStats();
    callback(stats);
}

/**
 * Clear cache
 */
export function clearCache(): void {
    queryCache.clear();
}

/**
 * Invalidate cache for a table
 */
export function invalidateTableCache(table: string): number {
    return queryCache.invalidateTable(table);
}

/**
 * Configure cache
 */
export function configureCache(config: any): void {
    queryCache.configure(config);
}

/**
 * Configure webhooks
 */
export function configureWebhooks(webhooks: any[]): void {
    webhookManager.configure(webhooks);
}

/**
 * Get webhook statistics
 */
export function getWebhookStats(callback: (stats: any) => void): void {
    const stats = webhookManager.getStats();
    callback(stats);
}

/**
 * Get event emitter statistics
 */
export function getEventStats(callback: (stats: any) => void): void {
    const stats = eventEmitter.getStats();
    callback(stats);
}

/**
 * Clear all event listeners
 */
export function clearEventListeners(event?: string): void {
    eventEmitter.removeAllListeners(event);
}

/**
 * Subscribe to a database event from Lua
 */
export function subscribeToEvent(event: string, callback: (data: any) => void): void {
    eventEmitter.on(event, callback);
}

/**
 * Unsubscribe from a database event
 */
export function unsubscribeFromEvent(event: string, callback: (data: any) => void): void {
    eventEmitter.off(event, callback);
}

/**
 * Create a database snapshot
 */
export async function createSnapshot(
    name: string,
    callback: (success: boolean, result: any) => void
): Promise<void> {
    try {
        const result = await snapshotManager.createSnapshot(name, "manual");
        callback(result.success, result);
    } catch (error: any) {
        callback(false, error.message);
    }
}

/**
 * Restore a database snapshot
 */
export async function restoreSnapshot(
    name: string,
    callback: (success: boolean, result: any) => void
): Promise<void> {
    try {
        const result = await snapshotManager.restoreSnapshot(name);
        callback(result.success, result);
    } catch (error: any) {
        callback(false, error.message);
    }
}

/**
 * List all snapshots
 */
export async function listSnapshots(callback: (snapshots: any[]) => void): Promise<void> {
    try {
        const snapshots = await snapshotManager.listSnapshots();
        callback(snapshots);
    } catch (error: any) {
        callback([]);
    }
}

/**
 * Delete a snapshot
 */
export async function deleteSnapshot(
    name: string,
    callback: (success: boolean) => void
): Promise<void> {
    try {
        const success = await snapshotManager.deleteSnapshot(name);
        callback(success);
    } catch (error: any) {
        callback(false);
    }
}

/**
 * Get snapshot statistics
 */
export async function getSnapshotStats(callback: (stats: any) => void): Promise<void> {
    try {
        const stats = await snapshotManager.getStats();
        callback(stats);
    } catch (error: any) {
        callback(null);
    }
}

/**
 * Transaction API - Execute atomic multi-operation batches
 * GENERIC - works with ANY table/operation combination
 */
export async function executeTransaction(
    operations: any[],
    callback: (success: boolean, result: any) => void
): Promise<void> {
    try {
        const result = await mutation("functions/transaction:executeTransaction" as any, {
            operations,
        });
        callback(true, result);
    } catch (error: any) {
        console.error("[cfx-db] Transaction failed:", error.message);
        callback(false, { error: error.message });
    }
}

/**
 * Direct query wrapper for Lua (convenience function)
 * Use this to call any Convex query function directly
 */
export async function directQuery(
    queryName: string,
    args: any,
    callback: (success: boolean, result: any) => void
): Promise<void> {
    return luaQuery(queryName, args, callback);
}

/**
 * Direct mutation wrapper for Lua (convenience function)
 * Use this to call any Convex mutation function directly
 */
export async function directMutation(
    mutationName: string,
    args: any,
    callback: (success: boolean, result: any) => void
): Promise<void> {
    return luaMutation(mutationName, args, callback);
}

/**
 * Validation Rules API - Add custom validation rules for your tables
 * Use this from your gamemode to enforce data integrity
 */
export function addValidationRules(table: string, rules: any): void {
    // Validation rules are defined in Convex, not here
    // This is a placeholder for documentation
    console.warn("[cfx-db] addValidationRules is not yet implemented - validation rules must be added in convex/lib/validation_rules.ts");
}

/**
 * Get request coalescing statistics
 */
export function getCoalescingStats(callback: (stats: any) => void): void {
    const stats = requestCoalescer.getStats();
    callback(stats);
}

/**
 * Reset request coalescing statistics
 */
export function resetCoalescingStats(): void {
    requestCoalescer.resetStats();
}

// Register Lua-specific exports
if (typeof global.exports !== "undefined") {
    global.exports("_luaQuery", luaQuery);
    global.exports("_luaMutation", luaMutation);
    global.exports("_luaSubscribe", luaSubscribe);
    global.exports("_luaUnsubscribe", luaUnsubscribe);

    // Convenience wrappers
    global.exports("query", directQuery);
    global.exports("mutation", directMutation);

    // Feature APIs
    global.exports("getPerformanceStats", getPerformanceStats);
    global.exports("getSlowestQueries", getSlowestQueries);
    global.exports("getAllSlowQueries", getAllSlowQueries);
    global.exports("resetPerformanceMetrics", resetPerformanceMetrics);
    global.exports("getCacheStats", getCacheStats);
    global.exports("clearCache", clearCache);
    global.exports("invalidateTableCache", invalidateTableCache);
    global.exports("configureCache", configureCache);
    global.exports("configureWebhooks", configureWebhooks);
    global.exports("getWebhookStats", getWebhookStats);
    global.exports("getEventStats", getEventStats);
    global.exports("clearEventListeners", clearEventListeners);
    global.exports("subscribeToEvent", subscribeToEvent);
    global.exports("unsubscribeFromEvent", unsubscribeFromEvent);
    global.exports("createSnapshot", createSnapshot);
    global.exports("restoreSnapshot", restoreSnapshot);
    global.exports("listSnapshots", listSnapshots);
    global.exports("deleteSnapshot", deleteSnapshot);
    global.exports("getSnapshotStats", getSnapshotStats);
    global.exports("executeTransaction", executeTransaction);
    global.exports("getCoalescingStats", getCoalescingStats);
    global.exports("resetCoalescingStats", resetCoalescingStats);
}

// Bridge TypeScript events to Lua events
// Subscribe to all events and emit them as FiveM events
eventEmitter.on("*", (eventData: any) => {
    // Emit to all clients if needed (currently server-only)
    // TriggerClientEvent('cfx-db:event', -1, eventData);

    // For server-side only, we don't need to emit FiveM events
    // Lua listeners will subscribe directly to the EventEmitter via exports
});

// Cleanup subscriptions when resources stop
on("onResourceStop", (resourceName: string) => {
    cleanupResourceSubscriptions(resourceName);
});
