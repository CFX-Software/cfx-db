/**
 * Performance Monitor for CFX-DB
 *
 * Tracks query execution times, detects slow queries, and provides
 * performance metrics for identifying bottlenecks.
 */

interface QueryMetrics {
    operation: string;
    table: string;
    count: number;
    totalTime: number;
    avgTime: number;
    maxTime: number;
    minTime: number;
    slowQueries: Array<{
        args: string;
        duration: number;
        timestamp: number;
    }>;
}

export class PerformanceMonitor {
    private static instance: PerformanceMonitor;

    private metrics: Map<string, QueryMetrics> = new Map();
    private readonly SLOW_QUERY_THRESHOLD = 1000; // 1 second
    private readonly MAX_SLOW_QUERIES_PER_OPERATION = 100;

    private constructor() {}

    static getInstance(): PerformanceMonitor {
        if (!PerformanceMonitor.instance) {
            PerformanceMonitor.instance = new PerformanceMonitor();
        }
        return PerformanceMonitor.instance;
    }

    /**
     * Track a query execution
     *
     * @param operation - Operation type (select, insert, update, delete, etc.)
     * @param table - Table name
     * @param args - Query arguments
     * @param duration - Execution time in milliseconds
     */
    trackQuery(
        operation: string,
        table: string,
        args: any,
        duration: number
    ): void {
        const key = `${operation}:${table}`;
        let metric = this.metrics.get(key);

        if (!metric) {
            metric = {
                operation,
                table,
                count: 0,
                totalTime: 0,
                avgTime: 0,
                maxTime: 0,
                minTime: Infinity,
                slowQueries: [],
            };
            this.metrics.set(key, metric);
        }

        // Update metrics
        metric.count++;
        metric.totalTime += duration;
        metric.avgTime = metric.totalTime / metric.count;
        metric.maxTime = Math.max(metric.maxTime, duration);
        metric.minTime = Math.min(metric.minTime, duration);

        // Track slow queries
        if (duration > this.SLOW_QUERY_THRESHOLD) {
            // Sanitize args (don't store sensitive data)
            const sanitizedArgs = this.sanitizeArgs(args);

            metric.slowQueries.push({
                args: JSON.stringify(sanitizedArgs),
                duration,
                timestamp: Date.now(),
            });

            // Keep only last N slow queries
            if (metric.slowQueries.length > this.MAX_SLOW_QUERIES_PER_OPERATION) {
                metric.slowQueries.shift();
            }

            console.warn(
                `[cfx-db] Slow query detected: ${operation} on ${table} took ${duration}ms`
            );
        }
    }

    /**
     * Sanitize query arguments (remove sensitive data)
     */
    private sanitizeArgs(args: any): any {
        if (!args || typeof args !== "object") {
            return args;
        }

        const sanitized: any = {};

        for (const [key, value] of Object.entries(args)) {
            // Skip potentially sensitive fields
            if (
                key === "data" ||
                key === "password" ||
                key === "token" ||
                key === "secret"
            ) {
                sanitized[key] = "[REDACTED]";
            } else if (typeof value === "object" && value !== null) {
                sanitized[key] = this.sanitizeArgs(value);
            } else {
                sanitized[key] = value;
            }
        }

        return sanitized;
    }

    /**
     * Get all performance metrics
     */
    getStats(): QueryMetrics[] {
        return Array.from(this.metrics.values()).map((metric) => ({
            ...metric,
            // Don't include full slow query details in summary
            slowQueries: [],
        }));
    }

    /**
     * Get slowest queries across all operations
     *
     * @param limit - Maximum number of slow queries to return
     */
    getSlowestQueries(limit: number = 10): QueryMetrics[] {
        return Array.from(this.metrics.values())
            .sort((a, b) => b.avgTime - a.avgTime)
            .slice(0, limit);
    }

    /**
     * Get metrics for a specific operation/table
     *
     * @param operation - Operation type
     * @param table - Table name
     */
    getMetric(operation: string, table: string): QueryMetrics | undefined {
        return this.metrics.get(`${operation}:${table}`);
    }

    /**
     * Get all slow queries with details
     *
     * @param limit - Maximum number of slow queries to return
     */
    getAllSlowQueries(limit: number = 100): Array<{
        operation: string;
        table: string;
        args: string;
        duration: number;
        timestamp: number;
    }> {
        const allSlowQueries: Array<{
            operation: string;
            table: string;
            args: string;
            duration: number;
            timestamp: number;
        }> = [];

        for (const metric of this.metrics.values()) {
            for (const slowQuery of metric.slowQueries) {
                allSlowQueries.push({
                    operation: metric.operation,
                    table: metric.table,
                    args: slowQuery.args,
                    duration: slowQuery.duration,
                    timestamp: slowQuery.timestamp,
                });
            }
        }

        // Sort by duration (slowest first)
        allSlowQueries.sort((a, b) => b.duration - a.duration);

        return allSlowQueries.slice(0, limit);
    }

    /**
     * Reset all performance metrics
     */
    reset(): void {
        this.metrics.clear();
        console.log("[cfx-db] Performance metrics reset");
    }

    /**
     * Export metrics as JSON
     */
    export(): string {
        const data = {
            timestamp: Date.now(),
            metrics: Array.from(this.metrics.values()),
        };

        return JSON.stringify(data, null, 2);
    }
}
