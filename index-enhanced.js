require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const zlib = require('zlib');

// Import optimization modules
const ConnectionManager = require('./lib/connection-manager');
const AdaptiveCacheManager = require('./lib/adaptive-cache-manager');
const MetricsCollector = require('./lib/metrics-collector');
const MetricsAggregator = require('./lib/metrics-aggregator');
const RequestDeduplicator = require('./lib/request-deduplicator');
const CircuitBreaker = require('./lib/circuit-breaker');
const EmbeddingQueue = require('./lib/embedding-queue');
const WeaviateConnectionPool = require('./lib/weaviate-connection-pool');
const OptimizedWeaviateClient = require('./lib/optimized-weaviate-client');
const WeaviateOptimizer = require('./weaviate-optimizer');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize enhanced components
const connectionManager = new ConnectionManager();
const cacheManager = new AdaptiveCacheManager();
const metricsCollector = new MetricsCollector();
const metricsAggregator = new MetricsAggregator();
const requestDeduplicator = new RequestDeduplicator();
const weaviatePool = new WeaviateConnectionPool({ poolSize: 5 });

// Circuit breakers for each service
const circuitBreakers = {
    mcp: new CircuitBreaker({ threshold: 5, timeout: 30000 }),
    weaviate: new CircuitBreaker({ threshold: 3, timeout: 20000 }),
    cohere: new CircuitBreaker({ threshold: 3, timeout: 15000 }),
    openrouter: new CircuitBreaker({ threshold: 5, timeout: 30000 })
};

// Embedding queue with Cohere batch processor
const embeddingQueue = new EmbeddingQueue({ batchSize: 96, maxWait: 100 });

// Set up embedding batch processor
embeddingQueue.setBatchProcessor(async (items) => {
    const texts = items.map(item => item.text);
    const options = items[0].options; // Assume same options for batch
    
    try {
        const embeddings = await circuitBreakers.cohere.execute(
            async () => {
                const cohereConnection = connectionManager.getConnection('cohere');
                const response = await cohereConnection.client.embed({
                    texts,
                    model: options.model || 'embed-english-v3.0',
                    inputType: options.inputType || 'search_document'
                });
                return response.embeddings;
            },
            'cohere-embed'
        );

        // Resolve all promises with their respective embeddings
        items.forEach((item, index) => {
            item.resolve(embeddings[index]);
        });
    } catch (error) {
        // Reject all promises on error
        items.forEach(item => item.reject(error));
    }
});

// Enhanced Weaviate client with all optimizations
class EnhancedWeaviateClient extends OptimizedWeaviateClient {
    constructor() {
        super();
        this.pool = weaviatePool;
        this.deduplicator = requestDeduplicator;
        this.embeddingQueue = embeddingQueue;
        this.circuitBreaker = circuitBreakers.weaviate;
    }

    async query(className, queryText, options = {}) {
        const dedupeKey = `query:${className}:${queryText}:${JSON.stringify(options)}`;
        
        return this.deduplicator.dedupe(dedupeKey, async () => {
            return this.circuitBreaker.execute(
                async () => super.query(className, queryText, options),
                'weaviate-query'
            );
        });
    }

    async generateEmbedding(text) {
        // Use the embedding queue for better batching
        return this.embeddingQueue.add(text);
    }

    async batchInsert(className, objects) {
        return this.circuitBreaker.execute(
            async () => {
                return this.pool.execute(async (client) => {
                    // Use connection from pool
                    const originalClient = this.connectionManager.getConnection('weaviate').client;
                    this.connectionManager.getConnection('weaviate').client = client;
                    
                    try {
                        return await super.batchInsert(className, objects);
                    } finally {
                        // Restore original client
                        this.connectionManager.getConnection('weaviate').client = originalClient;
                    }
                });
            },
            'weaviate-batch-insert'
        );
    }
}

const weaviateClient = new EnhancedWeaviateClient();
const optimizer = new WeaviateOptimizer();

// Enhanced middleware with Brotli compression
app.use(helmet());
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true
}));

// Enhanced compression with Brotli
app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
        if (req.headers['x-no-compression']) {
            return false;
        }
        return compression.filter(req, res);
    },
    brotliOptions: {
        params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 4
        }
    }
}));

