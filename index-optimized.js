require('dotenv').config();
const express = require('express');
const cors = require('cors');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

// Import optimized modules
const ConnectionManager = require('./lib/connection-manager');
const CacheManager = require('./lib/cache-manager');
const MetricsCollector = require('./lib/metrics-collector');
const OptimizedWeaviateClient = require('./lib/optimized-weaviate-client');
const WeaviateOptimizer = require('./weaviate-optimizer');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize managers
const connectionManager = new ConnectionManager();
const cacheManager = new CacheManager();
const metricsCollector = new MetricsCollector();
const optimizedWeaviateClient = new OptimizedWeaviateClient();
const weaviateOptimizer = new WeaviateOptimizer();

// Security middleware
app.use(helmet({
    contentSecurityPolicy: false, // Disable for API
    crossOriginEmbedderPolicy: false
}));

// Compression middleware
app.use(compression());

// CORS configuration
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true
}));

// Request logging
app.use(morgan('combined'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
const limiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: 'Too many requests, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

const strictLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 20, // 20 requests per minute for expensive operations
    message: 'Rate limit exceeded for this operation.',
});

app.use('/api/', limiter);
app.use('/api/weaviate/migrate-data', strictLimiter);
app.use('/api/weaviate/optimize-schema', strictLimiter);

// Request tracking middleware
app.use((req, res, next) => {
    const start = Date.now();
    
    res.on('finish', () => {
        const duration = Date.now() - start;
        metricsCollector.recordRequest(req.path, res.statusCode, duration);
    });
    
    next();
});

// Health check with detailed status
app.get('/health', async (req, res) => {
    try {
        const healthStatus = await connectionManager.healthCheckAll();
        const metrics = metricsCollector.getMetricsSummary();
        
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            services: healthStatus,
            metrics: {
                requests: metrics.requests.total,
                errorRate: metrics.requests.errorRate,
                avgResponseTime: metrics.performance.avgResponseTime
            }
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Detailed metrics endpoint
app.get('/api/metrics', async (req, res) => {
    const metrics = metricsCollector.getMetricsSummary();
    const cacheStats = cacheManager.getStats();
    const optimizedStats = await optimizedWeaviateClient.getStats();
    
    res.json({
        metrics,
        cache: cacheStats,
        weaviate: optimizedStats,
        timestamp: new Date().toISOString()
    });
});

// MCP proxy with caching and retry
app.all('/api/mcp/*', async (req, res) => {
    const start = Date.now();
    const mcpPath = req.params[0];
    const cacheKey = req.method === 'GET' 
        ? cacheManager.generateKey('mcp', mcpPath, req.query)
        : null;
    
    try {
        // Check cache for GET requests
        if (cacheKey) {
            const cached = await cacheManager.get('mcp', cacheKey);
            if (cached) {
                res.set('X-Cache', 'HIT');
                return res.json(cached);
            }
        }
        
        // Execute request with retry
        const response = await connectionManager.executeWithRetry('mcp', async (client) => {
            const config = {
                method: req.method,
                url: mcpPath,
                data: req.body,
                params: req.query
            };
            return await client.request(config);
        });
        
        // Cache successful GET responses
        if (cacheKey && response.status === 200) {
            await cacheManager.set('mcp', cacheKey, response.data);
        }
        
        res.set('X-Cache', 'MISS');
        res.json(response.data);
        
        metricsCollector.recordIntegration('mcp', true, Date.now() - start);
    } catch (error) {
        metricsCollector.recordIntegration('mcp', false, Date.now() - start);
        res.status(error.response?.status || 500).json({
            status: 'error',
            message: 'MCP request failed',
            error: error.message,
            path: mcpPath
        });
    }
});

// Optimized Weaviate search
app.post('/api/weaviate/search', async (req, res) => {
    try {
        const { query, options = {} } = req.body;
        
        if (!query) {
            return res.status(400).json({
                status: 'error',
                message: 'Query parameter is required'
            });
        }
        
        const results = await optimizedWeaviateClient.enhancedSearch(query, options);
        res.json({
            status: 'success',
            ...results
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Search failed',
            error: error.message
        });
    }
});

// Batch operations endpoint
app.post('/api/weaviate/batch', async (req, res) => {
    try {
        const { className, objects } = req.body;
        
        if (!className || !objects || !Array.isArray(objects)) {
            return res.status(400).json({
                status: 'error',
                message: 'className and objects array are required'
            });
        }
        
        const results = await optimizedWeaviateClient.batchInsert(className, objects);
        res.json({
            status: 'success',
            ...results
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Batch operation failed',
            error: error.message
        });
    }
});

// Schema optimization endpoint
app.post('/api/weaviate/optimize-schema', async (req, res) => {
    try {
        const result = await weaviateOptimizer.optimizeSchema();
        res.json(result);
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Schema optimization failed',
            error: error.message
        });
    }
});

// Data migration endpoint
app.post('/api/weaviate/migrate-data', async (req, res) => {
    try {
        const { batchSize = 50, skipLowValue = true } = req.body;
        
        // Use server-sent events for progress updates
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
        });
        
        const sendProgress = (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };
        
        // Start migration with progress callback
        const result = await weaviateOptimizer.migrateData({
            batchSize,
            skipLowValue,
            onProgress: sendProgress
        });
        
        sendProgress({ type: 'complete', result });
        res.end();
    } catch (error) {
        res.write(`data: ${JSON.stringify({ 
            type: 'error', 
            error: error.message 
        })}\n\n`);
        res.end();
    }
});

