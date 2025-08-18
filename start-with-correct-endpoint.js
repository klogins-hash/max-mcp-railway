// Temporary startup script with correct MCP endpoint
process.env.MCP_ENDPOINT = 'https://mcp-max-v1-production.up.railway.app/api/v1';

// Load the rest of the environment variables
require('dotenv').config();

// Override the MCP_ENDPOINT again to ensure it's correct
process.env.MCP_ENDPOINT = 'https://mcp-max-v1-production.up.railway.app/api/v1';

// Start the optimized server
require('./index-optimized.js');
