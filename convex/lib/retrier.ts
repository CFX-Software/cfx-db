import { ActionRetrier } from "@convex-dev/action-retrier";
import { components } from "../_generated/api";
import { internalAction, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

/**
 * Action Retrier for CFX-DB
 *
 * Use this for reliable delivery of webhooks and external API calls.
 * The retrier will automatically retry failed actions with exponential backoff.
 *
 * Features:
 * - Automatic retries with exponential backoff
 * - Configurable max attempts
 * - Persistent retry state (survives restarts)
 * - Failure callbacks
 */
export const retrier = new ActionRetrier(components.actionRetrier, {
    // Default configuration
    initialBackoffMs: 1000,   // Start with 1 second delay
    base: 2,                  // Exponential backoff multiplier
    maxFailures: 4,           // Retry up to 4 times after initial failure
});

// ============================================
// WEBHOOK SENDING WITH RETRIES
// ============================================

/**
 * Internal action that actually sends the webhook
 * This is called by the retrier
 */
export const sendWebhookInternal = internalAction({
    args: {
        url: v.string(),
        payload: v.any(),
        headers: v.optional(v.record(v.string(), v.string())),
    },
    handler: async (ctx, args) => {
        const response = await fetch(args.url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...args.headers,
            },
            body: JSON.stringify(args.payload),
        });

        if (!response.ok) {
            // Throw error to trigger retry
            throw new Error(`Webhook failed with status ${response.status}: ${await response.text()}`);
        }

        return { success: true, status: response.status };
    },
});

/**
 * Send a webhook with automatic retries
 * Use this instead of direct fetch calls for reliability
 */
export const sendWebhook = internalMutation({
    args: {
        url: v.string(),
        payload: v.any(),
        headers: v.optional(v.record(v.string(), v.string())),
    },
    returns: v.object({
        scheduled: v.boolean(),
        runId: v.string(),
    }),
    handler: async (ctx, args): Promise<{ scheduled: boolean; runId: string }> => {
        // Schedule the webhook with retries
        // Only include headers if defined (exactOptionalPropertyTypes compliance)
        const actionArgs: { url: string; payload: any; headers?: Record<string, string> } = {
            url: args.url,
            payload: args.payload,
        };
        if (args.headers !== undefined) {
            actionArgs.headers = args.headers;
        }

        const runId: string = await retrier.run(ctx, internal.lib.retrier.sendWebhookInternal, actionArgs);

        return { scheduled: true, runId };
    },
});

// ============================================
// GENERIC ACTION WITH RETRIES
// ============================================

/**
 * Run any internal action with automatic retries
 *
 * Usage:
 *   await retrier.run(ctx, internal.myModule.myAction, { ...args });
 *
 * The action will be retried on failure with exponential backoff.
 */
