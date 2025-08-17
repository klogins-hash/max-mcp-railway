const NodeCache = require('node-cache');

class CacheManager {
    constructor() {
        // Different cache instances for different purposes
        this.caches = {
            embeddings: new NodeCache({ 
                stdTTL: 3600, // 1 hour for embeddings
                checkperiod: 600,
                useClones: false
            }),
            searches: new NodeCache({ 
                stdTTL: 300, // 5 minutes for search results
                checkperiod: 60,
                maxKeys: 1000
            }),
            mcp: new NodeCache({ 
                stdTTL: 60, // 1 minute for MCP responses
                checkperiod: 30,
                maxKeys: 500
            }),
            metadata: new NodeCache({ 
                stdTTL: 1800, // 30 minutes for metadata
                checkperiod: 300
            })
        };

        this.stats = {
            hits: 0,
            misses: 0,
            sets: 0,
            deletes: 0
        };
    }

    generateKey(type, ...params) {
        // Generate consistent cache keys
        const keyBase = params.map(p => 
            typeof p === 'object' ? JSON.stringify(p) : String(p)
        ).join(':');
        
        return `${type}:${this.hashString(keyBase)}`;
    }

    hashString(str) {
        // Simple hash function for consistent keys
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash).toString(36);
    }

    async get(cacheType, key) {
        const cache = this.caches[cacheType];
        if (!cache) return null;

        const value = cache.get(key);
        if (value !== undefined) {
            this.stats.hits++;
            return value;
        }

        this.stats.misses++;
        return null;
    }

    async set(cacheType, key, value, ttl = null) {
        const cache = this.caches[cacheType];
        if (!cache) return false;

        const success = ttl ? cache.set(key, value, ttl) : cache.set(key, value);
        if (success) {
            this.stats.sets++;
        }
        return success;
    }

    async getOrSet(cacheType, key, fetchFunction, ttl = null) {
        // Try to get from cache first
        const cached = await this.get(cacheType, key);
        if (cached !== null) {
            return cached;
        }

        // Fetch fresh data
        try {
            const freshData = await fetchFunction();
            await this.set(cacheType, key, freshData, ttl);
            return freshData;
        } catch (error) {
            console.error(`Cache fetch error for ${key}:`, error);
            throw error;
        }
    }

    async invalidate(cacheType, pattern = null) {
        const cache = this.caches[cacheType];
        if (!cache) return 0;

        if (pattern) {
            // Invalidate keys matching pattern
            const keys = cache.keys();
            let deleted = 0;
            
            for (const key of keys) {
                if (key.includes(pattern)) {
                    cache.del(key);
                    deleted++;
                }
            }
            
            this.stats.deletes += deleted;
            return deleted;
        } else {
            // Clear entire cache type
            const deleted = cache.keys().length;
            cache.flushAll();
            this.stats.deletes += deleted;
            return deleted;
        }
    }

    async warmUp(preloadData) {
        // Pre-populate cache with frequently accessed data
        const results = {
            embeddings: 0,
            metadata: 0
        };

        // Preload common embeddings
        if (preloadData.embeddings) {
            for (const [text, embedding] of Object.entries(preloadData.embeddings)) {
                const key = this.generateKey('embedding', text);
                if (await this.set('embeddings', key, embedding)) {
                    results.embeddings++;
                }
            }
        }

        // Preload metadata
        if (preloadData.metadata) {
            for (const [key, value] of Object.entries(preloadData.metadata)) {
                if (await this.set('metadata', key, value)) {
                    results.metadata++;
                }
            }
        }

        return results;
    }

    getStats() {
        const cacheStats = {};
        
        for (const [name, cache] of Object.entries(this.caches)) {
            const keys = cache.keys();
            cacheStats[name] = {
                keys: keys.length,
                hits: cache.getStats().hits,
                misses: cache.getStats().misses,
                ksize: cache.getStats().ksize,
                vsize: cache.getStats().vsize
            };
        }

        return {
            global: this.stats,
            caches: cacheStats,
            hitRate: this.stats.hits / (this.stats.hits + this.stats.misses) || 0
        };
    }

    // Batch operations for efficiency
    async getBatch(cacheType, keys) {
        const cache = this.caches[cacheType];
        if (!cache) return {};

        const results = {};
        const missingKeys = [];

        for (const key of keys) {
            const value = cache.get(key);
            if (value !== undefined) {
                results[key] = value;
                this.stats.hits++;
            } else {
                missingKeys.push(key);
                this.stats.misses++;
            }
        }

        return { results, missingKeys };
    }

    async setBatch(cacheType, entries, ttl = null) {
        const cache = this.caches[cacheType];
        if (!cache) return 0;

        let successful = 0;
        for (const [key, value] of Object.entries(entries)) {
            if (ttl ? cache.set(key, value, ttl) : cache.set(key, value)) {
                successful++;
                this.stats.sets++;
            }
        }

        return successful;
    }
}

module.exports = CacheManager;
