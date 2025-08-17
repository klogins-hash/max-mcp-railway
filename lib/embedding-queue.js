/**
 * Embedding Queue
 * Batches embedding requests for optimal Cohere API usage
 */
class EmbeddingQueue {
    constructor(options = {}) {
        this.batchSize = options.batchSize || 96; // Cohere's max batch size
        this.maxWait = options.maxWait || 100; // Max wait time in ms
        this.queue = [];
        this.processing = false;
        this.timer = null;
        
        this.stats = {
            totalRequests: 0,
            totalBatches: 0,
            avgBatchSize: 0,
            totalTexts: 0
        };
    }

    /**
     * Add text to the embedding queue
     * @param {string} text - Text to generate embedding for
     * @param {Object} options - Additional options (model, inputType)
     * @returns {Promise} - Resolves with the embedding
     */
    async add(text, options = {}) {
        this.stats.totalRequests++;
        
        return new Promise((resolve, reject) => {
            this.queue.push({
                text,
                options,
                resolve,
                reject,
                timestamp: Date.now()
            });

            // Start processing if not already
            if (!this.processing) {
                this.scheduleProcessing();
            }
        });
    }

    /**
     * Add multiple texts at once
     * @param {Array<string>} texts - Array of texts
     * @param {Object} options - Additional options
     * @returns {Promise<Array>} - Array of embeddings
     */
    async addBatch(texts, options = {}) {
        const promises = texts.map(text => this.add(text, options));
        return Promise.all(promises);
    }

    /**
     * Schedule queue processing
     */
    scheduleProcessing() {
        // Clear any existing timer
        if (this.timer) {
            clearTimeout(this.timer);
        }

        // Process immediately if batch is full
        if (this.queue.length >= this.batchSize) {
            this.processQueue();
        } else {
            // Otherwise wait up to maxWait
            this.timer = setTimeout(() => {
                this.processQueue();
            }, this.maxWait);
        }
    }

    /**
     * Process the current queue
     */
    async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;
        
        // Take up to batchSize items
        const batch = this.queue.splice(0, this.batchSize);
        
        // Group by options (model, inputType)
        const groups = this.groupByOptions(batch);

        for (const group of groups) {
            try {
                // Process this group
                await this.processBatch(group);
                
                // Update stats
                this.stats.totalBatches++;
                this.stats.totalTexts += group.length;
                this.stats.avgBatchSize = this.stats.totalTexts / this.stats.totalBatches;
            } catch (error) {
                // Reject all promises in this group
                group.forEach(item => item.reject(error));
            }
        }

        this.processing = false;

        // Check if there are more items to process
        if (this.queue.length > 0) {
            this.scheduleProcessing();
        }
    }

    /**
     * Group items by their options
     */
    groupByOptions(items) {
        const groups = new Map();
        
        items.forEach(item => {
            const key = JSON.stringify(item.options);
            if (!groups.has(key)) {
                groups.set(key, []);
            }
            groups.get(key).push(item);
        });

        return Array.from(groups.values());
    }

    /**
     * Process a batch of items with the same options
     * This should be overridden by the actual implementation
     */
    async processBatch(items) {
        // This is a placeholder - should be overridden
        throw new Error('processBatch must be implemented');
    }

    /**
     * Set the batch processor function
     */
    setBatchProcessor(processorFn) {
        this.processBatch = processorFn;
    }

    /**
     * Get queue statistics
     */
    getStats() {
        return {
            ...this.stats,
            currentQueueSize: this.queue.length,
            isProcessing: this.processing,
            efficiency: this.stats.totalBatches > 0
                ? (this.stats.avgBatchSize / this.batchSize * 100).toFixed(2) + '%'
                : '0%'
        };
    }

    /**
     * Clear the queue (use with caution)
     */
    clear() {
        // Reject all pending promises
        this.queue.forEach(item => {
            item.reject(new Error('Queue cleared'));
        });
        
        this.queue = [];
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
}

module.exports = EmbeddingQueue;
