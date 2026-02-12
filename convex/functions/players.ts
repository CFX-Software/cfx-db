import { query, mutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Example: Player Functions
 *
 * This demonstrates how to create domain-specific functions
 * using the players table from schema.ts
 *
 * Users can follow this pattern for their own tables.
 */

// =========================================
// Queries
// =========================================

/**
 * Get a player by identifier
 */
export const get = query({
    args: { identifier: v.string() },
    handler: async (ctx, args) => {
        return ctx.db
            .query("players")
            .withIndex("by_identifier", (q) => q.eq("identifier", args.identifier))
            .first();
    },
});

/**
 * Get all players
 */
export const getAll = query({
    args: { limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const query = ctx.db.query("players");

        if (args.limit) {
            return query.take(args.limit);
        }

        return query.collect();
    },
});

// =========================================
// Mutations
// =========================================

/**
 * Create or update player on join
 */
export const upsertOnJoin = mutation({
    args: {
        identifier: v.string(),
        name: v.string(),
    },
    handler: async (ctx, args) => {
        const timestamp = Date.now();

        const existing = await ctx.db
            .query("players")
            .withIndex("by_identifier", (q) => q.eq("identifier", args.identifier))
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, {
                name: args.name,
                lastSeen: timestamp,
            });
            return existing._id;
        } else {
            return ctx.db.insert("players", {
                identifier: args.identifier,
                name: args.name,
                firstJoin: timestamp,
                lastSeen: timestamp,
            });
        }
    },
});

/**
 * Update player's last seen timestamp
 */
export const updateLastSeen = mutation({
    args: { identifier: v.string() },
    handler: async (ctx, args) => {
        const player = await ctx.db
            .query("players")
            .withIndex("by_identifier", (q) => q.eq("identifier", args.identifier))
            .first();

        if (!player) {
            throw new Error(`Player not found: ${args.identifier}`);
        }

        await ctx.db.patch(player._id, {
            lastSeen: Date.now(),
        });

        return player._id;
    },
});

/**
 * Delete a player
 */
export const remove = mutation({
    args: { identifier: v.string() },
    handler: async (ctx, args) => {
        const player = await ctx.db
            .query("players")
            .withIndex("by_identifier", (q) => q.eq("identifier", args.identifier))
            .first();

        if (!player) {
            throw new Error(`Player not found: ${args.identifier}`);
        }

        await ctx.db.delete(player._id);
        return { deleted: true, playerId: player._id };
    },
});
