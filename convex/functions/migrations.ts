/**
 * Migration System for CFX-DB
 *
 * Tracks schema migrations and provides functions to manage migration history.
 * Note: Convex handles actual schema deployment. This system tracks what changes
 * have been applied for documentation and rollback purposes.
 */

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Record a migration as applied
 */
export const recordMigration = mutation({
    args: {
        version: v.number(),
        name: v.string(),
        success: v.boolean(),
        error: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Check if migration already recorded
        const existing = await ctx.db
            .query("migrations")
            .withIndex("by_version", (q) => q.eq("version", args.version))
            .first();

        if (existing) {
            throw new Error(
                `Migration version ${args.version} already applied at ${new Date(existing.appliedAt).toISOString()}`
            );
        }

        // Record the migration
        const id = await ctx.db.insert("migrations", {
            version: args.version,
            name: args.name,
            appliedAt: Date.now(),
            success: args.success,
            error: args.error,
        });

        return { id, version: args.version, name: args.name };
    },
});

/**
 * Get all applied migrations
 */
export const getAppliedMigrations = query({
    args: {},
    handler: async (ctx) => {
        const migrations = await ctx.db
            .query("migrations")
            .withIndex("by_version")
            .order("asc")
            .collect();

        return migrations;
    },
});

/**
 * Get current schema version (highest applied migration)
 */
export const getCurrentVersion = query({
    args: {},
    handler: async (ctx) => {
        const migrations = await ctx.db
            .query("migrations")
            .withIndex("by_version")
            .order("desc")
            .filter((q) => q.eq(q.field("success"), true))
            .first();

        return migrations ? migrations.version : 0;
    },
});

/**
 * Check if a migration version has been applied
 */
export const isMigrationApplied = query({
    args: { version: v.number() },
    handler: async (ctx, args) => {
        const migration = await ctx.db
            .query("migrations")
            .withIndex("by_version", (q) => q.eq("version", args.version))
            .first();

        return migration !== null && migration.success;
    },
});

/**
 * Get migration by version
 */
export const getMigration = query({
    args: { version: v.number() },
    handler: async (ctx, args) => {
        const migration = await ctx.db
            .query("migrations")
            .withIndex("by_version", (q) => q.eq("version", args.version))
            .first();

        return migration;
    },
});

/**
 * Get migrations that failed
 */
export const getFailedMigrations = query({
    args: {},
    handler: async (ctx) => {
        const migrations = await ctx.db
            .query("migrations")
            .filter((q) => q.eq(q.field("success"), false))
            .collect();

        return migrations;
    },
});

/**
 * Delete a migration record (for rollback or fixing errors)
 * WARNING: Only use this if you know what you're doing
 */
export const deleteMigration = mutation({
    args: { version: v.number() },
    handler: async (ctx, args) => {
        const migration = await ctx.db
            .query("migrations")
            .withIndex("by_version", (q) => q.eq("version", args.version))
            .first();

        if (!migration) {
            throw new Error(`Migration version ${args.version} not found`);
        }

        await ctx.db.delete(migration._id);

        return { deleted: true, version: args.version };
    },
});

/**
 * Get migration statistics
 */
export const getMigrationStats = query({
    args: {},
    handler: async (ctx) => {
        const allMigrations = await ctx.db.query("migrations").collect();

        const successful = allMigrations.filter((m) => m.success).length;
        const failed = allMigrations.filter((m) => m.success === false).length;
        const currentVersion = allMigrations.length > 0
            ? Math.max(...allMigrations.filter((m) => m.success).map((m) => m.version))
            : 0;

        return {
            total: allMigrations.length,
            successful,
            failed,
            currentVersion,
            migrations: allMigrations.sort((a, b) => a.version - b.version),
        };
    },
});
