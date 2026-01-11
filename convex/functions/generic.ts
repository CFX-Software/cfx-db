import { query, mutation } from "../_generated/server";
import { v } from "convex/values";

/**
 * Generic CRUD functions that work with any table
 *
 * These provide a foundation for database operations.
 * Users can call these directly or create domain-specific wrappers.
 */

// =========================================
// Generic Queries
// =========================================

/**
 * Get a document by ID
 */
export const getById = query({
    args: {
        table: v.string(),
        id: v.string(),
    },
    handler: async (ctx, args) => {
        return ctx.db.get(args.id as any);
    },
});

/**
 * Get all documents from a table
 */
export const getAll = query({
    args: {
        table: v.string(),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const query = ctx.db.query(args.table as any);

        if (args.limit) {
            return query.take(args.limit);
        }

        return query.collect();
    },
});

/**
 * Query by index
 */
export const queryByIndex = query({
    args: {
        table: v.string(),
        indexName: v.string(),
        indexValue: v.any(),
    },
    handler: async (ctx, args) => {
        return ctx.db
            .query(args.table as any)
            .withIndex(args.indexName as any, (q: any) =>
                q.eq(args.indexName.replace('by_', ''), args.indexValue)
            )
            .collect();
    },
});

/**
 * Get first document matching index
 */
export const getFirstByIndex = query({
    args: {
        table: v.string(),
        indexName: v.string(),
        indexValue: v.any(),
    },
    handler: async (ctx, args) => {
        return ctx.db
            .query(args.table as any)
            .withIndex(args.indexName as any, (q: any) =>
                q.eq(args.indexName.replace('by_', ''), args.indexValue)
            )
            .first();
    },
});

// =========================================
// Generic Mutations
// =========================================

/**
 * Insert a new document
 */
export const insert = mutation({
    args: {
        table: v.string(),
        data: v.any(),
    },
    handler: async (ctx, args) => {
        return ctx.db.insert(args.table as any, args.data);
    },
});

/**
 * Update a document by ID
 */
export const update = mutation({
    args: {
        table: v.string(),
        id: v.string(),
        data: v.any(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.id as any, args.data);
        return args.id;
    },
});

/**
 * Delete a document by ID
 */
export const remove = mutation({
    args: {
        table: v.string(),
        id: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id as any);
        return { deleted: true, id: args.id };
    },
});

/**
 * Upsert - update if exists, insert if not
 */
export const upsert = mutation({
    args: {
        table: v.string(),
        indexName: v.string(),
        indexValue: v.any(),
        data: v.any(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query(args.table as any)
            .withIndex(args.indexName as any, (q: any) =>
                q.eq(args.indexName.replace('by_', ''), args.indexValue)
            )
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, args.data);
            return existing._id;
        } else {
            return ctx.db.insert(args.table as any, args.data);
        }
    },
});

// =========================================
// Key-Value Operations
// =========================================

/**
 * Get a value from the key-value store
 */
export const kvGet = query({
    args: { key: v.string() },
    handler: async (ctx, args) => {
        const entry = await ctx.db
            .query("keyValue")
            .withIndex("by_key", (q) => q.eq("key", args.key))
            .first();

        return entry?.value;
    },
});

/**
 * Set a value in the key-value store
 */
export const kvSet = mutation({
    args: {
        key: v.string(),
        value: v.any(),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("keyValue")
            .withIndex("by_key", (q) => q.eq("key", args.key))
            .first();

        if (existing) {
            await ctx.db.patch(existing._id, {
                value: args.value,
                updatedAt: Date.now(),
            });
            return existing._id;
        } else {
            return ctx.db.insert("keyValue", {
                key: args.key,
                value: args.value,
                updatedAt: Date.now(),
            });
        }
    },
});

/**
 * Delete a key from the key-value store
 */
export const kvDelete = mutation({
    args: { key: v.string() },
    handler: async (ctx, args) => {
        const entry = await ctx.db
            .query("keyValue")
            .withIndex("by_key", (q) => q.eq("key", args.key))
            .first();

        if (entry) {
            await ctx.db.delete(entry._id);
            return { deleted: true };
        }

        return { deleted: false };
    },
});
