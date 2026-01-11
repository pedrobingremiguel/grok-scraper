/**
 * Standard API Test
 * Quick validation test with 16 requests
 * Logs all requests and responses to api-test-log.json
 */

import * as path from 'path';
import { TestLogger } from '../src/utils/test-logger';
import { getStandardTestConfig } from './config/test-config';
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
async function testApi() {
    const config = getStandardTestConfig();

    console.log('═══════════════════════════════════════════════════════════');
    console.log('  Standard API Test');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('Configuration:');
    console.log(`  Total Requests:     ${config.totalRequests}`);
    console.log(`  Concurrent:         ${config.concurrentRequests}`);
    console.log(`  Max Retries:        ${config.maxRetries}`);
    console.log(`  Target Success:     >${(config.targetSuccessRate * 100)}%`);
    console.log(`  API URL:            ${config.apiUrl}`);
    console.log('');

    // Initialize logger
    const logger = new TestLogger(path.join(process.cwd(), 'api-test-log.json'));

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
    console.log(`📝 Sending ${config.totalRequests} requests to API...\n`);
    const prompts = generatePrompts(config.totalRequests);
    const requests: ApiRequest[] = prompts.map((prompt, index) => ({
        id: `req_${index + 1}`,
        prompt,
        country: 'US',
        include: { markdown: false }
    }));

    // Process requests
    const testStartTime = Date.now();

    const results = await processWithConcurrency(
        requests,
        async (request) => await makeRequestWithRetry(request, logger, config),
        config.concurrentRequests,
        (completed, total, currentResults) => {
            const currentStats = calculateStatistics(currentResults, Date.now() - testStartTime);
            displayProgress(completed, total, currentStats);
        }
    );

    const totalDurationMs = Date.now() - testStartTime;
    console.log('\n');

    // Calculate and display statistics
    const stats = calculateStatistics(results, totalDurationMs);
    displayStatistics(stats, config);

    // Save results
    saveResults(results, stats, config, path.join(process.cwd(), 'api-test-results.json'));

    // Save detailed logger output
    logger.save();
    console.log(`📄 Detailed log written to: ${path.join(process.cwd(), 'api-test-log.json')}\n`);

    // Exit with appropriate code
    const meetsSuccessRate = stats.successRate >= config.targetSuccessRate;
    const exitCode = meetsSuccessRate ? 0 : 1;
    console.log(meetsSuccessRate ? '✅ API test complete!\n' : '⚠️  API test completed with errors\n');
    process.exit(exitCode);
}

// Run the test
testApi().catch(error => {
    console.error('❌ Test error:', error);
    process.exit(1);
});
