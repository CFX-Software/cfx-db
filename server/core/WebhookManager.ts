/**
 * Webhook Manager for CFX-DB
 *
 * Handles external webhook delivery for database events.
 * Provides retry logic and URL validation for security.
 */

import { Logger, ScopedLogger } from "../utils/Logger";

// Use built-in fetch (Node 18+)

interface WebhookConfig {
    url: string;
    events: string[];
    headers?: Record<string, string>;
    retryOnFailure?: boolean;
    maxRetries?: number;
}

interface WebhookPayload {
    event: string;
    table: string;
    operation: string;
    data: any;
    timestamp: number;
    resourceName?: string;
    playerId?: string;
}

export class WebhookManager {
    private static instance: WebhookManager;

    private webhooks: WebhookConfig[] = [];
    private deliveryQueue: Map<string, WebhookPayload[]> = new Map();
    private retryAttempts: Map<string, number> = new Map();

    private readonly MAX_RETRIES = 3;
    private readonly RETRY_DELAY = 5000; // 5 seconds

    private log: ScopedLogger;

    private constructor() {
        this.log = Logger.getInstance().scoped("webhook");
    }

    static getInstance(): WebhookManager {
        if (!WebhookManager.instance) {
            WebhookManager.instance = new WebhookManager();
        }
        return WebhookManager.instance;
    }

    /**
     * Register webhooks from configuration
     */
    configure(webhooks: WebhookConfig[]): void {
        // Replace existing configuration to avoid duplicate deliveries.
        this.webhooks = [];
        this.retryAttempts.clear();

        // Validate all webhooks
        for (const webhook of webhooks) {
            if (!this.isValidWebhookURL(webhook.url)) {
                this.log.warn("Invalid webhook URL skipped", { url: webhook.url.slice(0, 50) });
                continue;
            }

            if (!webhook.events || webhook.events.length === 0) {
                this.log.warn("Webhook must specify at least one event");
                continue;
            }

            this.webhooks.push({
                ...webhook,
                retryOnFailure: webhook.retryOnFailure ?? true,
                maxRetries: webhook.maxRetries ?? this.MAX_RETRIES,
            });
        }

        this.log.debug("Webhooks registered", { count: this.webhooks.length });
    }

    /**
     * Validate webhook URL (security)
     */
    private isValidWebhookURL(url: string): boolean {
        try {
            const parsed = new URL(url);

            // Must use HTTPS
            if (parsed.protocol !== "https:") {
                this.log.debug("Webhook URL must use HTTPS");
                return false;
            }

            // Block localhost and internal IPs
            const hostname = parsed.hostname.toLowerCase();
            if (
                hostname === "localhost" ||
                hostname === "127.0.0.1" ||
                hostname.startsWith("192.168.") ||
                hostname.startsWith("10.") ||
                hostname.startsWith("172.16.") ||
                hostname.startsWith("172.17.") ||
                hostname.startsWith("172.18.") ||
                hostname.startsWith("172.19.") ||
                hostname.startsWith("172.20.") ||
                hostname.startsWith("172.21.") ||
                hostname.startsWith("172.22.") ||
                hostname.startsWith("172.23.") ||
                hostname.startsWith("172.24.") ||
                hostname.startsWith("172.25.") ||
                hostname.startsWith("172.26.") ||
                hostname.startsWith("172.27.") ||
                hostname.startsWith("172.28.") ||
                hostname.startsWith("172.29.") ||
                hostname.startsWith("172.30.") ||
                hostname.startsWith("172.31.")
            ) {
                this.log.debug("Webhook URL cannot be localhost or internal IP");
                return false;
            }

            return true;
        } catch (error) {
            this.log.debug("Invalid webhook URL format");
            return false;
        }
    }

    /**
     * Trigger webhooks for an event
     */
    async trigger(payload: WebhookPayload): Promise<void> {
        // Find matching webhooks
        const matchingWebhooks = this.webhooks.filter((webhook) =>
            this.matchesEvent(webhook.events, payload.event)
        );

        if (matchingWebhooks.length === 0) {
            return; // No webhooks registered for this event
        }

        // Deliver to all matching webhooks (async, non-blocking)
        for (const webhook of matchingWebhooks) {
            this.deliver(webhook, payload).catch((error) => {
                this.log.error("Webhook delivery failed", {
                    event: payload.event,
                    error: error.message,
                });
            });
        }
    }

    /**
     * Check if webhook events match the triggered event
     */
    private matchesEvent(webhookEvents: string[], triggeredEvent: string): boolean {
        for (const pattern of webhookEvents) {
            // Exact match
            if (pattern === triggeredEvent) {
                return true;
            }

            // Wildcard match (e.g., "players:*")
            if (pattern.endsWith(":*")) {
                const prefix = pattern.slice(0, -2);
                if (triggeredEvent.startsWith(prefix + ":")) {
                    return true;
                }
            }

            // Global wildcard
            if (pattern === "*") {
                return true;
            }
        }

        return false;
    }

