/**
 * RateLimiter - Token bucket rate limiting
 *
 * Prevents DoS by limiting operations per resource and globally.
 * Uses token bucket algorithm for smooth rate limiting with burst allowance.
 */

import { Logger } from "../utils/Logger";

interface TokenBucket {
    tokens: number;
    lastRefill: number;
    capacity: number;
    refillRate: number; // tokens per second
}

export class RateLimiter {
    private static instance: RateLimiter;

    private readonly PER_RESOURCE_LIMIT = 100; // 100 ops/sec per resource
    private readonly GLOBAL_LIMIT = 500;       // 500 ops/sec total
    private readonly BURST_MULTIPLIER = 2;     // Allow 2x burst

    private resourceBuckets: Map<string, TokenBucket> = new Map();
    private globalBucket: TokenBucket;

    private constructor() {
        // Initialize global bucket
        this.globalBucket = {
            tokens: this.GLOBAL_LIMIT * this.BURST_MULTIPLIER,
            lastRefill: Date.now(),
            capacity: this.GLOBAL_LIMIT * this.BURST_MULTIPLIER,
            refillRate: this.GLOBAL_LIMIT,
        };

        // Cleanup old resource buckets every minute
        setInterval(() => {
            this.cleanup();
        }, 60000);
    }

    static getInstance(): RateLimiter {
        if (!RateLimiter.instance) {
            RateLimiter.instance = new RateLimiter();
        }
        return RateLimiter.instance;
    }

    /**
     * Check if operation is allowed for given resource
     * @param resourceName The FiveM resource name making the request
     * @param cost Number of tokens to consume (default: 1)
     * @returns true if allowed, false if rate limited
     */
    checkLimit(resourceName: string, cost: number = 1): boolean {
        // Check global limit first
        if (!this.consumeTokens(this.globalBucket, cost)) {
            Logger.getInstance().scoped("ratelimit").warn("Global rate limit exceeded");
            return false;
        }

        // Check per-resource limit
        let bucket = this.resourceBuckets.get(resourceName);
        if (!bucket) {
            bucket = {
                tokens: this.PER_RESOURCE_LIMIT * this.BURST_MULTIPLIER,
                lastRefill: Date.now(),
                capacity: this.PER_RESOURCE_LIMIT * this.BURST_MULTIPLIER,
                refillRate: this.PER_RESOURCE_LIMIT,
            };
            this.resourceBuckets.set(resourceName, bucket);
        }

        if (!this.consumeTokens(bucket, cost)) {
            Logger.getInstance().scoped("ratelimit").warn("Rate limit exceeded", { resource: resourceName });
            return false;
        }

        return true;
    }

    /**
     * Consume tokens from a bucket
     * @param bucket The token bucket
     * @param cost Number of tokens to consume
     * @returns true if tokens were consumed, false if not enough tokens
     */
    private consumeTokens(bucket: TokenBucket, cost: number): boolean {
        // Refill tokens based on time elapsed
        const now = Date.now();
        const timePassed = (now - bucket.lastRefill) / 1000; // seconds
        const tokensToAdd = timePassed * bucket.refillRate;

        bucket.tokens = Math.min(bucket.capacity, bucket.tokens + tokensToAdd);
        bucket.lastRefill = now;

        // Check if enough tokens
        if (bucket.tokens >= cost) {
            bucket.tokens -= cost;
            return true;
        }

        return false;
    }

    /**
     * Get current rate limit stats
     */
    getStats(): {
        globalTokens: number;
        globalCapacity: number;
        resourceCount: number;
    } {
        return {
            globalTokens: Math.floor(this.globalBucket.tokens),
            globalCapacity: this.globalBucket.capacity,
            resourceCount: this.resourceBuckets.size,
        };
    }

    /**
     * Cleanup buckets for resources that haven't been used recently
     */
    private cleanup(): void {
        const now = Date.now();
        const threshold = 5 * 60 * 1000; // 5 minutes

        for (const [resourceName, bucket] of this.resourceBuckets.entries()) {
            if (now - bucket.lastRefill > threshold) {
                this.resourceBuckets.delete(resourceName);
            }
        }
    }

    /**
     * Reset rate limits for a specific resource (for testing/admin)
     */
    reset(resourceName?: string): void {
        if (resourceName) {
            this.resourceBuckets.delete(resourceName);
        } else {
            // Reset global
            this.globalBucket.tokens = this.globalBucket.capacity;
            this.globalBucket.lastRefill = Date.now();
        }
    }
}
