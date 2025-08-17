# Max MCP Railway Integration

A Railway application that integrates with Max MCP server and Weaviate vector database.

## Overview

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