// Combined process and store with optimization
app.post('/api/process-and-store', async (req, res) => {
    try {
        const { mcpEndpoint, data, weaviateClass, options = {} } = req.body;
        
        // Step 1: Process through MCP
        const mcpResponse = await connectionManager.executeWithRetry('mcp', async (client) => {
            return await client.post(mcpEndpoint, data);
        });
        
        // Step 2: Prepare for Weaviate storage
        const processedData = Array.isArray(mcpResponse.data) 
            ? mcpResponse.data 
            : [mcpResponse.data];
        
        // Step 3: Batch insert with embeddings
        const result = await optimizedWeaviateClient.batchInsert(
            weaviateClass || 'OptimizedDocument',
            processedData
        );
        
        res.json({
            status: 'success',
            message: 'Data processed and stored',
            mcp: {
                endpoint: mcpEndpoint,
                itemsProcessed: processedData.length
            },
            weaviate: result
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Combined operation failed',
            error: error.message
        });
    }
});

// Cache management endpoints
app.post('/api/cache/invalidate', async (req, res) => {
    try {
        const { type, pattern } = req.body;
        const deleted = await cacheManager.invalidate(type, pattern);
        
        res.json({
            status: 'success',
            deleted,
            message: `Invalidated ${deleted} cache entries`
        });
    } catch (error) {
        res.status(500).json({
            status: 'error',
            message: 'Cache invalidation failed',
            error: error.message
        });
    }
});

app.get('/api/cache/stats', (req, res) => {
    res.json(cacheManager.getStats());
});

// Graceful shutdown
const gracefulShutdown = async () => {
    console.log('\n🛑 Shutting down gracefully...');
    
    // Stop accepting new requests
    server.close(() => {
        console.log('✅ HTTP server closed');
    });
    
    // Wait for ongoing requests to complete
    setTimeout(() => {
        console.log('✅ Cleanup complete');
        process.exit(0);
    }, 5000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Start server
const server = app.listen(PORT, () => {
    console.log(`
🚀 Max MCP Railway Optimized Server
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Port: ${PORT}
🔗 Health: http://localhost:${PORT}/health
📈 Metrics: http://localhost:${PORT}/api/metrics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🤖 Features:
   ✓ Connection pooling & retry logic
   ✓ Multi-level caching
   ✓ Rate limiting & security
   ✓ Batch operations
   ✓ Real-time metrics
   ✓ Enhanced AI search
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `);
});

module.exports = app;
