/**
 * Large-Scale API Test
 * Tests the Guest Grok API service at scale with 1000+ requests
 * Target: >95% success rate with continuous traffic patterns
 */

import * as path from 'path';
import { TestLogger } from '../src/utils/test-logger';
import { getLargeTestConfig } from './config/test-config';
import {
    ApiRequest,
    generatePrompts,
    checkHealth,
    processWithConcurrency,
    makeRequestWithRetry,
    calculateStatistics,
    displayProgress,
    displayStatistics,
    saveResults,
    sleep
} from './utils/test-runner';

/**
 * Main test function
 */
async function testLargeScaleApi(): Promise<void> {
    const config = getLargeTestConfig();

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Large-Scale Guest API Test');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('Configuration:');
    console.log(`  Total Requests:     ${config.totalRequests}`);
    console.log(`  Traffic Mode:       ${config.trafficMode.toUpperCase()}`);
    if (config.trafficMode === 'continuous') {
        console.log(`  Arrival Rate:       ${config.requestsPerSecond} req/s`);
        console.log(`  Expected Duration:  ~${Math.ceil(config.totalRequests / config.requestsPerSecond!)}s`);
    } else {
        console.log(`  Concurrent:         ${config.concurrentRequests}`);
        console.log(`  Batch Size:         ${config.batchSize}`);
        console.log(`  Batch Delay:        ${config.batchDelayMs}ms`);
    }
    console.log(`  Max Retries:        ${config.maxRetries}`);
    console.log(`  Target Success:     >${(config.targetSuccessRate * 100)}%`);
    console.log(`  Min Successful:     ${config.minimumSuccessfulRequests}`);
    console.log(`  API URL:            ${config.apiUrl}`);
    console.log('');

    // Initialize logger
    const logger = new TestLogger(path.join(process.cwd(), 'large-api-test-log.json'));

    // Check if API is running
    console.log('🔍 Checking API health...');
    const isHealthy = await checkHealth(config.apiUrl);

    if (!isHealthy) {
        console.error('❌ API is not running or not healthy!');
        console.error(`   Please start the API with: npm start`);
        console.error(`   Expected URL: ${config.apiUrl}\n`);
        process.exit(1);
    }

    console.log(`✓ API is healthy\n`);

    // Generate requests
    console.log('📝 Generating test requests...');
    const prompts = generatePrompts(config.totalRequests);
    const requests: ApiRequest[] = prompts.map((prompt, index) => ({
        id: `req_${String(index + 1).padStart(5, '0')}`,
        prompt,
        country: 'US',
        include: { markdown: false }
    }));
    console.log(`✓ Generated ${requests.length} requests\n`);

    // Choose traffic pattern
    let allResults: import('./utils/test-runner').TestResult[];
    let totalDurationMs: number;

    if (config.trafficMode === 'continuous') {
        // Continuous traffic mode - realistic arrival pattern
        console.log('🚀 Starting continuous traffic test...\n');

        const result = await runContinuousTraffic(requests, logger, config);
        allResults = result.results;
        totalDurationMs = result.durationMs;
    } else {
        // Legacy batch mode
        console.log('🚀 Starting batch mode test...\n');

        const result = await runBatchTraffic(requests, logger, config);
        allResults = result.results;
        totalDurationMs = result.durationMs;
    }

    // Calculate and display statistics
    const stats = calculateStatistics(allResults, totalDurationMs);
    displayStatistics(stats, config);

    // Save results
    saveResults(allResults, stats, config, path.join(process.cwd(), 'large-api-test-results.json'));

    // Save detailed logger output
    logger.save();
    console.log(`📄 Detailed log written to: ${path.join(process.cwd(), 'large-api-test-log.json')}\n`);

    // Exit with appropriate code
    const meetsSuccessRate = stats.successRate >= config.targetSuccessRate;
    const meetsMinimumCount = !config.minimumSuccessfulRequests ||
        stats.successfulRequests >= config.minimumSuccessfulRequests;
    const exitCode = (meetsSuccessRate && meetsMinimumCount) ? 0 : 1;

    process.exit(exitCode);
}

// ============================================================================
// TRAFFIC PATTERN IMPLEMENTATIONS
// ============================================================================

