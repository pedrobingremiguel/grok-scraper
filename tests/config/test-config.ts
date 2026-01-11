/**
 * Test Configuration
 * Separate from application config - used only for testing
 */

import { CONFIG } from '../../src/config/config';

export interface TestConfig {
    // API Settings
    apiUrl: string;
    endpoint: string;

    // Test Scale
    totalRequests: number;
    concurrentRequests: number;
    batchSize: number;
    batchDelayMs: number;

    // Traffic Pattern
    trafficMode: 'batch' | 'continuous';
    requestsPerSecond?: number;

    // Request Settings
    requestTimeoutMs: number;
    maxRetries: number;

    // Success Criteria
    targetSuccessRate: number;
    minimumSuccessfulRequests?: number;
}

/**
 * Standard Test Configuration - For quick validation
 */
export function getStandardTestConfig(): TestConfig {
    return {
        // Use main config for server settings
        apiUrl: process.env.API_URL || `http://${CONFIG.host}:${CONFIG.port}`,
        endpoint: '/v1/monitor/grok',
        totalRequests: parseInt(process.env.STANDARD_TOTAL_REQUESTS || '10', 10),
        concurrentRequests: parseInt(process.env.STANDARD_CONCURRENT_REQUESTS || '2', 10),

        // Traffic Pattern
        trafficMode: (process.env.STANDARD_TRAFFIC_MODE as 'batch' | 'continuous') || 'batch',
        requestsPerSecond: parseInt(process.env.STANDARD_REQUESTS_PER_SECOND || '2', 10),

        batchSize: parseInt(process.env.STANDARD_BATCH_SIZE || '10', 10),
        batchDelayMs: parseInt(process.env.STANDARD_BATCH_DELAY_MS || '200', 10),
        // Align with main config timeout
        requestTimeoutMs: parseInt(process.env.STANDARD_REQUEST_TIMEOUT_MS || String(CONFIG.requestTimeout), 10),
        maxRetries: parseInt(process.env.STANDARD_MAX_RETRIES || '5', 10),
        targetSuccessRate: parseFloat(process.env.STANDARD_TARGET_SUCCESS_RATE || '0.95'),
    };
}

/**
 * Large-Scale Test Configuration - For production validation
 * Uses continuous traffic mode to simulate real-world request patterns
 * 
 * Configuration:
 * - 8 requests/minute (0.133 req/s)
 * - 10 browser pool
 * - 5 backpressure multiplier (50 queue threshold)
 * 
 */
export function getLargeTestConfig(): TestConfig {
    return {
        // Use main config for server settings
        apiUrl: process.env.API_URL || `http://${CONFIG.host}:${CONFIG.port}`,
        endpoint: '/v1/monitor/grok',

        totalRequests: parseInt(process.env.LARGE_TOTAL_REQUESTS || '1200', 10),
        concurrentRequests: parseInt(process.env.LARGE_CONCURRENT_REQUESTS || '10', 10),

        trafficMode: (process.env.LARGE_TRAFFIC_MODE as 'batch' | 'continuous') || 'continuous',
        requestsPerSecond: parseFloat(process.env.LARGE_REQUESTS_PER_SECOND || '0.133'),  // 8/min

        // Ignored in continuous mode)
        batchSize: parseInt(process.env.LARGE_BATCH_SIZE || '50', 10),
        batchDelayMs: parseInt(process.env.LARGE_BATCH_DELAY_MS || '1000', 10),

        // Align with main config timeout
        requestTimeoutMs: parseInt(process.env.LARGE_REQUEST_TIMEOUT_MS || String(CONFIG.requestTimeout), 10),
        maxRetries: parseInt(process.env.LARGE_MAX_RETRIES || '2', 10),

        // Success Criteria: High success rate expected (sustainable load)
        targetSuccessRate: parseFloat(process.env.LARGE_TARGET_SUCCESS_RATE || '0.95'),
        minimumSuccessfulRequests: parseInt(process.env.LARGE_MIN_SUCCESSFUL_REQUESTS || '1140', 10),  // 95% of 1200
    };
}
