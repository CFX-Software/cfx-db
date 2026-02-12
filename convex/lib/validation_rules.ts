/**
 * Data Validation Rules Engine for cfx-db
 *
 * Enforces data integrity at the database layer with field-level validation.
 * Supports: required, string, number, boolean, enum, email, url, custom validators
 */

/**
 * Validation Rule Types
 */
export type ValidationRule =
    | { type: "required" }
    | { type: "string"; minLength?: number; maxLength?: number; pattern?: string }
    | { type: "number"; min?: number; max?: number; integer?: boolean }
    | { type: "boolean" }
    | { type: "enum"; values: any[] }
    | { type: "email" }
    | { type: "url" }
    | { type: "custom"; validator: (value: any) => boolean; message: string };

/**
 * Table Validation Rules Configuration
 */
interface TableValidationRules {
    [tableName: string]: {
        [fieldName: string]: ValidationRule[];
    };
}

/**
 * Validation Rules for CFX-DB Tables
 *
 * IMPORTANT: This is a GENERIC database resource.
 * Validation rules should be defined in YOUR GAMEMODE, not here.
 *
 * Use addValidationRules() to add rules at runtime:
 *
 * Example from your gamemode:
 *   exports['cfx-db']:addValidationRules('players', {
 *       identifier: [
 *           { type: "required" },
 *           { type: "string", pattern: "^(steam|license):[a-fA-F0-9]+$" }
 *       ]
 *   })
 */
const validationRules: TableValidationRules = {
    // Example validation rules (for testing/demonstration)
    // In production, define your own rules in YOUR gamemode
    players: {
        identifier: [
            { type: "required" },
            {
                type: "string",
                pattern: "^(steam|license|discord|xbl|live|fivem):[a-fA-F0-9]+$",
            },
        ],
        name: [
            { type: "required" },
            { type: "string", minLength: 1, maxLength: 50 },
        ],
        money: [{ type: "number", min: 0, integer: true }],
    },
};

/**
 * Validate data against table validation rules
 *
 * @param table - Table name
 * @param data - Data object to validate
 * @param operation - Operation type ('insert' or 'update')
 * @throws Error if validation fails
 */
