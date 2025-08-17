/**
 * Metrics Aggregator
 * Provides time-series aggregation for metrics data
 */
class MetricsAggregator {
    constructor() {
        this.timeSeries = new Map();
        this.aggregationIntervals = {
            '1m': 60000,
            '5m': 300000,
            '15m': 900000,
            '1h': 3600000,
            '24h': 86400000
        };
    }

    /**
     * Add a metric data point
     */
    addMetric(name, value, timestamp = Date.now(), tags = {}) {
        const key = this.getMetricKey(name, tags);
        
        if (!this.timeSeries.has(key)) {
            this.timeSeries.set(key, []);
        }
        
        this.timeSeries.get(key).push({
            value,
            timestamp,
            tags
        });

        // Clean up old data (keep last 24 hours)
        this.cleanupOldData(key);
    }

    /**
     * Generate metric key from name and tags
     */
    getMetricKey(name, tags) {
        const tagString = Object.entries(tags)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}:${v}`)
            .join(',');
        return `${name}${tagString ? ',' + tagString : ''}`;
    }

    /**
     * Clean up data older than 24 hours
     */
    cleanupOldData(key) {
        const cutoff = Date.now() - this.aggregationIntervals['24h'];
        const data = this.timeSeries.get(key);
        
        if (data) {
            const filtered = data.filter(point => point.timestamp > cutoff);
            if (filtered.length < data.length) {
                this.timeSeries.set(key, filtered);
            }
        }
    }

    /**
     * Aggregate time series data
     */
    aggregateTimeSeries(metricName, interval = '1m', tags = {}) {
        const key = this.getMetricKey(metricName, tags);
        const data = this.timeSeries.get(key) || [];
        
        if (data.length === 0) {
            return [];
        }

        const intervalMs = this.aggregationIntervals[interval] || 60000;
        const buckets = new Map();

        // Group data into time buckets
        data.forEach(point => {
            const bucketTime = Math.floor(point.timestamp / intervalMs) * intervalMs;
            
            if (!buckets.has(bucketTime)) {
                buckets.set(bucketTime, []);
            }
            
            buckets.get(bucketTime).push(point.value);
        });

        // Calculate aggregates for each bucket
        const aggregated = Array.from(buckets.entries()).map(([timestamp, values]) => ({
            timestamp,
            interval,
            count: values.length,
            sum: this.sum(values),
            avg: this.average(values),
            min: Math.min(...values),
            max: Math.max(...values),
            p50: this.percentile(values, 50),
            p95: this.percentile(values, 95),
            p99: this.percentile(values, 99),
            stdDev: this.standardDeviation(values)
        }));

        // Sort by timestamp
        aggregated.sort((a, b) => a.timestamp - b.timestamp);

        return aggregated;
    }

    /**
     * Get multiple metrics aggregated together
     */
    aggregateMultipleMetrics(metrics, interval = '1m') {
        const results = {};
        
        metrics.forEach(({ name, tags = {} }) => {
            results[name] = this.aggregateTimeSeries(name, interval, tags);
        });

        return results;
    }

    /**
     * Calculate sum of values
     */
    sum(values) {
        return values.reduce((sum, val) => sum + val, 0);
    }

    /**
     * Calculate average of values
     */
    average(values) {
        if (values.length === 0) return 0;
        return this.sum(values) / values.length;
    }

    /**
     * Calculate percentile
     */
    percentile(values, p) {
        if (values.length === 0) return 0;
        
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.ceil((p / 100) * sorted.length) - 1;
        
        return sorted[Math.max(0, index)];
    }

    /**
     * Calculate standard deviation
     */
    standardDeviation(values) {
        if (values.length === 0) return 0;
        
        const avg = this.average(values);
        const squaredDiffs = values.map(val => Math.pow(val - avg, 2));
        const avgSquaredDiff = this.average(squaredDiffs);
        
        return Math.sqrt(avgSquaredDiff);
    }

    /**
     * Get rate of change for a metric
     */
    getRate(metricName, interval = '1m', tags = {}) {
        const aggregated = this.aggregateTimeSeries(metricName, interval, tags);
        
        if (aggregated.length < 2) {
            return null;
        }

        const rates = [];
        
        for (let i = 1; i < aggregated.length; i++) {
            const timeDiff = (aggregated[i].timestamp - aggregated[i-1].timestamp) / 1000; // seconds
            const valueDiff = aggregated[i].sum - aggregated[i-1].sum;
            const rate = valueDiff / timeDiff;
            
            rates.push({
                timestamp: aggregated[i].timestamp,
                rate,
                interval
            });
        }

        return rates;
    }

    /**
     * Get current snapshot of all metrics
     */
    getSnapshot() {
        const snapshot = {};
        
        for (const [key, data] of this.timeSeries.entries()) {
            if (data.length > 0) {
                const recent = data.slice(-100); // Last 100 points
                snapshot[key] = {
                    count: data.length,
                    latest: data[data.length - 1],
                    recentAvg: this.average(recent.map(p => p.value)),
                    recentMin: Math.min(...recent.map(p => p.value)),
                    recentMax: Math.max(...recent.map(p => p.value))
                };
            }
        }

        return snapshot;
    }

    /**
     * Export metrics in Prometheus format
     */
    toPrometheusFormat() {
        const lines = [];
        const snapshot = this.getSnapshot();

        for (const [key, stats] of Object.entries(snapshot)) {
            const [name, ...tagPairs] = key.split(',');
            const tags = tagPairs.length > 0 
                ? '{' + tagPairs.join(',') + '}'
                : '';

            lines.push(`# TYPE ${name} gauge`);
            lines.push(`${name}${tags} ${stats.latest.value} ${stats.latest.timestamp}`);
        }

        return lines.join('\n');
    }

    /**
     * Clear all metrics data
     */
    clear() {
        this.timeSeries.clear();
    }
}

module.exports = MetricsAggregator;
