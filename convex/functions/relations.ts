import { query } from "../_generated/server";
import { v } from "convex/values";
import { validateTableAccess, validateWhereClause, validateQueryOptions } from "../lib/validators";

/**
 * Relationship Helpers for CFX-DB
 *
 * Provides JOIN-like functionality to query related data across tables.
 * Fetches primary data first, then fetches related data using foreign keys.
 */

// Maximum relation depth to prevent DoS
const MAX_RELATION_DEPTH = 3;

/**
 * Query with relations (JOIN-like)
 *
 * Fetches primary records and then fetches related data from other tables.
 */
export const queryWithRelations = query({
    args: {
        table: v.string(),
        where: v.optional(v.any()),
        options: v.optional(
            v.object({
                orderBy: v.optional(v.any()),
                limit: v.optional(v.number()),
                offset: v.optional(v.number()),
                select: v.optional(v.array(v.string())),
            })
        ),
        relations: v.array(
            v.object({
                name: v.string(), // Alias for the relation
                table: v.string(), // Related table
                foreignKey: v.string(), // Field in related table
                localKey: v.optional(v.string()), // Field in this table (defaults to _id)
                type: v.union(v.literal("one"), v.literal("many")), // 1:1 or 1:N
                select: v.optional(v.array(v.string())), // Fields to include from related table
            })
        ),
    },
    handler: async (ctx, args) => {
        // Validate table access
        validateTableAccess(args.table);

        // Validate where clause
        if (args.where) {
            validateWhereClause(args.where);
        }

        // Validate query options
        if (args.options) {
            validateQueryOptions(args.options);
        }

        // Validate relations
        if (args.relations.length > MAX_RELATION_DEPTH) {
            throw new Error(
                `Too many relations (max ${MAX_RELATION_DEPTH})`
            );
        }

        for (const relation of args.relations) {
            validateTableAccess(relation.table);
        }

        // Fetch primary records
        let query = ctx.db.query(args.table as any);

        // Apply where clause
        if (args.where) {
            query = query.filter((q: any) => {
                // Simple equality check
                for (const [key, value] of Object.entries(args.where)) {
                    if (!q.eq(q.field(key), value)) {
                        return false;
                    }
                }
                return true;
            });
        }

        // Fetch records
        let records = await query.collect();

        // Apply offset
        if (args.options?.offset) {
            records = records.slice(args.options.offset);
        }

        // Apply limit
        if (args.options?.limit) {
            records = records.slice(0, args.options.limit);
        }

        // Apply field selection to primary records
        if (args.options?.select) {
            records = records.map((r: any) => {
                const selected: any = { _id: r._id };
                for (const field of args.options!.select!) {
                    if (field in r) {
                        selected[field] = r[field];
                    }
                }
                return selected;
            });
        }

        // Fetch related data for each relation
        for (const relation of args.relations) {
            // Extract local keys from primary records
            const localKey = relation.localKey || "_id";
            const localKeys = records.map((r: any) => r[localKey]);

            // Fetch all related records in one query
            const relatedRecords = await ctx.db.query(relation.table as any).collect();

            // Filter related records by foreign key
            const matchingRelated = relatedRecords.filter((r: any) =>
                localKeys.includes(r[relation.foreignKey])
            );

            // Apply field selection to related records
            const processedRelated = relation.select
                ? matchingRelated.map((r: any) => {
                      const selected: any = { _id: r._id };
                      for (const field of relation.select!) {
                          if (field in r) {
                              selected[field] = r[field];
                          }
                      }
                      return selected;
                  })
                : matchingRelated;

            // Attach related data to primary records
            for (const record of records) {
                const localValue = (record as any)[localKey];

                if (relation.type === "one") {
                    // 1:1 relationship - find first match
                    (record as any)[relation.name] =
                        processedRelated.find(
                            (r: any) => r[relation.foreignKey] === localValue
                        ) || null;
                } else {
                    // 1:N relationship - find all matches
                    (record as any)[relation.name] = processedRelated.filter(
                        (r: any) => r[relation.foreignKey] === localValue
                    );
                }
            }
        }

        return records;
    },
});

/**
 * Nested query with relations
 *
 * Allows fetching relations that themselves have relations (depth: 2+)
 * Use with caution - can be slow with deep nesting.
 */
export const queryWithNestedRelations = query({
    args: {
        table: v.string(),
        where: v.optional(v.any()),
        relations: v.array(
            v.object({
                name: v.string(),
                table: v.string(),
                foreignKey: v.string(),
                localKey: v.optional(v.string()),
                type: v.union(v.literal("one"), v.literal("many")),
                select: v.optional(v.array(v.string())),
                // Nested relations
                relations: v.optional(v.array(v.any())),
            })
        ),
    },
    handler: async (ctx, args) => {
        // TODO: Implement nested relations
        // For now, just call queryWithRelations without nesting
        throw new Error("Nested relations not yet implemented - use queryWithRelations for now");
    },
});

/**
 * Count with relations
 *
 * Useful for getting counts of related data without fetching all records.
 */
export const countWithRelations = query({
    args: {
        table: v.string(),
        where: v.optional(v.any()),
        relation: v.object({
            table: v.string(),
            foreignKey: v.string(),
            localKey: v.optional(v.string()),
        }),
    },
    handler: async (ctx, args) => {
        validateTableAccess(args.table);
        validateTableAccess(args.relation.table);

        // Fetch primary records
        let query = ctx.db.query(args.table as any);

        if (args.where) {
            query = query.filter((q: any) => {
                for (const [key, value] of Object.entries(args.where)) {
                    if (!q.eq(q.field(key), value)) {
                        return false;
                    }
                }
                return true;
            });
        }

        const records = await query.collect();

        // Count related records for each primary record
        const localKey = args.relation.localKey || "_id";
        const counts: { [key: string]: number } = {};

        const allRelated = await ctx.db.query(args.relation.table as any).collect();

        for (const record of records) {
            const localValue = (record as any)[localKey];
            const count = allRelated.filter(
                (r: any) => r[args.relation.foreignKey] === localValue
            ).length;

            counts[localValue] = count;
        }

        return counts;
    },
});
