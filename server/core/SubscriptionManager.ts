import type { FunctionReference } from "convex/server";
import { ConnectionManager } from "./ConnectionManager";

/**
 * SubscriptionManager - Manages real-time subscriptions with deduplication
 *
 * Features:
 * - Automatic subscription deduplication (same query+args = shared sub)
 * - Reference counting for cleanup
 * - Memory usage tracking
 * - Per-subscriber callbacks
 */

interface SubscriptionEntry {
    id: string;
    queryName: string;
    args: any;
    unsubscribe: () => void;
    subscribers: Map<string, (data: any) => void>; // subscriberId -> callback
    lastUpdate: number;
    data: any;
}

export class SubscriptionManager {
    private static instance: SubscriptionManager;

    private readonly MAX_SUBSCRIPTIONS = 500; // Prevent runaway subscriptions
    private subscriptions: Map<string, SubscriptionEntry> = new Map();
    private subscriberMap: Map<string, Set<string>> = new Map(); // subscriberId -> Set of subscription IDs

    private constructor() {}

    static getInstance(): SubscriptionManager {
        if (!SubscriptionManager.instance) {
            SubscriptionManager.instance = new SubscriptionManager();
        }
        return SubscriptionManager.instance;
    }

    /**
     * Subscribe to a query with automatic deduplication
     */
    subscribe(
        query: FunctionReference<"query">,
        args: any,
        subscriberId: string,
        onUpdate: (data: any) => void
    ): string {
        const key = this.getSubscriptionKey(query, args);

        let sub = this.subscriptions.get(key);

        if (sub) {
            // Add subscriber to existing subscription
            sub.subscribers.set(subscriberId, onUpdate);

            // Immediately send cached data if available
            if (sub.data !== undefined) {
                onUpdate(sub.data);
            }
        } else {
            // Check subscription limit before creating new subscription
            if (this.subscriptions.size >= this.MAX_SUBSCRIPTIONS) {
                throw new Error(
                    `[cfx-db] Max subscriptions (${this.MAX_SUBSCRIPTIONS}) reached. Unsubscribe unused subscriptions.`
                );
            }

            // Create new subscription
            const client = ConnectionManager.getInstance().getSubscriptionClient();

            const unsubscribe = client.onUpdate(
                query,
                args,
                (data: any) => {
                    this.handleUpdate(key, data);
                }
            );

            sub = {
                id: key,
                queryName: query.toString(),
                args,
                unsubscribe,
                subscribers: new Map([[subscriberId, onUpdate]]),
                lastUpdate: Date.now(),
                data: undefined,
            };

            this.subscriptions.set(key, sub);
        }

        // Track subscriber's subscriptions
        if (!this.subscriberMap.has(subscriberId)) {
            this.subscriberMap.set(subscriberId, new Set());
        }
        this.subscriberMap.get(subscriberId)!.add(key);

        return key;
    }

    /**
     * Unsubscribe a specific subscriber from a subscription
     */
    unsubscribe(subscriptionId: string, subscriberId: string): boolean {
        const sub = this.subscriptions.get(subscriptionId);
        if (!sub) return false;

        // Remove subscriber
        sub.subscribers.delete(subscriberId);

        // Update subscriber map
        const subIds = this.subscriberMap.get(subscriberId);
        if (subIds) {
            subIds.delete(subscriptionId);
            if (subIds.size === 0) {
                this.subscriberMap.delete(subscriberId);
            }
        }

        // If no more subscribers, clean up the subscription
        if (sub.subscribers.size === 0) {
            sub.unsubscribe();
            this.subscriptions.delete(subscriptionId);
            return true;
        }

        return false;
    }

    /**
     * Cleanup all subscriptions for a subscriber (e.g., on player disconnect)
     */
    cleanupSubscriber(subscriberId: string): number {
        const subIds = this.subscriberMap.get(subscriberId);
        if (!subIds) return 0;

        let cleaned = 0;
        for (const subId of subIds) {
            if (this.unsubscribe(subId, subscriberId)) {
                cleaned++;
            }
        }

        this.subscriberMap.delete(subscriberId);
        return cleaned;
    }

    /**
     * Handle subscription update
     */
    private handleUpdate(subscriptionId: string, data: any): void {
        const sub = this.subscriptions.get(subscriptionId);
        if (!sub) return;

        sub.data = data;
        sub.lastUpdate = Date.now();

        // Notify all subscribers
        for (const callback of sub.subscribers.values()) {
            try {
                callback(data);
            } catch (error) {
                console.error("[cfx-db] Error in subscription callback:", error);
            }
        }
    }

    /**
     * Create deterministic key from query + args
     */
    private getSubscriptionKey(query: FunctionReference<"query">, args: any): string {
        const sortedArgs = JSON.stringify(args, Object.keys(args || {}).sort());
        return `${query.toString()}:${sortedArgs}`;
    }

    /**
     * Get subscription data without subscribing
     */
    getSubscriptionData(subscriptionId: string): any | undefined {
        return this.subscriptions.get(subscriptionId)?.data;
    }

    /**
     * Get statistics
     */
    getStats(): {
        activeSubscriptions: number;
        totalSubscribers: number;
        memoryEstimateMB: number;
    } {
        let totalSubscribers = 0;
        let memoryBytes = 0;

        for (const sub of this.subscriptions.values()) {
            totalSubscribers += sub.subscribers.size;
            if (sub.data) {
                memoryBytes += JSON.stringify(sub.data).length * 2;
            }
        }

        return {
            activeSubscriptions: this.subscriptions.size,
            totalSubscribers,
            memoryEstimateMB: memoryBytes / (1024 * 1024),
        };
    }

    /**
     * Cleanup and dispose all subscriptions
     */
    dispose(): void {
        for (const sub of this.subscriptions.values()) {
            sub.unsubscribe();
        }
        this.subscriptions.clear();
        this.subscriberMap.clear();
    }
}
