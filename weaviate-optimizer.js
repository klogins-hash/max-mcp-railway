require('dotenv').config();
const weaviate = require('weaviate-ts-client').default;
const { CohereClient } = require('cohere-ai');
const OpenAI = require('openai');
const CacheManager = require('./lib/cache-manager');
const MetricsCollector = require('./lib/metrics-collector');

class WeaviateOptimizer {
    constructor() {
        // Initialize Weaviate client
        this.weaviateClient = weaviate.client({
            scheme: 'https',
            host: process.env.WEAVIATE_ENDPOINT.replace('https://', '').replace('/', ''),
            headers: {
                'X-Cohere-Api-Key': process.env.COHERE_API_KEY,
            }
        });

        // Initialize Cohere client
        this.cohereClient = new CohereClient({
            token: process.env.COHERE_API_KEY,
        });

        // Initialize OpenRouter client
        this.openRouterClient = new OpenAI({
            baseURL: 'https://openrouter.ai/api/v1',
            apiKey: process.env.OPENROUTER_API_KEY,
            defaultHeaders: {
                'HTTP-Referer': 'https://max-mcp-railway.up.railway.app',
                'X-Title': 'Max MCP Railway Integration'
            }
        });

        // Initialize cache and metrics
        this.cacheManager = new CacheManager();
        this.metricsCollector = new MetricsCollector();
    }

    // Optimize existing schema to use external Cohere v3 embeddings
    async optimizeSchema() {
        try {
            console.log('🔧 Starting Weaviate schema optimization...');
            
            // Get current schema
            const schema = await this.weaviateClient.schema.getter().do();
            console.log(`📊 Found ${schema.classes.length} existing classes`);

            // Create optimized unified schema with external embeddings
            const optimizedClass = {
                class: 'OptimizedDocument',
                description: 'Unified document class with external Cohere v3 embeddings and optimized configuration',
                vectorizer: 'none', // Use external embeddings
                vectorIndexConfig: {
                    distance: 'cosine',
                    ef: 128,
                    efConstruction: 256,
                    maxConnections: 64,
                    dynamicEfMin: 50,
                    dynamicEfMax: 300,
                    vectorCacheMaxObjects: 50000,
                    cleanupIntervalSeconds: 600,
                    flatSearchCutoff: 10000
                },
                properties: [
                    {
                        name: 'title',
                        dataType: ['text'],
                        description: 'Document title',
                        indexFilterable: true,
                        indexSearchable: true
                    },
                    {
                        name: 'content',
                        dataType: ['text'],
                        description: 'Document content',
                        indexFilterable: false,
                        indexSearchable: true
                    },
                    {
                        name: 'source',
                        dataType: ['text'],
                        description: 'Document source',
                        indexFilterable: true,
                        indexSearchable: false
                    },
                    {
                        name: 'category',
                        dataType: ['text'],
                        description: 'Document category',
                        indexFilterable: true,
                        indexSearchable: false
                    },
                    {
                        name: 'contentType',
                        dataType: ['text'],
                        description: 'Type of content (code, documentation, knowledge)',
                        indexFilterable: true,
                        indexSearchable: false
                    },
                    {
                        name: 'priority',
                        dataType: ['number'],
                        description: 'Content priority score',
                        indexFilterable: true,
                        indexRangeFilters: true
                    },
                    {
                        name: 'wordCount',
                        dataType: ['int'],
                        description: 'Word count of content',
                        indexFilterable: true,
                        indexRangeFilters: true
                    },
                    {
                        name: 'createdAt',
                        dataType: ['date'],
                        description: 'Creation timestamp',
                        indexFilterable: true,
                        indexRangeFilters: true
                    },
                    {
                        name: 'isActive',
                        dataType: ['boolean'],
                        description: 'Whether document is active',
                        indexFilterable: true
                    }
                ]
            };

            // Check if optimized class already exists
            try {
                const existingClass = await this.weaviateClient.schema.classGetter()
                    .withClassName('OptimizedDocument')
                    .do();
                console.log('ℹ️ OptimizedDocument class already exists');
                return { success: true, message: 'Schema already optimized' };
            } catch (error) {
                // Class doesn't exist, continue with creation
            }

            // Create the optimized class
            await this.weaviateClient.schema.classCreator()
                .withClass(optimizedClass)
                .do();
            console.log('✅ Created OptimizedDocument class for external Cohere v3 embeddings');

            return { success: true, message: 'Schema optimization completed' };
        } catch (error) {
            console.error('❌ Schema optimization failed:', error);
            return { success: false, error: error.message };
        }
    }

