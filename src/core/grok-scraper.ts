/**
 * Grok Scraper with Browser Pool Support 
 * Handles individual scraping requests using pooled browser
 */

import { Page } from 'patchright';
import { GrokRequest, GrokResponse, GrokErrorResponse, ErrorCode, Source } from '../config/types';
import { formatSuccessResponse } from '../handlers/response-formatter';
import { createGrokRateLimitError, createExtractionFailureError } from '../handlers/error-handler';
import { CONFIG } from '../config/config';

/**
 * Error classification for retry logic
 */
export interface ErrorClassification {
    shouldRetry: boolean;
    shouldResetBrowser: boolean;
    errorCode?: string;
}

/**
 * Classify errors to determine if they're recoverable
 */
export function classifyError(error: GrokErrorResponse): ErrorClassification {
    // Check for StandardErrorResponse format
    if ('error' in error && typeof error.error === 'object' && 'code' in error.error) {
        const errorCode = error.error.code;

        // Rate limit errors - should retry after browser reset
        if (errorCode === ErrorCode.CONCURRENT_LIMIT_EXCEEDED ||
            errorCode === ErrorCode.RATE_LIMITED) {
            return {
                shouldRetry: true,
                shouldResetBrowser: true,
                errorCode: errorCode,
            };
        }

        // External service errors (including timeouts) - should retry after browser reset
        if (errorCode === ErrorCode.EXTERNAL_SERVICE_ERROR ||
            errorCode === ErrorCode.EXTRACTION_FAILED) {
            return {
                shouldRetry: true,
                shouldResetBrowser: true,
                errorCode: errorCode,
            };
        }
    }

    // Default: don't retry
    return {
        shouldRetry: false,
        shouldResetBrowser: false,
    };
}

/**
 * Random delay helper
 */
