#!/bin/bash

# Max MCP Railway Deployment Script
# This script handles deployment of the optimized server

set -e

echo "🚀 Max MCP Railway Deployment Script"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please create a .env file with the required environment variables."
    exit 1
fi

# Load environment variables
export $(cat .env | grep -v '^#' | xargs)

# Function to check required env vars
check_env_vars() {
    local required_vars=(
        "MCP_ENDPOINT"
        "MCP_API_KEY"
        "WEAVIATE_ENDPOINT"
        "WEAVIATE_API_KEY"
        "COHERE_API_KEY"
        "OPENROUTER_API_KEY"
        "RAILWAY_API_TOKEN"
        "RAILWAY_SERVICE_ID"
        "RAILWAY_PROJECT_ID"
    )
    
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            echo "❌ Error: $var is not set in .env file"
            exit 1
        fi
    done
    
    echo "✅ All required environment variables are set"
}

# Function to install dependencies
install_dependencies() {
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
}

# Function to run tests
run_tests() {
    echo "🧪 Running optimization tests..."
    
    # Start server in background for testing
    npm start > /dev/null 2>&1 &
    SERVER_PID=$!
    
    # Wait for server to start
    echo "⏳ Waiting for server to start..."
    sleep 5
    
    # Run tests
    node test-optimizations.js
    TEST_EXIT_CODE=$?
    
    # Kill test server
    kill $SERVER_PID 2>/dev/null || true
    
    if [ $TEST_EXIT_CODE -ne 0 ]; then
        echo "❌ Tests failed! Aborting deployment."
        exit 1
    fi
    
    echo "✅ All tests passed"
}

# Function to deploy to Railway
deploy_to_railway() {
    echo "🚂 Deploying to Railway..."
    
    # Check if railway CLI is installed
    if ! command -v railway &> /dev/null; then
        echo "📥 Installing Railway CLI..."
        npm install -g @railway/cli
    fi
    
    # Login to Railway
    echo "🔐 Logging in to Railway..."
    railway login --browserless
    
    # Link to project
    railway link $RAILWAY_PROJECT_ID
    
    # Deploy
    echo "📤 Deploying application..."
    railway up --service $RAILWAY_SERVICE_ID
    
    echo "✅ Deployment complete!"
}

# Function to verify deployment
verify_deployment() {
    echo "🔍 Verifying deployment..."
    
    # Get deployment URL
    DEPLOY_URL=$(railway status --json | jq -r '.url')
    
    if [ -z "$DEPLOY_URL" ]; then
        echo "⚠️  Warning: Could not retrieve deployment URL"
        return
    fi
    
    echo "🌐 Deployment URL: $DEPLOY_URL"
    
    # Test health endpoint
    echo "🏥 Testing health endpoint..."
    HEALTH_STATUS=$(curl -s "$DEPLOY_URL/health" | jq -r '.status')
    
    if [ "$HEALTH_STATUS" = "healthy" ]; then
        echo "✅ Deployment is healthy!"
    else
        echo "❌ Deployment health check failed"
        exit 1
    fi
}

# Function to run post-deployment tasks
post_deployment() {
    echo "📋 Running post-deployment tasks..."
    
    # Warm up cache
    echo "🔥 Warming up cache..."
    curl -X POST "$DEPLOY_URL/api/cache/warmup" \
        -H "Content-Type: application/json" \
        -d '{"preload": true}' || true
    
    # Initialize metrics
    echo "📊 Initializing metrics..."
    curl -s "$DEPLOY_URL/api/metrics" > /dev/null || true
    
    echo "✅ Post-deployment tasks complete"
}

# Main deployment flow
main() {
    echo "🎯 Deployment Mode: ${1:-production}"
    echo ""
    
    # Step 1: Check environment
    check_env_vars
    
    # Step 2: Install dependencies
    install_dependencies
    
    # Step 3: Run tests (optional)
    if [ "${SKIP_TESTS}" != "true" ]; then
        run_tests
    else
        echo "⚠️  Skipping tests (SKIP_TESTS=true)"
    fi
    
    # Step 4: Deploy
    if [ "$1" = "local" ]; then
        echo "🏠 Starting local server..."
        npm start
    else
        deploy_to_railway
        verify_deployment
        post_deployment
    fi
    
    echo ""
    echo "🎉 Deployment successful!"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# Run main function
main "$@"