    // Generate Cohere v3 embeddings for text with caching
    async generateEmbedding(text) {
        const cacheKey = this.cacheManager.generateKey('embedding', text);
        
        // Check cache first
        const cached = await this.cacheManager.get('embeddings', cacheKey);
        if (cached) {
            this.metricsCollector.recordEmbedding(0, true);
            return cached;
        }

        try {
            const start = Date.now();
            const response = await this.cohereClient.embed({
                texts: [text],
                model: 'embed-english-v3.0',
                inputType: 'search_document'
            });
            
            const embedding = response.embeddings[0];
            
            // Cache the result
            await this.cacheManager.set('embeddings', cacheKey, embedding);
            
            this.metricsCollector.recordEmbedding(Date.now() - start, false);
            return embedding;
        } catch (error) {
            console.error('❌ Failed to generate embedding:', error);
            throw error;
        }
    }

    // Batch generate embeddings with caching
    async batchGenerateEmbeddings(texts) {
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
                const start = Date.now();
                const response = await this.cohereClient.embed({
                    texts: uncachedTexts,
                    model: 'embed-english-v3.0',
                    inputType: 'search_document'
                });

                // Cache and assign embeddings
                for (let i = 0; i < response.embeddings.length; i++) {
                    const originalIndex = uncachedIndices[i];
                    const cacheKey = this.cacheManager.generateKey('embedding', texts[originalIndex]);
                    
                    embeddings[originalIndex] = response.embeddings[i];
                    await this.cacheManager.set('embeddings', cacheKey, response.embeddings[i]);
                    
                    this.metricsCollector.recordEmbedding((Date.now() - start) / uncachedTexts.length, false);
                }
            } catch (error) {
                console.error('❌ Failed to generate batch embeddings:', error);
                throw error;
            }
        }

        return embeddings;
    }

    // Migrate data from old classes to optimized class with Cohere v3 embeddings
    async migrateData(options = {}) {
        try {
            console.log('🚀 Starting data migration with Cohere v3 embeddings...');
            
            const sourceClasses = ['Document', 'Knowledge', 'CohereKnowledge'];
            let totalMigrated = 0;
            let totalSkipped = 0;
            const batchSize = options.batchSize || 50;
            const skipLowValue = options.skipLowValue !== false;
            const onProgress = options.onProgress || (() => {});

            for (const sourceClass of sourceClasses) {
                console.log(`📦 Migrating data from ${sourceClass}...`);
                
                // Get data from source class in smaller batches
                let offset = 0;
                console.log(`\n📄 Migrating from ${sourceClass}...`);
                onProgress({ type: 'class_start', class: sourceClass });
                
                // Get count first
                const countResult = await this.weaviateClient.graphql
                    .aggregate()
                    .withClassName(sourceClass)
                    .withFields('meta { count }')
                    .do();
                
                const totalCount = countResult.data.Aggregate[sourceClass]?.[0]?.meta?.count || 0;
                console.log(`📊 Found ${totalCount} documents in ${sourceClass}`);
                
                // Migrate in batches
                while (offset < totalCount) {
                    const result = await this.weaviateClient.graphql
                        .get()
                        .withClassName(sourceClass)
                        .withFields('title content source category')
                        .withLimit(batchSize)
                        .withOffset(offset)
                        .do();

                    const documents = result.data.Get[sourceClass] || [];
                    
                    if (documents.length === 0) break;
                    
                    // Process batch
                    const batchObjects = [];
                    const textsToEmbed = [];
                    const docsToProcess = [];
                    
                    for (const doc of documents) {
                        // Clean and optimize document
                        const cleaned = this.cleanDocument(doc, sourceClass);
                        
                        // Skip low-value content if enabled
                        if (skipLowValue && this.isLowValueContent(cleaned.content)) {
                            totalSkipped++;
                            continue;
                        }
                        
                        const text = `${cleaned.title} ${cleaned.content}`.substring(0, 2000);
                        textsToEmbed.push(text);
                        docsToProcess.push(cleaned);
                    }
                    
                    // Batch generate embeddings
                    if (textsToEmbed.length > 0) {
                        const embeddings = await this.batchGenerateEmbeddings(textsToEmbed);
                        
                        for (let i = 0; i < docsToProcess.length; i++) {
                            batchObjects.push({
                                class: 'OptimizedDocument',
                                properties: docsToProcess[i],
                                vector: embeddings[i]
                            });
                        }
                        
                        // Insert batch
                        await this.weaviateClient.batch
                            .objectsBatcher()
                            .withObjects(...batchObjects)
                            .do();
                        
                        totalMigrated += batchObjects.length;
                    }
                    
                    offset += batchSize;
                    
                    // Progress update
                    const progress = Math.round((offset / totalCount) * 100);
                    onProgress({
                        type: 'progress',
                        class: sourceClass,
                        processed: offset,
                        total: totalCount,
                        progress,
                        migrated: totalMigrated,
                        skipped: totalSkipped
                    });
                    
                    console.log(`✅ Progress: ${offset}/${totalCount} (${progress}%)`);
                    
                    // Rate limiting
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
            }

            console.log(`\n✅ Migration completed!`);
            console.log(`📊 Total migrated: ${totalMigrated}`);
            console.log(`🚫 Total skipped: ${totalSkipped}`);
            
            onProgress({
                type: 'complete',
                migrated: totalMigrated,
                skipped: totalSkipped
            });
            
            return {
                success: true,
                migrated: totalMigrated,
                skipped: totalSkipped,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('❌ Data migration failed:', error);
            return { success: false, error: error.message };
        }
    }

    // Clean and optimize document data
    cleanDocument(doc, sourceClass) {
        // Determine content type based on source class and content
        let contentType = 'documentation';
        if (sourceClass === 'Knowledge' || sourceClass === 'CohereKnowledge') {
            contentType = 'knowledge';
        } else if (doc.source && doc.source.includes('code_repo')) {
            contentType = 'code';
        }

        // Filter out low-value content
        const content = doc.content || '';
        const isLowValue = this.isLowValueContent(content);
        
        return {
            title: doc.title || 'Untitled',
            content: isLowValue ? null : content,
            source: doc.source || 'unknown',
            category: doc.category || 'general',
            contentType,
            priority: doc.priority || (isLowValue ? 0.1 : 0.8),
            wordCount: content.split(/\s+/).length,
            createdAt: doc.createdAt || new Date().toISOString(),
            isActive: isLowValue ? false : (doc.isActive !== false)
        };
    }

    // Identify low-value content for filtering
    isLowValueContent(content) {
        if (!content || content.length < 50) return true;
        
        const lowValuePatterns = [
            /^StartFontMetrics/,
            /^Copyright \(c\)/,
            /^# File generated from our OpenAPI spec/,
            /^from typing import/,
            /^import /,
            /^\s*[A-Z]\s+-?\d+\s+;/,  // Font metrics
            /^KPX\s+/,                 // Kerning data
            /^EndCharMetrics/
        ];

        return lowValuePatterns.some(pattern => pattern.test(content));
    }

    // Enhanced search with OpenRouter integration
    async enhancedSearch(query, options = {}) {
        try {
            const {
                limit = 10,
                useOpenRouter = true,
                model = 'openrouter/auto',
                contentType = null,
                minPriority = 0.3
            } = options;

            console.log(`🔍 Enhanced search for: "${query}"`);

            // Build where filter
            let whereFilter = {
                operator: 'And',
                operands: [
                    {
                        path: ['isActive'],
                        operator: 'Equal',
                        valueBoolean: true
                    },
                    {
                        path: ['priority'],
                        operator: 'GreaterThanEqual',
                        valueNumber: minPriority
                    }
                ]
            };

            if (contentType) {
                whereFilter.operands.push({
                    path: ['contentType'],
                    operator: 'Equal',
                    valueText: contentType
                });
            }

            // Perform vector search
            const searchResult = await this.weaviateClient.graphql.get()
                .withClassName('OptimizedDocument')
                .withFields('title content source category contentType priority _additional { certainty }')
                .withNearText({ concepts: [query] })
                .withWhere(whereFilter)
                .withLimit(limit)
                .do();

            const documents = searchResult.data.Get.OptimizedDocument || [];
            console.log(`📊 Found ${documents.length} relevant documents`);

            // Enhance results with OpenRouter if requested
            if (useOpenRouter && documents.length > 0) {
                const enhancedResults = await this.enhanceWithOpenRouter(query, documents, model);
                return {
                    success: true,
                    query,
                    results: enhancedResults,
                    totalFound: documents.length
                };
            }

            return {
                success: true,
                query,
                results: documents,
                totalFound: documents.length
            };
        } catch (error) {
            console.error('❌ Enhanced search failed:', error);
            return { success: false, error: error.message };
        }
    }

    // Enhance search results using OpenRouter
    async enhanceWithOpenRouter(query, documents, model = 'openrouter/auto') {
        try {
            console.log(`🤖 Enhancing results with OpenRouter (${model})...`);

            const context = documents.map(doc => 
                `Title: ${doc.title}\nSource: ${doc.source}\nContent: ${doc.content?.substring(0, 500)}...`
            ).join('\n\n---\n\n');

            const completion = await this.openRouterClient.chat.completions.create({
                model: model,
                models: [
                    'anthropic/claude-3.5-sonnet',
                    'openai/gpt-4o',
                    'google/gemini-pro-1.5',
                    'meta-llama/llama-3.1-70b-instruct'
                ],
                messages: [
                    {
                        role: 'system',
                        content: `You are an AI assistant helping to analyze and summarize search results from a development knowledge base. 
                        Provide concise, relevant insights based on the search query and context provided.`
                    },
                    {
                        role: 'user',
                        content: `Query: "${query}"\n\nRelevant documents:\n${context}\n\nPlease provide:
                        1. A brief summary of the most relevant information
                        2. Key insights related to the query
                        3. Suggested next steps or related topics to explore`
                    }
                ],
                max_tokens: 1000,
                temperature: 0.3
            });

            const enhancement = completion.choices[0].message.content;
            const modelUsed = completion.model;

            return {
                documents,
                enhancement,
                modelUsed,
                enhancedAt: new Date().toISOString()
            };
        } catch (error) {
            console.error('❌ OpenRouter enhancement failed:', error);
            return {
                documents,
                enhancement: null,
                error: error.message
            };
        }
    }

    // Get optimization statistics
    async getOptimizationStats() {
        try {
            const stats = {};
            
            // Get counts for each class
            const classes = ['Document', 'Knowledge', 'CohereKnowledge', 'OptimizedDocument'];
            
            for (const className of classes) {
                try {
                    const result = await this.weaviateClient.graphql.aggregate()
                        .withClassName(className)
                        .withFields('meta { count }')
                        .do();
                    
                    stats[className] = result.data.Aggregate[className]?.[0]?.meta?.count || 0;
                } catch (error) {
                    stats[className] = 0;
                }
            }

            // Calculate optimization metrics
            const totalOriginal = stats.Document + stats.Knowledge + stats.CohereKnowledge;
            const optimized = stats.OptimizedDocument;
            const reductionPercentage = totalOriginal > 0 ? 
                Math.round(((totalOriginal - optimized) / totalOriginal) * 100) : 0;

            return {
                success: true,
                stats,
                metrics: {
                    totalOriginalDocuments: totalOriginal,
                    optimizedDocuments: optimized,
                    reductionPercentage,
                    spaceSaved: reductionPercentage > 0
                }
            };
        } catch (error) {
            console.error('❌ Failed to get optimization stats:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = WeaviateOptimizer;
