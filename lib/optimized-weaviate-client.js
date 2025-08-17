const ConnectionManager = require('./connection-manager');
const CacheManager = require('./cache-manager');
const MetricsCollector = require('./metrics-collector');

class OptimizedWeaviateClient {
    constructor() {
        this.connectionManager = new ConnectionManager();
        this.cacheManager = new CacheManager();
        this.metricsCollector = new MetricsCollector();
        
        // Batch processing configuration
        this.batchConfig = {
            maxSize: 100,
            maxWaitTime: 1000, // 1 second
            queue: [],
            timer: null
        };
    }

    async query(className, queryText, options = {}) {
        const start = Date.now();
        const cacheKey = this.cacheManager.generateKey('search', className, queryText, options);
        
        try {
            // Check cache first
            const cached = await this.cacheManager.get('searches', cacheKey);
            if (cached) {
                this.metricsCollector.recordSearch(Date.now() - start, false);
                return cached;
            }

            // Execute query with retry logic
            const result = await this.connectionManager.executeWithRetry('weaviate', async (client) => {
                const query = client.graphql
                    .get()
                    .withClassName(className)
                    .withFields(options.fields || '_additional { id distance }')
                    .withLimit(options.limit || 10);

                // Add where filter if provided
                if (options.where) {
                    query.withWhere(options.where);
                }

                // Add near text search if query text provided
                if (queryText) {
                    // Generate embedding
                    const embedding = await this.generateEmbedding(queryText);
                    query.withNearVector({ vector: embedding });
                } else if (options.nearText) {
                    const embedding = await this.generateEmbedding(options.nearText.concepts[0]);
                    query.withNearVector({ vector: embedding });
                }

                return await query.do();
            });

            // Cache the result
            await this.cacheManager.set('searches', cacheKey, result);
            
            this.metricsCollector.recordSearch(Date.now() - start, false);
            this.metricsCollector.recordIntegration('weaviate', true, Date.now() - start);
            
            return result;
        } catch (error) {
            this.metricsCollector.recordIntegration('weaviate', false, Date.now() - start);
            throw error;
        }
    }

    async generateEmbedding(text) {
        const start = Date.now();
        const cacheKey = this.cacheManager.generateKey('embedding', text);
        
        // Check cache
        const cached = await this.cacheManager.get('embeddings', cacheKey);
        if (cached) {
            this.metricsCollector.recordEmbedding(0, true);
            return cached;
        }

        try {
            // Generate with Cohere
            const result = await this.connectionManager.executeWithRetry('cohere', async (client) => {
                const response = await client.embed({
                    texts: [text],
                    model: 'embed-english-v3.0',
                    inputType: 'search_document'
                });
                return response.embeddings[0];
            });

            // Cache the embedding
            await this.cacheManager.set('embeddings', cacheKey, result);
            
            const duration = Date.now() - start;
            this.metricsCollector.recordEmbedding(duration, false);
            this.metricsCollector.recordIntegration('cohere', true, duration);
            
            return result;
        } catch (error) {
            this.metricsCollector.recordIntegration('cohere', false, Date.now() - start);
            throw error;
        }
    }

    async batchInsert(className, objects) {
        const start = Date.now();
        const batchSize = 50; // Optimal batch size for Weaviate
        const results = {
            successful: 0,
            failed: 0,
            errors: []
        };

        try {
            // Process in batches
            for (let i = 0; i < objects.length; i += batchSize) {
                const batch = objects.slice(i, i + batchSize);
                
                // Generate embeddings for batch
                const textsToEmbed = batch.map(obj => 
                    obj.title + ' ' + (obj.content || '').substring(0, 1000)
                );
                
                const embeddings = await this.batchGenerateEmbeddings(textsToEmbed);
                
                // Prepare batch with embeddings
                const batchWithVectors = batch.map((obj, idx) => ({
                    ...obj,
                    _additional: { vector: embeddings[idx] }
                }));

                // Insert batch
                try {
                    await this.connectionManager.executeWithRetry('weaviate', async (client) => {
                        const batcher = client.batch.objectsBatcher();
                        
                        for (const obj of batchWithVectors) {
                            batcher.withObject({
                                class: className,
                                properties: obj,
                                vector: obj._additional.vector
                            });
                        }
                        
                        return await batcher.do();
                    });
                    
                    results.successful += batch.length;
                } catch (error) {
                    results.failed += batch.length;
                    results.errors.push({
                        batch: `${i}-${i + batch.length}`,
                        error: error.message
                    });
                }

                // Progress update
                if ((i + batchSize) % 500 === 0) {
                    console.log(`📊 Batch insert progress: ${i + batchSize}/${objects.length}`);
                }
            }

            const duration = Date.now() - start;
            console.log(`✅ Batch insert completed in ${duration}ms`);
            
            return results;
        } catch (error) {
            console.error('❌ Batch insert failed:', error);
            throw error;
        }
    }