function randomDelay(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Check if page shows rate limit message
 */
async function checkRateLimit(page: Page): Promise<boolean> {
    return await page.evaluate(() => {
        const bodyText = document.body.textContent || '';
        return bodyText.includes('Grok is under heavy usage right now');
    });
}

/**
 * Extract sources from a single accordion by clicking it and reading the content
 */
async function extractSourcesFromAccordion(page: Page, accordionIndex: number): Promise<Source[]> {
    return await page.evaluate((index) => {
        const accordionButtons = Array.from(document.querySelectorAll('aside button[data-orientation="vertical"][aria-controls]'));
        const button = accordionButtons[index] as HTMLElement;

        if (!button) return [];

        const regionId = button.getAttribute('aria-controls');
        if (!regionId) return [];

        button.click();

        // Wait for content to render, then extract sources
        return new Promise<any[]>((resolve) => {
            setTimeout(() => {
                const region = document.getElementById(regionId);
                if (!region || region.hasAttribute('hidden')) {
                    resolve([]);
                    return;
                }

                const sources: any[] = [];
                const sourceLinks = Array.from(region.querySelectorAll('a[href][target="_blank"]'));

                for (const link of sourceLinks) {
                    const href = link.getAttribute('href');
                    if (!href || !href.startsWith('http')) continue;

                    const titleElement = link.querySelector('.font-semibold.text-sm');
                    const descElement = link.querySelector('p.text-sm.line-clamp-3');
                    const domainElement = link.querySelector('.text-xs.text-secondary.truncate');

                    const title = titleElement?.textContent?.trim() || '';
                    const description = descElement?.textContent?.trim() || '';
                    const domain = domainElement?.textContent?.trim() || '';

                    if (title && href) {
                        sources.push({
                            url: href,
                            label: domain || new URL(href).hostname,
                            description: description || title
                        });
                    }
                }

                resolve(sources);
            }, 300);
        });
    }, accordionIndex);
}

/**
 * Deduplicate sources by URL, keeping the first occurrence
 */
function deduplicateSources(sources: any[]): Source[] {
    const seenUrls = new Set<string>();
    const deduplicated: Source[] = [];

    for (const source of sources) {
        if (!seenUrls.has(source.url)) {
            seenUrls.add(source.url);
            deduplicated.push({
                ...source,
                position: deduplicated.length + 1
            });
        }
    }

    return deduplicated;
}

/**
 * Extract sources and search queries from Grok's sidebar
 */
async function extractSourcesAndQueries(page: Page, browserId: number): Promise<{ sources: Source[], searchQueries: string[] }> {
    try {
        console.log(`  [Browser ${browserId}] Attempting to extract sources and queries...`);

        // Wait for action buttons
        await page.waitForSelector('.action-buttons.last-response', { timeout: 5000 });
        console.log(`  [Browser ${browserId}] Action buttons found`);

        // Check if sources button exists
        const sourcesButtonExists = await page.evaluate(() => {
            const allDivs = Array.from(document.querySelectorAll('.action-buttons .truncate'));
            return allDivs.some(div => div.textContent?.includes('sources'));
        });

        if (!sourcesButtonExists) {
            console.log(`  [Browser ${browserId}] No sources button found (query didn't use web search)`);
            return { sources: [], searchQueries: [] };
        }

        console.log(`  [Browser ${browserId}] Found sources button, clicking...`);

        try {
            // Click sources button
            await page.evaluate(() => {
                const allDivs = Array.from(document.querySelectorAll('.action-buttons .truncate'));
                const sourcesDiv = allDivs.find(div => div.textContent?.includes('sources'));
                const clickableParent = sourcesDiv?.closest('.cursor-pointer');
                if (clickableParent) {
                    (clickableParent as HTMLElement).click();
                }
            });

            await page.waitForTimeout(1500);

            // Extract search queries
            const accordionInfo = await page.evaluate(() => {
                const queries: string[] = [];
                const accordionButtons = Array.from(document.querySelectorAll('aside button[data-orientation="vertical"][aria-controls]'));

                for (const button of accordionButtons) {
                    const queryElement = button.querySelector('.font-semibold.italic');
                    const query = queryElement?.textContent?.trim();
                    if (query) queries.push(query);
                }

                return { queries, accordionCount: accordionButtons.length };
            });

            console.log(`  [Browser ${browserId}] Found ${accordionInfo.accordionCount} search query groups`);

            // Extract sources from each accordion
            const allSources: any[] = [];

            for (let i = 0; i < accordionInfo.accordionCount; i++) {
                const accordionSources = await extractSourcesFromAccordion(page, i);
                allSources.push(...accordionSources);
                console.log(`  [Browser ${browserId}] Accordion ${i + 1}/${accordionInfo.accordionCount}: extracted ${accordionSources.length} sources`);
            }

            // Deduplicate by URL
            const deduplicatedSources = deduplicateSources(allSources);
            const duplicatesRemoved = allSources.length - deduplicatedSources.length;

            if (duplicatesRemoved > 0) {
                console.log(`  [Browser ${browserId}] Removed ${duplicatesRemoved} duplicate sources (${allSources.length} -> ${deduplicatedSources.length})`);
            }

            console.log(`  [Browser ${browserId}] ✓ Extracted ${deduplicatedSources.length} unique sources from ${accordionInfo.accordionCount} query groups`);
            return { sources: deduplicatedSources, searchQueries: accordionInfo.queries };

        } catch (error) {
            console.log(`  [Browser ${browserId}] Failed to extract sources:`, error);
            return { sources: [], searchQueries: [] };
        }

    } catch (error) {
        console.log(`  [Browser ${browserId}] Error extracting sources:`, error);
        return { sources: [], searchQueries: [] };
    }
}

/**
 * Navigate to Grok
 */
async function ensureGrokPage(page: Page, browserId: number): Promise<void> {
    const currentUrl = page.url();

    // If not on grok.com, navigate there
    if (!currentUrl.includes('grok.com')) {
        console.log(`  [Browser ${browserId}] Navigating to grok.com...`);
        await page.goto(CONFIG.grokUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.browserTimeout });
        await page.waitForTimeout(randomDelay(CONFIG.randomDelayMin, CONFIG.randomDelayMax));
    }
}

/**
 * Send a prompt to Grok and collect the response
 */