export function validateData(
    table: string,
    data: any,
    operation: "insert" | "update" = "insert"
): void {
    const rules = validationRules[table];

    // No validation rules for this table (allowed)
    if (!rules) {
        return;
    }

    for (const [field, fieldRules] of Object.entries(rules)) {
        const value = data[field];

        for (const rule of fieldRules) {
            // Skip required check on update if field is not provided
            if (
                operation === "update" &&
                rule.type === "required" &&
                value === undefined
            ) {
                continue;
            }

            switch (rule.type) {
                case "required":
                    if (value === undefined || value === null || value === "") {
                        throw new Error(`Field '${field}' is required`);
                    }
                    break;

                case "string":
                    // Skip validation if field is optional and not provided
                    if (value === undefined || value === null) {
                        break;
                    }

                    if (typeof value !== "string") {
                        throw new Error(`Field '${field}' must be a string`);
                    }

                    if (rule.minLength && value.length < rule.minLength) {
                        throw new Error(
                            `Field '${field}' must be at least ${rule.minLength} characters long`
                        );
                    }

                    if (rule.maxLength && value.length > rule.maxLength) {
                        throw new Error(
                            `Field '${field}' must be at most ${rule.maxLength} characters long`
                        );
                    }

                    if (rule.pattern) {
                        // Prevent ReDoS attacks - limit pattern complexity
                        if (rule.pattern.length > 500) {
                            throw new Error(
                                `Validation pattern for field '${field}' is too complex`
                            );
                        }

                        const regex = new RegExp(rule.pattern);
                        if (!regex.test(value)) {
                            throw new Error(
                                `Field '${field}' does not match required pattern`
                            );
                        }
                    }
                    break;

                case "number":
                    // Skip validation if field is optional and not provided
                    if (value === undefined || value === null) {
                        break;
                    }

                    if (typeof value !== "number") {
                        throw new Error(`Field '${field}' must be a number`);
                    }

                    if (isNaN(value) || !isFinite(value)) {
                        throw new Error(`Field '${field}' must be a valid number`);
                    }

                    if (rule.integer && !Number.isInteger(value)) {
                        throw new Error(`Field '${field}' must be an integer`);
                    }

                    if (rule.min !== undefined && value < rule.min) {
                        throw new Error(
                            `Field '${field}' must be at least ${rule.min}`
                        );
                    }

                    if (rule.max !== undefined && value > rule.max) {
                        throw new Error(
                            `Field '${field}' must be at most ${rule.max}`
                        );
                    }
                    break;

                case "boolean":
                    // Skip validation if field is optional and not provided
                    if (value === undefined || value === null) {
                        break;
                    }

                    if (typeof value !== "boolean") {
                        throw new Error(`Field '${field}' must be a boolean`);
                    }
                    break;

                case "enum":
                    // Skip validation if field is optional and not provided
                    if (value === undefined || value === null) {
                        break;
                    }

                    if (!rule.values.includes(value)) {
                        throw new Error(
                            `Field '${field}' must be one of: ${rule.values.join(", ")}`
                        );
                    }
                    break;

                case "email":
                    // Skip validation if field is optional and not provided
                    if (value === undefined || value === null) {
                        break;
                    }

                    if (typeof value !== "string") {
                        throw new Error(`Field '${field}' must be a string`);
                    }

                    // Simple email validation (RFC 5322 simplified)
                    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                    if (!emailRegex.test(value)) {
                        throw new Error(`Field '${field}' must be a valid email address`);
                    }
                    break;

                case "url":
                    // Skip validation if field is optional and not provided
                    if (value === undefined || value === null) {
                        break;
                    }

                    if (typeof value !== "string") {
                        throw new Error(`Field '${field}' must be a string`);
                    }

                    try {
                        new URL(value);
                    } catch {
                        throw new Error(`Field '${field}' must be a valid URL`);
                    }
                    break;

                case "custom":
                    // Skip validation if field is optional and not provided
                    if (value === undefined || value === null) {
                        break;
                    }

                    try {
                        if (!rule.validator(value)) {
                            throw new Error(
                                rule.message || `Field '${field}' failed custom validation`
                            );
                        }
                    } catch (error: any) {
                        throw new Error(
                            rule.message ||
                                error.message ||
                                `Field '${field}' failed custom validation`
                        );
                    }
                    break;

                default:
                    // Unknown rule type - log warning but don't fail
                    console.warn(
                        `[cfx-db] Unknown validation rule type for field '${field}'`
                    );
            }
        }
    }
}

/**
 * Add validation rules for a table at runtime
 *
 * @param table - Table name
 * @param rules - Field validation rules
 */
export function addValidationRules(
    table: string,
    rules: { [fieldName: string]: ValidationRule[] }
): void {
    if (!validationRules[table]) {
        validationRules[table] = {};
    }

    Object.assign(validationRules[table], rules);
}

/**
 * Get validation rules for a table
 *
 * @param table - Table name
 * @returns Validation rules for the table
 */
export function getValidationRules(table: string): {
    [fieldName: string]: ValidationRule[];
} | undefined {
    return validationRules[table];
}

/**
 * Remove validation rules for a table
 *
 * @param table - Table name
 */
export function removeValidationRules(table: string): void {
    delete validationRules[table];
}

/**
 * Check if a table has validation rules
 *
 * @param table - Table name
 * @returns True if table has validation rules
 */
export function hasValidationRules(table: string): boolean {
    return !!validationRules[table];
}

/**
 * Export all validation rules (for debugging/documentation)
 *
 * @returns All validation rules
 */
export function getAllValidationRules(): TableValidationRules {
    return { ...validationRules };
}