app.use(express.json({ limit: '50mb' }));
app.use(morgan('combined'));

// Request tracking middleware
app.use((req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        metricsCollector.recordRequest(req.path, req.method, res.statusCode, duration);
        metricsAggregator.addMetric('request_duration', duration, Date.now(), {
            path: req.path,
            method: req.method,
            status: res.statusCode
        });
    });
    
    next();
});

// Enhanced rate limiting
const createRateLimiter = (windowMs, max, message) => rateLimit({
    windowMs,
    max,
    message,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        metricsCollector.recordError('rate_limit', req.path);
        res.status(429).json({ error: message });
    }
});

// Apply rate limiters
app.use('/api/', createRateLimiter(60000, 100, 'Too many requests'));
app.use('/api/weaviate/optimize', createRateLimiter(300000, 5, 'Optimization rate limit exceeded'));
app.use('/api/weaviate/batch', createRateLimiter(60000, 20, 'Batch operation rate limit exceeded'));

// Health check endpoint with detailed status
app.get('/health', async (req, res) => {
    try {
        const [health, poolStats, cacheStats, metrics] = await Promise.all([
            connectionManager.healthCheckAll(),
            weaviatePool.getStats(),
            cacheManager.getAdaptiveStats(),
            metricsCollector.getMetricsSummary()
        ]);

        const circuitStatus = {};
        for (const [name, breaker] of Object.entries(circuitBreakers)) {
            circuitStatus[name] = breaker.getStatus();
        }

        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            connections: health,
            pool: poolStats,
            cache: cacheStats,
            metrics,
            circuits: circuitStatus,
            deduplication: requestDeduplicator.getStats(),
            embeddingQueue: embeddingQueue.getStats()
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Metrics endpoint with aggregation
app.get('/metrics', async (req, res) => {
    const { interval = '1m', format = 'json' } = req.query;
    
    const metrics = metricsAggregator.aggregateMultipleMetrics([
        { name: 'request_duration' },
        { name: 'embedding_generation_time' },
        { name: 'search_duration' },
        { name: 'cache_hit_rate' }
    ], interval);

    if (format === 'prometheus') {
        res.type('text/plain');
        res.send(metricsAggregator.toPrometheusFormat());
    } else {
        res.json({
            interval,
            metrics,
            snapshot: metricsAggregator.getSnapshot(),
            timestamp: new Date().toISOString()
        });
    }
});

// MCP proxy endpoints with circuit breaker
app.all('/api/mcp/*', async (req, res) => {
    const path = req.params[0];
    const start = Date.now();
    
    try {
        const result = await circuitBreakers.mcp.execute(
            async () => {
                const dedupeKey = `mcp:${req.method}:${path}:${JSON.stringify(req.body)}`;
                
                return requestDeduplicator.dedupe(dedupeKey, async () => {
                    const cacheKey = cacheManager.generateKey('mcp', req.method, path, req.body);
                    
                    // Check cache for GET requests
                    if (req.method === 'GET') {
                        const cached = await cacheManager.get('mcp', cacheKey);
                        if (cached) {
                            metricsAggregator.addMetric('cache_hit_rate', 1);
                            return cached;
                        }
                    }
                    
                    // Make request
                    const response = await connectionManager.executeWithRetry('mcp', async (axios) => {
                        return await axios({
                            method: req.method,
                            url: `/${path}`,
                            data: req.body,
                            params: req.query
                        });
                    });
                    
                    // Cache successful GET responses
                    if (req.method === 'GET' && response.data) {
                        await cacheManager.set('mcp', cacheKey, response.data);
                        metricsAggregator.addMetric('cache_hit_rate', 0);
                    }
                    
                    return response.data;
                });
            },
            'mcp-proxy'
        );
        
        metricsCollector.recordIntegration('mcp', true, Date.now() - start);
        res.json(result);
    } catch (error) {
        metricsCollector.recordIntegration('mcp', false, Date.now() - start);
        res.status(error.response?.status || 500).json({
            error: error.message,
            details: error.response?.data
        });
    }
});

// Weaviate query endpoint
app.post('/api/weaviate/query', async (req, res) => {
    try {
        const { className, query, options } = req.body;
        const result = await weaviateClient.query(className, query, options);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Enhanced search endpoint
app.post('/api/weaviate/search', async (req, res) => {
    try {
        const { query, options } = req.body;
        const result = await weaviateClient.enhancedSearch(query, options);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Batch operations endpoint
app.post('/api/weaviate/batch', async (req, res) => {
    try {
        const { className, objects } = req.body;
        const result = await weaviateClient.batchInsert(className, objects);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Streaming endpoint for large exports
app.get('/api/weaviate/export/:className', async (req, res) => {
    const { className } = req.params;
    const { limit = 1000, offset = 0 } = req.query;
    
    try {
        res.writeHead(200, {
            'Content-Type': 'application/x-ndjson',
            'Transfer-Encoding': 'chunked',
            'X-Content-Type-Options': 'nosniff'
        });

        await weaviatePool.execute(async (client) => {
            let currentOffset = parseInt(offset);
            const batchSize = Math.min(parseInt(limit), 100);
            let hasMore = true;

            while (hasMore && currentOffset < parseInt(offset) + parseInt(limit)) {
                const result = await client.data
                    .getter()
                    .withClassName(className)
                    .withLimit(batchSize)
                    .withOffset(currentOffset)
                    .do();

                if (!result || result.length === 0) {
                    hasMore = false;
                    break;
                }

                // Stream each object as NDJSON
                result.forEach(obj => {
                    res.write(JSON.stringify(obj) + '\n');
                });

                currentOffset += result.length;
                
                // Small delay to prevent overwhelming
                await new Promise(resolve => setTimeout(resolve, 10));
            }
        });

        res.end();
    } catch (error) {
        console.error('Export error:', error);
        res.write(JSON.stringify({ error: error.message }) + '\n');
        res.end();
    }
});

// Optimization endpoints
app.post('/api/weaviate/optimize', async (req, res) => {
    try {
        const result = await optimizer.optimizeSchema();
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Cache management endpoints
app.get('/api/cache/stats', async (req, res) => {
    const stats = cacheManager.getAdaptiveStats();
    res.json(stats);
});

app.post('/api/cache/clear', async (req, res) => {
    const { type, pattern } = req.body;
    
    if (pattern) {
        await cacheManager.invalidatePattern(pattern);
    } else if (type) {
        await cacheManager.clearCache(type);
    } else {
        // Clear all caches
        ['embeddings', 'searches', 'mcp', 'metadata'].forEach(type => {
            cacheManager.clearCache(type);
        });
    }
    
    res.json({ message: 'Cache cleared', stats: cacheManager.getStats() });
});

// Circuit breaker management
app.get('/api/circuits/status', (req, res) => {
    const status = {};
    for (const [name, breaker] of Object.entries(circuitBreakers)) {
        status[name] = breaker.getStatus();
    }
    res.json(status);
});

app.post('/api/circuits/reset/:service', (req, res) => {
    const { service } = req.params;
    
    if (circuitBreakers[service]) {
        circuitBreakers[service].reset();
        res.json({ 
            message: `Circuit breaker for ${service} reset`,
            status: circuitBreakers[service].getStatus()
        });
    } else {
        res.status(404).json({ error: 'Service not found' });
    }
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
    console.log(`\n${signal} received. Starting graceful shutdown...`);
    
    // Stop accepting new requests
    server.close(() => {
        console.log('HTTP server closed');
    });

    // Clean up resources
    try {
        await weaviatePool.close();
        cacheManager.shutdown();
        embeddingQueue.clear();
        console.log('All resources cleaned up');
        process.exit(0);
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
};

// Start server
const server = app.listen(PORT, () => {
    console.log(`🚀 Enhanced Max MCP Railway server running on port ${PORT}`);
    console.log(`📊 Metrics available at http://localhost:${PORT}/metrics`);
    console.log(`🏥 Health check at http://localhost:${PORT}/health`);
    console.log(`⚡ Circuit breakers active for all services`);
    console.log(`🔄 Request deduplication enabled`);
    console.log(`📦 Brotli compression enabled`);
    console.log(`🏊 Connection pooling active with ${weaviatePool.poolSize} connections`);
});

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    metricsCollector.recordError('uncaught_exception', error.message);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    metricsCollector.recordError('unhandled_rejection', reason);
});
