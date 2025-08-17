/**
 * Circuit Breaker Pattern Implementation
 * Prevents cascading failures by stopping requests to failing services
 */
class CircuitBreaker {
    constructor(options = {}) {
        this.threshold = options.threshold || 5; // Number of failures before opening
        this.timeout = options.timeout || 60000; // Time to wait before half-open (ms)
        this.resetTimeout = options.resetTimeout || 120000; // Time to reset stats (ms)
        
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failures = 0;
        this.successes = 0;
        this.nextAttempt = Date.now();
        this.lastFailureTime = null;
        
        this.stats = {
            totalCalls: 0,
            totalFailures: 0,
            totalSuccesses: 0,
            circuitOpens: 0
        };
    }

    /**
     * Execute an operation through the circuit breaker
     * @param {Function} operation - Async function to execute
     * @param {string} operationName - Name for logging
     * @returns {Promise} - Result of the operation
     */
    async execute(operation, operationName = 'operation') {
        this.stats.totalCalls++;

        // Check if circuit is open
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                const waitTime = Math.ceil((this.nextAttempt - Date.now()) / 1000);
                throw new Error(`Circuit breaker is OPEN for ${operationName}. Retry in ${waitTime}s`);
            }
            // Move to half-open state to test
            this.state = 'HALF_OPEN';
            console.log(`⚡ Circuit breaker HALF-OPEN for ${operationName}, testing...`);
        }

        try {
            const result = await operation();
            this.onSuccess(operationName);
            return result;
        } catch (error) {
            this.onFailure(operationName, error);
            throw error;
        }
    }

    /**
     * Handle successful operation
     */
    onSuccess(operationName) {
        this.failures = 0;
        this.successes++;
        this.stats.totalSuccesses++;

        if (this.state === 'HALF_OPEN') {
            this.state = 'CLOSED';
            console.log(`✅ Circuit breaker CLOSED for ${operationName}`);
        }

        // Reset stats after timeout
        if (this.lastFailureTime && Date.now() - this.lastFailureTime > this.resetTimeout) {
            this.successes = 1;
            this.lastFailureTime = null;
        }
    }

    /**
     * Handle failed operation
     */
    onFailure(operationName, error) {
        this.failures++;
        this.stats.totalFailures++;
        this.lastFailureTime = Date.now();

        if (this.state === 'HALF_OPEN') {
            // Failed in half-open, go back to open
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
            this.stats.circuitOpens++;
            console.log(`❌ Circuit breaker OPEN again for ${operationName}`);
        } else if (this.failures >= this.threshold) {
            // Threshold reached, open circuit
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.timeout;
            this.stats.circuitOpens++;
            console.log(`🚨 Circuit breaker OPEN for ${operationName} after ${this.failures} failures`);
        }
    }

    /**
     * Get circuit breaker status
     */
    getStatus() {
        return {
            state: this.state,
            failures: this.failures,
            successes: this.successes,
            nextAttempt: this.state === 'OPEN' ? new Date(this.nextAttempt).toISOString() : null,
            stats: {
                ...this.stats,
                successRate: this.stats.totalCalls > 0 
                    ? (this.stats.totalSuccesses / this.stats.totalCalls * 100).toFixed(2) + '%'
                    : '0%'
            }
        };
    }

    /**
     * Manually reset the circuit breaker
     */
    reset() {
        this.state = 'CLOSED';
        this.failures = 0;
        this.successes = 0;
        this.nextAttempt = Date.now();
        this.lastFailureTime = null;
        console.log('🔄 Circuit breaker manually reset');
    }
}

module.exports = CircuitBreaker;
