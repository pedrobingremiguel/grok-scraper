/**
 * Response formatting for Grok scraper (Guest version)
 * Transforms scraper output to cloro.dev format
 * Identical to authenticated version - API contract doesn't change
 */

import { GrokSuccessResponse, Source, ScraperResult } from '../config/types';

interface FormatOptions {
    includeMarkdown?: boolean;
    includeHtml?: boolean;
    model?: string;
}

/**
 * Formats successful Grok response in cloro.dev format
 * Returns 200-style success response with all required fields
 */
export function formatSuccessResponse(
    scraperResult: ScraperResult,
    options: FormatOptions = {}
): GrokSuccessResponse {
    const modelName = options.model || 'Auto';

    // Build raw response in Cloro dev event format
    const rawResponse = scraperResult.rawResponse || []; // TODO: Use actual captured events in future

    const response: GrokSuccessResponse = {
        success: true,
        result: {
            text: scraperResult.response,
            sources: scraperResult.sources || [],
            html: "",
            markdown: scraperResult.response,
            rawResponse: rawResponse,
            searchQueries: scraperResult.searchQueries || [],
            model: modelName,
            shoppingCards: [],
            entities: [],
        },
    };

    return response;
}
