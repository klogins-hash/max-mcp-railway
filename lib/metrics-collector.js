class MetricsCollector {
    constructor() {
        this.metrics = {
            requests: {
                total: 0,
                byEndpoint: {},
                byStatus: {},
                errors: 0
            },
            performance: {
                responseTimes: [],
                embeddings: {
                    generated: 0,
                    cached: 0,
                    avgTime: 0,
                    times: []
                },
                searches: {
                    total: 0,
                    enhanced: 0,
                    avgTime: 0,
                    times: []
                }
            },
            resources: {
                memory: [],
                cpu: []
            },
            integrations: {
                mcp: { requests: 0, errors: 0, avgLatency: 0 },
                weaviate: { queries: 0, errors: 0, avgLatency: 0 },
                cohere: { embeddings: 0, errors: 0, tokensUsed: 0 },
                openrouter: { completions: 0, errors: 0, modelsUsed: {} }
            }
        };

        // Start resource monitoring
        this.startResourceMonitoring();
    }

    startResourceMonitoring() {
        // Monitor every 30 seconds
        setInterval(() => {
            const usage = process.memoryUsage();
            this.metrics.resources.memory.push({
                timestamp: Date.now(),
                heapUsed: usage.heapUsed,
                heapTotal: usage.heapTotal,
                rss: usage.rss,
                external: usage.external
            });

            // Keep only last hour of data
            const oneHourAgo = Date.now() - 3600000;
            this.metrics.resources.memory = this.metrics.resources.memory.filter(
                m => m.timestamp > oneHourAgo
            );

            // CPU usage
            const cpuUsage = process.cpuUsage();
            this.metrics.resources.cpu.push({
                timestamp: Date.now(),
                user: cpuUsage.user,
                system: cpuUsage.system
            });

            this.metrics.resources.cpu = this.metrics.resources.cpu.filter(
                c => c.timestamp > oneHourAgo
            );
        }, 30000);
    }

    recordRequest(endpoint, status, duration) {
        this.metrics.requests.total++;
        
        // By endpoint
        if (!this.metrics.requests.byEndpoint[endpoint]) {
            this.metrics.requests.byEndpoint[endpoint] = {
                count: 0,
                avgDuration: 0,
                durations: []
            };
        }
        
        const endpointMetrics = this.metrics.requests.byEndpoint[endpoint];
        endpointMetrics.count++;
        endpointMetrics.durations.push(duration);
        
        // Keep only last 100 durations
        if (endpointMetrics.durations.length > 100) {
            endpointMetrics.durations.shift();
        }
        
        endpointMetrics.avgDuration = this.calculateAverage(endpointMetrics.durations);

        // By status
        const statusGroup = `${Math.floor(status / 100)}xx`;
        this.metrics.requests.byStatus[statusGroup] = 
            (this.metrics.requests.byStatus[statusGroup] || 0) + 1;

        if (status >= 400) {
            this.metrics.requests.errors++;
        }

        // Overall response times
        this.metrics.performance.responseTimes.push(duration);
        if (this.metrics.performance.responseTimes.length > 1000) {
            this.metrics.performance.responseTimes.shift();
        }
    }

    recordEmbedding(duration, cached = false) {
        if (cached) {
            this.metrics.performance.embeddings.cached++;
        } else {
            this.metrics.performance.embeddings.generated++;
            this.metrics.performance.embeddings.times.push(duration);
            
            if (this.metrics.performance.embeddings.times.length > 100) {
                this.metrics.performance.embeddings.times.shift();
            }
            
            this.metrics.performance.embeddings.avgTime = 
                this.calculateAverage(this.metrics.performance.embeddings.times);
        }
    }

    recordSearch(duration, enhanced = false) {
        this.metrics.performance.searches.total++;
        if (enhanced) {
            this.metrics.performance.searches.enhanced++;
        }

        this.metrics.performance.searches.times.push(duration);
        if (this.metrics.performance.searches.times.length > 100) {
            this.metrics.performance.searches.times.shift();
        }

        this.metrics.performance.searches.avgTime = 
            this.calculateAverage(this.metrics.performance.searches.times);
    }

    recordIntegration(service, success, latency, metadata = {}) {
        const integration = this.metrics.integrations[service];
        if (!integration) return;

        if (success) {
            integration.requests = (integration.requests || 0) + 1;
            
            // Update average latency
            if (latency) {
                const currentAvg = integration.avgLatency || 0;
                const totalRequests = integration.requests;
                integration.avgLatency = ((currentAvg * (totalRequests - 1)) + latency) / totalRequests;
            }

            // Service-specific metrics
            if (service === 'cohere' && metadata.tokensUsed) {
                integration.tokensUsed += metadata.tokensUsed;
            } else if (service === 'openrouter' && metadata.model) {
                integration.modelsUsed[metadata.model] = 
                    (integration.modelsUsed[metadata.model] || 0) + 1;
            }
        } else {
            integration.errors = (integration.errors || 0) + 1;
        }
    }

    calculateAverage(numbers) {
        if (numbers.length === 0) return 0;
        return numbers.reduce((a, b) => a + b, 0) / numbers.length;
    }

    calculatePercentile(numbers, percentile) {
        if (numbers.length === 0) return 0;
        
        const sorted = [...numbers].sort((a, b) => a - b);
        const index = Math.ceil((percentile / 100) * sorted.length) - 1;
        return sorted[index];
    }

    getMetricsSummary() {
        const responseTimes = this.metrics.performance.responseTimes;
        const memoryUsage = this.metrics.resources.memory[this.metrics.resources.memory.length - 1] || {};

        return {
            requests: {
                total: this.metrics.requests.total,
                errorRate: this.metrics.requests.total > 0 
                    ? (this.metrics.requests.errors / this.metrics.requests.total) * 100 
                    : 0,
                byStatus: this.metrics.requests.byStatus,
                topEndpoints: Object.entries(this.metrics.requests.byEndpoint)
                    .sort((a, b) => b[1].count - a[1].count)
                    .slice(0, 5)
                    .map(([endpoint, data]) => ({
                        endpoint,
                        count: data.count,
                        avgDuration: Math.round(data.avgDuration)
                    }))
            },
            performance: {
                avgResponseTime: Math.round(this.calculateAverage(responseTimes)),
                p50ResponseTime: Math.round(this.calculatePercentile(responseTimes, 50)),
                p95ResponseTime: Math.round(this.calculatePercentile(responseTimes, 95)),
                p99ResponseTime: Math.round(this.calculatePercentile(responseTimes, 99)),
                embeddings: {
                    total: this.metrics.performance.embeddings.generated + 
                           this.metrics.performance.embeddings.cached,
                    cacheHitRate: this.metrics.performance.embeddings.cached > 0
                        ? (this.metrics.performance.embeddings.cached / 
                           (this.metrics.performance.embeddings.generated + 
                            this.metrics.performance.embeddings.cached)) * 100
                        : 0,
                    avgGenerationTime: Math.round(this.metrics.performance.embeddings.avgTime)
                },
                searches: {
                    total: this.metrics.performance.searches.total,
                    enhancedRate: this.metrics.performance.searches.total > 0
                        ? (this.metrics.performance.searches.enhanced / 
                           this.metrics.performance.searches.total) * 100
                        : 0,
                    avgSearchTime: Math.round(this.metrics.performance.searches.avgTime)
                }
            },
            resources: {
                memory: {
                    heapUsedMB: Math.round((memoryUsage.heapUsed || 0) / 1024 / 1024),
                    heapTotalMB: Math.round((memoryUsage.heapTotal || 0) / 1024 / 1024),
                    rssMB: Math.round((memoryUsage.rss || 0) / 1024 / 1024)
                },
                uptime: Math.round(process.uptime())
            },
            integrations: this.metrics.integrations
        };
    }

    reset() {
        // Reset all metrics except resource monitoring
        this.metrics.requests = {
            total: 0,
            byEndpoint: {},
            byStatus: {},
            errors: 0
        };
        
        this.metrics.performance = {
            responseTimes: [],
            embeddings: {
                generated: 0,
                cached: 0,
                avgTime: 0,
                times: []
            },
            searches: {
                total: 0,
                enhanced: 0,
                avgTime: 0,
                times: []
            }
        };

        this.metrics.integrations = {
            mcp: { requests: 0, errors: 0, avgLatency: 0 },
            weaviate: { queries: 0, errors: 0, avgLatency: 0 },
            cohere: { embeddings: 0, errors: 0, tokensUsed: 0 },
            openrouter: { completions: 0, errors: 0, modelsUsed: {} }
        };
    }
}

module.exports = MetricsCollector;
