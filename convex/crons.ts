import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Cron Jobs for CFX-DB
 *
 * Automated tasks that run on a schedule.
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
        olderThan: Date.now() - 30 * 24 * 60 * 60 * 1000, // 30 days ago
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
        olderThan: Date.now() - 7 * 24 * 60 * 60 * 1000, // 7 days ago
        type: "automatic" as const,
    }
);

export default crons;
