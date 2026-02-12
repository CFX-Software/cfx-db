/**
 * CacheManager - LRU cache with TTL support
 *
 * Features:
 * - Per-key TTL
 * - Memory limit with LRU eviction
 * - Cache invalidation patterns
 * - Performance metrics
 */

interface CacheEntry<T> {
    value: T;
    expiresAt: number;
    size: number; // Estimated size in bytes
    lastAccessed: number;
}

export class CacheManager {
    private static instance: CacheManager;
    private cache: Map<string, CacheEntry<any>> = new Map();
    private currentMemoryBytes: number = 0;
    private maxMemoryBytes: number;
    private defaultTTL: number;

    // Stats
    private hits: number = 0;
    private misses: number = 0;
    private evictions: number = 0;

    private constructor(maxMemoryMB: number, defaultTTL: number) {
        this.maxMemoryBytes = maxMemoryMB * 1024 * 1024;
        this.defaultTTL = defaultTTL;
    }

    static getInstance(maxMemoryMB?: number, defaultTTL?: number): CacheManager {
        if (!CacheManager.instance) {
            if (maxMemoryMB === undefined || defaultTTL === undefined) {
                throw new Error("maxMemoryMB and defaultTTL required for first initialization");
            }
            CacheManager.instance = new CacheManager(maxMemoryMB, defaultTTL);
        }
        return CacheManager.instance;
    }

    /**
     * Get a value from cache
     */
    get<T>(key: string): T | undefined {
        const entry = this.cache.get(key);

        if (!entry) {
            this.misses++;
            return undefined;
        }

        // Check expiry
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            this.currentMemoryBytes -= entry.size;
            this.misses++;
            return undefined;
        }

        // Update access time for LRU
        entry.lastAccessed = Date.now();
        this.hits++;
        return entry.value as T;
    }

    /**
     * Set a value in cache
     */
    set<T>(key: string, value: T, ttl?: number): void {
        const size = this.estimateSize(value);
        const expiresAt = Date.now() + (ttl ?? this.defaultTTL);

        // Remove old entry if exists
        const existing = this.cache.get(key);
        if (existing) {
            this.currentMemoryBytes -= existing.size;
        }

        // Check if we need to evict
        while (this.currentMemoryBytes + size > this.maxMemoryBytes && this.cache.size > 0) {
            this.evictLRU();
        }

        // Add new entry
        this.cache.set(key, {
            value,
            expiresAt,
            size,
            lastAccessed: Date.now(),
        });

        this.currentMemoryBytes += size;
    }

    /**
     * Delete a specific key
     */
    delete(key: string): boolean {
        const entry = this.cache.get(key);
        if (entry) {
            this.cache.delete(key);
            this.currentMemoryBytes -= entry.size;
            return true;
        }
        return false;
    }

    /**
     * Invalidate keys matching a pattern
     */
    invalidate(pattern: string | RegExp): number {
        let count = 0;
        const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;

        for (const [key, entry] of this.cache.entries()) {
            if (regex.test(key)) {
                this.cache.delete(key);
                this.currentMemoryBytes -= entry.size;
                count++;
            }
        }

        return count;
    }

    /**
     * Clear entire cache
     */
    clear(): void {
        this.cache.clear();
        this.currentMemoryBytes = 0;
    }

    /**
     * Evict least recently used entry
     */
    private evictLRU(): void {
        let lruKey: string | null = null;
        let lruTime = Infinity;

        for (const [key, entry] of this.cache.entries()) {
            if (entry.lastAccessed < lruTime) {
                lruTime = entry.lastAccessed;
                lruKey = key;
            }
        }

        if (lruKey) {
            const entry = this.cache.get(lruKey)!;
            this.cache.delete(lruKey);
            this.currentMemoryBytes -= entry.size;
            this.evictions++;
        }
    }

    /**
     * Estimate size of a value in bytes (rough estimate)
     */
    private estimateSize(value: any): number {
        const json = JSON.stringify(value);
        return json.length * 2; // Rough estimate: 2 bytes per character
    }

    /**
     * Get cache statistics
     */
    getStats(): {
        size: number;
        memoryMB: number;
        maxMemoryMB: number;
        hits: number;
        misses: number;
        evictions: number;
        hitRate: number;
    } {
        const total = this.hits + this.misses;
        return {
            size: this.cache.size,
            memoryMB: this.currentMemoryBytes / (1024 * 1024),
            maxMemoryMB: this.maxMemoryBytes / (1024 * 1024),
            hits: this.hits,
            misses: this.misses,
            evictions: this.evictions,
            hitRate: total > 0 ? this.hits / total : 0,
        };
    }

    /**
     * Clean up expired entries
     */
    cleanup(): number {
        let removed = 0;
        const now = Date.now();

        for (const [key, entry] of this.cache.entries()) {
            if (now > entry.expiresAt) {
                this.cache.delete(key);
                this.currentMemoryBytes -= entry.size;
                removed++;
            }
        }

        return removed;
    }
}
