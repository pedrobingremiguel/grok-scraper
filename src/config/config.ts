/**
 * Configuration for Grok Scraper API Service
 * All configurable values centralized here for easy management
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Determine environment and load appropriate .env file
const NODE_ENV = process.env.NODE_ENV || 'development';
const envFile = `.env.${NODE_ENV}`;
const envPath = path.resolve(process.cwd(), envFile);

const result = dotenv.config({ path: envPath });
if (result.error) {
    // Fallback to default .env 
    dotenv.config();
}

export interface Config {
    // Server Configuration
    port: number;
    host: string;

    // Browser Pool Configuration
    browserPoolSize: number;
    browserHeadless: boolean; // Run browser in headless mode
    browserTimeout: number; // Timeout for browser operations (ms)
    browserAcquisitionTimeout: number; // Timeout for acquiring a browser (ms)
    browserHealthCheckInterval: number; // How often to check browser health (ms)
    initialPageWait: number; // Wait time after navigation (ms)

    // Queue Configuration
    maxRetries: number; // Maximum retry attempts per request
    maxCompletedRequests: number; // Max completed requests to keep in memory

    // Request Configuration
    requestTimeout: number; // Overall request timeout (ms)
    initialDelay: number; // Delay before starting scrape (ms)

    // Backpressure Configuration
    backpressureEnabled: boolean;
    backpressureThreshold: number; // Max queued requests before rejecting
    backpressureMultiplier: number; // Multiplier of browser pool size for dynamic threshold

    // Scraper Timeouts
    inputSelectorTimeout: number; // Timeout for finding input selector (ms)
    responseCompletionTimeout: number; // Timeout for response completion (ms)
    stuckCheckInterval: number; // How often to check if response is stuck (ms)

    // Scraper Delays
    randomDelayMin: number; // Min random delay (ms)
    randomDelayMax: number; // Max random delay (ms)
    typingDelay: number; // Delay between keystrokes (ms)

    // URLs
    grokUrl: string;

    // Feature Flags
    enableBrowserHealthMonitoring: boolean;
    enableGracefulShutdown: boolean;
}

/**
 * Load and validate configuration from environment variables
 */
function loadConfig(): Config {
    return {
        // Server Configuration
        port: parseInt(process.env.PORT || '3002', 10),
        host: process.env.HOST || '0.0.0.0',

        // Browser Pool Configuration
        browserPoolSize: parseInt(process.env.BROWSER_POOL_SIZE || '4', 10),
        browserHeadless: process.env.BROWSER_HEADLESS === 'true',
        browserTimeout: parseInt(process.env.BROWSER_TIMEOUT || '30000', 10),
        browserAcquisitionTimeout: parseInt(process.env.BROWSER_ACQUISITION_TIMEOUT || '60000', 10),
        browserHealthCheckInterval: parseInt(process.env.BROWSER_HEALTH_CHECK_INTERVAL || '30000', 10),
        initialPageWait: parseInt(process.env.INITIAL_PAGE_WAIT || '2000', 10),

        // Queue Configuration
        maxRetries: parseInt(process.env.MAX_RETRIES || '1000', 10),
        maxCompletedRequests: parseInt(process.env.MAX_COMPLETED_REQUESTS || '1000', 10),

        // Request Configuration
        requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '180000', 10),
        initialDelay: parseInt(process.env.INITIAL_DELAY || '2000', 10),

        // Backpressure Configuration
        backpressureEnabled: process.env.BACKPRESSURE_ENABLED !== 'false',
        backpressureThreshold: parseInt(process.env.BACKPRESSURE_THRESHOLD || '20', 10),
        backpressureMultiplier: parseInt(process.env.BACKPRESSURE_MULTIPLIER || '5', 10),

        // Scraper Timeouts
        inputSelectorTimeout: parseInt(process.env.INPUT_SELECTOR_TIMEOUT || '2000', 10),
        responseCompletionTimeout: parseInt(process.env.RESPONSE_COMPLETION_TIMEOUT || '120000', 10),
        stuckCheckInterval: parseInt(process.env.STUCK_CHECK_INTERVAL || '5000', 10),

        // Scraper Delays
        randomDelayMin: parseInt(process.env.RANDOM_DELAY_MIN || '100', 10),
        randomDelayMax: parseInt(process.env.RANDOM_DELAY_MAX || '1000', 10),
        typingDelay: parseInt(process.env.TYPING_DELAY || '30', 10),

        // URLs
        grokUrl: process.env.GROK_URL || 'https://grok.com',

        // Feature Flags
        enableBrowserHealthMonitoring: process.env.ENABLE_BROWSER_HEALTH_MONITORING !== 'false',
        enableGracefulShutdown: process.env.ENABLE_GRACEFUL_SHUTDOWN !== 'false',
    };
}

