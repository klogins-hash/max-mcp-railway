#!/bin/bash

# Enhanced deployment script for max-mcp-railway
# This script deploys the enhanced version with all optimizations

echo "🚀 Deploying Enhanced Max MCP Railway to Production..."

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | grep -v '^#' | xargs)
fi

# Check if Railway project ID is set
if [ -z "$RAILWAY_PROJECT_ID" ]; then
    echo "❌ Error: RAILWAY_PROJECT_ID not found in .env file"
    exit 1
fi

# Check if Railway service ID is set
if [ -z "$RAILWAY_SERVICE_ID" ]; then
    echo "❌ Error: RAILWAY_SERVICE_ID not found in .env file"
    exit 1
fi

echo "📦 Project ID: $RAILWAY_PROJECT_ID"
echo "🔧 Service ID: $RAILWAY_SERVICE_ID"

# Stop the local server if running
echo "🛑 Stopping local server..."
pkill -f "node index-enhanced.js" 2>/dev/null || true

# Run tests first
echo "🧪 Running optimization tests..."
npm test

if [ $? -ne 0 ]; then
    echo "❌ Tests failed. Aborting deployment."
    exit 1
fi

echo "✅ Tests passed!"

# Create deployment info file
echo "📝 Creating deployment info..."
cat > deployment-info.json << EOF
{
  "version": "2.0.0",
  "timestamp": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "features": [
    "Request Deduplication",
    "Circuit Breakers (all services)",
    "Embedding Batch Queue",
    "Adaptive Cache TTL",
    "Weaviate Connection Pool (5 connections)",
    "Brotli Compression",
    "Metrics Aggregation",
    "Streaming Exports"
  ],
  "endpoints": {
    "health": "/health",
    "metrics": "/metrics",
    "circuits": "/api/circuits/status",
    "cache": "/api/cache/stats",
    "export": "/api/weaviate/export/:className"
  }
}
EOF

# Commit deployment info
git add deployment-info.json
git commit -m "chore: add deployment info for v2.0.0" 2>/dev/null || true

echo "🔄 Deployment process:"
echo "1. Push to GitHub repository linked to Railway"
echo "2. Railway will automatically deploy from the main branch"
echo "3. Monitor deployment at https://railway.app/project/$RAILWAY_PROJECT_ID"

echo ""
echo "📋 Post-deployment checklist:"
echo "✓ Check health endpoint: https://[your-railway-url]/health"
echo "✓ Monitor metrics: https://[your-railway-url]/metrics"
echo "✓ Verify circuit breakers: https://[your-railway-url]/api/circuits/status"
echo "✓ Check connection pool: https://[your-railway-url]/health (pool section)"
echo "✓ Test request deduplication with concurrent requests"
echo "✓ Verify adaptive caching is working"

echo ""
echo "🎯 Production optimizations active:"
echo "• Request deduplication preventing duplicate API calls"
echo "• Circuit breakers protecting all external services"
echo "• Embedding queue batching up to 96 texts"
echo "• Adaptive cache adjusting TTL based on access patterns"
echo "• Connection pool with 5 Weaviate connections"
echo "• Brotli compression for better performance"
echo "• Time-series metrics aggregation"
echo "• Streaming exports for large datasets"

echo ""
echo "✅ Enhanced deployment preparation complete!"
echo "🚀 Push to your GitHub repository to trigger Railway deployment"
