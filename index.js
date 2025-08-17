require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const weaviate = require('weaviate-ts-client').default;
const WeaviateOptimizer = require('./weaviate-optimizer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize Weaviate client
const weaviateClient = weaviate.client({
  scheme: 'https',
  host: process.env.WEAVIATE_ENDPOINT.replace('https://', '').replace('/', ''),
  authApiKey: new weaviate.ApiKey(process.env.WEAVIATE_API_KEY),
});

// Initialize Weaviate Optimizer
const weaviateOptimizer = new WeaviateOptimizer();

// MCP Client configuration
const mcpConfig = {
  baseURL: process.env.MCP_ENDPOINT,
  headers: {
    'Authorization': `Bearer ${process.env.MCP_API_KEY}`,
    'Content-Type': 'application/json'
  }
};

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {
      mcp: process.env.MCP_ENDPOINT,
      weaviate: process.env.WEAVIATE_ENDPOINT,
      railway: {
        serviceId: process.env.RAILWAY_SERVICE_ID,
        projectId: process.env.RAILWAY_PROJECT_ID
      }
    }
  });
});

// Test MCP connection
app.get('/test/mcp', async (req, res) => {
  try {
    const response = await axios.get(process.env.MCP_ENDPOINT, mcpConfig);
    res.json({
      status: 'success',
      message: 'MCP connection successful',
      data: response.data
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'MCP connection failed',
      error: error.message
    });
  }
});

// Test Weaviate connection
app.get('/test/weaviate', async (req, res) => {
  try {
    const result = await weaviateClient.misc.metaGetter().do();
    res.json({
      status: 'success',
      message: 'Weaviate connection successful',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Weaviate connection failed',
      error: error.message
    });
  }
});

// MCP proxy endpoint
app.post('/mcp/*', async (req, res) => {
  try {
    const mcpPath = req.params[0];
    const response = await axios.post(
      `${process.env.MCP_ENDPOINT}${mcpPath}`,
      req.body,
      mcpConfig
    );
    res.json(response.data);
  } catch (error) {
    res.status(error.response?.status || 500).json({
      status: 'error',
      message: 'MCP request failed',
      error: error.message
    });
  }
});

// Weaviate query endpoint
app.post('/weaviate/query', async (req, res) => {
  try {
    const { className, query, limit = 10 } = req.body;
    
    const result = await weaviateClient.graphql
      .get()
      .withClassName(className)
      .withFields('*')
      .withNearText({ concepts: [query] })
      .withLimit(limit)
      .do();
    
    res.json({
      status: 'success',
      data: result
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Weaviate query failed',
      error: error.message
    });
  }
});

// Combined endpoint: Use MCP to process data and store in Weaviate
app.post('/process-and-store', async (req, res) => {
  try {
    const { mcpEndpoint, data, weaviateClass } = req.body;
    
    // Step 1: Process data through MCP
    const mcpResponse = await axios.post(
      `${process.env.MCP_ENDPOINT}${mcpEndpoint}`,
      data,
      mcpConfig
    );
    
    // Step 2: Store processed data in Weaviate
    const weaviateResult = await weaviateClient.data
      .creator()
      .withClassName(weaviateClass)
      .withProperties(mcpResponse.data)
      .do();
    
    res.json({
      status: 'success',
      message: 'Data processed through MCP and stored in Weaviate',
      mcpResult: mcpResponse.data,
      weaviateResult: weaviateResult
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Combined operation failed',
      error: error.message
    });
  }
});

// Weaviate Optimization Endpoints
app.post('/weaviate/optimize-schema', async (req, res) => {
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

app.post('/weaviate/migrate-data', async (req, res) => {
  try {
    const result = await weaviateOptimizer.migrateData();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Data migration failed',
      error: error.message
    });
  }
});

app.post('/weaviate/enhanced-search', async (req, res) => {
  try {
    const { query, options = {} } = req.body;
    if (!query) {
      return res.status(400).json({
        status: 'error',
        message: 'Query parameter is required'
      });
    }
    
    const result = await weaviateOptimizer.enhancedSearch(query, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Enhanced search failed',
      error: error.message
    });
  }
});

app.get('/weaviate/optimization-stats', async (req, res) => {
  try {
    const result = await weaviateOptimizer.getOptimizationStats();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to get optimization stats',
      error: error.message
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Max MCP Railway server running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 MCP Endpoint: ${process.env.MCP_ENDPOINT}`);
  console.log(`🗄️ Weaviate Endpoint: ${process.env.WEAVIATE_ENDPOINT}`);
  console.log(`🚂 Railway Service ID: ${process.env.RAILWAY_SERVICE_ID}`);
  console.log(`📦 Railway Project ID: ${process.env.RAILWAY_PROJECT_ID}`);
  console.log(`🤖 Cohere API: Configured for v3 embeddings`);
  console.log(`🔀 OpenRouter API: Auto mode enabled`);
  console.log(`⚡ Weaviate Optimizer: Ready for enhanced search`);
});

module.exports = app;
