import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { Doc, Id } from "../_generated/dataModel";
import { validateTableAccess, validateWhereClause, sanitizeData, validateQueryOptions } from "../lib/validators";
import { validateData } from "../lib/validation_rules";

/**
 * Generic CRUD Operations for cfx-db
 *
 * Provides a unified interface for all database operations:
 * - INSERT: Create new records
 * - SELECT: Query records with filtering, sorting, pagination
 * - UPDATE: Modify existing records
 * - DELETE: Remove records
 * - COUNT: Count matching records
 */

// Args validation schema
const crudArgs = {
    operation: v.union(
        v.literal("insert"),
        v.literal("select"),
        v.literal("update"),
        v.literal("delete"),
        v.literal("count"),
        v.literal("upsert")
    ),
    table: v.string(),
    data: v.optional(v.any()),
    where: v.optional(v.any()),
    options: v.optional(v.object({
        orderBy: v.optional(v.any()),
        limit: v.optional(v.number()),
        offset: v.optional(v.number()),
        select: v.optional(v.array(v.string())),
    })),
    // For upsert
    insert: v.optional(v.any()),
    update: v.optional(v.any()),
};

/**
 * Main CRUD execution function (mutation)
 * Used for: INSERT, UPDATE, DELETE, UPSERT
 */
export const execute = mutation({
    args: crudArgs,
    handler: async (ctx, args) => {
        const startTime = Date.now();
        let success = false;
        let error: string | undefined;
        let results: any;

        try {
            // Validate table access
            validateTableAccess(args.table);

            // Validate where clause if present
            if (args.where) {
                validateWhereClause(args.where);
            }

            // Validate query options if present
            if (args.options) {
                validateQueryOptions(args.options);
            }

            // Route to appropriate handler
            switch (args.operation) {
                case "insert":
                    results = await handleInsert(ctx, args.table, args.data);
                    break;

                case "update":
                    results = await handleUpdate(ctx, args.table, args.where, args.data);
                    break;

                case "delete":
                    results = await handleDelete(ctx, args.table, args.where);
                    break;

                case "upsert":
                    results = await handleUpsert(ctx, args.table, args.where, args.insert, args.update);
                    break;

                case "select":
                    // Allow SELECT in mutation for consistency (though query is better)
                    results = await handleSelect(ctx, args.table, args.where, args.options);
                    break;

                case "count":
                    results = await handleCount(ctx, args.table, args.where);
                    break;

                default:
                    throw new Error(`Unknown operation: ${args.operation}`);
            }

            success = true;
            return results;
        } catch (e: any) {
            success = false;
            error = e.message;
            throw e;
        } finally {
            // Write audit log (async, non-blocking)
            await writeAuditLog(ctx, {
                operation: args.operation,
                table: args.table,
                resourceName: (args as any)._meta?.resourceName,
                playerId: (args as any)._meta?.playerId,
                data: args.data || args.insert,
                where: args.where,
                results: success ? {
                    count: Array.isArray(results) ? results.length : (results?.updated || results?.deleted || 1)
                } : undefined,
                timestamp: Date.now(),
                duration: Date.now() - startTime,
                success,
                error,
            });
        }
    }
});

/**
 * Read-only CRUD function (query)
 * Used for: SELECT, COUNT
 * Use this for subscriptions and real-time queries
 */
export const read = query({
    args: {
        operation: v.union(v.literal("select"), v.literal("count")),
        table: v.string(),
        where: v.optional(v.any()),
        options: v.optional(v.object({
            orderBy: v.optional(v.any()),
            limit: v.optional(v.number()),
            offset: v.optional(v.number()),
            select: v.optional(v.array(v.string())),
        })),
    },
    handler: async (ctx, args) => {
        const startTime = Date.now();
        let success = false;
        let error: string | undefined;
        let results: any;

        try {
            validateTableAccess(args.table);

            if (args.where) {
                validateWhereClause(args.where);
            }

            // Validate query options if present
            if (args.options) {
                validateQueryOptions(args.options);
            }

            switch (args.operation) {
                case "select":
                    results = await handleSelect(ctx, args.table, args.where, args.options);
                    break;

                case "count":
                    results = await handleCount(ctx, args.table, args.where);
                    break;

                default:
                    throw new Error(`Unknown read operation: ${args.operation}`);
            }

            success = true;
            return results;
        } catch (e: any) {
            success = false;
            error = e.message;
            throw e;
        } finally {
            // Write audit log (async, non-blocking)
            // Note: In queries, we can't write to DB, so this would need to be done via a mutation
            // For now, we'll skip audit logging in read queries to keep them pure
            // Alternatively, could use a scheduled function to batch log reads
        }
    }
});