    async batchGenerateEmbeddings(texts) {
        const start = Date.now();
        const embeddings = [];
        const uncachedTexts = [];
        const uncachedIndices = [];

        // Check cache for each text
        for (let i = 0; i < texts.length; i++) {
            const cacheKey = this.cacheManager.generateKey('embedding', texts[i]);
            const cached = await this.cacheManager.get('embeddings', cacheKey);
            
            if (cached) {
                embeddings[i] = cached;
                this.metricsCollector.recordEmbedding(0, true);
            } else {
                uncachedTexts.push(texts[i]);
                uncachedIndices.push(i);
            }
        }

        // Generate embeddings for uncached texts
        if (uncachedTexts.length > 0) {
            try {
                const result = await this.connectionManager.executeWithRetry('cohere', async (client) => {
                    const response = await client.embed({
                        texts: uncachedTexts,
                        model: 'embed-english-v3.0',
                        inputType: 'search_document'
                    });
                    return response.embeddings;
                });

                // Cache and assign embeddings
                for (let i = 0; i < result.length; i++) {
                    const originalIndex = uncachedIndices[i];
                    const cacheKey = this.cacheManager.generateKey('embedding', texts[originalIndex]);
                    
                    embeddings[originalIndex] = result[i];
                    await this.cacheManager.set('embeddings', cacheKey, result[i]);
                    
                    const duration = Date.now() - start;
                    this.metricsCollector.recordEmbedding(duration / uncachedTexts.length, false);
                }

                this.metricsCollector.recordIntegration('cohere', true, Date.now() - start);
            } catch (error) {
                this.metricsCollector.recordIntegration('cohere', false, Date.now() - start);
                throw error;
            }
        }

        return embeddings;
    }

    async enhancedSearch(query, options = {}) {
        const start = Date.now();
        
        try {
            // Perform vector search
            const searchResults = await this.query('OptimizedDocument', query, {
                limit: options.limit || 10,
                fields: `
                    title
                    content
                    source
                    category
                    contentType
                    priority
                    _additional {
                        id
                        distance
                        certainty
                    }
                `
            });

            // Filter and rank results
            const documents = this.processSearchResults(searchResults, options);

            // Enhance with AI if requested
            if (options.enhance !== false && documents.length > 0) {
                const enhanced = await this.enhanceWithAI(query, documents, options.model);
                
                this.metricsCollector.recordSearch(Date.now() - start, true);
                return enhanced;
            }

            this.metricsCollector.recordSearch(Date.now() - start, false);
            return { documents, query, timestamp: new Date().toISOString() };
        } catch (error) {
            console.error('Enhanced search error:', error);
            throw error;
        }
    }

    processSearchResults(searchResults, options) {
        if (!searchResults?.data?.Get?.OptimizedDocument) {
            return [];
        }

        let documents = searchResults.data.Get.OptimizedDocument;

        // Apply additional filtering
        if (options.filters) {
            if (options.filters.category) {
                documents = documents.filter(doc => 
                    doc.category === options.filters.category
                );
            }
            if (options.filters.contentType) {
                documents = documents.filter(doc => 
                    doc.contentType === options.filters.contentType
                );
            }
            if (options.filters.minPriority) {
                documents = documents.filter(doc => 
                    doc.priority >= options.filters.minPriority
                );
            }
        }

        // Sort by relevance and priority
        documents.sort((a, b) => {
            const distanceDiff = (a._additional.distance || 0) - (b._additional.distance || 0);
            if (Math.abs(distanceDiff) > 0.01) {
                return distanceDiff;
            }
            return (b.priority || 0) - (a.priority || 0);
        });

        return documents.slice(0, options.limit || 10);
    }

    async enhanceWithAI(query, documents, model = 'openrouter/auto') {
        const start = Date.now();
        
        try {
            const context = documents.map((doc, idx) => 
                `[${idx + 1}] ${doc.title}\nSource: ${doc.source}\nRelevance: ${(1 - doc._additional.distance).toFixed(3)}\nContent: ${doc.content?.substring(0, 300)}...`
            ).join('\n\n');

            const result = await this.connectionManager.executeWithRetry('openrouter', async (client) => {
                const completion = await client.chat.completions.create({
                    model: model,
                    models: this.connectionManager.getConnection('openrouter').fallbackModels,
                    messages: [
                        {
                            role: 'system',
                            content: 'You are an AI assistant analyzing search results. Provide concise, actionable insights.'
                        },
                        {
                            role: 'user',
                            content: `Query: "${query}"\n\nTop Results:\n${context}\n\nProvide:\n1. Key findings summary\n2. Most relevant insights\n3. Recommended actions or next steps`
                        }
                    ],
                    max_tokens: 500,
                    temperature: 0.3
                });

                return {
                    enhancement: completion.choices[0].message.content,
                    model: completion.model
                };
            });

            this.metricsCollector.recordIntegration('openrouter', true, Date.now() - start, {
                model: result.model
            });

            return {
                query,
                documents,
                enhancement: result.enhancement,
                modelUsed: result.model,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            this.metricsCollector.recordIntegration('openrouter', false, Date.now() - start);
            
            // Return results without enhancement on error
            return {
                query,
                documents,
                enhancement: null,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }

    async getStats() {
        const weaviateHealth = await this.connectionManager.healthCheckAll();
        const cacheStats = this.cacheManager.getStats();
        const metrics = this.metricsCollector.getMetricsSummary();

        return {
            connections: weaviateHealth,
            cache: cacheStats,
            metrics,
            timestamp: new Date().toISOString()
        };
    }
}

module.exports = OptimizedWeaviateClient;
