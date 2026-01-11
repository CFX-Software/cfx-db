/**
 * Snapshot Functions for CFX-DB
 *
 * Functions for creating and managing database snapshots.
 * Snapshots export all table data to JSON for backup/restore.
 */

import { mutation, query, internalMutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Create a snapshot metadata record
 */
export const createSnapshotMetadata = mutation({
    args: {
        name: v.string(),
        type: v.union(v.literal("automatic"), v.literal("manual")),
        tables: v.array(v.string()),
        createdBy: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Check if snapshot with this name already exists
        const existing = await ctx.db
            .query("snapshots")
            .withIndex("by_name", (q) => q.eq("name", args.name))
            .first();

        if (existing) {
            throw new Error(`Snapshot with name '${args.name}' already exists`);
        }

        // Create snapshot metadata
        const id = await ctx.db.insert("snapshots", {
            name: args.name,
            type: args.type,
            timestamp: Date.now(),
            tables: args.tables,
            recordCount: 0,
            status: "pending",
            createdBy: args.createdBy,
        });

        return { id, name: args.name };
    },
});

/**
 * Update snapshot status after completion
 */
export const updateSnapshotStatus = mutation({
    args: {
        name: v.string(),
        status: v.union(v.literal("completed"), v.literal("failed")),
        recordCount: v.optional(v.number()),
        size: v.optional(v.number()),
        error: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const snapshot = await ctx.db
            .query("snapshots")
            .withIndex("by_name", (q) => q.eq("name", args.name))
            .first();

        if (!snapshot) {
            throw new Error(`Snapshot '${args.name}' not found`);
        }

        await ctx.db.patch(snapshot._id, {
            status: args.status,
            recordCount: args.recordCount ?? snapshot.recordCount,
            size: args.size,
            error: args.error,
        });

        return { updated: true, name: args.name, status: args.status };
    },
});

/**
 * Get all snapshots
 */
export const getAllSnapshots = query({
    args: {},
    handler: async (ctx) => {
        const snapshots = await ctx.db
            .query("snapshots")
            .withIndex("by_timestamp")
            .order("desc")
            .collect();

        return snapshots;
    },
});

/**
 * Get snapshot by name
 */
export const getSnapshot = query({
    args: { name: v.string() },
    handler: async (ctx, args) => {
        const snapshot = await ctx.db
            .query("snapshots")
            .withIndex("by_name", (q) => q.eq("name", args.name))
            .first();

        return snapshot;
    },
});

/**
 * Get automatic snapshots
 */
export const getAutomaticSnapshots = query({
    args: {},
    handler: async (ctx) => {
        const snapshots = await ctx.db
            .query("snapshots")
            .withIndex("by_type", (q) => q.eq("type", "automatic"))
            .order("desc")
            .collect();

        return snapshots;
    },
});

/**
 * Get manual snapshots
 */
export const getManualSnapshots = query({
    args: {},
    handler: async (ctx) => {
        const snapshots = await ctx.db
            .query("snapshots")
            .withIndex("by_type", (q) => q.eq("type", "manual"))
            .order("desc")
            .collect();

        return snapshots;
    },
});

/**
 * Delete old snapshots (for cleanup)
 *
 * IMPORTANT: Uses retentionDays instead of olderThan timestamp.
 * This ensures the cutoff is calculated at RUNTIME, not when the cron is deployed.
 */
export const deleteOldSnapshots = internalMutation({
    args: {
        retentionDays: v.optional(v.number()), // Days to retain (default: 7)
        type: v.optional(v.union(v.literal("automatic"), v.literal("manual"))),
    },
    handler: async (ctx, args) => {
        // Calculate cutoff timestamp at RUNTIME
        const retentionMs = (args.retentionDays ?? 7) * 24 * 60 * 60 * 1000;
        const olderThan = Date.now() - retentionMs;

        // Fetch snapshots with or without type filter, limited to avoid memory issues
        const snapshots = args.type
            ? await ctx.db
                  .query("snapshots")
                  .withIndex("by_type", (q) => q.eq("type", args.type!))
                  .take(1000)
            : await ctx.db.query("snapshots").take(1000);

        // Filter by timestamp
        const toDelete = snapshots.filter((s) => s.timestamp < olderThan);

        // Delete in parallel for better performance
        await Promise.all(toDelete.map((snapshot) => ctx.db.delete(snapshot._id)));

        console.log(`[cfx-db] Deleted ${toDelete.length} ${args.type || 'all'} snapshots older than ${args.retentionDays ?? 7} days`);
        return { deleted: toDelete.length, names: toDelete.map((s) => s.name) };
    },
});

/**
 * Delete a specific snapshot
 */
export const deleteSnapshot = mutation({
    args: { name: v.string() },
    handler: async (ctx, args) => {
        const snapshot = await ctx.db
            .query("snapshots")
            .withIndex("by_name", (q) => q.eq("name", args.name))
            .first();

        if (!snapshot) {
            throw new Error(`Snapshot '${args.name}' not found`);
        }

        await ctx.db.delete(snapshot._id);

        return { deleted: true, name: args.name };
    },
});

/**
 * Get snapshot statistics
 */
export const getSnapshotStats = query({
    args: {},
    handler: async (ctx) => {
        const snapshots = await ctx.db.query("snapshots").collect();

        const automatic = snapshots.filter((s) => s.type === "automatic").length;
        const manual = snapshots.filter((s) => s.type === "manual").length;
        const completed = snapshots.filter((s) => s.status === "completed").length;
        const failed = snapshots.filter((s) => s.status === "failed").length;

        const totalSize = snapshots
            .filter((s) => s.size !== undefined)
            .reduce((sum, s) => sum + (s.size || 0), 0);

        const totalRecords = snapshots.reduce((sum, s) => sum + s.recordCount, 0);

        // Get latest snapshot
        const latest = snapshots.sort((a, b) => b.timestamp - a.timestamp)[0];

        return {
            total: snapshots.length,
            automatic,
            manual,
            completed,
            failed,
            totalSize,
            totalRecords,
            latestSnapshot: latest
                ? {
                      name: latest.name,
                      timestamp: latest.timestamp,
                      type: latest.type,
                      status: latest.status,
                  }
                : null,
        };
    },
});

/**
 * Export all data from a table (for backup)
 */
export const exportTableData = query({
    args: {
        table: v.string(),
        limit: v.optional(v.number()),
        offset: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const tableName = args.table as any;

        // Query all records from the table
        let query = ctx.db.query(tableName);

        const records = await query.collect();

        // Apply pagination if specified
        const start = args.offset || 0;
        const end = args.limit ? start + args.limit : records.length;

        return {
            table: args.table,
            records: records.slice(start, end),
            total: records.length,
            returned: end - start,
        };
    },
});
