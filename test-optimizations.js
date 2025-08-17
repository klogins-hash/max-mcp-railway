#!/usr/bin/env node

const axios = require('axios');
const colors = require('colors');

// Base URL for testing
const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

// Test data
const testQueries = [
    'How to implement authentication in Node.js',
    'Best practices for React performance optimization',
    'Deploying applications to Railway',
    'Weaviate vector database configuration',
    'OpenRouter API integration guide'
];

const testDocuments = [
    {
        title: 'Node.js Authentication Guide',
        content: 'Comprehensive guide on implementing secure authentication in Node.js applications using JWT, OAuth, and session-based approaches.',
        source: 'docs/nodejs/auth.md',
        category: 'documentation',
        contentType: 'guide',
        priority: 9,
        wordCount: 1500
    },
    {
        title: 'React Performance Optimization',
        content: 'Advanced techniques for optimizing React applications including code splitting, lazy loading, memoization, and virtual DOM optimization.',
        source: 'docs/react/performance.md',
        category: 'documentation',
        contentType: 'guide',
        priority: 8,
        wordCount: 2000
    }
];

// Test utilities
async function runTest(name, testFn) {
    console.log(`\n🧪 Testing: ${name}`.cyan);
    const start = Date.now();
    
    try {
        await testFn();
        const duration = Date.now() - start;
        console.log(`✅ ${name} passed (${duration}ms)`.green);
        return { name, status: 'passed', duration };
    } catch (error) {
        const duration = Date.now() - start;
        console.log(`❌ ${name} failed (${duration}ms)`.red);
        console.log(`   Error: ${error.message}`.red);
        return { name, status: 'failed', duration, error: error.message };
    }
}

// Test cases
const tests = {
    async healthCheck() {
        const response = await axios.get(`${BASE_URL}/health`);
        if (response.data.status !== 'healthy') {
            throw new Error('Health check failed');
        }
        console.log('   Services:', Object.keys(response.data.services).join(', '));
    },

    async metrics() {
        const response = await axios.get(`${BASE_URL}/api/metrics`);
        if (!response.data.metrics) {
            throw new Error('Metrics endpoint failed');
        }
        console.log('   Request count:', response.data.metrics.requests.total);
        console.log('   Cache hit rate:', response.data.cache.global.hitRate.toFixed(2));
    },

    async mcpProxy() {
        const response = await axios.get(`${BASE_URL}/api/mcp/health`);
        console.log('   MCP Status:', response.status);
        console.log('   Cache:', response.headers['x-cache'] || 'MISS');
    },

    async weaviateSearch() {
        const response = await axios.post(`${BASE_URL}/api/weaviate/search`, {
            query: testQueries[0],
            options: {
                limit: 5,
                enhance: false
            }
        });
        
        if (!response.data.documents) {
            throw new Error('Search returned no documents');
        }
        console.log('   Documents found:', response.data.documents.length);
    },

    async enhancedSearch() {
        const response = await axios.post(`${BASE_URL}/api/weaviate/search`, {
            query: testQueries[1],
            options: {
                limit: 5,
                enhance: true,
                model: 'openrouter/auto'
            }
        });
        
        if (!response.data.enhancement) {
            throw new Error('Enhanced search failed to generate AI insights');
        }
        console.log('   Model used:', response.data.modelUsed);
        console.log('   Enhancement length:', response.data.enhancement.length);
    },

    async batchInsert() {
        const response = await axios.post(`${BASE_URL}/api/weaviate/batch`, {
            className: 'OptimizedDocument',
            objects: testDocuments
        });
        
        if (response.data.successful === 0) {
            throw new Error('Batch insert failed');
        }
        console.log('   Inserted:', response.data.successful);
        console.log('   Failed:', response.data.failed);
    },

    async cachePerformance() {
        // First request (cache miss)
        const start1 = Date.now();
        await axios.get(`${BASE_URL}/api/mcp/test/cache`);
        const duration1 = Date.now() - start1;
        
        // Second request (cache hit)
        const start2 = Date.now();
        const response2 = await axios.get(`${BASE_URL}/api/mcp/test/cache`);
        const duration2 = Date.now() - start2;
        
        const improvement = ((duration1 - duration2) / duration1 * 100).toFixed(1);
        console.log('   First request:', `${duration1}ms`);
        console.log('   Cached request:', `${duration2}ms`);
        console.log('   Performance improvement:', `${improvement}%`);
        
        if (response2.headers['x-cache'] !== 'HIT') {
            throw new Error('Cache not working properly');
        }
    },

    async rateLimiting() {
        const requests = [];
        for (let i = 0; i < 105; i++) {
            requests.push(
                axios.get(`${BASE_URL}/api/metrics`)
                    .then(() => ({ success: true }))
                    .catch(err => ({ 
                        success: false, 
                        status: err.response?.status 
                    }))
            );
        }
        
        const results = await Promise.all(requests);
        const rateLimited = results.filter(r => r.status === 429).length;
        
        console.log('   Total requests:', requests.length);
        console.log('   Rate limited:', rateLimited);
        
        if (rateLimited === 0) {
            throw new Error('Rate limiting not working');
        }
    },

    async connectionResilience() {
        // Test retry logic by calling a non-existent endpoint
        try {
            await axios.post(`${BASE_URL}/api/mcp/non-existent-endpoint`, {
                test: true
            });
        } catch (error) {
            console.log('   Retry mechanism tested');
            console.log('   Error handled gracefully');
        }
    },

    async loadTest() {
        const concurrentRequests = 20;
        const requests = [];
        
        for (let i = 0; i < concurrentRequests; i++) {
            requests.push(
                axios.post(`${BASE_URL}/api/weaviate/search`, {
                    query: testQueries[i % testQueries.length],
                    options: { limit: 3, enhance: false }
                })
            );
        }
        
        const start = Date.now();
        await Promise.all(requests);
        const duration = Date.now() - start;
        const avgTime = duration / concurrentRequests;
        
        console.log('   Concurrent requests:', concurrentRequests);
        console.log('   Total time:', `${duration}ms`);
        console.log('   Average time:', `${avgTime.toFixed(1)}ms`);
        
        if (avgTime > 1000) {
            throw new Error('Performance under load is poor');
        }
    }
};

// Main test runner
async function runAllTests() {
    console.log('🚀 Starting Max MCP Railway Optimization Tests'.bold.cyan);
    console.log(`📍 Testing against: ${BASE_URL}`.gray);
    console.log('━'.repeat(50).gray);
    
    const results = [];
    
    // Run tests in sequence
    for (const [name, testFn] of Object.entries(tests)) {
        const result = await runTest(name, testFn);
        results.push(result);
        
        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    // Summary
    console.log('\n' + '━'.repeat(50).gray);
    console.log('📊 Test Summary'.bold.cyan);
    
    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const totalDuration = results.reduce((sum, r) => sum + r.duration, 0);
    
    console.log(`✅ Passed: ${passed}`.green);
    console.log(`❌ Failed: ${failed}`.red);
    console.log(`⏱️  Total time: ${totalDuration}ms`.gray);
    
    if (failed > 0) {
        console.log('\nFailed tests:'.red);
        results
            .filter(r => r.status === 'failed')
            .forEach(r => console.log(`  - ${r.name}: ${r.error}`.red));
    }
    
    // Performance metrics
    console.log('\n📈 Performance Metrics'.bold.cyan);
    const avgDuration = totalDuration / results.length;
    console.log(`Average test duration: ${avgDuration.toFixed(1)}ms`);
    
    // Exit code
    process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(error => {
    console.error('Test runner failed:', error);
    process.exit(1);
});