export async function scrapeGrok(
    page: Page,
    request: GrokRequest,
    browserId: number
): Promise<GrokResponse | GrokErrorResponse> {
    try {
        console.log(`  [Browser ${browserId}] Processing: "${request.prompt.substring(0, 50)}..."`);

        await ensureGrokPage(page, browserId);

        // Random delay before interacting
        await page.waitForTimeout(randomDelay(CONFIG.randomDelayMin, CONFIG.randomDelayMax));

        // Try to find input field with multiple fallback selectors
        const INPUT_SELECTORS = [
            'textarea:not([aria-hidden="true"])',              // Fresh page - visible textarea
            'div.tiptap.ProseMirror[contenteditable="true"]',  // Active chat - contenteditable div
            'textarea[placeholder*="Ask"]',                     // Textarea with "Ask" placeholder
            'div[contenteditable="true"][role="textbox"]',     // Generic contenteditable textbox
            'input[type="text"][placeholder*="Ask"]',          // Input field alternative
            'textarea',                                         // Any textarea as last resort
        ];

        let inputSelector: string | null = null;

        console.log(`  [Browser ${browserId}] Looking for input field with ${INPUT_SELECTORS.length} fallback selectors...`);

        // Try each selector with short timeout
        for (const selector of INPUT_SELECTORS) {
            try {
                await page.waitForSelector(selector, { timeout: CONFIG.inputSelectorTimeout, state: 'visible' });
                inputSelector = selector;
                console.log(`  [Browser ${browserId}] ✓ Found input: ${selector}`);
                break;
            } catch {
                continue;
            }
        }

        // If no selector worked, throw error
        if (!inputSelector) {
            console.log(`  [Browser ${browserId}] ❌ No input field found - Grok UI may have changed`);
            throw new Error('No input field found - Grok UI may have changed. Tried all selectors.');
        }

        // Click and clear
        await page.click(inputSelector);
        await page.waitForTimeout(200);
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(300);

        // Type the prompt
        console.log(`  [Browser ${browserId}] Typing prompt...`);
        await page.keyboard.type(request.prompt, { delay: CONFIG.typingDelay });
        await page.waitForTimeout(500);

        // Submit with Enter
        await page.keyboard.press('Enter');
        console.log(`  [Browser ${browserId}] Prompt submitted`);

        // Wait for either response completion OR rate limit message
        console.log(`  [Browser ${browserId}] Waiting for response...`);

        // Check for rate limit early
        await page.waitForTimeout(CONFIG.initialDelay);
        if (await checkRateLimit(page)) {
            console.log(`  [Browser ${browserId}] ⚠️  Rate limit detected`);
            return createGrokRateLimitError();
        }

        // Wait for response completion with periodic stuck browser detection
        const maxWaitTime = CONFIG.responseCompletionTimeout;
        const checkInterval = CONFIG.stuckCheckInterval;
        let elapsedTime = 0;
        let responseCompleted = false;

        try {
            while (elapsedTime < maxWaitTime && !responseCompleted) {
                try {
                    // Try to find the completion indicator with short timeout
                    await page.waitForSelector('.action-buttons.last-response', {
                        state: 'visible',
                        timeout: checkInterval
                    });
                    responseCompleted = true;
                    console.log(`  [Browser ${browserId}] ✓ Response completed`);
                    break;
                } catch (timeoutError) {
                    elapsedTime += checkInterval;

                    // Check for "No response." indicator
                    const isStuck = await page.evaluate(() => {
                        const noResponseElement = document.querySelector('p.text-secondary.italic');
                        return noResponseElement?.textContent?.trim() === 'No response.';
                    });

                    if (isStuck) {
                        console.log(`  [Browser ${browserId}] ❌ Stuck browser detected (No response element found)`);
                        return createExtractionFailureError('Browser stuck - No response element detected');
                    }

                    // Check for rate limit
                    if (await checkRateLimit(page)) {
                        console.log(`  [Browser ${browserId}] ⚠️  Rate limit detected`);
                        return createGrokRateLimitError();
                    }
                }
            }

            if (!responseCompleted) {
                console.log(`  [Browser ${browserId}] ⚠️  Timeout, attempting to extract...`);
            }
        } catch (error) {
            console.log(`  [Browser ${browserId}] ⚠️  Error waiting for response, attempting to extract...`);
        }

        // Extract response
        const result = await page.evaluate(() => {
            const messageBubbles = Array.from(document.querySelectorAll('.message-bubble'));
            const markdownContent = Array.from(document.querySelectorAll('.response-content-markdown'));
            const lastBubble = messageBubbles[messageBubbles.length - 1];
            const lastMarkdown = markdownContent[markdownContent.length - 1];

            return {
                bubbleText: lastBubble?.textContent?.trim() || '',
                markdownText: lastMarkdown?.textContent?.trim() || '',
            };
        });

        const responseText = result.markdownText.length > result.bubbleText.length
            ? result.markdownText
            : result.bubbleText;

        if (!responseText || responseText === request.prompt) {
            console.log(`  [Browser ${browserId}] ❌ No response content found - browser may be stuck`);
            return createExtractionFailureError('No response content found - browser stuck');
        }

        // Check for "No response" which indicates empty/stuck response
        if (responseText.trim() === 'No response.' || responseText.length < 3) {
            console.log(`  [Browser ${browserId}] ❌ Empty response detected - browser stuck`);
            return createExtractionFailureError('Empty response - browser stuck');
        }

        console.log(`  [Browser ${browserId}] ✓ Response captured (${responseText.length} chars)`);

        // Extract sources and search queries from sidebar
        const { sources, searchQueries } = await extractSourcesAndQueries(page, browserId);

        // Format response with all extracted data
        const response = formatSuccessResponse(
            {
                query: request.prompt,
                response: responseText.trim(),
                rawResponse: undefined, // TODO: Not capturing raw events in MVP
                sources: sources,
                searchQueries: searchQueries
            },
            {
                model: 'auto', // TODO: Grok model versioning
                includeMarkdown: request.include?.markdown
            }
        );

        return response;

    } catch (error: any) {
        console.log(`  [Browser ${browserId}] ❌ Error:`, error.message);
        return createExtractionFailureError(error.message);
    }
}
