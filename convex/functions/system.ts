import { query } from "../_generated/server";

/**
 * Lightweight service ping for connection health checks.
 *
 * Keeps health checks independent from any application table.
 */
export const ping = query({
    args: {},
    handler: async () => {
        return {
            ok: true,
            timestamp: Date.now(),
        };
    },
});
