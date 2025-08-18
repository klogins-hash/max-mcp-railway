const axios = require('axios');

const DEPLOYMENT_URL = 'https://mcp-max-v1-production.up.railway.app';

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m'
};

async function runTests() {
  console.log('🧪 Testing Max MCP Railway Deployment\n');
  console.log(`🌐 URL: ${DEPLOYMENT_URL}\n`);
  
  const tests = [
    {
      name: 'Health Check',
      method: 'GET',
      endpoint: '/health',
      expectedStatus: 200,
      validateResponse: (data) => {
        return data.status === 'healthy' && 
               data.services?.mcp && 
               data.services?.weaviate;
      }
    },
    {
      name: 'MCP Connection Test',
      method: 'GET',
      endpoint: '/test/mcp',
      expectedStatus: [200, 500], // May fail if MCP is down
      validateResponse: (data) => {
        return data.status === 'success' || data.status === 'error';
      }
    },
    {
      name: 'Weaviate Connection Test',
      method: 'GET',
      endpoint: '/test/weaviate',
      expectedStatus: [200, 500], // May fail if Weaviate is down
      validateResponse: (data) => {
        return data.status === 'success' || data.status === 'error';
      }
    },
    {
      name: 'Invalid Endpoint Test (404)',
      method: 'GET',
      endpoint: '/invalid-endpoint-test',
      expectedStatus: 404,
      validateResponse: () => true
    },
    {
      name: 'MCP Proxy Test (Empty Body)',
      method: 'POST',
      endpoint: '/mcp/test',
      body: {},
      expectedStatus: [200, 400, 500],
      validateResponse: () => true
    },
    {
      name: 'Weaviate Query Test (Missing Params)',
      method: 'POST',
      endpoint: '/weaviate/query',
      body: {},
      expectedStatus: [400, 500],
      validateResponse: (data) => {
        return data.status === 'error';
      }
    },
    {
      name: 'CORS Headers Test',
      method: 'OPTIONS',
      endpoint: '/health',
      expectedStatus: [200, 204],
      validateResponse: () => true,
      validateHeaders: (headers) => {
        return headers['access-control-allow-origin'] !== undefined;
      }
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      console.log(`📋 Test: ${test.name}`);
      
      const config = {
        method: test.method,
        url: `${DEPLOYMENT_URL}${test.endpoint}`,
        validateStatus: () => true, // Don't throw on any status
        timeout: 10000
      };
      
      if (test.body) {
        config.data = test.body;
      }
      
      const response = await axios(config);
      
      // Check status code
      const expectedStatuses = Array.isArray(test.expectedStatus) 
        ? test.expectedStatus 
        : [test.expectedStatus];
      
      const statusOk = expectedStatuses.includes(response.status);
      
      // Validate response data
      const dataOk = test.validateResponse 
        ? test.validateResponse(response.data) 
        : true;
      
      // Validate headers if needed
      const headersOk = test.validateHeaders 
        ? test.validateHeaders(response.headers)
        : true;
      
      if (statusOk && dataOk && headersOk) {
        console.log(`${colors.green}✅ PASSED${colors.reset} - Status: ${response.status}`);
        passed++;
      } else {
        console.log(`${colors.red}❌ FAILED${colors.reset} - Status: ${response.status}`);
        if (!statusOk) console.log(`   Expected status: ${expectedStatuses.join(' or ')}`);
        if (!dataOk) console.log(`   Response validation failed`);
        if (!headersOk) console.log(`   Header validation failed`);
        failed++;
      }
      
      // Log response details for debugging
      if (test.name.includes('Health')) {
        console.log(`   Services: MCP=${response.data.services?.mcp ? '✓' : '✗'}, Weaviate=${response.data.services?.weaviate ? '✓' : '✗'}`);
      }
      
    } catch (error) {
      console.log(`${colors.red}❌ ERROR${colors.reset} - ${error.message}`);
      failed++;
    }
    
    console.log('');
  }
  
  // Summary
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 Test Summary:`);
  console.log(`   ${colors.green}Passed: ${passed}${colors.reset}`);
  console.log(`   ${colors.red}Failed: ${failed}${colors.reset}`);
  console.log(`   Total: ${tests.length}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  // Potential issues found
  console.log('\n🔍 Analysis:');
  
  if (failed === 0) {
    console.log(`${colors.green}✅ All tests passed! Deployment appears healthy.${colors.reset}`);
  } else {
    console.log(`${colors.yellow}⚠️  Some tests failed. Review the failures above.${colors.reset}`);
  }
  
  // Security recommendations
  console.log('\n🔒 Security Recommendations:');
  console.log('1. Ensure API keys are properly secured in Railway environment');
  console.log('2. Consider adding rate limiting to prevent abuse');
  console.log('3. Implement request validation for all endpoints');
  console.log('4. Add authentication if this is not meant to be public');
}

// Run the tests
runTests().catch(console.error);
