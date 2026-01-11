# Grok Scraper — Guest Mode

Web scraper for grok.com using unauthenticated access with browser automation, concurrent request handling. Fully compatible with Cloro dev API specification.

---

## Architecture

### System Overview

The scraper uses a browser pool pattern with a FIFO request queue to handle concurrent scraping requests. Each browser in the pool runs a dedicated worker thread that continuously processes queued requests. When rate limits are encountered, requests are automatically retried with browser rotation to maximize throughput.

### Core Components

**Express API Server** - HTTP interface accepting scraping requests, validates input, applies backpressure when queue is full

**Request Queue** - FIFO queue managing request lifecycle, retry logic, and browser assignment

**Browser Pool** - Pre-initialized Playwright browsers with health monitoring, each running a dedicated worker thread

**Grok Scraper** - Core scraping logic with DOM extraction, source deduplication, rate limit detection, and response formatting

### Request Lifecycle

1. Client sends POST request → API validates and enqueues
2. Available worker dequeues request → Acquires browser from pool
3. Browser navigates to fresh Grok page → Submits prompt → Waits for response completion
4. Scraper extracts text, sources, search queries → Formats response
5. Success: Response returned to client
6. Failure: Browser ID marked as failed for this request → Re-enqueued for retry with different browser
7. Process repeats until success or max retriesreached

## Technical Decisions

### 1. Browser Pool Pattern

**Decision:** Pre-initialized pool of n browsers with concurrent worker threads  
**Rationale:** Pooling enables parallel request processing, workers handle retries automatically without blocking new requests due to free access rate limits

**Implementation:**

- Each browser is initialized once at startup and reused
- Browser state is reset between requests (navigate to fresh grok.com page)
- Health monitoring runs every 30s to detect and recover stuck browsers
- Workers (1 per browser) continuously dequeue and process requests
- `acquire(failedBrowserIds)` preferentially assigns browsers that haven't failed the current request

### 2. Retry Strategy with Browser Avoidance

**Decision:** Max n retry attempts per request with browser rotation, fallback to any browser if all have failed  
**Rationale:** Guest rate limits are unpredictable and sometimes browser-specific  
**Implementation:**

```typescript
// Request queue tracks failed browsers per request:
retryInfo: {
  attemptCount: number;
  maxAttempts: 1000;              // MAX_RETRIES
  failedBrowserIds: number[];     // Failed browsers
  lastError?: string;
  lastErrorCode?: string;
}

// On failure, browser ID is added to failedBrowserIds:
if (!request.retryInfo.failedBrowserIds.includes(browserId)) {
  request.retryInfo.failedBrowserIds.push(browserId);
}

// Request is immediately re-queued (FIFO, no delays):
request.state = RequestState.RETRY_PENDING;
this.queue.push(request);

// On next attempt, browser pool avoids failed browsers:
const browser = await browserPool.acquire(request.retryInfo.failedBrowserIds);

```

### 3. Dynamic Backpressure

**Decision:** `threshold = browserPoolSize × multiplier` (default: 4 × 5 = 20)  
**Rationale:** Prevents queue overflow under heavy load while maintaining throughput  
**Behavior:**

- When queue size < threshold: Accept all requests
- When queue size ≥ threshold: Reject with 503 Service Unavailable
- Auto-adjusts when pool size changes (standard → large deployment)

### 4. Source Extraction with Deduplication

**Decision:** Sequential accordion processing with URL-based deduplication  
**Rationale:** Deduplication essential as Grok reuses authoritative sources across multiple related queries
**Implementation:**

```typescript
// Sequential extraction (accordions are mutually exclusive):
1. Click accordion N → Wait for expansion (200ms)
2. Extract all sources from that accordion
3. Move to next accordion (N+1)
4. Repeat for all accordions
5. Deduplicate by URL using Set<string>
6. Re-number positions to maintain sequence
```

### 9. Configuration

**Decision:** Environment-based config with validation  
**Rationale:** Enables profile-based testing, and flexbility

### Essential Settings

```bash
# Server
PORT=3002
HOST=0.0.0.0

# Browser Pool
BROWSER_POOL_SIZE=4
BROWSER_HEADLESS=true
BROWSER_TIMEOUT=30000

# Backpressure (prevents queue overflow)
BACKPRESSURE_ENABLED=true
BACKPRESSURE_MULTIPLIER=5        # threshold = pool_size × multiplier

# Retry Strategy
MAX_RETRIES=1000                 # Max attempts per request

# Scraper Timeouts
REQUEST_TIMEOUT=180000
RESPONSE_COMPLETION_TIMEOUT=120000
```

### Configuration Profiles

**`.env.standard`** - Development/testing (4 browsers, moderate load)  
**`.env.large`** - Production validation (8 browsers, high throughput)

See [config/config.ts](src/config/config.ts) for full configuration schema and validation.

---

## Quick Start

### Installation & Build

```bash
npm install
npm run build
```

### Running the Server

```bash
# Standard configuration
npm run dev

# Large-scale configuration
npm start
```

Server runs on `http://localhost:3002` (configurable via `PORT`)

### API Usage

**POST /v1/monitor/grok** - Submit scraping request

```bash
curl -X POST http://localhost:3002/v1/monitor/grok \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test-api-key" \
  -d '{
    "prompt": "Explain quantum entanglement",
    "country": "US",
    "include": { "markdown": false }
  }'

# Response format:
{
  "rawResponse": [],
  "markdown": "Quantum entanglement is...",
  "text": "Quantum entanglement is...",
  "sources": [
    { "url": "https://example.com/...", "title": "Source Title", "position": 1 }
  ],
  "searchQueries": ["quantum entanglement", "quantum mechanics basics"],
  "model": "grok-4.1"
}
```

