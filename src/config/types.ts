/**
 * Type definitions for Grok scraper
 * Based on cloro dev reference and /v1/monitor/chatgpt endpoint
*/

// ============================================================================
// REQUEST TYPES
// ============================================================================

export interface GrokRequest {
    prompt: string;
    country?: string;         // TODO: Defaulted to US string, does not impact Grok behavior in MVP
    include?: {
        markdown?: boolean;
        html?: boolean;         // TODO: Not supported in MVP
    };
}

// to implement any conversion if needed in the future
export interface NormalizedGrokRequest {
    prompt: string;
    country: string;
    model: string;
    include: {
        markdown: boolean;
        html: boolean;
    };
}

// ============================================================================
// SUCCESS RESPONSE (200)
// ============================================================================

export interface Source {
    position: number;
    url: string;
    label: string;
    description: string;
}

export interface GrokSuccessResponse {
    success: true;
    result: {
        text: string;
        sources: Source[];
        html: string;          // TODO: Not supported in MVP
        markdown: string;
        rawResponse: any[];
        searchQueries: string[];
        model: string;          // TODO: Currently is Auto in MVP
        shoppingCards: any[];   // TODO: Not supported in MVP
        entities: any[];        // TODO: Not supported in MVP
    };
}

// ============================================================================
// ERROR RESPONSE TYPES
// ============================================================================

// Format 1: Validation Error (400)
export interface ValidationErrorResponse {
    success: false;
    error: string;
    details: Array<{
        field: string;
        message: string;
    }>;
}

// Format 2: Standard Error with timestamp (401, 403, 404, 409, 429, 502)
export interface StandardErrorResponse {
    error: {
        code: string;
        message: string;
        details?: Record<string, any>;
        timestamp: string;
    };
}

// Format 3: Simple Error (499, 500)
export interface SimpleErrorResponse {
    success: false;
    error: string;
}

// Union of all error response types
export type GrokErrorResponse =
    | ValidationErrorResponse
    | StandardErrorResponse
    | SimpleErrorResponse;

// Complete response type
export type GrokResponse = GrokSuccessResponse | GrokErrorResponse;

// ============================================================================
// ERROR CODES ENUM
// ============================================================================

export enum ErrorCode {
    // Validation errors (400)
    VALIDATION_ERROR = 'VALIDATION_ERROR',

    // Authentication errors (401)
    MISSING_API_KEY = 'MISSING_API_KEY',
    INVALID_API_KEY_FORMAT = 'INVALID_API_KEY_FORMAT',
    INVALID_OR_EXPIRED_API_KEY = 'INVALID_OR_EXPIRED_API_KEY',

    // Authorization errors (403)
    INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
    INSUFFICIENT_CREDITS = 'INSUFFICIENT_CREDITS',

    // Not found errors (404)
    RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',

    // Conflict errors (409)
    RESOURCE_CONFLICT = 'RESOURCE_CONFLICT',
    RESOURCE_ALREADY_EXISTS = 'RESOURCE_ALREADY_EXISTS',

    // Rate limit errors (429)
    CONCURRENT_LIMIT_EXCEEDED = 'CONCURRENT_LIMIT_EXCEEDED',
    RATE_LIMITED = 'RATE_LIMITED',

    // Client errors (499)
    REQUEST_CANCELED = 'REQUEST_CANCELED',
    CLIENT_CLOSED_REQUEST = 'CLIENT_CLOSED_REQUEST',
    TIMEOUT = 'TIMEOUT',

    // Server errors (500)
    INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
    MAXIMUM_RETRIES_EXCEEDED = 'MAXIMUM_RETRIES_EXCEEDED',
    BROWSER_FAILURE = 'BROWSER_FAILURE',

    // External service errors (502)
    EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
    EXTRACTION_FAILED = 'EXTRACTION_FAILED',
}

// ============================================================================
// VALIDATION TYPES
// ============================================================================

export interface ValidationResult {
    valid: boolean;
    error?: GrokErrorResponse;
}

// ============================================================================
// INTERNAL TYPES
// ============================================================================

// Scraper result used internally
export interface ScraperResult {
    query: string;
    response: string;
    rawResponse?: any[];
    sources?: Source[];
    searchQueries?: string[];
}

// ============================================================================
// REQUEST STATE TRACKING
// ============================================================================

export enum RequestState {
    PENDING = 'PENDING',           // In queue, not yet processed
    PROCESSING = 'PROCESSING',     // Currently being processed
    COMPLETED = 'COMPLETED',       // Successfully completed
    FAILED = 'FAILED',             // Failed permanently (max retries)
    RETRY_PENDING = 'RETRY_PENDING' // Failed but will be retried
}

export interface RetryInfo {
    attemptCount: number;          // Number of attempts made
    maxAttempts: number;           // Maximum attempts allowed
    lastError?: string;            // Last error message
    lastErrorCode?: string;        // Last error code
    failedBrowserIds?: number[];   // Browser IDs that have failed this request
}
