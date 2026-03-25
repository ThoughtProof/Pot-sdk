/**
 * @pot-sdk2/polymarket — Rate Limiter
 *
 * Token bucket rate limiter for Polymarket API endpoints.
 * Prevents us from getting blocked when many agents verify simultaneously.
 *
 * Polymarket limits:
 * - /books: 300 req/10s (web), 50 req/10s (API)
 * - /price: 100 req/10s
 * - markets endpoint: 50 req/10s
 * - POST /order: 500 req/10s burst
 *
 * We're conservative: 30 req/10s across all endpoints combined.
 * Better to self-throttle than get 429'd.
 */

interface TokenBucket {
  tokens: number;
  maxTokens: number;
  refillRate: number; // tokens per second
  lastRefill: number; // timestamp ms
}

const buckets = new Map<string, TokenBucket>();

function getBucket(name: string, maxTokens: number, refillRate: number): TokenBucket {
  let bucket = buckets.get(name);
  if (!bucket) {
    bucket = {
      tokens: maxTokens,
      maxTokens,
      refillRate,
      lastRefill: Date.now(),
    };
    buckets.set(name, bucket);
  }
  return bucket;
}

function refill(bucket: TokenBucket): void {
  const now = Date.now();
  const elapsed = (now - bucket.lastRefill) / 1000;
  bucket.tokens = Math.min(
    bucket.maxTokens,
    bucket.tokens + elapsed * bucket.refillRate
  );
  bucket.lastRefill = now;
}

/**
 * Try to consume a token. Returns true if allowed, false if rate limited.
 */
export function tryConsume(endpoint: 'gamma' | 'clob' = 'gamma'): boolean {
  // Conservative limits: well below Polymarket's actual limits
  const config = {
    gamma: { maxTokens: 30, refillRate: 3 },  // 30 burst, 3/sec refill
    clob: { maxTokens: 20, refillRate: 2 },    // 20 burst, 2/sec refill
  };

  const { maxTokens, refillRate } = config[endpoint];
  const bucket = getBucket(endpoint, maxTokens, refillRate);

  refill(bucket);

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }

  return false;
}

/**
 * Wait until a token is available, then consume it.
 * Returns the wait time in ms (0 if immediate).
 */
export async function waitAndConsume(
  endpoint: 'gamma' | 'clob' = 'gamma'
): Promise<number> {
  if (tryConsume(endpoint)) return 0;

  // Calculate wait time
  const bucket = getBucket(
    endpoint,
    endpoint === 'gamma' ? 30 : 20,
    endpoint === 'gamma' ? 3 : 2
  );

  const tokensNeeded = 1 - bucket.tokens;
  const waitMs = Math.ceil((tokensNeeded / bucket.refillRate) * 1000);
  const clampedWait = Math.min(waitMs, 5000); // Max 5s wait

  await new Promise((resolve) => setTimeout(resolve, clampedWait));

  // After wait, force consume
  refill(bucket);
  bucket.tokens = Math.max(0, bucket.tokens - 1);

  return clampedWait;
}

/**
 * Reset all buckets. Useful for testing.
 */
export function resetRateLimiter(): void {
  buckets.clear();
}
