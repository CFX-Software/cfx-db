import { v } from "convex/values";

/**
 * Input Validation & Security Layer for cfx-db CRUD
 *
 * Prevents:
 * - SQL injection (no SQL, but still need to validate)
 * - Unauthorized table access
 * - Malicious where clauses
 * - System field tampering (_id, _creationTime)
 * - Excessive query limits
 */

/**
 * List of tables that can be accessed via CRUD operations
 * Add your tables here as you create them in schema.ts
 */
const ALLOWED_TABLES = [
    "players",
    "keyValue",
    "auditLogs",
    "migrations",
    "snapshots",
    // Add more tables here as needed
    // "vehicles",
    // "inventory",
    // "jobs",
];

/**
 * Maximum query limit to prevent abuse
 */
const MAX_QUERY_LIMIT = 1000;

/**
 * Allowed operators in WHERE clauses
 */
const ALLOWED_OPERATORS = [
    "=",
    "==",
    "!=",
    ">",
    "<",
    ">=",
    "<=",
    "IN",
    "NOT IN",
];

/**
 * Fields that cannot be modified by users
 */
const PROTECTED_FIELDS = [
    "_id",
    "_creationTime",
];

/**
 * Validate table access
 * Throws if table is not in allowlist
 */
export function validateTableAccess(table: string): void {
    if (!table || typeof table !== "string") {
        throw new Error("Table name must be a string");
    }

    // Check if table is allowed (don't leak table names in error)
    if (!ALLOWED_TABLES.includes(table)) {
        throw new Error("Access denied: table not allowed");
    }
}

/**
 * Validate WHERE clause structure
 * Prevents malicious filter injection
 */
export function validateWhereClause(where: any): void {
    if (!where) {
        return;
    }

    // Handle array format (from query builder)
    if (Array.isArray(where)) {
        for (const clause of where) {
            if (typeof clause !== "object") {
                throw new Error("WHERE clause must be an object or array of objects");
            }

            // Validate operator if present
            if (clause.operator && !ALLOWED_OPERATORS.includes(clause.operator)) {
                throw new Error(`Operator '${clause.operator}' is not allowed`);
            }

            // Validate field name (no special chars except _)
            if (clause.field && typeof clause.field === "string") {
                if (!/^[a-zA-Z0-9_]+$/.test(clause.field)) {
                    throw new Error(
                        `Invalid field name: '${clause.field}'. Only alphanumeric and _ allowed`
                    );
                }
            }
        }
        return;
    }

    // Handle object format {field: value}
    if (typeof where === "object") {
        for (const key of Object.keys(where)) {
            // Validate field name
            if (!/^[a-zA-Z0-9_]+$/.test(key)) {
                throw new Error(
                    `Invalid field name: '${key}'. Only alphanumeric and _ allowed`
                );
            }

            // Prevent deep nesting (potential DoS)
            if (typeof where[key] === "object" && where[key] !== null) {
                const depth = getObjectDepth(where[key]);
                if (depth > 5) {
                    throw new Error("WHERE clause nesting too deep (max 5 levels)");
                }
            }
        }
        return;
    }

    throw new Error("WHERE clause must be an object or array");
}

/**
 * Sanitize data before INSERT/UPDATE
 * Removes protected fields and validates structure
 */
export function sanitizeData(data: any): any {
    if (!data || typeof data !== "object") {
        throw new Error("Data must be an object");
    }

    // Deep clone to prevent prototype pollution
    const sanitized = JSON.parse(JSON.stringify(data));

    // Remove prototype pollution vectors
    delete sanitized.__proto__;
    delete sanitized.constructor;
    delete sanitized.prototype;

    // Remove protected fields
    for (const field of PROTECTED_FIELDS) {
        if (field in sanitized) {
            delete sanitized[field];
            console.warn(`Removed protected field '${field}' from data`);
        }
    }

    // Validate field names (must start with letter or underscore)
    for (const key of Object.keys(sanitized)) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
            throw new Error(
                `Invalid field name: '${key}'. Must start with letter or underscore, contain only alphanumeric and _`
            );
        }
    }

    // Check for dangerous values
    const serialized = JSON.stringify(sanitized);
    if (serialized.length > 1024 * 1024) {
        // 1MB limit per record
        throw new Error("Data size exceeds 1MB limit");
    }

    return sanitized;
}

/**
 * Validate query options (limit, offset, orderBy, etc.)
 */
export function validateQueryOptions(options?: any): void {
    if (!options) {
        return;
    }

    // Validate limit
    if (options.limit !== undefined) {
        if (typeof options.limit !== "number" || options.limit < 1) {
            throw new Error("Limit must be a positive number");
        }

        if (options.limit > MAX_QUERY_LIMIT) {
            throw new Error(`Limit cannot exceed ${MAX_QUERY_LIMIT}`);
        }
    }

    // Validate offset
    if (options.offset !== undefined) {
        if (typeof options.offset !== "number" || options.offset < 0) {
            throw new Error("Offset must be a non-negative number");
        }
    }

    // Validate select fields
    if (options.select !== undefined) {
        if (!Array.isArray(options.select)) {
            throw new Error("Select must be an array of field names");
        }

        for (const field of options.select) {
            if (typeof field !== "string") {
                throw new Error("Select fields must be strings");
            }

            if (!/^[a-zA-Z0-9_]+$/.test(field)) {
                throw new Error(
                    `Invalid select field: '${field}'. Only alphanumeric and _ allowed`
                );
            }
        }
    }

    // Validate orderBy
    if (options.orderBy !== undefined) {
        if (typeof options.orderBy !== "object") {
            throw new Error("OrderBy must be an object");
        }

        for (const [field, direction] of Object.entries(options.orderBy)) {
            if (!/^[a-zA-Z0-9_]+$/.test(field)) {
                throw new Error(
                    `Invalid orderBy field: '${field}'. Only alphanumeric and _ allowed`
                );
            }

            if (direction !== "asc" && direction !== "desc") {
                throw new Error(`OrderBy direction must be 'asc' or 'desc', got '${direction}'`);
            }
        }
    }
}

/**
 * Helper: Get object nesting depth
 */
function getObjectDepth(obj: any, depth: number = 0): number {
    if (typeof obj !== "object" || obj === null) {
        return depth;
    }

    let maxDepth = depth;
    for (const value of Object.values(obj)) {
        const childDepth = getObjectDepth(value, depth + 1);
        maxDepth = Math.max(maxDepth, childDepth);
    }

    return maxDepth;
}

/**
 * Add a table to the allowlist (for dynamic table registration)
 * Use this if you want to allow tables at runtime
 */
export function allowTable(table: string): void {
    if (!ALLOWED_TABLES.includes(table)) {
        ALLOWED_TABLES.push(table);
    }
}

/**
 * Get list of allowed tables
 */
export function getAllowedTables(): string[] {
    return [...ALLOWED_TABLES];
}

// ============================================
// LEGACY VALIDATORS (for backward compatibility)
// ============================================

/**
 * FiveM identifier (steam:xxx, license:xxx, etc.)
 */
export const fivemIdentifier = v.string();

/**
 * Timestamp validator
 */
export const timestamp = v.number();

/**
 * Pagination options
 */
export const paginationOpts = v.object({
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
});
