import { query } from "../_generated/server";
import { v } from "convex/values";
import { validateTableAccess, validateWhereClause, validateQueryOptions } from "../lib/validators";

/**
 * Relationship Helpers for CFX-DB
 *
 * Provides JOIN-like functionality to query related data across tables.
 * Fetches primary data first, then fetches related data using foreign keys.
 *
 * OPTIMIZED: Now uses limits and fetches related records more efficiently.
 */

// Maximum relation depth to prevent DoS
const MAX_RELATION_DEPTH = 3;
// Maximum records to fetch per relation to prevent memory issues
const MAX_RELATED_RECORDS = 1000;
// Maximum primary records
const MAX_PRIMARY_RECORDS = 500;

/**
 * Query with relations (JOIN-like)
 *
 * Fetches primary records and then fetches related data from other tables.
 *
 * PERFORMANCE NOTE: For best performance, ensure related tables have indexes
 * on their foreign key fields (e.g., vehicles should have "by_player_id" index).
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
                indexName: v.optional(v.string()), // Optional: index name for faster lookups
                limit: v.optional(v.number()), // Max related records per parent (for "many" type)
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

        // Calculate effective limit for primary records
        const requestedLimit = args.options?.limit || MAX_PRIMARY_RECORDS;
        const effectiveLimit = Math.min(requestedLimit, MAX_PRIMARY_RECORDS);

        // Fetch primary records with limit
        let dbQuery = ctx.db.query(args.table as any);

        // Apply where clause
        if (args.where) {
            dbQuery = dbQuery.filter((q: any) => {
                let result: any = null;
                for (const [key, value] of Object.entries(args.where)) {
                    const condition = q.eq(q.field(key), value);
                    result = result === null ? condition : q.and(result, condition);
                }
                return result;
            });
        }

        // Fetch with limit + offset buffer
        const fetchLimit = effectiveLimit + (args.options?.offset || 0);
        let records = await dbQuery.take(Math.min(fetchLimit, MAX_PRIMARY_RECORDS));

        // Apply offset
        if (args.options?.offset) {
            records = records.slice(args.options.offset);
        }

        // Apply limit
        records = records.slice(0, effectiveLimit);

        // Apply field selection to primary records (but keep localKey for relations)
        const localKeysNeeded = new Set(args.relations.map(r => r.localKey || "_id"));
        if (args.options?.select) {
            records = records.map((r: any) => {
                const selected: any = { _id: r._id };
                for (const field of args.options!.select!) {
                    if (field in r) {
                        selected[field] = r[field];
                    }
                }
                // Keep localKeys even if not in select
                for (const key of localKeysNeeded) {
                    if (key in r && !(key in selected)) {
                        selected[key] = r[key];
                    }
                }
                return selected;
            });
        }

        // Fetch related data for each relation
        for (const relation of args.relations) {
            const localKey = relation.localKey || "_id";
            const localKeys = records.map((r: any) => r[localKey]);
            const uniqueLocalKeys = [...new Set(localKeys)];

            // Skip if no records to relate
            if (uniqueLocalKeys.length === 0) {
                for (const record of records) {
                    (record as any)[relation.name] = relation.type === "one" ? null : [];
                }
                continue;
            }

            // Fetch related records - use index if specified, otherwise limited fetch
            let relatedRecords: any[];

            if (relation.indexName) {
                // Use specified index for each unique key (more efficient for small key sets)
                const relatedPromises = uniqueLocalKeys.map(async (keyValue) => {
                    return ctx.db
                        .query(relation.table as any)
                        .withIndex(relation.indexName as any, (q: any) =>
                            q.eq(relation.foreignKey, keyValue)
                        )
                        .take(relation.limit || (relation.type === "one" ? 1 : 100));
                });
                const relatedArrays = await Promise.all(relatedPromises);
                relatedRecords = relatedArrays.flat();
            } else {
                // Fallback: fetch limited records and filter (less efficient)
                const allRelated = await ctx.db
                    .query(relation.table as any)
                    .take(MAX_RELATED_RECORDS);

                relatedRecords = allRelated.filter((r: any) =>
                    uniqueLocalKeys.includes(r[relation.foreignKey])
                );
            }

            // Apply field selection to related records
            const processedRelated = relation.select
                ? relatedRecords.map((r: any) => {
                      const selected: any = { _id: r._id };
                      // Always include foreign key for matching
                      selected[relation.foreignKey] = r[relation.foreignKey];
                      for (const field of relation.select!) {
                          if (field in r) {
                              selected[field] = r[field];
                          }
                      }
                      return selected;
                  })
                : relatedRecords;

            // Attach related data to primary records
            for (const record of records) {
                const localValue = (record as any)[localKey];

                if (relation.type === "one") {
                    (record as any)[relation.name] =
                        processedRelated.find(
                            (r: any) => r[relation.foreignKey] === localValue
                        ) || null;
                } else {
                    const related = processedRelated.filter(
                        (r: any) => r[relation.foreignKey] === localValue
                    );
                    // Apply per-parent limit for "many" relations
                    (record as any)[relation.name] = relation.limit
                        ? related.slice(0, relation.limit)
                        : related;
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
 *
 * OPTIMIZED: Uses limits and index-based lookups when available.
 * For high-performance counting at scale, consider using Convex Aggregate component.
 */
export const countWithRelations = query({
    args: {
        table: v.string(),
        where: v.optional(v.any()),
        relation: v.object({
            table: v.string(),
            foreignKey: v.string(),
            localKey: v.optional(v.string()),
            indexName: v.optional(v.string()), // Optional: index for faster counting
        }),
        limit: v.optional(v.number()), // Max primary records to count for
    },
    handler: async (ctx, args) => {
        validateTableAccess(args.table);
        validateTableAccess(args.relation.table);

        const maxRecords = Math.min(args.limit || 100, MAX_PRIMARY_RECORDS);

        // Fetch primary records with limit
        let dbQuery = ctx.db.query(args.table as any);

        if (args.where) {
            dbQuery = dbQuery.filter((q: any) => {
                let result: any = null;
                for (const [key, value] of Object.entries(args.where)) {
                    const condition = q.eq(q.field(key), value);
                    result = result === null ? condition : q.and(result, condition);
                }
                return result;
            });
        }

        const records = await dbQuery.take(maxRecords);

        // Count related records for each primary record
        const localKey = args.relation.localKey || "_id";
        const counts: { [key: string]: number } = {};

        if (args.relation.indexName) {
            // Use index for efficient counting
            const countPromises = records.map(async (record: any) => {
                const localValue = record[localKey];
                const related = await ctx.db
                    .query(args.relation.table as any)
                    .withIndex(args.relation.indexName as any, (q: any) =>
                        q.eq(args.relation.foreignKey, localValue)
                    )
                    .take(10000); // Cap at reasonable limit
                return { key: localValue, count: related.length };
            });
            const results = await Promise.all(countPromises);
            for (const { key, count } of results) {
                counts[key] = count;
            }
        } else {
            // Fallback: fetch limited related records
            const allRelated = await ctx.db
                .query(args.relation.table as any)
                .take(MAX_RELATED_RECORDS);

            for (const record of records) {
                const localValue = (record as any)[localKey];
                const count = allRelated.filter(
                    (r: any) => r[args.relation.foreignKey] === localValue
                ).length;
                counts[localValue] = count;
            }
        }

        return counts;
    },
});
