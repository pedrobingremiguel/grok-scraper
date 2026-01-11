/**
 * Grok Scraper API Service (Unauthenticated version)
 * Implements cloro.dev compatible API for Grok scraping with browser pooling
 */

import express, { Request, Response } from 'express';
import { BrowserPool } from '../core/browser-pool';
import { RequestQueue, QueuedRequest } from '../queue/request-queue';
import { scrapeGrok, classifyError } from '../core/grok-scraper';
import { GrokRequest, GrokResponse, GrokErrorResponse } from '../config/types';
import { validateRequest as validateGrokRequest } from '../handlers/request-handler';
import {
    createRateLimitError,
    createInternalServerError
} from '../handlers/error-handler';
import { CONFIG, getBackpressureThreshold } from '../config/config';

// Global instances
let browserPool: BrowserPool | null = null;
const requestQueue = new RequestQueue();
let queueProcessorRunning = false;
let healthMonitorInterval: NodeJS.Timeout | null = null;

// Track active requests
let activeRequests = 0;

/**
 * Worker loop for processing requests concurrently
 * Each worker continuously processes requests from the queue
 */
async function workerLoop(workerId: number): Promise<void> {
    console.log(`[Worker ${workerId}] Started`);

    while (queueProcessorRunning) {
        try {
            const queuedRequest = requestQueue.dequeue();

            if (!queuedRequest) {
                // No requests available, wait briefly before checking again
                await new Promise(resolve => setTimeout(resolve, 100));
                continue;
            }

            console.log(`[Worker ${workerId}] Processing request ${queuedRequest.id}`);
            await processRequest(queuedRequest);

        } catch (error) {
            console.error(`[Worker ${workerId}] Error:`, error);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    console.log(`[Worker ${workerId}] Stopped`);
}

/**
 * Background queue processor - spawns concurrent workers
 * One worker per browser in the pool
 */
async function processQueueInBackground(): Promise<void> {
    queueProcessorRunning = true;

    console.log(`[Queue Processor] Starting ${CONFIG.browserPoolSize} concurrent workers...`);

    // Spawn one worker per browser for concurrent processing
    const workers: Promise<void>[] = [];
    for (let i = 0; i < CONFIG.browserPoolSize; i++) {
        workers.push(workerLoop(i + 1));
    }

    // Wait for all workers to complete (when queueProcessorRunning becomes false)
    await Promise.all(workers);

    console.log('[Queue Processor] All workers stopped');
}

/**
 * Process a single request through the browser pool
 * Includes retry logic and browser reset on recoverable errors
 */
async function processRequest(queuedRequest: QueuedRequest): Promise<GrokResponse | GrokErrorResponse> {
    activeRequests++;
    let browserReleased = false;

    try {
        // Acquire a browser from the pool, avoiding browsers that have already failed this request
        const browser = await browserPool!.acquire(queuedRequest.retryInfo.failedBrowserIds);

        try {
            // Reset browser to clean state before processing (prevent contamination)
            console.log(`  [Request ${queuedRequest.id}] Resetting browser ${browser.id} to clean state...`);
            await browserPool!.resetBrowser(browser);

            // Process the request
            const response = await scrapeGrok(browser.page, queuedRequest.request, browser.id);

            // Success responses have 'success: true' and 'result', errors have 'success: false' or 'error'
            const isError = !('success' in response && response.success === true);

            if (isError) {
                const errorResponse = response as GrokErrorResponse;
                const classification = classifyError(errorResponse);

                if (classification.shouldRetry) {
                    // Mark as failed and re-queue if retries available
                    const shouldRetry = requestQueue.markFailed(
                        queuedRequest.id,
                        'error' in response && typeof response.error === 'object' ?
                            (response.error as any).message : 'Unknown error',
                        classification.errorCode,
                        browser.id
                    );

                    if (shouldRetry) {
                        // Reset browser if needed for next retry
                        if (classification.shouldResetBrowser) {
                            await browserPool!.resetBrowser(browser);
                        }
                        activeRequests--;
                        return response;
                    }

                    // Max retries exceeded
                    if (queuedRequest.resolve) {
                        queuedRequest.resolve(response);
                    }
                    activeRequests--;
                    return response;
                } else {
                    // Non-recoverable error - resolve with error
                    requestQueue.markCompleted(queuedRequest.id); // Mark as complete even if error (non-retryable)
                    if (queuedRequest.resolve) {
                        queuedRequest.resolve(response);
                    }
                    activeRequests--;
                    return response;
                }
            } else {
                // Success - resolve with success response
                requestQueue.markCompleted(queuedRequest.id);
                if (queuedRequest.resolve) {
                    queuedRequest.resolve(response);
                }
                activeRequests--;
                return response;
            }
        } finally {
            // Release browser if not already released
            if (!browserReleased) {
                browserPool!.release(browser);
            }
        }
    } catch (error) {
        console.error('Error processing request:', error);

        // Mark as failed for retry
        const shouldRetry = requestQueue.markFailed(
            queuedRequest.id,
            error instanceof Error ? error.message : 'Unknown error'
        );

        const errorResponse = createInternalServerError();

        if (!shouldRetry) {
            // Max retries exceeded
            if (queuedRequest.resolve) {
                // Max retries exceeded - resolve with error
                queuedRequest.resolve(errorResponse);
            }
        }

        activeRequests--;
        return errorResponse;
    }
}

/**
 * Initialize the API service
 */
async function initializeService() {
    console.log('🚀 Initializing Grok Scraper API Service (Guest Mode)...\n');

    const backpressureThreshold = getBackpressureThreshold(CONFIG);

    console.log(`Configuration:`);
    console.log(`  - Port: ${CONFIG.port}`);
    console.log(`  - Browser Pool Size: ${CONFIG.browserPoolSize}`);
    console.log(`  - Max Retries: ${CONFIG.maxRetries === 1000 ? 'Unlimited (1000 attempts)' : CONFIG.maxRetries}`);
    console.log(`  - Request Timeout: ${CONFIG.requestTimeout}ms`);
    console.log(`  - Backpressure Threshold: ${backpressureThreshold === Infinity ? 'Disabled' : `${backpressureThreshold} queued requests`}`);
    console.log(`  - Browser Health Monitoring: ${CONFIG.enableBrowserHealthMonitoring ? 'Enabled' : 'Disabled'}`);
    console.log(`  - Graceful Shutdown: ${CONFIG.enableGracefulShutdown ? 'Enabled' : 'Disabled'}`);
    console.log(`  - Mode: GUEST (Unauthenticated)\n`);

    // Initialize browser pool
    console.log('Initializing browser pool...');
    browserPool = new BrowserPool(CONFIG.browserPoolSize);
    await browserPool.initialize();
    console.log('✓ Browser pool ready\n');

    // Start browser health monitoring if enabled
    if (CONFIG.enableBrowserHealthMonitoring && browserPool) {
        console.log('Starting browser health monitoring...');
        healthMonitorInterval = browserPool.startHealthMonitoring();
        console.log('✓ Health monitoring started\n');
    }

    // Start background queue processor
    console.log('Starting background queue processor...');
    processQueueInBackground().catch(error => {
        console.error('Queue processor crashed:', error);
    });
    console.log('✓ Queue processor started\n');
}

/**
 * Cleanup on shutdown
 */
async function cleanup() {
    if (!CONFIG.enableGracefulShutdown) {
        console.log('\n🧹 Shutting down immediately...');
        if (browserPool) {
            await browserPool.cleanup();
        }
        process.exit(0);
        return;
    }

    console.log('\n🧹 Shutting down gracefully...');

    // Stop queue processor
    queueProcessorRunning = false;
    console.log('✓ Queue processor stopped');

    // Stop health monitoring
    if (healthMonitorInterval) {
        clearInterval(healthMonitorInterval);
        console.log('✓ Health monitoring stopped');
    }

    // Wait for active requests to complete (with timeout)
    const maxWaitTime = 30000; // 30 seconds max
    const startWait = Date.now();

    if (activeRequests > 0) {
        console.log(`⏳ Waiting for ${activeRequests} active requests to complete...`);

        while (activeRequests > 0 && Date.now() - startWait < maxWaitTime) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            if (activeRequests > 0) {
                console.log(`   Still waiting... ${activeRequests} requests remaining`);
            }
        }

        if (activeRequests > 0) {
            console.log(`⚠️  Force shutting down with ${activeRequests} requests still active`);
        } else {
            console.log('✓ All active requests completed');
        }
    }

    // Cleanup browser pool
    if (browserPool) {
        console.log('Cleaning up browser pool...');
        await browserPool.cleanup();
        console.log('✓ Browser pool cleaned up');
    }

    console.log('✓ Shutdown complete');
    process.exit(0);
}

/**
 * Main application
 */
async function main() {
    const app = express();

    // Middleware
    app.use(express.json());

    // Log all requests
    app.use((req: Request, res: Response, next) => {
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
        next();
    });

    // Authentication middleware for monitor endpoints
    app.use((req: Request, res: Response, next) => {
        if (req.path.startsWith('/v1/monitor/')) {
            const authHeader = req.headers.authorization;

            if (!authHeader || !authHeader.startsWith('Bearer ')) {
                return res.status(401).json({
                    error: {
                        code: 'MISSING_API_KEY',
                        message: 'Authorization header with Bearer token is required',
                        timestamp: new Date().toISOString()
                    }
                });
            }

            // accept any bearer token in MVP, this enforces cloro.dev request format while allowing unauthenticated access
        }
        next();
    });

    // Health check endpoint
    app.get('/health', (req: Request, res: Response) => {
        const stats = browserPool?.getStats() || { total: 0, available: 0, busy: 0 };
        const queueStats = requestQueue.getStats();

        res.json({
            status: 'healthy',
            mode: 'guest',
            timestamp: new Date().toISOString(),
            browserPool: stats,
            queue: queueStats,
            requests: {
                active: activeRequests,
                totalProcessed: queueStats.completed,
                totalFailed: queueStats.failed,
                totalAttempts: queueStats.completed + queueStats.failed
            }
        });
    });

    // Main scraping endpoint
    app.post('/v1/monitor/grok', async (req: Request, res: Response) => {
        try {
            // Check system health
            const browserStats = browserPool?.getStats() || { available: 0, busy: 0, total: 0 };
            const queueStats = requestQueue.getStats();
            const backpressureThreshold = getBackpressureThreshold(CONFIG);

            // If queue at or above threshold, reject with 503
            if (queueStats.pending >= backpressureThreshold) {
                console.log(`[API] Backpressure triggered - ${queueStats.pending} requests queued (threshold: ${backpressureThreshold})`);
                return res.status(503).json({
                    success: false,
                    error: 'Service temporarily unavailable - request queue full. Please retry later.',
                    details: {
                        queueDepth: queueStats.pending,
                        threshold: backpressureThreshold,
                        busyBrowsers: browserStats.busy
                    }
                });
            }

            // Validate request using request-handler
            const validation = validateGrokRequest(req.body);
            if (!validation.valid) {
                return res.status(400).json(validation.error);
            }

            // Create normalized request
            const grokRequest: GrokRequest = {
                prompt: req.body.prompt,
                country: req.body.country || 'US',
                include: {
                    markdown: req.body.include?.markdown || false,
                    html: req.body.include?.html || false
                }
            };

            console.log(`[API] New request received: "${grokRequest.prompt.substring(0, 50)}..."`);

            // Enqueue the request (with retry tracking) and create a promise to track its completion
            const queuedRequest = requestQueue.enqueue(grokRequest);

            // Create a promise that will resolve when this request is processed
            const resultPromise = new Promise<GrokResponse | GrokErrorResponse>((resolve, reject) => {
                queuedRequest.resolve = resolve;
                queuedRequest.reject = reject;
            });

            // Wait for the background processor to handle it (or timeout)
            let timedOut = false;
            let timeoutId: NodeJS.Timeout;
            const timeoutPromise = new Promise<GrokErrorResponse>((resolve) => {
                timeoutId = setTimeout(() => {
                    timedOut = true;
                    resolve(createInternalServerError());
                }, CONFIG.requestTimeout);
            });

            const response = await Promise.race([resultPromise, timeoutPromise]);

            // Clear the timeout immediately to prevent race conditions
            clearTimeout(timeoutId!);

            // Check if timeout occurred and cleanup if necessary
            if (timedOut) {
                console.log(`[API] Request ${queuedRequest.id} timed out after ${CONFIG.requestTimeout}ms - cleaning up`);
                // Mark request as failed to clean it up from processing map
                requestQueue.markFailed(queuedRequest.id, `Request timeout - exceeded ${CONFIG.requestTimeout}ms`, 'TIMEOUT');
            }

            // Send appropriate status code
            if ('success' in response && response.success === false) {
                // Error response
                if ('details' in response) {
                    return res.status(400).json(response); // Validation error
                } else if ('error' in response && typeof response.error === 'object') {
                    const errorCode = (response.error as any).code;

                    if (errorCode === 'CONCURRENT_LIMIT_EXCEEDED') {
                        return res.status(429).json(response);
                    } else if (errorCode === 'EXTRACTION_FAILED') {
                        return res.status(502).json(response);
                    }
                }
                return res.status(500).json(response);
            }

            // Success response
            return res.status(200).json(response);

        } catch (error) {
            console.error('[API] Unexpected error:', error);
            const errorResponse = createInternalServerError();
            return res.status(500).json(errorResponse);
        }
    });

    // 404 handler
    app.use((req: Request, res: Response) => {
        res.status(404).json({
            success: false,
            error: 'Endpoint not found'
        });
    });

    // Initialize service
    await initializeService();

    // Start server
    const server = app.listen(Number(CONFIG.port), CONFIG.host, () => {
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`✅ Grok Scraper API Service running on port ${CONFIG.port} (GUEST MODE)`);
        console.log('═══════════════════════════════════════════════════════════');
        console.log(`\nEndpoints:`);
        console.log(`  - POST http://localhost:${CONFIG.port}/v1/monitor/grok`);
        console.log(`  - GET  http://localhost:${CONFIG.port}/health\n`);
        console.log(`Mode: GUEST (Unauthenticated access)`);
        console.log(`Server is listening on ${CONFIG.host}:${CONFIG.port}`);
        console.log(`Test with: curl http://localhost:${CONFIG.port}/health\n`);
    });

    // Graceful shutdown handlers
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
}

// Run the application
main().catch(error => {
    console.error('❌ Failed to start service:', error);
    process.exit(1);
});
