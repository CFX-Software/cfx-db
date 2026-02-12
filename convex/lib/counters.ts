import { ShardedCounter } from "@convex-dev/sharded-counter";
import { components } from "../_generated/api";
import { mutation, query } from "../_generated/server";
import { v } from "convex/values";

/**
 * Sharded Counter for CFX-DB
 *
 * Use this for high-throughput counters that would cause write contention
 * with regular Convex mutations. Examples:
 * - Online player count
 * - Total money in economy
 * - Event counters
 * - Statistics tracking
 *
 * Sharded counters split writes across multiple shards, allowing
 * many concurrent increments without conflicts.
 */
export const counter = new ShardedCounter(components.shardedCounter);

// ============================================
// COUNTER MUTATIONS
// ============================================

/**
 * Increment a counter by 1
 */
export const increment = mutation({
    args: {
        name: v.string(),
    },
    handler: async (ctx, args) => {
        await counter.add(ctx, args.name, 1);
        return { success: true, counter: args.name };
    },
});

/**
 * Decrement a counter by 1
 */
export const decrement = mutation({
    args: {
        name: v.string(),
    },
    handler: async (ctx, args) => {
        await counter.add(ctx, args.name, -1);
        return { success: true, counter: args.name };
    },
});

/**
 * Add a specific value to a counter (can be negative)
 */
export const add = mutation({
    args: {
        name: v.string(),
        value: v.number(),
    },
    handler: async (ctx, args) => {
        await counter.add(ctx, args.name, args.value);
        return { success: true, counter: args.name, added: args.value };
    },
});

// ============================================
// COUNTER QUERIES
// ============================================

/**
 * Get the current value of a counter
 */
export const get = query({
    args: {
        name: v.string(),
    },
    handler: async (ctx, args) => {
        const value = await counter.count(ctx, args.name);
        return value;
    },
});

/**
 * Get multiple counter values at once
 */
export const getMany = query({
    args: {
        names: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        const results: Record<string, number> = {};
        for (const name of args.names) {
            results[name] = await counter.count(ctx, name);
        }
        return results;
    },
});
