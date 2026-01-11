import { query, mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Audit Log Query Functions
 *
 * Provides queries for analyzing audit logs for anti-cheat, debugging, and compliance.
 */

/**
 * Query audit logs with filters
 *
 * OPTIMIZED: Uses .take() instead of .collect() to limit memory usage.
 * Filters are applied at the database level where possible.
 */
export const queryLogs = query({
    args: {
        table: v.optional(v.string()),
        operation: v.optional(v.string()),
        resourceName: v.optional(v.string()),
        playerId: v.optional(v.string()),
        startTime: v.optional(v.number()),
        endTime: v.optional(v.number()),
        limit: v.optional(v.number()),
        successOnly: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        // Default and cap limit to prevent memory issues
        const maxResults = Math.min(args.limit || 100, 1000);

        // Use index if specific filter provided, with .take() instead of .collect()
        let results;
        if (args.table) {
            results = await ctx.db
                .query("auditLogs")
                .withIndex("by_table", (q) => q.eq("table", args.table!))
                .order("desc")
                .take(maxResults * 2); // Take extra for post-filtering
        } else if (args.operation) {
            results = await ctx.db
                .query("auditLogs")
                .withIndex("by_operation", (q) => q.eq("operation", args.operation!))
                .order("desc")
                .take(maxResults * 2);
        } else if (args.resourceName) {
            results = await ctx.db
                .query("auditLogs")
                .withIndex("by_resource", (q) => q.eq("resourceName", args.resourceName!))
                .order("desc")
                .take(maxResults * 2);
        } else if (args.playerId) {
            results = await ctx.db
                .query("auditLogs")
                .withIndex("by_player", (q) => q.eq("playerId", args.playerId!))
                .order("desc")
                .take(maxResults * 2);
        } else {
            results = await ctx.db
                .query("auditLogs")
                .withIndex("by_timestamp")
                .order("desc")
                .take(maxResults * 2);
        }

        // Filter by timestamp range (post-query filtering)
        if (args.startTime !== undefined) {
            results = results.filter((log) => log.timestamp >= args.startTime!);
        }
        if (args.endTime !== undefined) {
            results = results.filter((log) => log.timestamp <= args.endTime!);
        }

        // Filter by success
        if (args.successOnly !== undefined) {
            results = results.filter((log) => log.success === args.successOnly);
        }

        // Apply final limit
        return results.slice(0, maxResults);
    },
});

/**
 * Query audit logs by table
 */
export const queryByTable = query({
    args: {
        table: v.string(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const logs = await ctx.db
            .query("auditLogs")
            .withIndex("by_table", (q) => q.eq("table", args.table))
            .order("desc")
            .take(args.limit || 100);

        return logs;
    },
});

/**
 * Query audit logs by resource
 */
export const queryByResource = query({
    args: {
        resourceName: v.string(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const logs = await ctx.db
            .query("auditLogs")
            .withIndex("by_resource", (q) => q.eq("resourceName", args.resourceName))
            .order("desc")
            .take(args.limit || 100);

        return logs;
    },
});

/**
 * Query audit logs by player
 */
export const queryByPlayer = query({
    args: {
        playerId: v.string(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const logs = await ctx.db
            .query("auditLogs")
            .withIndex("by_player", (q) => q.eq("playerId", args.playerId))
            .order("desc")
            .take(args.limit || 100);

        return logs;
    },
});

/**
 * Query audit logs by operation type
 */
export const queryByOperation = query({
    args: {
        operation: v.string(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const logs = await ctx.db
            .query("auditLogs")
            .withIndex("by_operation", (q) => q.eq("operation", args.operation))
            .order("desc")
            .take(args.limit || 100);

        return logs;
    },
});

/**
 * Get recent audit logs
 */
export const getRecentLogs = query({
    args: {
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const logs = await ctx.db
            .query("auditLogs")
            .withIndex("by_timestamp")
            .order("desc")
            .take(args.limit || 100);

        return logs;
    },
});

/**
 * Get failed operations
 *
 * OPTIMIZED: Fetches limited results, filters for failures.
 * Note: Consider adding a "by_success" index for better performance if failures are rare.
 */
export const getFailedOperations = query({
    args: {
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const maxResults = Math.min(args.limit || 100, 500);

        // Take more than needed since we filter for failures
        const logs = await ctx.db
            .query("auditLogs")
            .withIndex("by_timestamp")
            .order("desc")
            .take(maxResults * 10); // Take extra since failures are typically rare

        const failed = logs.filter((log) => !log.success);
        return failed.slice(0, maxResults);
    },
});

/**
 * Get audit statistics
 *
 * OPTIMIZED: Limits the sample size to prevent memory issues.
 * For full statistics on large datasets, consider using Convex Aggregate component.
 */
export const getStatistics = query({
    args: {
        startTime: v.optional(v.number()),
        endTime: v.optional(v.number()),
        sampleSize: v.optional(v.number()), // Max logs to analyze (default: 10000)
    },
    handler: async (ctx, args) => {
        const maxSample = Math.min(args.sampleSize || 10000, 50000);

        // Fetch limited sample for statistics
        let logs = await ctx.db
            .query("auditLogs")
            .withIndex("by_timestamp")
            .order("desc")
            .take(maxSample);

        // Filter by time range
        if (args.startTime) {
            logs = logs.filter((log) => log.timestamp >= args.startTime!);
        }
        if (args.endTime) {
            logs = logs.filter((log) => log.timestamp <= args.endTime!);
        }

        // Calculate statistics
        const stats = {
            total: logs.length,
            sampleLimited: logs.length >= maxSample, // Indicates if results were capped
            successful: logs.filter((log) => log.success).length,
            failed: logs.filter((log) => !log.success).length,
            byOperation: {} as Record<string, number>,
            byTable: {} as Record<string, number>,
            byResource: {} as Record<string, number>,
            avgDuration: 0,
            slowestOperations: [] as any[],
        };

        // Count by operation
        for (const log of logs) {
            stats.byOperation[log.operation] =
                (stats.byOperation[log.operation] || 0) + 1;
            stats.byTable[log.table] = (stats.byTable[log.table] || 0) + 1;
            stats.byResource[log.resourceName] =
                (stats.byResource[log.resourceName] || 0) + 1;
        }

        // Calculate average duration
        if (logs.length > 0) {
            stats.avgDuration =
                logs.reduce((sum, log) => sum + log.duration, 0) / logs.length;
        }

        // Find slowest operations
        stats.slowestOperations = [...logs]
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 10)
            .map((log) => ({
                operation: log.operation,
                table: log.table,
                duration: log.duration,
                timestamp: log.timestamp,
            }));

        return stats;
    },
});

/**
 * Delete old audit logs (used by cron job)
 *
 * IMPORTANT: Uses retentionDays instead of olderThan timestamp.
 * This ensures the cutoff is calculated at RUNTIME, not when the cron is deployed.
 */
export const deleteOldLogs = internalMutation({
    args: {
        retentionDays: v.optional(v.number()), // Days to retain (default: 30)
    },
    handler: async (ctx, args) => {
        // Calculate cutoff timestamp at RUNTIME
        const retentionMs = (args.retentionDays ?? 30) * 24 * 60 * 60 * 1000;
        const olderThan = Date.now() - retentionMs;

        // Use index range query for efficiency - delete in batches to avoid timeout
        const BATCH_SIZE = 500;
        let totalDeleted = 0;
        let hasMore = true;

        while (hasMore) {
            const oldLogs = await ctx.db
                .query("auditLogs")
                .withIndex("by_timestamp")
                .filter((q) => q.lt(q.field("timestamp"), olderThan))
                .take(BATCH_SIZE);

            if (oldLogs.length === 0) {
                hasMore = false;
                break;
            }

            // Delete in parallel for better performance
            await Promise.all(oldLogs.map((log) => ctx.db.delete(log._id)));
            totalDeleted += oldLogs.length;

            // If we got less than batch size, we're done
            if (oldLogs.length < BATCH_SIZE) {
                hasMore = false;
            }
        }

        console.log(`[cfx-db] Deleted ${totalDeleted} audit logs older than ${args.retentionDays ?? 30} days`);
        return { deleted: totalDeleted };
    },
});
