/**
 * Request Queue Manager
 * Enhanced FIFO queue with retry logic and state tracking
 * Handles request lifecycle: pending -> processing -> completed/failed
 */

import { GrokRequest, RequestState, RetryInfo } from '../config/types';
import { CONFIG } from '../config/config';

export interface QueuedRequest {
    id: string;
    request: GrokRequest;
    timestamp: number;
    state: RequestState;
    retryInfo: RetryInfo;
    resolve?: (value: any) => void;
    reject?: (error: any) => void;
}

export class RequestQueue {
    private queue: QueuedRequest[] = [];
    private processingRequests: Map<string, QueuedRequest> = new Map();
    private completedRequests: Map<string, QueuedRequest> = new Map();
    private requestCounter: number = 0;
    private readonly maxRetries: number = CONFIG.maxRetries;
    private readonly maxCompletedSize: number = CONFIG.maxCompletedRequests;

    /**
     * Add a request to the queue
     */
    enqueue(request: GrokRequest): QueuedRequest {
        const queuedRequest: QueuedRequest = {
            id: `req_${++this.requestCounter}`,
            request,
            timestamp: Date.now(),
            state: RequestState.PENDING,
            retryInfo: {
                attemptCount: 0,
                maxAttempts: this.maxRetries,
                failedBrowserIds: [],
            },
        };

        this.queue.push(queuedRequest);
        return queuedRequest;
    }

    /**
     * Get next request from the queue (FIFO)
     * Marks request as PROCESSING
     */
    dequeue(): QueuedRequest | null {
        const queuedRequest = this.queue.shift() || null;
        if (queuedRequest) {
            queuedRequest.state = RequestState.PROCESSING;
            queuedRequest.retryInfo.attemptCount++;
            this.processingRequests.set(queuedRequest.id, queuedRequest);
        }
        return queuedRequest;
    }

    /**
     * Mark a request as completed successfully
     */
    markCompleted(requestId: string): void {
        const request = this.processingRequests.get(requestId);
        if (request) {
            request.state = RequestState.COMPLETED;
            this.processingRequests.delete(requestId);
            this.completedRequests.set(requestId, request);

            // Cleanup old completed requests to prevent memory leak
            if (this.completedRequests.size > this.maxCompletedSize) {
                const oldest = Array.from(this.completedRequests.keys())[0];
                this.completedRequests.delete(oldest);
                console.log(`  [Queue] 🧹 Cleaned up old completed request ${oldest} (size: ${this.completedRequests.size})`);
            }
        }
    }

    /**
     * Mark a request as failed and handle retry logic
     * Returns true if request should be retried, false if permanently failed
     */
    markFailed(requestId: string, errorMessage: string, errorCode?: string, browserId?: number): boolean {
        const request = this.processingRequests.get(requestId);
        if (!request) {
            console.log(`  [Queue] ⚠️ Cannot mark ${requestId} as failed - not found in processing requests`);
            return false;
        }

        request.retryInfo.lastError = errorMessage;
        request.retryInfo.lastErrorCode = errorCode;

        // Track which browser failed
        if (browserId !== undefined) {
            if (!request.retryInfo.failedBrowserIds) {
                request.retryInfo.failedBrowserIds = [];
            }
            if (!request.retryInfo.failedBrowserIds.includes(browserId)) {
                request.retryInfo.failedBrowserIds.push(browserId);
            }
        }

        // Check if we should retry
        if (request.retryInfo.attemptCount < request.retryInfo.maxAttempts) {
            // Re-add to queue for retry
            request.state = RequestState.RETRY_PENDING;
            this.queue.push(request); // Add to back - maintain FIFO
            this.processingRequests.delete(requestId);
            console.log(`  [Queue] 🔄 Request ${requestId} re-queued for retry (attempt ${request.retryInfo.attemptCount}/${request.retryInfo.maxAttempts}) - Error: ${errorCode || 'UNKNOWN'}`);
            return true;
        } else {
            // Permanently failed
            request.state = RequestState.FAILED;
            this.processingRequests.delete(requestId);
            this.completedRequests.set(requestId, request);
            console.log(`  [Queue] ❌ Request ${requestId} permanently failed after ${request.retryInfo.attemptCount} attempts - Error: ${errorCode || 'UNKNOWN'}`);

            // Cleanup old completed requests to prevent memory leak
            if (this.completedRequests.size > this.maxCompletedSize) {
                const oldest = Array.from(this.completedRequests.keys())[0];
                this.completedRequests.delete(oldest);
                console.log(`  [Queue] 🧹 Cleaned up old failed request ${oldest} (size: ${this.completedRequests.size})`);
            }

            return false;
        }
    }

    /**
     * Check if queue is empty
     */
    isEmpty(): boolean {
        return this.queue.length === 0;
    }

    /**
     * Get current queue size
     */
    size(): number {
        return this.queue.length;
    }

    /**
     * Peek at the next request without removing it
     */
    peek(): QueuedRequest | null {
        return this.queue[0] || null;
    }

    /**
     * Get statistics about queue state
     */
    getStats(): {
        pending: number;
        processing: number;
        completed: number;
        failed: number;
    } {
        const failedCount = Array.from(this.completedRequests.values()).filter(
            r => r.state === RequestState.FAILED
        ).length;
        const completedCount = Array.from(this.completedRequests.values()).filter(
            r => r.state === RequestState.COMPLETED
        ).length;

        return {
            pending: this.queue.length,
            processing: this.processingRequests.size,
            completed: completedCount,
            failed: failedCount,
        };
    }

    /**
     * Clear all requests from the queue
     */
    clear(): void {
        this.queue = [];
        this.processingRequests.clear();
        this.completedRequests.clear();
    }
}
