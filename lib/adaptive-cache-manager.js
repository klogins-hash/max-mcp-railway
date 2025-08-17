const CacheManager = require('./cache-manager');

/**
 * Adaptive Cache Manager
 * Extends CacheManager with adaptive TTL based on access patterns
 */
class AdaptiveCacheManager extends CacheManager {
    constructor() {
        super();
        
        // Track access patterns
        this.accessPatterns = new Map();
        this.adaptiveConfig = {
            minMultiplier: 0.5,  // Minimum TTL multiplier
            maxMultiplier: 3.0,  // Maximum TTL multiplier
            decayFactor: 0.95,   // Decay factor for access frequency
            updateInterval: 60000 // Update patterns every minute
        };

        // Start periodic pattern updates
        this.startPatternUpdates();
    }

    /**
     * Override get to track access patterns
     */
    async get(cacheType, key) {
        const result = await super.get(cacheType, key);
        
        if (result !== null) {
            this.trackAccess(cacheType, key);
        }
        
        return result;
    }

    /**
     * Override set to use adaptive TTL
     */
    async set(cacheType, key, value, ttl = null) {
        const adaptiveTTL = ttl || this.getAdaptiveTTL(cacheType, key);
        return super.set(cacheType, key, value, adaptiveTTL);
    }

    /**
     * Track access for a cache key
     */
    trackAccess(cacheType, key) {
        const patternKey = `${cacheType}:${key}`;
        const pattern = this.accessPatterns.get(patternKey) || {
            count: 0,
            lastAccess: Date.now(),
            frequency: 0
        };

        pattern.count++;
        pattern.lastAccess = Date.now();
        
        // Calculate access frequency (accesses per hour)
        const hoursSinceCreation = (Date.now() - (pattern.created || Date.now())) / 3600000;
        pattern.frequency = pattern.count / Math.max(hoursSinceCreation, 1);
        
        this.accessPatterns.set(patternKey, pattern);
    }

    /**
     * Get adaptive TTL based on access patterns
     */
    getAdaptiveTTL(cacheType, key) {
        const baseTTL = this.caches[cacheType]?.options.stdTTL || 300;
        const patternKey = `${cacheType}:${key}`;
        const pattern = this.accessPatterns.get(patternKey);

        if (!pattern || pattern.frequency === 0) {
            return baseTTL;
        }

        // Calculate multiplier based on access frequency
        // Higher frequency = longer TTL
        const frequencyScore = Math.log10(pattern.frequency + 1);
        const multiplier = 1 + frequencyScore * 0.5;
        
        // Apply bounds
        const boundedMultiplier = Math.max(
            this.adaptiveConfig.minMultiplier,
            Math.min(this.adaptiveConfig.maxMultiplier, multiplier)
        );

        const adaptiveTTL = Math.round(baseTTL * boundedMultiplier);
        
        console.log(`📊 Adaptive TTL for ${cacheType}:${key.substring(0, 20)}... = ${adaptiveTTL}s (base: ${baseTTL}s, multiplier: ${boundedMultiplier.toFixed(2)}x)`);
        
        return adaptiveTTL;
    }

    /**
     * Start periodic pattern updates
     */
    startPatternUpdates() {
        this.patternUpdateInterval = setInterval(() => {
            this.updatePatterns();
        }, this.adaptiveConfig.updateInterval);
    }

    /**
     * Update access patterns (decay old entries)
     */
    updatePatterns() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours

        for (const [key, pattern] of this.accessPatterns.entries()) {
            // Remove very old patterns
            if (now - pattern.lastAccess > maxAge) {
                this.accessPatterns.delete(key);
                continue;
            }

            // Apply decay to frequency
            pattern.frequency *= this.adaptiveConfig.decayFactor;
            
            // Remove patterns with very low frequency
            if (pattern.frequency < 0.01) {
                this.accessPatterns.delete(key);
            }
        }
    }

    /**
     * Get adaptive cache statistics
     */
    getAdaptiveStats() {
        const baseStats = super.getStats();
        const patterns = Array.from(this.accessPatterns.entries()).map(([key, pattern]) => ({
            key: key.substring(0, 50) + '...',
            count: pattern.count,
            frequency: pattern.frequency.toFixed(2),
            lastAccess: new Date(pattern.lastAccess).toISOString()
        }));

        // Sort by frequency
        patterns.sort((a, b) => b.frequency - a.frequency);

        return {
            ...baseStats,
            adaptive: {
                totalPatterns: this.accessPatterns.size,
                topPatterns: patterns.slice(0, 10),
                config: this.adaptiveConfig
            }
        };
    }

    /**
     * Clean up intervals on shutdown
     */
    shutdown() {
        if (this.patternUpdateInterval) {
            clearInterval(this.patternUpdateInterval);
        }
    }
}

module.exports = AdaptiveCacheManager;
