/**
 * Query Cache for CFX-DB
 *
 * LRU (Least Recently Used) cache with TTL (Time To Live) for query results.
 * Reduces Convex API calls by caching frequently accessed data.
 */

interface CacheEntry<T> {
    data: T;
    expires: number;
    accessCount: number;
    createdAt: number;
}

interface CacheConfig {
    enabled: boolean;
    defaultTTL: number;
    maxSize: number;
    tableTTL: Record<string, number>;
}

export class QueryCache {
    private static instance: QueryCache;

    private cache: Map<string, CacheEntry<any>> = new Map();
    private config: CacheConfig = {
        enabled: true,
        defaultTTL: 60000, // 60 seconds
        maxSize: 1000,
        tableTTL: {
            players: 30000, // 30s (changes frequently)
            keyValue: 120000, // 2min (rarely changes)
        },
    };

    private hits = 0;
    private misses = 0;

    private constructor() {}

    static getInstance(): QueryCache {
        if (!QueryCache.instance) {
            QueryCache.instance = new QueryCache();
        }
        return QueryCache.instance;
    }

    /**
     * Configure cache settings
     */
    configure(config: Partial<CacheConfig>): void {
        this.config = { ...this.config, ...config };
    }

    /**
     * Get cached value
     */
    get<T>(key: string): T | null {
        if (!this.config.enabled) {
            return null;
        }

        const entry = this.cache.get(key);
        if (!entry) {
            this.misses++;
            return null;
        }

        // Check expiry
        if (Date.now() > entry.expires) {
            this.cache.delete(key);
            this.misses++;
            return null;
        }

        // Update access count
        entry.accessCount++;
        this.hits++;

        return entry.data as T;
    }

    /**
     * Set cached value
     */
    set<T>(key: string, data: T, ttl?: number): void {
        if (!this.config.enabled) {
            return;
        }

        // LRU eviction if full
        if (this.cache.size >= this.config.maxSize) {
            this.evictLRU();
        }

        this.cache.set(key, {
            data,
            expires: Date.now() + (ttl || this.config.defaultTTL),
            accessCount: 0,
            createdAt: Date.now(),
        });
    }

    /**
     * Evict least recently used entry
     */
    private evictLRU(): void {
        let lruKey: string | null = null;
        let lruCount = Infinity;

        for (const [key, entry] of this.cache.entries()) {
            if (entry.accessCount < lruCount) {
                lruCount = entry.accessCount;
                lruKey = key;
            }
        }

        if (lruKey) {
            this.cache.delete(lruKey);
        }
    }

    /**
     * Invalidate cache by pattern (e.g., table name)
     */
    invalidate(pattern: string): number {
        let count = 0;

        for (const [key, _] of this.cache.entries()) {
            if (key.includes(pattern)) {
                this.cache.delete(key);
                count++;
            }
        }

        return count;
    }

    /**
     * Invalidate all cache for a table
     */
    invalidateTable(table: string): number {
        return this.invalidate(`:${table}:`);
    }

    /**
     * Clear entire cache
     */
    clear(): void {
        this.cache.clear();
        this.hits = 0;
        this.misses = 0;
    }

    /**
     * Get cache statistics
     */
    getStats(): {
        size: number;
        maxSize: number;
        hits: number;
        misses: number;
        hitRate: number;
        enabled: boolean;
    } {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            maxSize: this.config.maxSize,
            hits: this.hits,
            misses: this.misses,
            hitRate: total > 0 ? this.hits / total : 0,
            enabled: this.config.enabled,
        };
    }

    /**
     * Generate cache key
     */
    static generateKey(operation: string, table: string, args: any): string {
        const argsStr = JSON.stringify(args || {});
        return `${operation}:${table}:${argsStr}`;
    }

    /**
     * Get TTL for a table
     */
    getTTL(table: string): number {
        return this.config.tableTTL[table] || this.config.defaultTTL;
    }

    /**
     * Check if caching is enabled
     */
    isEnabled(): boolean {
        return this.config.enabled;
    }

    /**
     * Enable cache
     */
    enable(): void {
        this.config.enabled = true;
    }

    /**
     * Disable cache
     */
    disable(): void {
        this.config.enabled = false;
    }

    /**
     * Get all cache keys
     */
    getKeys(): string[] {
        return Array.from(this.cache.keys());
    }

    /**
     * Get cache entry details
     */
    getEntry(key: string): CacheEntry<any> | null {
        return this.cache.get(key) || null;
    }
}
