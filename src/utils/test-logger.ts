/**
 * Test Logger Utility
 * Logs all API requests and responses to a JSON file during testing
 */

import * as fs from 'fs';
import * as path from 'path';

export interface LoggedRequest {
    timestamp: string;
    requestId: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    body: {
        prompt: string;
        country?: string;
        include?: {
            markdown?: boolean;
            html?: boolean;
        };
    };
}

export interface LoggedResponse {
    timestamp: string;
    requestId: string;
    statusCode: number;
    durationMs: number;
    response: any;
}

export interface TestSession {
    startTime: string;
    endTime?: string;
    totalRequests: number;
    successCount: number;
    failureCount: number;
    requests: LoggedRequest[];
    responses: LoggedResponse[];
}

export class TestLogger {
    private session: TestSession;
    private outputPath: string;

    constructor(outputPath: string) {
        this.outputPath = outputPath;
        this.session = {
            startTime: new Date().toISOString(),
            totalRequests: 0,
            successCount: 0,
            failureCount: 0,
            requests: [],
            responses: []
        };
    }

    /**
     * Log a request being sent
     */
    logRequest(
        requestId: string,
        method: string,
        url: string,
        headers: Record<string, string>,
        body: { prompt: string; country?: string; include?: { markdown?: boolean; html?: boolean } }
    ): void {
        this.session.requests.push({
            timestamp: new Date().toISOString(),
            requestId,
            method,
            url,
            headers,
            body
        });
        this.session.totalRequests++;
    }

    /**
     * Log a response received
     */
    logResponse(
        requestId: string,
        statusCode: number,
        durationMs: number,
        response: any
    ): void {
        this.session.responses.push({
            timestamp: new Date().toISOString(),
            requestId,
            statusCode,
            durationMs,
            response
        });

        // Determine success
        const isSuccess = response && typeof response === 'object' && response.success === true;
        if (isSuccess) {
            this.session.successCount++;
            this.logResponseFormat(requestId, response);
        } else {
            this.session.failureCount++;
        }
    }

    /**
     * Log response format details
     */
    private logResponseFormat(requestId: string, response: any): void {
        if (!response.result) return;

        const result = response.result;
        const formatInfo = {
            requestId,
            hasRawResponse: Array.isArray(result.rawResponse),
            rawResponseEvents: Array.isArray(result.rawResponse) ? result.rawResponse.length : 0,
            rawResponseTypes: Array.isArray(result.rawResponse)
                ? result.rawResponse.map((e: any) => e.type).join(', ')
                : 'N/A',
            hasMarkdown: typeof result.markdown === 'string',
            markdownLength: typeof result.markdown === 'string' ? result.markdown.length : 0,
            hasText: typeof result.text === 'string',
            textLength: typeof result.text === 'string' ? result.text.length : 0,
            sourcesCount: Array.isArray(result.sources) ? result.sources.length : 0,
            searchQueriesCount: Array.isArray(result.searchQueries) ? result.searchQueries.length : 0,
            hasModel: typeof result.model === 'string',
            formatCompliance: {
                rawResponseValid: Array.isArray(result.rawResponse),
                markdownPresent: typeof result.markdown === 'string' && result.markdown.length > 0,
                sourcesArray: Array.isArray(result.sources),
                searchQueriesArray: Array.isArray(result.searchQueries) || result.searchQueries === undefined
            }
        };

        console.log(`\n[Response Format - ${requestId}]`);
        console.log(`  ✓ rawResponse: ${formatInfo.hasRawResponse ? `${formatInfo.rawResponseEvents} events (${formatInfo.rawResponseTypes})` : 'MISSING'}`);
        console.log(`  ✓ markdown: ${formatInfo.hasMarkdown ? `${formatInfo.markdownLength} chars` : 'MISSING'}`);
        console.log(`  ✓ text: ${formatInfo.hasText ? `${formatInfo.textLength} chars` : 'MISSING'}`);
        console.log(`  ✓ sources: ${formatInfo.sourcesCount} items`);
        console.log(`  ✓ searchQueries: ${formatInfo.searchQueriesCount} items`);
        console.log(`  ✓ model: ${formatInfo.hasModel ? result.model : 'MISSING'}`);

        const allValid = Object.values(formatInfo.formatCompliance).every(v => v === true);
        console.log(`  Format Compliance: ${allValid ? '✓ PASS' : '✗ FAIL'}`);
    }

    /**
     * Save the session log to file
     */
    save(): void {
        this.session.endTime = new Date().toISOString();

        const dirPath = path.dirname(this.outputPath);
        if (!fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        fs.writeFileSync(
            this.outputPath,
            JSON.stringify(this.session, null, 2),
            'utf-8'
        );
    }

    /**
     * Get session statistics
     */
    getStats() {
        const totalDuration = this.session.responses.reduce((sum, r) => sum + r.durationMs, 0);
        const avgDuration = this.session.responses.length > 0
            ? Math.round(totalDuration / this.session.responses.length)
            : 0;

        return {
            totalRequests: this.session.totalRequests,
            successCount: this.session.successCount,
            failureCount: this.session.failureCount,
            successRate: this.session.totalRequests > 0
                ? Math.round((this.session.successCount / this.session.totalRequests) * 100)
                : 0,
            avgDurationMs: avgDuration
        };
    }
}