**GET /health** - Check service status

```bash
curl http://localhost:3002/health
```

---

## Testing

The project includes two test suites with different scale profiles:

### Standard Test (Quick Validation)

**Profile:** 16 requests, 4 concurrent

```bash
npm run dev # Setup
npm run test:api # Run test
```

**Output:** `api-test-results.json`, `api-test-log.json`

### Large-Scale Test (Production Validation)

**Profile:** 1200 requests, 20 concurrent, 95% success target, 1000+ minimum successes

```bash
npm run start # Setup
npm run test:large # Run large-scale test
```

**Output:** `large-api-test-results.json`, `large-api-test-log.json`

### Test Architecture

```
tests/
├── config/
│   └── test-config.ts          # Test-specific configurations
├── utils/
│   ├── test-runner.ts          # Shared test execution logic
│   └── test-logger.ts          # Request/response logging
├── test-api.ts                 # Standard test runner
└── test-large-api.ts           # Large-scale test runner
```

---

## API Contract

Implements [cloro.dev](https://cloro.dev) API request/response formats, referencing additionaly `/v1/monitor/chatgpt` for custom sucess response fields.

**Success Response (200):**

```typescript
{
  success: true;
  result: {
    text: string;
    sources: Source[];
    model: string;
    markdown: string;
    html?: string;
  }
}
```

**Error Responses:**

Support all standard HTTP error codes with cloro.dev error format.

---

## Project Structure

### Source Code Organization

```
src/
├── config/                    # Configuration & Type Definitions
│   ├── config.ts              # Centralized config with validation
│   └── types.ts               # TypeScript types for API contract (cloro.dev)
│
├── api/                       # HTTP Interface Layer
│   └── server.ts              # Express server with health endpoint
│                              # → Uses: request-handler, response-formatter
│
├── handlers/                  # Request/Response Pipeline
│   ├── request-handler.ts     # Validates incoming requests
│   ├── response-formatter.ts  # Formats success responses (cloro.dev format)
│   └── error-handler.ts       # Maps errors to HTTP status codes
│
├── queue/                     # Request Orchestration
│   └── request-queue.ts       # FIFO queue with backpressure & retry logic
│                              # → Manages: request lifecycle, worker threads
│                              # → Uses: browser-pool (acquires browsers)
│
├── core/                      # Scraping Engine
│   ├── browser-pool.ts        # Browser lifecycle management
│   │                          # • Initialization & health monitoring
│   │                          # • Browser acquisition & release
│   │                          # • Stuck browser detection & recovery
│   └── grok-scraper.ts        # Core scraping logic
│                              # • DOM extraction with 6 fallback selectors
│                              # • Rate limit detection & handling
│                              # • Response completion monitoring
│
└── utils/
    └── test-logger.ts         # Request/response logging for tests

tests/                         # Test Infrastructure
├── config/
│   └── test-config.ts         # Test-specific configs (isolated from src/config)
│                              # • getStandardTestConfig() - 16 requests
│                              # • getLargeTestConfig() - 1200 requests
│
├── utils/
│   ├── test-runner.ts         # Shared test execution logic (DRY)
│   │                          # • Concurrent request processing
│   │                          # • Statistics calculation (P50, P95, P99)
│   │                          # • Progress tracking & live updates
│   └── test-logger.ts         # Detailed request/response logging
│
├── test-api.ts                # Standard test runner (16 requests, 90% target)
└── test-large-api.ts          # Large-scale test (1200 requests, 95% target)
```

## Limitations & Considerations

- `rawResponse`, `html`, `shoppingCards`, `entities`, `model`, `country` response fields are not implemented or extract from Grok.
- Unauthenticated scraping subject to unpredictable rate limits from Grok
- Rate limits appear to be browser-specific in some cases
- High retry limit necessary due to frequent rate limiting
- Delicate balance between throughput and backpressure to prevent overload
- Browser pool could be dynamically resized based on load to improve capacity
- Browser reset between requests adds latency
- Requests can timeout under high load when queue builds up beyond capacity

## Test Results & Observations

**Load Test Configuration (1200 requests):**

- Traffic Mode: Continuous
- Request Throughput: 0.133 req/s, ~8 req/min
- Browser Pool: 10 browsers
- Target Success: 95%+ (1140+ successful requests)
- Test Duration: 8260 seconds (~2.3 hours)

**Actual Results:**

- Success Rate: 99.5% (1194/1200 requests)
- Average Latency: 44.4 seconds
- P50 Latency: 34.3 seconds
- P95 Latency: 112.5 seconds
- P99 Latency: 147.8 seconds
- Throughput: 0.145 req/s
- Failed Requests: 6

**Capacity Analysis:**

- Per-browser throughput: ~0.018 req/s (based on observed 0.145 req/s ÷ 8 browsers)
- 8-browser capacity: ~0.145 req/s sustained throughput
- Latency range: 7.4s - 165.4s (wide variance due to rate limiting)
- Backpressure threshold: 40 queued requests (8 × multiplier of 5)

**Format Compliance:**

- All responses include required fields and match cloro specifications

## TODO & Future Enhancements

- Implement missing features and fields: model detection, rawResponse, html, shoppingCards, entities, country support
- Add structured logging with multiple severities (info, warn, error, debug) and log separation for API, Scraper, Worker, Browser
- Add Prometheus metrics endpoint for queue depth, throughput, and system health
- Integrate Grafana dashboards for metrics visualization and monitoring
- Implement request priority levels to better manage queue ordering
- Add WebSocket support for real-time response streaming
- Implement asynchronous request handling
- Improve health checks with dependency monitoring (memory, disk, network)
- Implement monitoring and alerting for high error rates and latency spikes
