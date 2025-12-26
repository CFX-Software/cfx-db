/**
 * Helper utilities for Convex functions
 */

/**
 * Get current timestamp in milliseconds
 */
export function now(): number {
    return Date.now();
}

/**
 * Generate a unique ID with optional prefix
 */
export function generateId(prefix: string = ""): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 8);
    return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

/**
 * Normalize FiveM identifier to lowercase
 */
export function normalizeIdentifier(identifier: string): string {
    return identifier.toLowerCase().trim();
}
