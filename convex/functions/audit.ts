import { query, mutation, internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Audit Log Query Functions
 *
 * Provides queries for analyzing audit logs for anti-cheat, debugging, and compliance.
 */

/**
 * Query audit logs with filters
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
        // Use index if specific filter provided
        let results;
        if (args.table) {
            results = await ctx.db
                .query("auditLogs")
                .withIndex("by_table", (q) => q.eq("table", args.table!))
                .collect();
        } else if (args.operation) {
            results = await ctx.db
                .query("auditLogs")
                .withIndex("by_operation", (q) => q.eq("operation", args.operation!))
                .collect();
        } else if (args.resourceName) {
            results = await ctx.db
                .query("auditLogs")
                .withIndex("by_resource", (q) => q.eq("resourceName", args.resourceName!))
                .collect();
        } else if (args.playerId) {
            results = await ctx.db
                .query("auditLogs")
                .withIndex("by_player", (q) => q.eq("playerId", args.playerId!))
                .collect();
        } else {
            results = await ctx.db
                .query("auditLogs")
                .withIndex("by_timestamp")
                .order("desc")
                .collect();
        }

        // Filter by timestamp range
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

        // Sort by timestamp (newest first)
        results.sort((a, b) => b.timestamp - a.timestamp);

        // Apply limit
        if (args.limit) {
            results = results.slice(0, args.limit);
        }

        return results;
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
 */
export const getFailedOperations = query({
    args: {
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const logs = await ctx.db
            .query("auditLogs")
            .withIndex("by_timestamp")
            .order("desc")
            .collect();

        const failed = logs.filter((log) => !log.success);

        return failed.slice(0, args.limit || 100);
    },
});

/**
 * Get audit statistics
 */
export const getStatistics = query({
    args: {
        startTime: v.optional(v.number()),
        endTime: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        let logs = await ctx.db
            .query("auditLogs")
            .withIndex("by_timestamp")
            .collect();

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
        stats.slowestOperations = logs
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
 */
export const deleteOldLogs = internalMutation({
    args: {
        olderThan: v.number(), // Unix timestamp
    },
    handler: async (ctx, args) => {
        const oldLogs = await ctx.db
            .query("auditLogs")
            .withIndex("by_timestamp")
            .filter((q) => q.lt(q.field("timestamp"), args.olderThan))
            .collect();

        let deleted = 0;
        for (const log of oldLogs) {
            await ctx.db.delete(log._id);
            deleted++;
        }

        return { deleted };
    },
});
