/**
 * Browser Pool Manager
 * Manages a pool of browser instances for concurrent request processing
*/

import { chromium, Browser, BrowserContext, Page } from 'patchright';
import { CONFIG } from '../config/config';

// Constants
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const VIEWPORT = { width: 1920, height: 1080 };

interface BrowserInstance {
    id: number;
    browser: Browser;
    context: BrowserContext;
    page: Page;
    busy: boolean;
}

export class BrowserPool {
    private browsers: BrowserInstance[] = [];
    private poolSize: number;
    private initialized: boolean = false;

    constructor(poolSize: number = CONFIG.browserPoolSize) {
        this.poolSize = poolSize;
    }

    /**
     * Initialize all browsers in the pool
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        console.log(`\n🚀 Initializing browser pool with ${this.poolSize} instances ...\n`);

        // Initialize each browser
        for (let i = 0; i < this.poolSize; i++) {
            console.log(`[Browser ${i + 1}/${this.poolSize}] Launching...`);

            const browser = await chromium.launch({
                channel: 'chrome',
                headless: CONFIG.browserHeadless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-dev-shm-usage'
                ],
            });

            const context = await browser.newContext({
                viewport: VIEWPORT,
                userAgent: USER_AGENT,
                locale: 'en-US',
                timezoneId: 'America/New_York',
                permissions: [],
                extraHTTPHeaders: {
                    'Accept-Language': 'en-US,en;q=0.9',
                }
            });

            // Add script to remove webdriver property
            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
            });

            const page = await context.newPage();

            // Navigate to grok.com to establish basic session
            console.log(`[Browser ${i + 1}/${this.poolSize}] Navigating to grok.com...`);
            await page.goto(CONFIG.grokUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.browserTimeout });
            await page.waitForTimeout(CONFIG.initialPageWait);

            this.browsers.push({
                id: i + 1,
                browser,
                context,
                page,
                busy: false,
            });

            console.log(`[Browser ${i + 1}/${this.poolSize}] ✓ Ready\n`);
        }

        this.initialized = true;
        console.log(`✅ Browser pool initialized with ${this.poolSize} instances (guest mode)\n`);
    }

    /**
     * Get an available browser from the pool
     * Optionally prefer browsers that haven't failed for this request
     * @param avoidBrowserIds - Browser IDs to avoid (failed previously for this request)
     * @param timeoutMs - Maximum time to wait for a browser
     */
    async acquire(avoidBrowserIds?: number[], timeoutMs: number = CONFIG.browserAcquisitionTimeout): Promise<BrowserInstance> {
        if (!this.initialized) {
            throw new Error('Browser pool not initialized. Call initialize() first.');
        }

        const startTime = Date.now();

        // Wait for an available browser
        while (true) {
            // Check timeout to prevent infinite deadlock
            if (Date.now() - startTime > timeoutMs) {
                const busyBrowsers = this.browsers.filter(b => b.busy).map(b => b.id);
                throw new Error(`Browser acquisition timeout after ${timeoutMs}ms - all browsers busy: [${busyBrowsers.join(', ')}]`);
            }

            // First, try to get a browser that hasn't failed this request
            if (avoidBrowserIds && avoidBrowserIds.length > 0) {
                const preferredBrowser = this.browsers.find(
                    b => !b.busy && !avoidBrowserIds.includes(b.id)
                );
                if (preferredBrowser) {
                    preferredBrowser.busy = true;
                    console.log(`  [Pool] Assigned Browser ${preferredBrowser.id} (avoiding: [${avoidBrowserIds.join(', ')}])`);
                    return preferredBrowser;
                }
            }

            // Otherwise, get any available browser
            const available = this.browsers.find(b => !b.busy);
            if (available) {
                available.busy = true;
                return available;
            }

            // Wait a bit before checking again
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    /**
     * Release a browser back to the pool
     */
    release(browser: BrowserInstance): void {
        browser.busy = false;
    }

    /**
     * Reset a browser instance to a fresh state
     */
    async resetBrowser(browser: BrowserInstance): Promise<void> {
        try {
            console.log(`  [Browser ${browser.id}] 🔄 Resetting to fresh state...`);

            // Clear all storage to remove any rate limit state
            await browser.context.clearCookies();
            await browser.page.evaluate(() => {
                localStorage.clear();
                sessionStorage.clear();
            });

            // Navigate to fresh grok.com page with hard reload
            await browser.page.goto(CONFIG.grokUrl, {
                waitUntil: 'networkidle',
                timeout: CONFIG.browserTimeout
            });

            // Wait for page to stabilize and ensure we're on fresh page
            await browser.page.waitForTimeout(3000);

            // Verify we're on a fresh page by checking for textarea
            const hasFreshInput = await browser.page.locator('textarea:not([aria-hidden="true"])').isVisible().catch(() => false);
            console.log(`  [Browser ${browser.id}] ✓ Reset complete (fresh=${hasFreshInput})`);

            if (!hasFreshInput) {
                console.log(`  [Browser ${browser.id}] ⚠️  Warning: May not be on fresh page, forcing reload...`);
                await browser.page.reload({ waitUntil: 'networkidle', timeout: CONFIG.browserTimeout });
                await browser.page.waitForTimeout(CONFIG.initialPageWait);
            }
        } catch (error: any) {
            console.error(`  [Browser ${browser.id}] ❌ Reset failed:`, error.message);
            // If reset fails, try to recreate the browser instance
            try {
                await this.recreateBrowser(browser);
            } catch (recreateError: any) {
                console.error(`  [Browser ${browser.id}] ❌ Recreation failed - browser may be unusable:`, recreateError.message);
                throw new Error(`Failed to reset browser ${browser.id}: ${recreateError.message}`);
            }
        }
    }

    /**
     * Recreate a browser instance completely
     */
    private async recreateBrowser(browserInstance: BrowserInstance): Promise<void> {
        try {
            console.log(`  [Browser ${browserInstance.id}] 🔄 Recreating browser instance...`);

            // Close old browser
            try {
                await browserInstance.browser.close();
            } catch (e) {
                // Ignore close errors
            }

            // Create new browser
            const browser = await chromium.launch({
                channel: 'chrome',
                headless: CONFIG.browserHeadless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-blink-features=AutomationControlled',
                    '--disable-dev-shm-usage'
                ],
            });

            const context = await browser.newContext({
                viewport: VIEWPORT,
                userAgent: USER_AGENT,
                locale: 'en-US',
                timezoneId: 'America/New_York',
                permissions: [],
                extraHTTPHeaders: {
                    'Accept-Language': 'en-US,en;q=0.9',
                }
            });

            await context.addInitScript(() => {
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
            });

            const page = await context.newPage();
            await page.goto(CONFIG.grokUrl, { waitUntil: 'domcontentloaded', timeout: CONFIG.browserTimeout });
            await page.waitForTimeout(CONFIG.initialPageWait);

            // Update the instance
            browserInstance.browser = browser;
            browserInstance.context = context;
            browserInstance.page = page;

            console.log(`  [Browser ${browserInstance.id}] ✓ Recreated successfully`);
        } catch (error: any) {
            console.error(`  [Browser ${browserInstance.id}] ❌ Recreation failed:`, error.message);
            throw error;
        }
    }

    /**
     * Check if a browser is healthy
     * @param browser - Browser instance to check
     * @returns true if browser is responsive and on correct URL
     */
    async checkBrowserHealth(browser: BrowserInstance): Promise<boolean> {
        try {
            // Try to evaluate a simple expression
            await browser.page.evaluate(() => true);

            // Check if we're on the right URL
            const url = browser.page.url();
            const isOnGrok = url.includes('grok.com') || url.includes('x.com');

            if (!isOnGrok) {
                console.log(`  [Browser ${browser.id}] ⚠️  Health check: Wrong URL (${url})`);
                return false;
            }

            return true;
        } catch (error) {
            console.log(`  [Browser ${browser.id}] ⚠️  Health check failed:`, error);
            return false;
        }
    }

    /**
     * Run health checks on all browsers
     * Recreate unhealthy browsers that aren't currently busy
     */
    async healthCheckAll(): Promise<void> {
        if (!CONFIG.enableBrowserHealthMonitoring) {
            return;
        }

        console.log('[Health Check] Checking all browsers...');

        for (const browser of this.browsers) {
            // Skip busy browsers
            if (browser.busy) {
                continue;
            }

            const healthy = await this.checkBrowserHealth(browser);

            if (!healthy) {
                console.log(`[Health Check] Browser ${browser.id} is unhealthy - recreating...`);
                try {
                    await this.recreateBrowser(browser);
                    console.log(`[Health Check] Browser ${browser.id} recreated successfully`);
                } catch (error) {
                    console.error(`[Health Check] Failed to recreate browser ${browser.id}:`, error);
                }
            }
        }

        console.log('[Health Check] Complete');
    }

    /**
     * Start periodic health monitoring
     * @returns Interval ID for stopping the monitoring
     */
    startHealthMonitoring(): NodeJS.Timeout | null {
        if (!CONFIG.enableBrowserHealthMonitoring) {
            console.log('[Health Monitor] Browser health monitoring disabled');
            return null;
        }

        console.log(`[Health Monitor] Starting periodic health checks every ${CONFIG.browserHealthCheckInterval}ms`);

        const intervalId = setInterval(async () => {
            try {
                await this.healthCheckAll();
            } catch (error) {
                console.error('[Health Monitor] Error during health check:', error);
            }
        }, CONFIG.browserHealthCheckInterval);

        return intervalId;
    }

    /**
     * Get pool statistics
     */
    getStats(): { total: number; busy: number; available: number } {
        const busy = this.browsers.filter(b => b.busy).length;
        return {
            total: this.browsers.length,
            busy,
            available: this.browsers.length - busy,
        };
    }

    /**
     * Close all browsers and cleanup
     */
    async cleanup(): Promise<void> {
        console.log('\n🧹 Cleaning up browser pool...');

        for (const instance of this.browsers) {
            try {
                await instance.browser.close();
                console.log(`  ✓ Browser ${instance.id} closed`);
            } catch (error) {
                console.error(`  ❌ Error closing browser ${instance.id}:`, error);
            }
        }

        this.browsers = [];
        this.initialized = false;
        console.log('✅ Browser pool cleanup complete\n');
    }
}
