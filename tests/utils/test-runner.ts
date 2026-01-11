/**
 * Shared Test Runner
 * Common test execution logic used by all API tests
 */

import * as fs from 'fs';
import * as path from 'path';
import { TestLogger } from '../../src/utils/test-logger';
import { TestConfig } from '../config/test-config';

// ============================================================================
// TYPES
// ============================================================================

export interface ApiRequest {
    id: string;
    prompt: string;
    country?: string;
    include?: {
        markdown?: boolean;
        html?: boolean;
    };
}

export interface ApiResponse {
    success: boolean;
    result?: {
        text: string;
        sources: any[];
        model: string;
        shoppingCards?: any[];
        entities?: any[];
        searchQueries?: string[];
        markdown?: string;
        html?: string;
    };
    error?: any;
    details?: any[];
}

export interface TestResult {
    requestId: string;
    prompt: string;
    success: boolean;
    durationMs: number;
    attempts: number;
    response: any;
}

export interface Statistics {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    retriedRequests: number;
    successRate: number;
    avgDurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
    p50DurationMs: number;
    p95DurationMs: number;
    p99DurationMs: number;
    totalDurationSec: number;
    throughputReqPerSec: number;
}

// ============================================================================
// PROMPT POOL
// ============================================================================

const PROMPT_POOL = [
    // Very short answers (5-20 chars)
    "What is 2+2?",
    "What color is the sky?",
    "How many days in a week?",
    "What is H2O?",
    "Spell 'cat'.",
    "What is 10-3?",
    "Name a color.",
    "What is ice made of?",
    "How many eyes do humans have?",
    "What comes after Monday?",

    // Short answers (20-50 chars)
    "What is the capital of France?",
    "Who wrote Hamlet?",
    "Name a planet in our solar system.",
    "What year did WWII end?",
    "What is the largest mammal?",
    "Name the first U.S. president.",
    "What is the chemical symbol for gold?",
    "How many continents are there?",
    "What is the speed of light?",
    "Who invented the telephone?",
    "What is the tallest mountain?",
    "Name a programming language.",
    "What is the capital of Japan?",
    "Who painted the Mona Lisa?",
    "What is the smallest prime number?",

    // Medium answers (50-100 chars)
    "What is photosynthesis?",
    "Explain gravity in one sentence.",
    "What causes seasons on Earth?",
    "What is the difference between a virus and bacteria?",
    "Why is the ocean salty?",
    "What is democracy?",
    "How do airplanes fly?",
    "What is DNA?",
    "What is the greenhouse effect?",
    "How does a microwave work?",
    "What is the internet?",
    "What is renewable energy?",
    "How does GPS work?",
    "What is machine learning?",
    "What causes earthquakes?",

    // Longer answers (100-200 chars)
    "What is the water cycle?",
    "Explain how a rainbow forms.",
    "What is climate change?",
    "Describe the process of photosynthesis.",
    "What is artificial intelligence?",
    "How does the human heart work?",
    "What is quantum mechanics?",
    "Explain the Big Bang theory.",
    "What is blockchain technology?",
    "How does a computer processor work?",
    "What is the theory of evolution?",
    "How do vaccines work?",
    "What is cryptocurrency?",
    "Explain cloud computing.",
    "What is nuclear energy?",

    // Technical questions
    "What is REST API?",
    "Explain JavaScript closures.",
    "What is Docker?",
    "What is Kubernetes?",
    "Explain database indexing.",
    "What is Git?",
    "What is TypeScript?",
    "Explain HTTP vs HTTPS.",
    "What is a neural network?",
    "What is recursion?",

    // Science questions
    "What is Newton's first law?",
    "Explain the periodic table.",
    "What is an atom?",
    "What causes lightning?",
    "What is magnetism?",
    "How do plants make oxygen?",
    "What is the solar system?",
    "What causes tides?",
    "What is electricity?",
    "How do batteries work?",

    // General knowledge
    "What is the United Nations?",
    "Who discovered America?",
    "What is the Roman Empire?",
    "When was the internet invented?",
    "What is the Industrial Revolution?",
    "Who was Albert Einstein?",
    "What is the Renaissance?",
    "When did the dinosaurs go extinct?",
    "What is the Great Wall of China?",
    "Who wrote 1984?",
];

