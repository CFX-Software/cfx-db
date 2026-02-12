/**
 * CFX-DB Professional Logger
 *
 * Features:
 * - Log level filtering with zero overhead when filtered
 * - Structured JSON output mode for production log aggregation
 * - Secret redaction for security
 * - Scoped loggers for component categories
 * - FiveM-compatible output
 */

import type { Config } from "../config";

/**
 * Log levels with numeric values for comparison
 * debug(0) < info(1) < warn(2) < error(3)
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVEL_VALUES: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

/**
 * FiveM console color codes
 */
const COLORS = {
    reset: "^7",      // White/default
    debug: "^7",      // White
    info: "^2",       // Green
    warn: "^3",       // Yellow
    error: "^1",      // Red
    prefix: "^5",     // Magenta
    category: "^6",   // Cyan
};

const LEVEL_LABELS: Record<LogLevel, string> = {
    debug: "DEBUG",
    info: "INFO",
    warn: "WARN",
    error: "ERROR",
};

/**
 * Structured log entry for production analysis
 */
export interface LogEntry {
    timestamp: number;
    level: LogLevel;
    category: string;
    message: string;
    data?: Record<string, unknown>;
}

/**
 * Logger configuration
 */
interface LoggerConfig {
    level: LogLevel;
    structuredOutput: boolean;
    prefix: string;
    redactSecrets: boolean;
}

/**
 * Patterns to identify secrets that should be redacted
 */
const SECRET_PATTERNS = [
    /convex[_-]?url/i,
    /deploy[_-]?key/i,
    /jwt[_-]?secret/i,
    /api[_-]?key/i,
    /token/i,
    /password/i,
    /secret/i,
    /authorization/i,
    /webhook/i,
    /credential/i,
];

/**
 * Professional Logger for cfx-db
 */
export class Logger {
    private static instance: Logger;
    private config: LoggerConfig;
    private levelValue: number;

    private constructor(config?: Partial<LoggerConfig>) {
        this.config = {
            level: config?.level ?? "info",
            structuredOutput: config?.structuredOutput ?? false,
            prefix: config?.prefix ?? "[cfx-db]",
            redactSecrets: config?.redactSecrets ?? true,
        };
        this.levelValue = LOG_LEVEL_VALUES[this.config.level];
    }

    /**
     * Get the singleton instance
     */
    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Initialize logger with config (call during startup)
     */
    static initialize(config: Config): Logger {
        Logger.instance = new Logger({
            level: config.logLevel,
            structuredOutput: config.logStructured,
            redactSecrets: true,
        });
        return Logger.instance;
    }

    /**
     * Update log level at runtime
     */
    setLevel(level: LogLevel): void {
        this.config.level = level;
        this.levelValue = LOG_LEVEL_VALUES[level];
    }

    /**
     * Get current log level
     */
    getLevel(): LogLevel {
        return this.config.level;
    }

    /**
     * Check if a level would be logged (for zero-overhead conditional logging)
     */
    isEnabled(level: LogLevel): boolean {
        return LOG_LEVEL_VALUES[level] >= this.levelValue;
    }

    /**
     * Core logging method
     */
    private log(
        level: LogLevel,
        category: string,
        message: string,
        data?: Record<string, unknown>
    ): void {
        // Zero overhead check - return immediately if level is filtered
        if (LOG_LEVEL_VALUES[level] < this.levelValue) {
            return;
        }

        // Redact secrets if enabled
        const safeData =
            data && this.config.redactSecrets
                ? this.redactSecrets(data)
                : data;

        if (this.config.structuredOutput) {
            // Structured JSON output for production log aggregation
            const entry: LogEntry = {
                timestamp: Date.now(),
                level,
                category,
                message,
                ...(safeData && Object.keys(safeData).length > 0
                    ? { data: safeData }
                    : {}),
            };
            console.log(JSON.stringify(entry));
        } else {
            // Human-readable output with compact key=value data for cleaner console logs
            const color = COLORS[level];
            const categoryTag = category
                ? `${COLORS.category}[${category}]${COLORS.reset} `
                : "";
            const levelTag = `${color}[${LEVEL_LABELS[level]}]${COLORS.reset} `;
            const dataStr =
                safeData && Object.keys(safeData).length > 0
                    ? ` ${COLORS.reset}${this.formatData(safeData)}`
                    : "";
            const fullMessage = `${COLORS.prefix}${this.config.prefix}${COLORS.reset} ${categoryTag}${levelTag}${color}${message}${dataStr}${COLORS.reset}`;

            // Use console.log for all - FiveM handles colors via escape codes
            console.log(fullMessage);
        }
    }

