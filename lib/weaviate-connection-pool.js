const weaviate = require('weaviate-ts-client').default;

/**
 * Weaviate Connection Pool
 * Manages multiple Weaviate client connections for better performance
 */
class WeaviateConnectionPool {
    constructor(options = {}) {
        this.poolSize = options.poolSize || 5;
        this.url = options.url || process.env.WEAVIATE_ENDPOINT || process.env.WEAVIATE_URL;
        this.apiKey = options.apiKey || process.env.WEAVIATE_API_KEY;
        
        this.pool = [];
        this.currentIndex = 0;
        this.stats = {
            connectionsCreated: 0,
            totalRequests: 0,
            errors: 0
        };

        // Initialize the pool
        this.initializePool();
    }

    /**
     * Initialize the connection pool
     */
    initializePool() {
        console.log(`🏊 Initializing Weaviate connection pool with ${this.poolSize} connections...`);
        
        for (let i = 0; i < this.poolSize; i++) {
            try {
                const connection = this.createConnection();
                this.pool.push({
                    client: connection,
                    inUse: false,
                    lastUsed: Date.now(),
                    requestCount: 0
                });
                this.stats.connectionsCreated++;
            } catch (error) {
                console.error(`Failed to create connection ${i + 1}:`, error.message);
            }
        }

        console.log(`✅ Connection pool initialized with ${this.pool.length} connections`);
    }

    /**
     * Create a new Weaviate connection
     */
    createConnection() {
        return weaviate.client({
            scheme: 'https',
            host: this.url.replace('https://', ''),
            apiKey: new weaviate.ApiKey(this.apiKey),
            headers: {
                'X-Cohere-Api-Key': process.env.COHERE_API_KEY
            }
        });
    }

    /**
     * Get a connection from the pool
     */
    getConnection() {
        this.stats.totalRequests++;
        
        // Try to find an available connection
        for (let i = 0; i < this.pool.length; i++) {
            const index = (this.currentIndex + i) % this.pool.length;
            const conn = this.pool[index];
            
            if (!conn.inUse) {
                conn.inUse = true;
                conn.lastUsed = Date.now();
                conn.requestCount++;
                this.currentIndex = (index + 1) % this.pool.length;
                
                return {
                    client: conn.client,
                    release: () => this.releaseConnection(index)
                };
            }
        }

        // All connections in use, use round-robin anyway
        const conn = this.pool[this.currentIndex];
        conn.requestCount++;
        this.currentIndex = (this.currentIndex + 1) % this.pool.length;
        
        return {
            client: conn.client,
            release: () => {} // No-op since connection wasn't exclusively locked
        };
    }

    /**
     * Release a connection back to the pool
     */
    releaseConnection(index) {
        if (this.pool[index]) {
            this.pool[index].inUse = false;
        }
    }

    /**
     * Execute an operation with automatic connection management
     */
    async execute(operation) {
        const connection = this.getConnection();
        
        try {
            const result = await operation(connection.client);
            connection.release();
            return result;
        } catch (error) {
            this.stats.errors++;
            connection.release();
            throw error;
        }
    }

    /**
     * Health check all connections
     */
    async healthCheck() {
        const results = [];
        
        for (let i = 0; i < this.pool.length; i++) {
            try {
                const conn = this.pool[i];
                const meta = await conn.client.misc.metaGetter().do();
                results.push({
                    index: i,
                    healthy: true,
                    inUse: conn.inUse,
                    requestCount: conn.requestCount,
                    version: meta.version
                });
            } catch (error) {
                results.push({
                    index: i,
                    healthy: false,
                    error: error.message
                });
            }
        }

        return results;
    }

    /**
     * Get pool statistics
     */
    getStats() {
        const activeConnections = this.pool.filter(c => c.inUse).length;
        const totalRequests = this.pool.reduce((sum, c) => sum + c.requestCount, 0);
        
        return {
            ...this.stats,
            poolSize: this.pool.length,
            activeConnections,
            idleConnections: this.pool.length - activeConnections,
            averageRequestsPerConnection: totalRequests / this.pool.length,
            connectionDetails: this.pool.map((c, i) => ({
                index: i,
                inUse: c.inUse,
                requestCount: c.requestCount,
                lastUsed: new Date(c.lastUsed).toISOString()
            }))
        };
    }

    /**
     * Refresh a specific connection
     */
    async refreshConnection(index) {
        if (index < 0 || index >= this.pool.length) {
            throw new Error('Invalid connection index');
        }

        try {
            const newClient = this.createConnection();
            this.pool[index] = {
                client: newClient,
                inUse: false,
                lastUsed: Date.now(),
                requestCount: 0
            };
            console.log(`🔄 Refreshed connection at index ${index}`);
        } catch (error) {
            console.error(`Failed to refresh connection ${index}:`, error.message);
            throw error;
        }
    }

    /**
     * Close all connections (for graceful shutdown)
     */
    async close() {
        console.log('🛑 Closing Weaviate connection pool...');
        // Weaviate client doesn't have explicit close, but we can clear the pool
        this.pool = [];
    }
}

module.exports = WeaviateConnectionPool;
