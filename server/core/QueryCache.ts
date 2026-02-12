/**
 * Query Cache for CFX-DB - OPTIMIZED VERSION
 *
 * O(1) LRU cache with TTL using Map's insertion order property.
 * Uses fast hash function for key generation instead of JSON.stringify.
 */

// Fast hash function (djb2 algorithm) - much faster than JSON.stringify
function fastHash(str: string): string {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) + hash) ^ str.charCodeAt(i);
    }
    return (hash >>> 0).toString(36);
}

// Stable JSON stringify with sorted keys for consistent hashing
function stableStringify(obj: any): string {
    if (obj === null || obj === undefined) return '';
    if (typeof obj !== 'object') return String(obj);
    if (Array.isArray(obj)) {
        return '[' + obj.map(stableStringify).join(',') + ']';
    }
    const keys = Object.keys(obj).sort();
    return '{' + keys.map(k => `"${k}":${stableStringify(obj[k])}`).join(',') + '}';
}

interface CacheEntry<T> {
    data: T;
    expires: number;
    accessCount: number;
}

interface CacheConfig {
    enabled: boolean;
    defaultTTL: number;
    maxSize: number;
    tableTTL: Record<string, number>;
}

export class QueryCache {
    private static instance: QueryCache;

    // Using Map for O(1) LRU - Map maintains insertion order
    // When we access an entry, we delete and re-insert to move it to the end
    private cache: Map<string, CacheEntry<any>> = new Map();

    private config: CacheConfig = {
        enabled: true,
        defaultTTL: 60000, // 60 seconds
        maxSize: 2000, // Increased from 1000
        tableTTL: {
            players: 30000, // 30s (changes frequently)
        },
    };

    private hits = 0;
    private misses = 0;

    // Pre-computed key cache for hot paths
    private keyCache: Map<string, string> = new Map();
    private readonly KEY_CACHE_MAX = 500;

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
     * Get cached value - O(1) with LRU promotion
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

        // O(1) LRU promotion: delete and re-insert moves to end of Map
        entry.accessCount++;
        this.cache.delete(key);
        this.cache.set(key, entry);

        this.hits++;
        return entry.data as T;
    }

    /**
     * Set cached value - O(1)
     */
    set<T>(key: string, data: T, ttl?: number): void {
        if (!this.config.enabled) {
            return;
        }

        // O(1) LRU eviction - remove first entry (oldest/least recently used)
        if (this.cache.size >= this.config.maxSize) {
            const firstKey = this.cache.keys().next().value;
            if (firstKey) {
                this.cache.delete(firstKey);
            }
        }

        this.cache.set(key, {
            data,
            expires: Date.now() + (ttl || this.config.defaultTTL),
            accessCount: 0,
        });
    }

    /**
     * Check if key exists and is not expired - O(1)
     */
    has(key: string): boolean {
        if (!this.config.enabled) return false;

        const entry = this.cache.get(key);
        if (!entry) return false;

        if (Date.now() > entry.expires) {
            this.cache.delete(key);
            return false;
        }

        return true;
    }

    /**
     * Invalidate cache by pattern (table name)
     */
    invalidate(pattern: string): number {
        let count = 0;

        for (const key of this.cache.keys()) {
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
        this.keyCache.clear();
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
     * Generate cache key - FAST version using hash
     */
    static generateKey(operation: string, table: string, args: any): string {
        // Fast path for simple queries
        if (!args || Object.keys(args).length <= 3) {
            // For simple args, skip hashing for even faster performance
            const argsStr = stableStringify(args);
            return `${operation}:${table}:${argsStr}`;
        }

        // For complex args, use hash
        const argsHash = fastHash(stableStringify(args));
        return `${operation}:${table}:${argsHash}`;
    }

    /**
     * Generate key with caching for repeated queries
     */
    generateKeyCached(operation: string, table: string, args: any): string {
        const baseKey = `${operation}:${table}`;

        // Fast path for no args
        if (!args || Object.keys(args).length === 0) {
            return baseKey;
        }

        // Check key cache for hot paths
        const argsStr = stableStringify(args);
        const cacheKey = `${baseKey}:${fastHash(argsStr)}`;

        const cached = this.keyCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        // Generate and cache key
        const key = QueryCache.generateKey(operation, table, args);

        // LRU for key cache
        if (this.keyCache.size >= this.KEY_CACHE_MAX) {
            const firstKey = this.keyCache.keys().next().value;
            if (firstKey) {
                this.keyCache.delete(firstKey);
            }
        }

        this.keyCache.set(cacheKey, key);
        return key;
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

    /**
     * Bulk set - more efficient for multiple entries
     */
    setBulk(entries: Array<{ key: string; data: any; ttl?: number }>): void {
        if (!this.config.enabled) return;

        for (const { key, data, ttl } of entries) {
            // Check size before each insert
            if (this.cache.size >= this.config.maxSize) {
                const firstKey = this.cache.keys().next().value;
                if (firstKey) {
                    this.cache.delete(firstKey);
                }
            }

            this.cache.set(key, {
                data,
                expires: Date.now() + (ttl || this.config.defaultTTL),
                accessCount: 0,
            });
        }
    }

    /**
     * Prewarm cache with data (useful for anticipated queries)
     */
    prewarm(operation: string, table: string, results: any[]): void {
        if (!this.config.enabled || !Array.isArray(results)) return;

        const ttl = this.getTTL(table);
        const entries = results
            .filter(r => r && r._id)
            .map(r => ({
                key: QueryCache.generateKey(operation, table, { where: { _id: r._id } }),
                data: r,
                ttl,
            }));

        this.setBulk(entries);
    }
}