// ============================================================================
// UTILITIES
// ============================================================================

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function generatePrompts(count: number): string[] {
    const prompts: string[] = [];
    for (let i = 0; i < count; i++) {
        prompts.push(PROMPT_POOL[i % PROMPT_POOL.length]);
    }
    return prompts;
}

export function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
}

export function formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
}

// ============================================================================
// API FUNCTIONS
// ============================================================================

export async function makeRequest(
    request: ApiRequest,
    config: TestConfig
): Promise<{ response: ApiResponse; duration: number; httpStatus: number }> {
    const startTime = Date.now();

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), config.requestTimeoutMs);

        const response = await fetch(`${config.apiUrl}${config.endpoint}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer test-api-key',
            },
            body: JSON.stringify({
                prompt: request.prompt,
                country: request.country || 'US',
                include: request.include || { markdown: false }
            }),
            signal: controller.signal
        });

        clearTimeout(timeoutId);
        const data = await response.json();
        const duration = Date.now() - startTime;

        return { response: data, duration, httpStatus: response.status };
    } catch (error) {
        const duration = Date.now() - startTime;
        return {
            response: {
                success: false,
                error: error instanceof Error ? error.message : String(error)
            },
            duration,
            httpStatus: 0
        };
    }
}

export async function makeRequestWithRetry(
    request: ApiRequest,
    logger: TestLogger,
    config: TestConfig
): Promise<TestResult> {
    // Log the request
    logger.logRequest(
        request.id,
        'POST',
        `${config.apiUrl}${config.endpoint}`,
        {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer test-api-key'
        },
        {
            prompt: request.prompt,
            country: request.country || 'US',
            include: request.include
        }
    );

    // Make the request
    const { response, duration, httpStatus } = await makeRequest(request, config);
    const isSuccess = !!(response.success && response.result);

    // Log the response
    logger.logResponse(
        request.id,
        httpStatus,
        duration,
        response
    );

    // Return the result
    return {
        requestId: request.id,
        prompt: request.prompt,
        success: isSuccess,
        durationMs: duration,
        attempts: 1,
        response
    };
}

export async function checkHealth(apiUrl: string): Promise<boolean> {
    try {
        const response = await fetch(`${apiUrl}/health`, {
            signal: AbortSignal.timeout(5000)
        });
        const data = await response.json();
        return data.status === 'healthy';
    } catch (error) {
        return false;
    }
}

// ============================================================================
// CONCURRENCY CONTROL
// ============================================================================

export async function processWithConcurrency<T, R>(
    items: T[],
    processor: (item: T, index: number) => Promise<R>,
    concurrency: number,
    onProgress?: (completed: number, total: number, currentResults: R[]) => void
): Promise<R[]> {
    const results: R[] = [];
    const completedResults: R[] = [];
    let index = 0;
    let completed = 0;

    async function worker(): Promise<void> {
        while (index < items.length) {
            const currentIndex = index++;
            const item = items[currentIndex];
            const result = await processor(item, currentIndex);
            results[currentIndex] = result;
            completedResults.push(result);
            completed++;
            if (onProgress) {
                onProgress(completed, items.length, completedResults.slice());
            }
        }
    }

    // Start workers
    const workers = Array(Math.min(concurrency, items.length))
        .fill(0)
        .map(() => worker());

    await Promise.all(workers);
    return results;
}

// ============================================================================
// STATISTICS
// ============================================================================

export function calculateStatistics(results: TestResult[], totalDurationMs: number): Statistics {
    const successResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);
    const retriedResults = results.filter(r => r.attempts > 1);

    const durations = results.map(r => r.durationMs);

    return {
        totalRequests: results.length,
        successfulRequests: successResults.length,
        failedRequests: failedResults.length,
        retriedRequests: retriedResults.length,
        successRate: results.length > 0 ? successResults.length / results.length : 0,
        avgDurationMs: durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0,
        minDurationMs: durations.length > 0 ? Math.min(...durations) : 0,
        maxDurationMs: durations.length > 0 ? Math.max(...durations) : 0,
        p50DurationMs: percentile(durations, 50),
        p95DurationMs: percentile(durations, 95),
        p99DurationMs: percentile(durations, 99),
        totalDurationSec: totalDurationMs / 1000,
        throughputReqPerSec: totalDurationMs > 0 ? (results.length / (totalDurationMs / 1000)) : 0
    };
}

export function displayProgress(completed: number, total: number, stats: Partial<Statistics>): void {
    const percentage = ((completed / total) * 100).toFixed(1);
    const successRate = stats.successRate !== undefined ? (stats.successRate * 100).toFixed(1) : '0.0';

    process.stdout.write(`\r  Progress: ${completed}/${total} (${percentage}%) | Success Rate: ${successRate}% | Avg: ${Math.round(stats.avgDurationMs || 0)}ms`);
}

export function displayStatistics(stats: Statistics, config: TestConfig): void {
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('  Final Statistics');
    console.log('═══════════════════════════════════════════════════════════\n');

    console.log('Request Summary:');
    console.log(`  Total Requests:     ${stats.totalRequests}`);
    console.log(`  Successful:         ${stats.successfulRequests} (${(stats.successRate * 100).toFixed(2)}%)`);
    console.log(`  Failed:             ${stats.failedRequests} (${((stats.failedRequests / stats.totalRequests) * 100).toFixed(2)}%)`);
    console.log(`  Retried:            ${stats.retriedRequests}`);

    console.log('\nPerformance:');
    console.log(`  Total Duration:     ${formatDuration(stats.totalDurationSec * 1000)}`);
    console.log(`  Throughput:         ${stats.throughputReqPerSec.toFixed(2)} req/sec`);

    console.log('\nLatency Distribution:');
    console.log(`  Min:                ${Math.round(stats.minDurationMs)}ms`);
    console.log(`  Avg:                ${Math.round(stats.avgDurationMs)}ms`);
    console.log(`  P50 (Median):       ${Math.round(stats.p50DurationMs)}ms`);
    console.log(`  P95:                ${Math.round(stats.p95DurationMs)}ms`);
    console.log(`  P99:                ${Math.round(stats.p99DurationMs)}ms`);
    console.log(`  Max:                ${Math.round(stats.maxDurationMs)}ms`);

    console.log('');

    // Success criteria check
    const meetsSuccessRate = stats.successRate >= config.targetSuccessRate;
    const meetsMinimumCount = !config.minimumSuccessfulRequests ||
        stats.successfulRequests >= config.minimumSuccessfulRequests;

    if (meetsSuccessRate && meetsMinimumCount) {
        console.log(`✅ SUCCESS: Test passed! (${stats.successfulRequests} successful requests, ${(stats.successRate * 100).toFixed(2)}% success rate)`);
    } else {
        if (!meetsSuccessRate) {
            console.log(`❌ FAIL: Success rate below ${(config.targetSuccessRate * 100)}% (${(stats.successRate * 100).toFixed(2)}%)`);
        }
        if (!meetsMinimumCount) {
            console.log(`❌ FAIL: Less than ${config.minimumSuccessfulRequests} successful requests (${stats.successfulRequests})`);
        }
    }
    console.log('');
}

export function saveResults(
    results: TestResult[],
    stats: Statistics,
    config: TestConfig,
    outputFile: string
): void {
    const outputData = {
        timestamp: new Date().toISOString(),
        configuration: {
            apiUrl: config.apiUrl,
            endpoint: config.endpoint,
            totalRequests: config.totalRequests,
            concurrentRequests: config.concurrentRequests,
            batchSize: config.batchSize,
            batchDelayMs: config.batchDelayMs,
            maxRetries: config.maxRetries,
            targetSuccessRate: config.targetSuccessRate,
            minimumSuccessfulRequests: config.minimumSuccessfulRequests
        },
        statistics: stats,
        results: results.map(result => ({
            requestId: result.requestId,
            prompt: result.prompt,
            success: result.success,
            durationMs: result.durationMs,
            attempts: result.attempts,
            responseText: result.success && result.response?.result?.text
                ? result.response.result.text.substring(0, 200)
                : null,
            error: !result.success ? result.response?.error || null : null
        }))
    };

    fs.writeFileSync(outputFile, JSON.stringify(outputData, null, 2));
    console.log(`📄 Results written to: ${outputFile}`);
}