// ============================================
// CRUD HANDLERS
// ============================================

// Performance limits
const MAX_COLLECT = 10000;    // Maximum records to load into memory
const MAX_COUNT = 100000;     // Maximum count cap
const MAX_BATCH_SIZE = 100;   // Maximum batch operation size

/**
 * Write audit log entry
 * Non-blocking - errors are logged but don't fail the operation
 */
async function writeAuditLog(ctx: any, log: {
    operation: string;
    table: string;
    resourceName?: string;
    playerId?: string;
    data?: any;
    where?: any;
    results?: any;
    timestamp: number;
    duration: number;
    success: boolean;
    error?: string;
}): Promise<void> {
    try {
        await ctx.db.insert("auditLogs", {
            operation: log.operation,
            table: log.table,
            resourceName: log.resourceName || "unknown",
            playerId: log.playerId,
            data: log.data,
            where: log.where,
            results: log.results,
            timestamp: log.timestamp,
            duration: log.duration,
            success: log.success,
            error: log.error,
        });
    } catch (error: any) {
        // Never fail operation due to audit log failure
        console.error("[cfx-db] Failed to write audit log:", error.message);
    }
}

/**
 * INSERT: Create new record(s)
 */
async function handleInsert(ctx: any, table: string, data: any) {
    if (!data) {
        throw new Error("INSERT requires data");
    }

    // Handle batch insert
    if (Array.isArray(data)) {
        const results = [];
        for (const item of data) {
            const sanitized = sanitizeData(item);
            // Validate data against table rules
            validateData(table, sanitized, "insert");
            const id = await ctx.db.insert(table as any, sanitized);
            results.push(id);
        }
        return results;
    }

    // Single insert
    const sanitized = sanitizeData(data);
    // Validate data against table rules
    validateData(table, sanitized, "insert");
    const id = await ctx.db.insert(table as any, sanitized);
    return id;
}

/**
 * SELECT: Query records with filtering, sorting, pagination
 */
async function handleSelect(ctx: any, table: string, where?: any, options?: any) {
    let query = ctx.db.query(table);

    // Apply where filters
    if (where) {
        query = applyWhereClause(query, where);
    }

    // Apply ordering
    if (options?.orderBy) {
        query = applyOrderBy(query, options.orderBy);
    }

    // Use .take() for limit to avoid loading all records
    if (options?.limit && !options?.offset) {
        const results = await query.take(options.limit);
        return applyFieldSelection(results, options?.select);
    }

    // For offset, we need to collect but cap it
    let results = await query.take(MAX_COLLECT);

    // Warn if we hit the cap
    if (results.length >= MAX_COLLECT) {
        console.warn(`[cfx-db] Query returned ${MAX_COLLECT}+ results, capping at ${MAX_COLLECT}`);
    }

    // Apply offset
    if (options?.offset) {
        results = results.slice(options.offset);
    }

    // Apply limit
    if (options?.limit) {
        results = results.slice(0, options.limit);
    }

    return applyFieldSelection(results, options?.select);
}

/**
 * UPDATE: Modify existing record(s)
 */
async function handleUpdate(ctx: any, table: string, where: any, data: any) {
    if (!data) {
        throw new Error("UPDATE requires data");
    }

    if (!where) {
        throw new Error("UPDATE requires where clause (use {where: {}} to update all)");
    }

    // Find matching records
    let query = ctx.db.query(table);
    query = applyWhereClause(query, where);
    const records = await query.collect();

    if (records.length === 0) {
        return { updated: 0 };
    }

    // Update each matching record
    const sanitized = sanitizeData(data);
    // Validate data against table rules
    validateData(table, sanitized, "update");
    for (const record of records) {
        await ctx.db.patch(record._id, sanitized);
    }

    return { updated: records.length };
}

/**
 * DELETE: Remove record(s)
 */
async function handleDelete(ctx: any, table: string, where: any) {
    if (!where) {
        throw new Error("DELETE requires where clause (use {where: {}} to delete all)");
    }

    // Find matching records
    let query = ctx.db.query(table);
    query = applyWhereClause(query, where);
    const records = await query.collect();

    if (records.length === 0) {
        return { deleted: 0 };
    }

    // Delete each matching record
    for (const record of records) {
        await ctx.db.delete(record._id);
    }

    return { deleted: records.length };
}

/**
 * COUNT: Count matching records
 */