/**
 * Validate configuration values
 * Throws an error if any configuration is invalid
 */
export function validateConfig(config: Config): void {
    const errors: string[] = [];

    // Server validation
    if (config.port < 1 || config.port > 65535) {
        errors.push('PORT must be between 1 and 65535');
    }

    // Browser pool validation
    if (config.browserPoolSize < 1 || config.browserPoolSize > 20) {
        errors.push('BROWSER_POOL_SIZE must be between 1 and 20');
    }

    if (config.browserTimeout < 1000) {
        errors.push('BROWSER_TIMEOUT must be at least 1000ms');
    }

    if (config.browserAcquisitionTimeout < 1000) {
        errors.push('BROWSER_ACQUISITION_TIMEOUT must be at least 1000ms');
    }

    if (config.browserHealthCheckInterval < 5000) {
        errors.push('BROWSER_HEALTH_CHECK_INTERVAL must be at least 5000ms');
    }

    // Queue validation
    if (config.maxRetries < 0) {
        errors.push('MAX_RETRIES must be non-negative');
    }

    if (config.maxCompletedRequests < 1) {
        errors.push('MAX_COMPLETED_REQUESTS must be at least 1');
    }

    // Request validation
    if (config.requestTimeout < 10000) {
        errors.push('REQUEST_TIMEOUT must be at least 10000ms (10 seconds)');
    }

    // Backpressure validation
    if (config.backpressureThreshold < 0) {
        errors.push('BACKPRESSURE_THRESHOLD must be non-negative');
    }

    if (config.backpressureMultiplier < 1) {
        errors.push('BACKPRESSURE_MULTIPLIER must be at least 1');
    }

    // Scraper validation
    if (config.inputSelectorTimeout < 100) {
        errors.push('INPUT_SELECTOR_TIMEOUT must be at least 100ms');
    }

    if (config.responseCompletionTimeout < 5000) {
        errors.push('RESPONSE_COMPLETION_TIMEOUT must be at least 5000ms');
    }

    if (config.stuckCheckInterval < 1000) {
        errors.push('STUCK_CHECK_INTERVAL must be at least 1000ms');
    }

    // Delay validation
    if (config.randomDelayMin < 0) {
        errors.push('RANDOM_DELAY_MIN must be non-negative');
    }

    if (config.randomDelayMax < config.randomDelayMin) {
        errors.push('RANDOM_DELAY_MAX must be greater than or equal to RANDOM_DELAY_MIN');
    }

    if (config.typingDelay < 0) {
        errors.push('TYPING_DELAY must be non-negative');
    }

    // URL validation
    if (!config.grokUrl.startsWith('http://') && !config.grokUrl.startsWith('https://')) {
        errors.push('GROK_URL must start with http:// or https://');
    }

    // Logical validation
    if (config.browserAcquisitionTimeout > config.requestTimeout) {
        errors.push('BROWSER_ACQUISITION_TIMEOUT should not exceed REQUEST_TIMEOUT');
    }

    if (config.responseCompletionTimeout > config.requestTimeout) {
        errors.push('RESPONSE_COMPLETION_TIMEOUT should not exceed REQUEST_TIMEOUT');
    }

    if (errors.length > 0) {
        throw new Error(
            `Configuration validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`
        );
    }
}

/**
 * Load, validate, and return configuration
 */
export function getConfig(): Config {
    const config = loadConfig();
    validateConfig(config);

    // Log configuration on startup
    console.log('🔧 Configuration Loaded:');
    console.log(`   Environment:         ${NODE_ENV}`);
    console.log(`   Config File:         ${envFile}`);
    console.log(`   Server:              ${config.host}:${config.port}`);
    console.log(`   Browser Pool Size:   ${config.browserPoolSize}`);
    console.log(`   Browser Headless:    ${config.browserHeadless}`);
    console.log(`   Max Retries:         ${config.maxRetries}`);
    console.log(`   Request Timeout:     ${config.requestTimeout}ms`);
    console.log(`   Backpressure:        ${config.backpressureEnabled ? 'Enabled' : 'Disabled'}`);
    if (config.backpressureEnabled) {
        console.log(`   Backpressure Limit:  ${getBackpressureThreshold(config)} requests`);
    }
    console.log('');

    return config;
}

// Export singleton instance
export const CONFIG = getConfig();

/**
 * Calculate dynamic backpressure threshold based on browser pool size
 */
export function getBackpressureThreshold(config: Config): number {
    if (!config.backpressureEnabled) {
        return 1000000; // Effectively disabled
    }

    // Use explicit threshold if set, otherwise calculate dynamically
    if (process.env.BACKPRESSURE_THRESHOLD) {
        return config.backpressureThreshold;
    }

    // Dynamic: allow N× browser pool size in queue
    return config.browserPoolSize * config.backpressureMultiplier;
}