    private formatData(data: Record<string, unknown>): string {
        const entries = Object.entries(data);
        if (entries.length === 0) return "";

        return entries
            .map(([key, value]) => `${key}=${this.formatValue(value)}`)
            .join(" ");
    }

    private formatValue(value: unknown): string {
        if (value === null) return "null";
        if (value === undefined) return "undefined";
        if (typeof value === "string") {
            const compact = value.replace(/\s+/g, " ").trim();
            return compact.length > 120 ? `"${compact.slice(0, 117)}..."` : `"${compact}"`;
        }
        if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
            return String(value);
        }
        if (Array.isArray(value)) {
            if (value.length === 0) return "[]";
            if (value.length <= 3) {
                return `[${value.map((item) => this.formatValue(item)).join(",")}]`;
            }
            return `[len:${value.length}]`;
        }
        if (typeof value === "object") {
            try {
                const json = JSON.stringify(value);
                if (!json) return "{}";
                return json.length > 120 ? `${json.slice(0, 117)}...` : json;
            } catch {
                return "[object]";
            }
        }
        return String(value);
    }

    /**
     * Redact sensitive values from data objects
     */
    private redactSecrets(
        data: Record<string, unknown>
    ): Record<string, unknown> {
        const redacted: Record<string, unknown> = {};

        for (const [key, value] of Object.entries(data)) {
            const isSecret = SECRET_PATTERNS.some((pattern) =>
                pattern.test(key)
            );

            if (isSecret) {
                redacted[key] = "[REDACTED]";
            } else if (
                typeof value === "string" &&
                SECRET_PATTERNS.some((pattern) => pattern.test(value))
            ) {
                // Also redact if value looks like a secret
                redacted[key] = "[REDACTED]";
            } else if (
                typeof value === "object" &&
                value !== null &&
                !Array.isArray(value)
            ) {
                redacted[key] = this.redactSecrets(
                    value as Record<string, unknown>
                );
            } else {
                redacted[key] = value;
            }
        }

        return redacted;
    }

    // Convenience methods for each level
    debug(
        category: string,
        message: string,
        data?: Record<string, unknown>
    ): void {
        this.log("debug", category, message, data);
    }

    info(
        category: string,
        message: string,
        data?: Record<string, unknown>
    ): void {
        this.log("info", category, message, data);
    }

    warn(
        category: string,
        message: string,
        data?: Record<string, unknown>
    ): void {
        this.log("warn", category, message, data);
    }

    error(
        category: string,
        message: string,
        data?: Record<string, unknown>
    ): void {
        this.log("error", category, message, data);
    }

    /**
     * Create a scoped logger for a specific category
     */
    scoped(category: string): ScopedLogger {
        return new ScopedLogger(this, category);
    }
}

/**
 * Scoped logger for specific components
 * Provides a cleaner API by pre-binding the category
 */
export class ScopedLogger {
    constructor(
        private logger: Logger,
        private category: string
    ) {}

    isEnabled(level: LogLevel): boolean {
        return this.logger.isEnabled(level);
    }

    debug(message: string, data?: Record<string, unknown>): void {
        this.logger.debug(this.category, message, data);
    }

    info(message: string, data?: Record<string, unknown>): void {
        this.logger.info(this.category, message, data);
    }

    warn(message: string, data?: Record<string, unknown>): void {
        this.logger.warn(this.category, message, data);
    }

    error(message: string, data?: Record<string, unknown>): void {
        this.logger.error(this.category, message, data);
    }
}

// Export singleton getter for convenience
export const log = Logger.getInstance();
