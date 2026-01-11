/**
 * Error handling utilities for Grok scraper (Guest version)
 * Supports cloro.dev error response formats used in guest mode
 */

import {
    GrokErrorResponse,
    ValidationErrorResponse,
    StandardErrorResponse,
    SimpleErrorResponse,
    ErrorCode
} from '../config/types';

// ============================================================================
// ERROR FORMAT CREATORS
// ============================================================================

// Format 1: Validation Error (400)
export function createValidationError(
    field: string,
    message: string
): ValidationErrorResponse {
    return {
        success: false,
        error: 'Request validation failed',
        details: [{
            field,
            message,
        }],
    };
}

// Format 2: Standard Error with timestamp (401, 403, 404, 409, 429, 502)
export function createStandardError(
    code: ErrorCode,
    message: string,
    details?: Record<string, any>
): StandardErrorResponse {
    const error: StandardErrorResponse = {
        error: {
            code,
            message,
            timestamp: new Date().toISOString(),
        },
    };

    if (details) {
        error.error.details = details;
    }

    return error;
}

// Format 3: Simple Error (499, 500)
export function createSimpleError(message: string): SimpleErrorResponse {
    return {
        success: false,
        error: message,
    };
}

// ============================================================================
// SPECIFIC ERROR CREATORS (by HTTP status code equivalent)
// ============================================================================

// 400 - Validation Error
export function createPromptValidationError(message: string): ValidationErrorResponse {
    return createValidationError('prompt', message);
}

export function createCountryValidationError(message: string): ValidationErrorResponse {
    return createValidationError('country', message);
}

// 401 - Authentication Error
export function createMissingApiKeyError(): StandardErrorResponse {
    return createStandardError(
        ErrorCode.MISSING_API_KEY,
        'Missing or invalid API key'
    );
}

export function createInvalidApiKeyFormatError(): StandardErrorResponse {
    return createStandardError(
        ErrorCode.INVALID_API_KEY_FORMAT,
        'Invalid API key format'
    );
}

export function createExpiredApiKeyError(): StandardErrorResponse {
    return createStandardError(
        ErrorCode.INVALID_OR_EXPIRED_API_KEY,
        'Invalid or expired API key'
    );
}

// 403 - Authorization Error
export function createInsufficientPermissionsError(requiredScopes?: string[]): StandardErrorResponse {
    return createStandardError(
        ErrorCode.INSUFFICIENT_PERMISSIONS,
        'Insufficient permissions',
        requiredScopes ? { requiredScopes } : undefined
    );
}

export function createInsufficientCreditsError(): StandardErrorResponse {
    return createStandardError(
        ErrorCode.INSUFFICIENT_CREDITS,
        'Insufficient credits'
    );
}

// 404 - Not Found
export function createResourceNotFoundError(resourceId?: string): StandardErrorResponse {
    return createStandardError(
        ErrorCode.RESOURCE_NOT_FOUND,
        'Route not found',
        resourceId ? { id: resourceId } : undefined
    );
}

// 409 - Conflict
export function createResourceConflictError(): StandardErrorResponse {
    return createStandardError(
        ErrorCode.RESOURCE_CONFLICT,
        'Resource conflict'
    );
}

export function createResourceAlreadyExistsError(): StandardErrorResponse {
    return createStandardError(
        ErrorCode.RESOURCE_ALREADY_EXISTS,
        'Resource already exists'
    );
}

// 429 - Rate Limit / Concurrent Limit
export function createRateLimitError(limit: number = 10): StandardErrorResponse {
    return createStandardError(
        ErrorCode.CONCURRENT_LIMIT_EXCEEDED,
        'Concurrent limit exceeded',
        { limit }
    );
}

export function createGrokRateLimitError(): StandardErrorResponse {
    return createStandardError(
        ErrorCode.RATE_LIMITED,
        'Grok is under heavy usage right now',
        { limit: 10, service: 'Grok' }
    );
}

// 499 - Client Closed Request
export function createRequestCanceledError(): SimpleErrorResponse {
    return createSimpleError('Request was canceled');
}

export function createTimeoutError(): SimpleErrorResponse {
    return createSimpleError('Request timeout');
}

// 500 - Internal Server Error
export function createInternalServerError(): SimpleErrorResponse {
    return createSimpleError('Internal server error');
}

export function createMaxRetriesError(): SimpleErrorResponse {
    return createSimpleError('Maximum retries exceeded');
}

export function createBrowserFailureError(message?: string): SimpleErrorResponse {
    return createSimpleError(message || 'Browser failure');
}

// 502 - External Service Error
export function createExternalServiceError(service: string = 'Grok'): StandardErrorResponse {
    return createStandardError(
        ErrorCode.EXTERNAL_SERVICE_ERROR,
        `External service error: ${service}`,
        { service }
    );
}

export function createExtractionFailureError(message?: string): StandardErrorResponse {
    return createStandardError(
        ErrorCode.EXTERNAL_SERVICE_ERROR,
        message || 'Failed to extract response from Grok',
        { service: 'Grok' }
    );
}

// 503 - Service Unavailable (Custom - not in cloro.dev spec)
export function createServiceUnavailableError(service: string = 'Grok'): StandardErrorResponse {
    return createStandardError(
        'SERVICE_UNAVAILABLE' as ErrorCode,
        `Service temporarily unavailable: ${service}`,
        { service }
    );
}

// ============================================================================
// GENERIC ERROR HANDLER
// ============================================================================

/**
 * Generic error handler that defaults extraordinary errors to 503 Service Unavailable
 * For cloro.dev compatibility - supports all error response formats but uses custom 503 for simplicity
 */
export function handleGenericError(error: unknown): GrokErrorResponse {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Categorize based on error message and default to 503 for extraordinary errors
    if (errorMessage.includes('timeout') || errorMessage.includes('Navigation timeout')) {
        return createTimeoutError();
    }

    if (errorMessage.includes('rate limit') || errorMessage.includes('under heavy usage')) {
        return createGrokRateLimitError();
    }

    if (errorMessage.includes('browser') || errorMessage.includes('launch') || errorMessage.includes('crashed')) {
        return createBrowserFailureError(errorMessage);
    }

    if (errorMessage.includes('selector') || errorMessage.includes('element') || errorMessage.includes('extract')) {
        return createExtractionFailureError(errorMessage);
    }

    if (errorMessage.includes('canceled') || errorMessage.includes('aborted')) {
        return createRequestCanceledError();
    }

    if (errorMessage.includes('maximum retries') || errorMessage.includes('retries exceeded')) {
        return createMaxRetriesError();
    }

    // Default extraordinary errors to 503 Service Unavailable (custom)
    return createServiceUnavailableError('Grok');
}


