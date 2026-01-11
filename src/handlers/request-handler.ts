/**
 * Request validation and normalization for Grok scraper (Guest version)
 * Implements cloro.dev request validation rules
 * Identical to authenticated version - API contract doesn't change
 */

import { GrokRequest, NormalizedGrokRequest, ValidationResult } from '../config/types';
import { createPromptValidationError, createCountryValidationError } from './error-handler';

/**
 * Validates incoming Grok request against cloro.dev spec
 * Returns validation error in 400 format if invalid
 */
export function validateRequest(request: GrokRequest): ValidationResult {
    // Validate prompt existence
    if (!request.prompt || typeof request.prompt !== 'string') {
        return {
            valid: false,
            error: createPromptValidationError('Prompt is required and must be a string'),
        };
    }

    // Validate prompt length (must be 1-10,000 characters after trimming)
    const trimmedPrompt = request.prompt.trim();

    if (trimmedPrompt.length < 1) {
        return {
            valid: false,
            error: createPromptValidationError('Prompt cannot be empty'),
        };
    }

    if (trimmedPrompt.length > 10000) {
        return {
            valid: false,
            error: createPromptValidationError('Prompt cannot exceed 10,000 characters'),
        };
    }

    // Validate country code (if provided)
    if (request.country !== undefined) {
        if (typeof request.country !== 'string') {
            return {
                valid: false,
                error: createCountryValidationError('Country must be a string'),
            };
        }

        if (request.country.length !== 2) {
            return {
                valid: false,
                error: createCountryValidationError('Country must be a 2-letter ISO 3166-1 alpha-2 code'),
            };
        }

        // Validate uppercase format
        if (!/^[A-Z]{2}$/.test(request.country)) {
            return {
                valid: false,
                error: createCountryValidationError('Country must be uppercase (e.g., "US", "GB")'),
            };
        }
    }

    return { valid: true };
}

/**
 * Normalizes request with default values
 */
export function normalizeRequest(request: GrokRequest): NormalizedGrokRequest {
    return {
        prompt: request.prompt.trim(),
        country: request.country || 'US',
        model: 'fast',  // Internal: always use fast (grok-4.1-fast)
        include: {
            markdown: request.include?.markdown ?? false,
            html: request.include?.html ?? false,
        },
    };
}