async function handleCount(ctx: any, table: string, where?: any) {
    let query = ctx.db.query(table);

    if (where) {
        query = applyWhereClause(query, where);
    }

    // Cap the count to prevent memory exhaustion
    const results = await query.take(MAX_COUNT);

    if (results.length >= MAX_COUNT) {
        console.warn(`[cfx-db] Count exceeded ${MAX_COUNT}, returning capped value`);
    }

    return results.length;
}

/**
 * UPSERT: Insert if not exists, update if exists
 *
 * NOTE: This implementation has a potential race condition for concurrent upserts.
 * To prevent duplicates, ensure your table has a unique index on the upsert key.
 * Example: .index("by_identifier", ["identifier"]).
 * Then Convex will enforce uniqueness at the database level.
 */
async function handleUpsert(ctx: any, table: string, where: any, insertData: any, updateData: any) {
    if (!where) {
        throw new Error("UPSERT requires where clause");
    }

    // Try to update first (optimistic approach)
    let query = ctx.db.query(table);
    query = applyWhereClause(query, where);
    const existing = await query.first();

    if (existing) {
        // Update existing record
        const sanitized = sanitizeData(updateData);
        // Validate data against table rules
        validateData(table, sanitized, "update");
        await ctx.db.patch(existing._id, sanitized);
        return { action: "updated", id: existing._id };
    }

    // Record doesn't exist, try to insert
    // Note: If another concurrent upsert inserts between our check and insert,
    // this will fail if there's a unique index (which is good - prevents duplicates)
    // Without a unique index, duplicates are possible
    try {
        const sanitized = sanitizeData(insertData);
        // Validate data against table rules
        validateData(table, sanitized, "insert");
        const id = await ctx.db.insert(table as any, sanitized);
        return { action: "inserted", id };
    } catch (error: any) {
        // If insert failed due to unique constraint, try update again
        if (error.message && error.message.includes("unique")) {
            const retryQuery = ctx.db.query(table);
            const retryExisting = await applyWhereClause(retryQuery, where).first();
            if (retryExisting) {
                const sanitized = sanitizeData(updateData);
                // Validate data against table rules
                validateData(table, sanitized, "update");
                await ctx.db.patch(retryExisting._id, sanitized);
                return { action: "updated", id: retryExisting._id };
            }
        }
        throw error;
    }
}

// ============================================
// QUERY BUILDING HELPERS
// ============================================

/**
 * Apply field selection to results
 */
function applyFieldSelection(results: any[], selectFields?: string[]): any[] {
    if (!selectFields || !Array.isArray(selectFields)) {
        return results;
    }

    return results.map((row: any) => {
        const selected: any = {};
        for (const field of selectFields) {
            if (field in row) {
                selected[field] = row[field];
            }
        }
        // Always include _id for reference
        selected._id = row._id;
        return selected;
    });
}

/**
 * Apply WHERE clause to query using Convex filter syntax
 * Supports: =, !=, >, <, >=, <=, AND, OR
 */
function applyWhereClause(query: any, where: any): any {
    if (!where || typeof where !== 'object') {
        return query;
    }

    // Handle array of conditions (from query builder)
    if (Array.isArray(where)) {
        // Build filter with AND conditions
        return query.filter((q: any) => {
            let result: any = null;

            for (const clause of where) {
                const { field, operator, value, type } = clause;
                let condition: any;

                // Build condition based on operator using Convex syntax
                switch (operator) {
                    case '=':
                    case '==':
                        condition = q.eq(q.field(field), value);
                        break;
                    case '!=':
                        condition = q.neq(q.field(field), value);
                        break;
                    case '>':
                        condition = q.gt(q.field(field), value);
                        break;
                    case '<':
                        condition = q.lt(q.field(field), value);
                        break;
                    case '>=':
                        condition = q.gte(q.field(field), value);
                        break;
                    case '<=':
                        condition = q.lte(q.field(field), value);
                        break;
                    case 'IN':
                        if (!Array.isArray(value)) {
                            throw new Error('IN operator requires an array value');
                        }
                        // Build OR chain: field = val1 OR field = val2 OR ...
                        condition = value.reduce((acc: any, v: any, i: number) => {
                            const eq = q.eq(q.field(field), v);
                            return i === 0 ? eq : q.or(acc, eq);
                        }, null);
                        break;
                    case 'NOT IN':
                        if (!Array.isArray(value)) {
                            throw new Error('NOT IN operator requires an array value');
                        }
                        // Build AND chain: field != val1 AND field != val2 AND ...
                        condition = value.reduce((acc: any, v: any, i: number) => {
                            const neq = q.neq(q.field(field), v);
                            return i === 0 ? neq : q.and(acc, neq);
                        }, null);
                        break;
                    default:
                        throw new Error(`Unsupported operator: ${operator}`);
                }

                // Combine conditions
                if (result === null) {
                    result = condition;
                } else if (type === 'OR') {
                    result = q.or(result, condition);
                } else {
                    result = q.and(result, condition);
                }
            }

            return result;
        });
    }

    // Handle simple object where {field: value}
    // Build AND conditions for all fields
    const entries = Object.entries(where);
    if (entries.length === 0) {
        return query;
    }

    return query.filter((q: any) => {
        let result: any = null;

        for (const [field, value] of entries) {
            const condition = q.eq(q.field(field), value);

            if (result === null) {
                result = condition;
            } else {
                result = q.and(result, condition);
            }
        }

        return result;
    });
}

