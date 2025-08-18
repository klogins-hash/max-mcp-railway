// Startup script with correct credentials
process.env.MCP_ENDPOINT = 'https://mcp-max-v1-production.up.railway.app';
process.env.MCP_API_KEY = 'dScmFSCHUUDuZkVydzLBb4vkUajXpZg1rgGGYe7d4Bk';
process.env.WEAVIATE_ENDPOINT = 'https://weaviate-production-5bc1.up.railway.app/';
process.env.WEAVIATE_API_KEY = 'b631484764105cea8c7d19b2469cc6144cc048feff68e119f0e527281a0409df';

// Load any other environment variables
require('dotenv').config();

// Override with correct values
process.env.MCP_ENDPOINT = 'https://mcp-max-v1-production.up.railway.app';
process.env.MCP_API_KEY = 'dScmFSCHUUDuZkVydzLBb4vkUajXpZg1rgGGYe7d4Bk';
process.env.WEAVIATE_ENDPOINT = 'https://weaviate-production-5bc1.up.railway.app/';
process.env.WEAVIATE_API_KEY = 'b631484764105cea8c7d19b2469cc6144cc048feff68e119f0e527281a0409df';

// Start the optimized server
require('./index-optimized.js');
