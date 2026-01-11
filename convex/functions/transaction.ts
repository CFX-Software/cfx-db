import { mutation } from "../_generated/server";
import { v } from "convex/values";
import { validateTableAccess, validateWhereClause, sanitizeData } from "../lib/validators";
import { validateData } from "../lib/validation_rules";

/**
 * Transaction System for CFX-DB
 *
 * Provides atomic multi-operation batches to prevent money/item duplication exploits.
 * All operations in a transaction succeed or fail together.
 *
 * IMPORTANT: Convex mutations are already atomic within a single function.
 * This implementation leverages that guarantee by batching operations into one mutation.
 */

// Maximum operations per transaction (prevent abuse)
const MAX_OPERATIONS_PER_TRANSACTION = 10;

// Transaction timeout (5 seconds)
const TRANSACTION_TIMEOUT_MS = 5000;

/**
 * Operation types supported in transactions
 */
type TransactionOperation =
    | {
          type: "insert";
          table: string;
          data: any;
      }
    | {
          type: "update";
          table: string;
          where: any;
          data: any;
      }
    | {
          type: "delete";
          table: string;
          where: any;
      }
    | {
          type: "upsert";
          table: string;
          where: any;
          insert: any;
          update: any;
      };

/**
 * Execute atomic transaction
 *
 * All operations succeed or all fail - no partial commits.
 * This prevents money/item duplication exploits.
 */
export const executeTransaction = mutation({
    args: {
        operations: v.array(v.any()),
        timeout: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const startTime = Date.now();

        // Validate operation count
        if (args.operations.length === 0) {
            throw new Error("Transaction must have at least one operation");
        }

        if (args.operations.length > MAX_OPERATIONS_PER_TRANSACTION) {
            throw new Error(
                `Transaction exceeds maximum ${MAX_OPERATIONS_PER_TRANSACTION} operations`
            );
        }

        // Validate all operations BEFORE executing ANY
        // This ensures we don't partially apply operations before hitting an error
        for (const op of args.operations) {
            if (!op.type || !op.table) {
                throw new Error("Each operation must have 'type' and 'table' fields");
            }

            // Validate table access
            validateTableAccess(op.table);

            // Validate where clauses
            if (op.where) {
                validateWhereClause(op.where);
            }

            // Validate data
            if (op.data) {
                const sanitized = sanitizeData(op.data);
                validateData(op.table, sanitized, op.type === "insert" ? "insert" : "update");
            }

            if (op.insert) {
                const sanitized = sanitizeData(op.insert);
                validateData(op.table, sanitized, "insert");
            }

            if (op.update) {
                const sanitized = sanitizeData(op.update);
                validateData(op.table, sanitized, "update");
            }
        }

        // Execute all operations atomically
        const results: any[] = [];

        for (const op of args.operations) {
            // Check timeout
            if (Date.now() - startTime > (args.timeout || TRANSACTION_TIMEOUT_MS)) {
                throw new Error("Transaction timeout exceeded");
            }

            let result: any;

            switch (op.type) {
                case "insert": {
                    const sanitized = sanitizeData(op.data);
                    const id = await ctx.db.insert(op.table as any, sanitized);
                    result = { type: "insert", id };
                    break;
                }

                case "update": {
                    if (!op.where) {
                        throw new Error("UPDATE requires where clause");
                    }

                    // Find matching records
                    let query = ctx.db.query(op.table);
                    if (op.where._id) {
                        // Optimize for _id lookups
                        const record = await ctx.db.get(op.where._id);
                        if (!record) {
                            result = { type: "update", updated: 0 };
                            break;
                        }

                        const sanitized = sanitizeData(op.data);
                        await ctx.db.patch(record._id, sanitized);
                        result = { type: "update", updated: 1 };
                    } else {
                        // General where clause (less efficient, but necessary)
                        const records = await query.collect();
                        const matching = records.filter((r: any) => {
                            // Simple equality check for now
                            for (const [key, value] of Object.entries(op.where)) {
                                if (r[key] !== value) return false;
                            }
                            return true;
                        });

                        if (matching.length === 0) {
                            result = { type: "update", updated: 0 };
                            break;
                        }

                        const sanitized = sanitizeData(op.data);
                        for (const record of matching) {
                            await ctx.db.patch(record._id, sanitized);
                        }

                        result = { type: "update", updated: matching.length };
                    }
                    break;
                }

                case "delete": {
                    if (!op.where) {
                        throw new Error("DELETE requires where clause");
                    }

                    // Find and delete matching records
                    let query = ctx.db.query(op.table);
                    if (op.where._id) {
                        // Optimize for _id lookups
                        const record = await ctx.db.get(op.where._id);
                        if (!record) {
                            result = { type: "delete", deleted: 0 };
                            break;
                        }

                        await ctx.db.delete(record._id);
                        result = { type: "delete", deleted: 1 };
                    } else {
                        const records = await query.collect();
                        const matching = records.filter((r: any) => {
                            for (const [key, value] of Object.entries(op.where)) {
                                if (r[key] !== value) return false;
                            }
                            return true;
                        });

                        for (const record of matching) {
                            await ctx.db.delete(record._id);
                        }

                        result = { type: "delete", deleted: matching.length };
                    }
                    break;
                }

                case "upsert": {
                    if (!op.where) {
                        throw new Error("UPSERT requires where clause");
                    }

                    // Try to find existing record
                    let query = ctx.db.query(op.table);
                    const records = await query.collect();
                    const existing = records.find((r: any) => {
                        for (const [key, value] of Object.entries(op.where)) {
                            if (r[key] !== value) return false;
                        }
                        return true;
                    });

                    if (existing) {
                        // Update
                        const sanitized = sanitizeData(op.update);
                        await ctx.db.patch(existing._id, sanitized);
                        result = { type: "upsert", action: "updated", id: existing._id };
                    } else {
                        // Insert
                        const sanitized = sanitizeData(op.insert);
                        const id = await ctx.db.insert(op.table as any, sanitized);
                        result = { type: "upsert", action: "inserted", id };
                    }
                    break;
                }

                default:
                    throw new Error(`Unknown operation type: ${op.type}`);
            }

            results.push(result);
        }

        return {
            success: true,
            operations: results.length,
            results,
            duration: Date.now() - startTime,
        };
    },
});

/**
 * IMPORTANT: This is a GENERIC transaction system.
 * Application-specific logic (like money transfers) should be implemented
 * in YOUR gamemode using the executeTransaction function above.
 *
 * Example usage in your gamemode:
 *
 * local tx = DB.transaction()
 *     :update('players', {where = {identifier = from}, set = {money = money - 100}})
 *     :update('players', {where = {identifier = to}, set = {money = money + 100}})
 *     :insert('transactions', {from = from, to = to, amount = 100})
 *     :commit(callback)
 *
 * This keeps cfx-db generic and reusable across different gamemodes.
 */