/**
 * Apply ORDER BY to query
 * Supports: {field: 'asc'|'desc'} or [[field, 'asc'], ...]
 */
function applyOrderBy(query: any, orderBy: any): any {
    if (!orderBy) {
        return query;
    }

    // Handle object {field: 'asc'}
    if (typeof orderBy === 'object' && !Array.isArray(orderBy)) {
        for (const [field, direction] of Object.entries(orderBy)) {
            if (direction === 'desc') {
                query = query.order('desc');
            } else {
                query = query.order('asc');
            }
        }
        return query;
    }

    // Handle array [[field, 'asc'], [field2, 'desc']]
    if (Array.isArray(orderBy)) {
        // Convex doesn't support multi-field ordering directly
        // We'll need to sort in memory after collect()
        // For now, just apply first ordering
        if (orderBy.length > 0) {
            const [field, direction] = orderBy[0];
            if (direction === 'desc') {
                query = query.order('desc');
            }
        }
    }

    return query;
}

/**
 * Batch insert helper (for insertMany)
 */
export const insertMany = mutation({
    args: {
        table: v.string(),
        records: v.array(v.any()),
    },
    handler: async (ctx, args) => {
        validateTableAccess(args.table);

        // Validate batch size
        if (args.records.length > MAX_BATCH_SIZE) {
            throw new Error(`Batch size ${args.records.length} exceeds maximum ${MAX_BATCH_SIZE}`);
        }

        const ids = [];
        for (const record of args.records) {
            const sanitized = sanitizeData(record);
            // Validate data against table rules
            validateData(args.table, sanitized, "insert");
            const id = await ctx.db.insert(args.table as any, sanitized);
            ids.push(id);
        }

        return ids;
    }
});

/**
 * Batch update helper (for updateMany with different values)
 */
export const updateMany = mutation({
    args: {
        table: v.string(),
        updates: v.array(v.object({
            where: v.any(),
            set: v.any(),
        })),
    },
    handler: async (ctx, args) => {
        validateTableAccess(args.table);

        // Validate batch size
        if (args.updates.length > MAX_BATCH_SIZE) {
            throw new Error(`Batch size ${args.updates.length} exceeds maximum ${MAX_BATCH_SIZE}`);
        }

        const results = [];
        for (const update of args.updates) {
            const result = await handleUpdate(ctx, args.table, update.where, update.set);
            results.push(result);
        }

        return results;
    }
});

/**
 * Batch delete helper (for deleteMany with different where clauses)
 */
export const bulkDelete = mutation({
    args: {
        table: v.string(),
        whereList: v.array(v.any()),
    },
    handler: async (ctx, args) => {
        validateTableAccess(args.table);

        // Validate batch size
        if (args.whereList.length > MAX_BATCH_SIZE) {
            throw new Error(`Batch size ${args.whereList.length} exceeds maximum ${MAX_BATCH_SIZE}`);
        }

        const results = [];
        for (const where of args.whereList) {
            const result = await handleDelete(ctx, args.table, where);
            results.push(result);
        }

        const totalDeleted = results.reduce((sum, r) => sum + r.deleted, 0);
        return { deleted: totalDeleted, operations: results.length };
    }
});

/**
 * Batch upsert helper (for upsertMany)
 */
export const bulkUpsert = mutation({
    args: {
        table: v.string(),
        operations: v.array(v.object({
            where: v.any(),
            insert: v.any(),
            update: v.any(),
        })),
    },
    handler: async (ctx, args) => {
        validateTableAccess(args.table);

        // Validate batch size
        if (args.operations.length > MAX_BATCH_SIZE) {
            throw new Error(`Batch size ${args.operations.length} exceeds maximum ${MAX_BATCH_SIZE}`);
        }

        const results = [];
        for (const op of args.operations) {
            const result = await handleUpsert(ctx, args.table, op.where, op.insert, op.update);
            results.push(result);
        }

        return results;
    }
});
