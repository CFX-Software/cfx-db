import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * CFX-DB Minimal Schema
 *
 * This is a basic example schema to demonstrate the framework.
 * Users should extend this with their own tables and fields based on their needs.
 */
export default defineSchema({
    /**
     * Example: Simple player table
     *
     * This demonstrates the basic pattern. Add your own tables following this structure.
     *
     * SECURITY NOTE: The "by_identifier" index prevents duplicate players when using
     * upsert operations. Without it, race conditions can create duplicate records.
     */
    players: defineTable({
        identifier: v.string(),        // Primary FiveM identifier (e.g., license:xxx)
        name: v.string(),              // Player name
        firstJoin: v.number(),         // Timestamp of first join
        lastSeen: v.number(),          // Timestamp of last seen
        online: v.optional(v.boolean()), // Online status
        money: v.optional(v.number()),   // Cash money
        bank: v.optional(v.number()),    // Bank money
    })
        .index("by_identifier", ["identifier"])  // For fast lookups by identifier
        .index("by_online", ["online"])          // For querying online players
        .index("by_money", ["money"]),           // For leaderboards/rankings

    /**
     * Generic key-value store for simple data
     *
     * Use this for storing simple settings, flags, or small pieces of data
     * without creating dedicated tables.
     *
     * SECURITY NOTE: The "by_key" index prevents duplicate keys when using
     * upsert operations.
     */
    keyValue: defineTable({
        key: v.string(),
        value: v.any(),
        updatedAt: v.number(),
    }).index("by_key", ["key"]),  // Unique key lookup

    /**
     * Audit Logs - Track all database operations
     *
     * Used for anti-cheat, debugging, compliance, and security monitoring.
     * Logs ALL CRUD operations with metadata for investigation and analysis.
     *
     * RETENTION: Auto-cleanup after 30 days (configured in crons.ts)
     */
    auditLogs: defineTable({
        operation: v.string(),              // "insert", "update", "delete", "select"
        table: v.string(),                  // Target table name
        resourceName: v.string(),           // FiveM resource that made the call
        playerId: v.optional(v.string()),   // FiveM player ID if applicable
        data: v.optional(v.any()),          // Data being written (for insert/update)
        where: v.optional(v.any()),         // Where clause (for update/delete/select)
        results: v.optional(v.any()),       // Results summary (count, IDs, etc.)
        timestamp: v.number(),              // Unix timestamp
        duration: v.number(),               // Execution time in milliseconds
        success: v.boolean(),               // Did operation succeed?
        error: v.optional(v.string()),      // Error message if failed
    })
        .index("by_timestamp", ["timestamp"])
        .index("by_table", ["table", "timestamp"])
        .index("by_resource", ["resourceName", "timestamp"])
        .index("by_player", ["playerId", "timestamp"])
        .index("by_operation", ["operation", "timestamp"]),

    /**
     * Migration History - Track applied schema migrations
     *
     * Used for schema versioning and safe database evolution.
     * Tracks which migrations have been applied to prevent re-running them.
     */
    migrations: defineTable({
        version: v.number(),            // Migration version number
        name: v.string(),               // Migration name (e.g., "add_vehicles_table")
        appliedAt: v.number(),          // Unix timestamp when applied
        success: v.boolean(),           // Did migration succeed?
        error: v.optional(v.string()),  // Error message if failed
    }).index("by_version", ["version"]),

    /**
     * Snapshot Metadata - Track database snapshots
     *
     * Used for backup and disaster recovery.
     * Stores metadata about snapshots. Actual data is exported to JSON files.
     */
    snapshots: defineTable({
        name: v.string(),                   // Snapshot name (e.g., "auto_2024-01-15")
        type: v.union(v.literal("automatic"), v.literal("manual")), // Type of snapshot
        timestamp: v.number(),              // Unix timestamp when created
        tables: v.array(v.string()),        // Tables included in snapshot
        recordCount: v.number(),            // Total records in snapshot
        size: v.optional(v.number()),       // Approximate size in bytes
        status: v.union(
            v.literal("pending"),
            v.literal("completed"),
            v.literal("failed")
        ),
        error: v.optional(v.string()),      // Error message if failed
        createdBy: v.optional(v.string()),  // Resource that created snapshot
    })
        .index("by_timestamp", ["timestamp"])
        .index("by_type", ["type", "timestamp"])
        .index("by_name", ["name"]),
});

/**
 * How to extend this schema:
 *
 * 1. Add your own tables:
 *    vehicles: defineTable({ ... }).index(...),
 *    inventory: defineTable({ ... }).index(...),
 *
 * 2. Reference the Convex docs for schema patterns:
 *    https://docs.convex.dev/database/schemas
 *
 * 3. Use the generic CRUD functions in functions/generic.ts
 *    or create your own domain-specific functions
 */