    /**
     * Check if URL is a Discord webhook
     */
    private isDiscordWebhook(url: string): boolean {
        return url.includes("discord.com/api/webhooks") || url.includes("discordapp.com/api/webhooks");
    }

    /**
     * Format payload for Discord webhooks
     */
    private formatDiscordPayload(payload: WebhookPayload): object {
        // Color based on operation
        const colors: Record<string, number> = {
            insert: 0x00ff00,  // Green
            update: 0xffaa00,  // Orange
            delete: 0xff0000,  // Red
            upsert: 0x0099ff,  // Blue
        };

        const color = colors[payload.operation] || 0x808080;
        const timestamp = new Date(payload.timestamp).toISOString();

        // Build fields from data (limit to avoid Discord's field limit)
        const fields: Array<{ name: string; value: string; inline?: boolean }> = [];

        if (payload.data && typeof payload.data === "object") {
            const entries = Object.entries(payload.data).slice(0, 10); // Max 10 fields
            for (const [key, value] of entries) {
                let displayValue = String(value);
                if (typeof value === "object") {
                    displayValue = JSON.stringify(value).slice(0, 100);
                }
                if (displayValue.length > 100) {
                    displayValue = displayValue.slice(0, 97) + "...";
                }
                fields.push({
                    name: key,
                    value: displayValue || "(empty)",
                    inline: true,
                });
            }
        }

        return {
            embeds: [
                {
                    title: `📊 ${payload.event}`,
                    description: `**Table:** \`${payload.table}\`\n**Operation:** \`${payload.operation.toUpperCase()}\``,
                    color,
                    fields: fields.length > 0 ? fields : undefined,
                    footer: {
                        text: `CFX-DB • ${payload.resourceName || "Unknown Resource"}`,
                    },
                    timestamp,
                },
            ],
        };
    }

    /**
     * Deliver webhook payload
     */
    private async deliver(webhook: WebhookConfig, payload: WebhookPayload): Promise<void> {
        const webhookId = `${webhook.url}:${payload.event}:${payload.timestamp}`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

            // Format body based on webhook type
            const isDiscord = this.isDiscordWebhook(webhook.url);
            const body = isDiscord
                ? this.formatDiscordPayload(payload)
                : {
                      event: payload.event,
                      table: payload.table,
                      operation: payload.operation,
                      data: payload.data,
                      timestamp: payload.timestamp,
                      resourceName: payload.resourceName,
                      playerId: payload.playerId,
                  };

            const response = await fetch(webhook.url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "User-Agent": "CFX-DB/1.0",
                    ...(webhook.headers || {}),
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                // Try to get error details from Discord
                let errorDetails = response.statusText;
                try {
                    const errorBody = await response.text();
                    if (errorBody) {
                        errorDetails = `${response.statusText} - ${errorBody}`;
                    }
                } catch {}
                throw new Error(
                    `Webhook returned status ${response.status}: ${errorDetails}`
                );
            }

            // Success - clear retry attempts
            this.retryAttempts.delete(webhookId);
            this.log.debug("Webhook delivered", { event: payload.event });
        } catch (error: any) {
            this.log.debug("Webhook delivery attempt failed", {
                event: payload.event,
                error: error.message,
            });

            // Retry logic
            if (webhook.retryOnFailure) {
                const attempts = this.retryAttempts.get(webhookId) || 0;

                if (attempts < (webhook.maxRetries || this.MAX_RETRIES)) {
                    this.retryAttempts.set(webhookId, attempts + 1);

                    this.log.debug("Retrying webhook delivery", {
                        attempt: attempts + 1,
                        maxRetries: webhook.maxRetries || this.MAX_RETRIES,
                    });

                    // Retry after delay
                    setTimeout(() => {
                        this.deliver(webhook, payload);
                    }, this.RETRY_DELAY * (attempts + 1)); // Exponential backoff
                } else {
                    this.log.warn("Webhook delivery failed after max retries", {
                        event: payload.event,
                        attempts,
                    });
                    this.retryAttempts.delete(webhookId);
                }
            }
        }
    }

    /**
     * Get webhook statistics
     */
    getStats(): {
        webhookCount: number;
        pendingRetries: number;
        webhooks: Array<{ url: string; events: string[] }>;
    } {
        return {
            webhookCount: this.webhooks.length,
            pendingRetries: this.retryAttempts.size,
            webhooks: this.webhooks.map((w) => ({
                url: w.url,
                events: w.events,
            })),
        };
    }

    /**
     * Clear all webhooks
     */
    clear(): void {
        this.webhooks = [];
        this.deliveryQueue.clear();
        this.retryAttempts.clear();
    }
}
