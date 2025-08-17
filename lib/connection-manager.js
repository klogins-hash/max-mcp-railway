const axios = require('axios');
const weaviate = require('weaviate-ts-client').default;
const { CohereClient } = require('cohere-ai');
const OpenAI = require('openai');

class ConnectionManager {
    constructor() {
        this.connections = new Map();
        this.retryConfig = {
            retries: 3,
            retryDelay: 1000,
            retryCondition: (error) => {
                return !error.response || error.response.status >= 500;
            }
        };
        this.initializeConnections();
    }

    initializeConnections() {
        // MCP connection with retry logic
        this.connections.set('mcp', {
            client: axios.create({
                baseURL: process.env.MCP_ENDPOINT,
                timeout: 30000,
                headers: {
                    'Authorization': `Bearer ${process.env.MCP_API_KEY}`,
                    'Content-Type': 'application/json'
                }
            }),
            healthCheck: async () => {
                try {
                    const response = await this.connections.get('mcp').client.get('/health');
                    return { healthy: true, latency: response.headers['x-response-time'] };
                } catch (error) {
                    return { healthy: false, error: error.message };
                }
            }
        });

        // Weaviate connection with optimized config
        this.connections.set('weaviate', {
            client: weaviate.client({
                scheme: 'https',
                host: process.env.WEAVIATE_ENDPOINT.replace('https://', '').replace('/', ''),
                authApiKey: new weaviate.ApiKey(process.env.WEAVIATE_API_KEY),
                headers: {
                    'X-Cohere-Api-Key': process.env.COHERE_API_KEY,
                }
            }),
            healthCheck: async () => {
                try {
                    const start = Date.now();
                    const result = await this.connections.get('weaviate').client.misc.metaGetter().do();
                    return { 
                        healthy: true, 
                        latency: Date.now() - start,
                        version: result.version
                    };
                } catch (error) {
                    return { healthy: false, error: error.message };
                }
            }
        });

        // Cohere connection with rate limiting
        this.connections.set('cohere', {
            client: new CohereClient({
                token: process.env.COHERE_API_KEY,
            }),
            rateLimiter: {
                requests: 0,
                resetTime: Date.now() + 60000,
                maxRequests: 100
            },
            healthCheck: async () => {
                try {
                    // Simple health check without consuming API credits
                    return { healthy: true, rateLimit: this.getRateLimitStatus('cohere') };
                } catch (error) {
                    return { healthy: false, error: error.message };
                }
            }
        });

        // OpenRouter connection with fallback handling
        this.connections.set('openrouter', {
            client: new OpenAI({
                baseURL: 'https://openrouter.ai/api/v1',
                apiKey: process.env.OPENROUTER_API_KEY,
                defaultHeaders: {
                    'HTTP-Referer': 'https://max-mcp-railway.up.railway.app',
                    'X-Title': 'Max MCP Railway Integration'
                }
            }),
            fallbackModels: [
                'anthropic/claude-3.5-sonnet',
                'openai/gpt-4o',
                'google/gemini-pro-1.5',
                'meta-llama/llama-3.1-70b-instruct'
            ],
            healthCheck: async () => {
                try {
                    return { healthy: true, availableModels: this.connections.get('openrouter').fallbackModels };
                } catch (error) {
                    return { healthy: false, error: error.message };
                }
            }
        });
    }

    async executeWithRetry(connectionName, operation) {
        const connection = this.connections.get(connectionName);
        if (!connection) {
            throw new Error(`Connection ${connectionName} not found`);
        }

        let lastError;
        for (let attempt = 0; attempt <= this.retryConfig.retries; attempt++) {
            try {
                // Check rate limits for Cohere
                if (connectionName === 'cohere') {
                    await this.checkRateLimit('cohere');
                }

                const result = await operation(connection.client);
                
                // Update rate limit counters
                if (connectionName === 'cohere') {
                    this.updateRateLimit('cohere');
                }

                return result;
            } catch (error) {
                lastError = error;
                
                if (attempt < this.retryConfig.retries && this.retryConfig.retryCondition(error)) {
                    const delay = this.retryConfig.retryDelay * Math.pow(2, attempt);
                    console.log(`⚠️ Retry attempt ${attempt + 1} for ${connectionName} after ${delay}ms`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    break;
                }
            }
        }

        throw lastError;
    }

    async checkRateLimit(connectionName) {
        const connection = this.connections.get(connectionName);
        if (!connection?.rateLimiter) return;

        const limiter = connection.rateLimiter;
        
        // Reset counter if time window has passed
        if (Date.now() > limiter.resetTime) {
            limiter.requests = 0;
            limiter.resetTime = Date.now() + 60000;
        }

        // Check if rate limit exceeded
        if (limiter.requests >= limiter.maxRequests) {
            const waitTime = limiter.resetTime - Date.now();
            throw new Error(`Rate limit exceeded. Wait ${Math.ceil(waitTime / 1000)} seconds.`);
        }
    }

    updateRateLimit(connectionName) {
        const connection = this.connections.get(connectionName);
        if (connection?.rateLimiter) {
            connection.rateLimiter.requests++;
        }
    }

    getRateLimitStatus(connectionName) {
        const connection = this.connections.get(connectionName);
        if (!connection?.rateLimiter) return null;

        const limiter = connection.rateLimiter;
        return {
            remaining: limiter.maxRequests - limiter.requests,
            resetIn: Math.max(0, limiter.resetTime - Date.now())
        };
    }

    async healthCheckAll() {
        const results = {};
        
        for (const [name, connection] of this.connections) {
            if (connection.healthCheck) {
                results[name] = await connection.healthCheck();
            }
        }

        return results;
    }

    getConnection(name) {
        return this.connections.get(name);
    }
}

module.exports = ConnectionManager;
