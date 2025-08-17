/**
 * Request Deduplicator
 * Prevents duplicate concurrent requests to external services
 */
class RequestDeduplicator {
    constructor() {
        this.pending = new Map();
        this.stats = {
            deduped: 0,
            total: 0
        };
    }

    /**
     * Deduplicate requests based on a unique key
     * @param {string} key - Unique identifier for the request
     * @param {Function} requestFn - Async function that makes the request
     * @returns {Promise} - Result of the request
     */
    async dedupe(key, requestFn) {
        this.stats.total++;
        
        // If there's already a pending request with this key, return it
        if (this.pending.has(key)) {
            this.stats.deduped++;
            console.log(`🔄 Deduplicating request: ${key}`);
            return this.pending.get(key);
        }

        // Create new request promise
        const promise = requestFn()
            .then(result => {
                // Clean up on success
                this.pending.delete(key);
                return result;
            })
            .catch(error => {
                // Clean up on error
                this.pending.delete(key);
                throw error;
            });

        // Store the promise
        this.pending.set(key, promise);
        
        return promise;
    }

    /**
     * Get deduplication statistics
     */
    getStats() {
        return {
            ...this.stats,
            deduplicationRate: this.stats.total > 0 
                ? (this.stats.deduped / this.stats.total * 100).toFixed(2) + '%'
                : '0%',
            currentPending: this.pending.size
        };
    }

    /**
     * Clear all pending requests (use with caution)
     */
    clear() {
        this.pending.clear();
    }
}

module.exports = RequestDeduplicator;
