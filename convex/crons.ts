import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Cron Jobs for CFX-DB
 *
 * Automated tasks that run on a schedule.
 *
 * NOTE: Arguments are passed as retention periods (days), NOT timestamps.
 * The actual timestamp is calculated at RUNTIME inside each function.
 * This prevents the bug where Date.now() would be captured at deploy time.
 */

const crons = cronJobs();

/**
 * Clean up old audit logs
 * Runs daily at 3 AM to delete logs older than 30 days
 */
crons.daily(
    "cleanup-old-audit-logs",
    {
        hourUTC: 3, // 3 AM UTC
        minuteUTC: 0,
    },
    internal.functions.audit.deleteOldLogs,
    {
        retentionDays: 30, // Calculate timestamp at runtime, not deploy time
    }
);

/**
 * Clean up old automatic snapshots
 * Runs daily at 4 AM to delete automatic snapshots older than 7 days
 */
crons.daily(
    "cleanup-old-snapshots",
    {
        hourUTC: 4, // 4 AM UTC
        minuteUTC: 0,
    },
    internal.functions.snapshot.deleteOldSnapshots,
    {
        retentionDays: 7, // Calculate timestamp at runtime, not deploy time
        type: "automatic" as const,
    }
);

export default crons;
