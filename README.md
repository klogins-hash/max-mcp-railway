# Max MCP Railway v2.0.0

🚀 **Production-ready** integration gateway connecting Max MCP server, Weaviate vector database, and Railway infrastructure with enterprise-grade optimizations.

### 🎯 Production Optimizations (v2.0.0)

### Performance Enhancements
- **Request Deduplication**: Prevents duplicate concurrent API calls
- **Circuit Breakers**: Protects all external services from cascading failures
- **Embedding Queue**: Batches up to 96 embeddings for optimal Cohere API usage
- **Adaptive Cache Manager**: Dynamically adjusts TTL based on access patterns
- **Weaviate Connection Pool**: 5 persistent connections for better performance
- **Brotli Compression**: Enhanced response compression
- **Metrics Aggregator**: Time-series data collection and analysis
- **Streaming Exports**: NDJSON streaming for large datasets

### Core Features
- **MCP Integration**: Direct connection to Max MCP server for AI-powered operations
- **Weaviate Vector Database**: Efficient storage and retrieval of embeddings
- **RESTful API**: Clean, well-documented endpoints for all operations
- **Railway Deployment**: Optimized for Railway platform with health checks and monitoring

**GitHub Repository**: https://github.com/klogins-hash/max-mcp-railway

This project provides a unified API gateway that connects:
- **Max MCP Server**: https://mcp-max-v1-production.up.railway.app/
- **Weaviate Vector Database**: https://weaviate-production-5bc1.up.railway.app/
- **Railway Infrastructure**: Service and project management

## Features

- ✅ Health monitoring for all connected services
- 🔗 MCP API proxy with authentication
- 🗄️ Weaviate vector database integration
- 🚂 Railway service management
- 📊 Combined data processing pipeline

## API Endpoints

### Health & Testing
- `GET /health` - Service health check
- `GET /test/mcp` - Test MCP connection
- `GET /test/weaviate` - Test Weaviate connection

### MCP Integration
- `POST /mcp/*` - Proxy requests to MCP server

### Weaviate Integration
- `POST /weaviate/query` - Query Weaviate database

### Combined Operations
- `POST /process-and-store` - Process data through MCP and store in Weaviate

## Environment Variables

```env
# MCP Configuration
MCP_ENDPOINT=https://mcp-max-v1-production.up.railway.app/
MCP_API_KEY=your_mcp_api_key

# Weaviate Configuration
WEAVIATE_ENDPOINT=https://weaviate-production-5bc1.up.railway.app/
WEAVIATE_API_KEY=your_weaviate_api_key

# Railway Configuration
RAILWAY_SERVICE_ID=your_service_id
RAILWAY_PROJECT_ID=your_project_id

# Server Configuration
PORT=3000
NODE_ENV=production
```

## 🚀 Railway Deployment

### Quick Deploy

1. **Connect GitHub to Railway**:
   - Go to [Railway Dashboard](https://railway.app)
   - Create a new project
   - Select "Deploy from GitHub repo"
   - Choose `klogins-hash/max-mcp-railway`

2. **Configure Environment Variables**:
   Add these variables in Railway:
   ```
   MCP_ENDPOINT=https://mcp-max-v1-production.up.railway.app/api/v1
   MCP_API_KEY=your_mcp_api_key
   WEAVIATE_ENDPOINT=your_weaviate_endpoint
   WEAVIATE_API_KEY=your_weaviate_api_key
   COHERE_API_KEY=your_cohere_api_key
   OPENROUTER_API_KEY=your_openrouter_api_key
   CORS_ALLOWED_ORIGINS=*
   ```

3. **Deploy**: Railway will automatically deploy from the main branch

### Deployment Status
- **Repository**: https://github.com/klogins-hash/max-mcp-railway
- **Main File**: `index-enhanced.js` (v2.0.0)
- **Health Check**: `/health`
- **Metrics**: `/metrics`

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your actual credentials
   ```

3. **Run locally:**
   ```bash
   npm run dev
   ```

4. **Deploy to Railway:**
   ```bash
   railway login
   railway link
   railway up
   ```

## Usage Examples

### Test MCP Connection
```bash
curl http://localhost:3000/test/mcp
```

### Query Weaviate
```bash
curl -X POST http://localhost:3000/weaviate/query \
  -H "Content-Type: application/json" \
  -d '{
    "className": "Document",
    "query": "search term",
    "limit": 5
  }'
```

### Combined Processing
```bash
curl -X POST http://localhost:3000/process-and-store \
  -H "Content-Type: application/json" \
  -d '{
    "mcpEndpoint": "/process",
    "data": {"text": "content to process"},
    "weaviateClass": "ProcessedDocument"
  }'
```

## Railway Configuration

The project includes:
- `railway.json` - Railway deployment configuration
- Health check endpoint at `/health`
- Automatic restart on failure
- Nixpacks build system

## Project Structure

```
max-mcp-railway/
├── index.js          # Main application
├── package.json      # Dependencies and scripts
├── railway.json      # Railway configuration
├── .env              # Environment variables
└── README.md         # This file
```

## Service IDs

- **Railway Service ID**: b7fb58e4-d3d0-417c-8c7a-3f21605de144
- **Railway Project ID**: fe345834-5fab-40f2-832f-b2ca876dfcfc
