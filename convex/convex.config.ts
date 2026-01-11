import { defineApp } from "convex/server";
import shardedCounter from "@convex-dev/sharded-counter/convex.config";
import actionRetrier from "@convex-dev/action-retrier/convex.config";

/**
 * CFX-DB Convex App Configuration
 *
 * This file registers Convex components used by cfx-db:
 * - shardedCounter: High-throughput counters (online players, total money, etc.)
 * - actionRetrier: Reliable webhook/action delivery with automatic retries
 */
const app = defineApp();

// Sharded Counter - for high-write counters like online player count
app.use(shardedCounter);

// Action Retrier - for reliable webhook delivery
app.use(actionRetrier);

export default app;