async function runContinuousTraffic(
    requests: ApiRequest[],
    logger: any,
    config: import('./config/test-config').TestConfig
): Promise<{ results: import('./utils/test-runner').TestResult[], durationMs: number }> {
    const results: import('./utils/test-runner').TestResult[] = [];
    const startTime = Date.now();
    const requestsPerSecond = config.requestsPerSecond || 5;
    const delayBetweenRequests = 1000 / requestsPerSecond; // ms between each request

    // Track in-flight requests
    const inFlightRequests = new Set<Promise<import('./utils/test-runner').TestResult>>();
    let completedCount = 0;
    let rejectedCount = 0;
    let failedCount = 0;

    // Progress update interval
    const progressInterval = setInterval(() => {
        const currentStats = calculateStatistics(results, Date.now() - startTime);
        displayProgress(completedCount, requests.length, currentStats);

        // Show queue pressure
        const queuePressure = inFlightRequests.size;
        console.log(`  📊 In-flight: ${queuePressure} requests | Rejected (503): ${rejectedCount} | Failed: ${failedCount}`);
    }, 2000);

    // Fire requests at steady rate
    for (let i = 0; i < requests.length; i++) {
        const request = requests[i];

        const requestPromise = makeRequestWithRetry(request, logger, config)
            .then(result => {
                results.push(result);
                completedCount++;
                inFlightRequests.delete(requestPromise);
                return result;
            })
            .catch(error => {
                const errorResult: import('./utils/test-runner').TestResult = {
                    requestId: request.id,
                    prompt: request.prompt,
                    success: false,
                    durationMs: 0,
                    attempts: 1,
                    response: { error: error.message || 'Request failed' }
                };
                results.push(errorResult);
                completedCount++;
                inFlightRequests.delete(requestPromise);
                return errorResult;
            });

        inFlightRequests.add(requestPromise);

        if (i < requests.length - 1) {
            await sleep(delayBetweenRequests);
        }
    }

    console.log(`\n✓ All ${requests.length} requests sent. Waiting for completion...\n`);

    // Wait for all in-flight requests to complete
    await Promise.all(Array.from(inFlightRequests));

    clearInterval(progressInterval);

    const totalDurationMs = Date.now() - startTime;
    console.log(`\n✓ All requests completed in ${(totalDurationMs / 1000).toFixed(1)}s\n`);

    return { results, durationMs: totalDurationMs };
}


async function runBatchTraffic(
    requests: ApiRequest[],
    logger: any,
    config: import('./config/test-config').TestConfig
): Promise<{ results: import('./utils/test-runner').TestResult[], durationMs: number }> {
    const startTime = Date.now();
    const allResults: import('./utils/test-runner').TestResult[] = [];
    const batchCount = Math.ceil(requests.length / config.batchSize);

    for (let batchIndex = 0; batchIndex < batchCount; batchIndex++) {
        const batchStart = batchIndex * config.batchSize;
        const batchEnd = Math.min(batchStart + config.batchSize, requests.length);
        const batchRequests = requests.slice(batchStart, batchEnd);

        console.log(`Batch ${batchIndex + 1}/${batchCount}: Processing ${batchRequests.length} requests...`);

        // Process batch with concurrency control
        const batchResults = await processWithConcurrency(
            batchRequests,
            async (request) => await makeRequestWithRetry(request, logger, config),
            config.concurrentRequests,
            (completed, total, currentResults) => {
                const currentStats = calculateStatistics(allResults.concat(currentResults), Date.now() - startTime);
                displayProgress(allResults.length + completed, requests.length, currentStats);
            }
        );

        allResults.push(...batchResults);

        // Display batch summary
        const batchSuccess = batchResults.filter(r => r.success).length;
        console.log(`\n  ✓ Batch complete: ${batchSuccess}/${batchResults.length} successful\n`);

        // Delay before next batch (except for last batch)
        if (batchIndex < batchCount - 1) {
            await sleep(config.batchDelayMs);
        }
    }

    const totalDurationMs = Date.now() - startTime;
    return { results: allResults, durationMs: totalDurationMs };
}

// ============================================================================
// RUN TEST
// ============================================================================

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n⚠️  Test interrupted by user\n');
    process.exit(130);
});

process.on('SIGTERM', () => {
    console.log('\n\n⚠️  Test terminated\n');
    process.exit(143);
});

// Run the test
testLargeScaleApi().catch(error => {
    console.error('❌ Test error:', error);
    process.exit(1);
});
