/**
 * @pot-sdk2/polymarket — Error Types
 *
 * Typed errors so agents can intelligently retry, skip, or escalate.
 * Generic try/catch is not acceptable for autonomous commerce.
 */

export class PolymarketError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean
  ) {
    super(message);
    this.name = 'PolymarketError';
  }
}

/** API returned 429 — back off and retry */
export class RateLimitError extends PolymarketError {
  constructor(
    public readonly endpoint: string,
    public readonly retryAfterMs: number = 10_000
  ) {
    super(
      `Rate limited on ${endpoint}. Retry after ${retryAfterMs}ms.`,
      'RATE_LIMIT',
      true
    );
    this.name = 'RateLimitError';
  }
}

/** Market condition ID not found on Polymarket */
export class MarketNotFoundError extends PolymarketError {
  constructor(public readonly conditionId: string) {
    super(
      `Market ${conditionId} not found on Polymarket.`,
      'MARKET_NOT_FOUND',
      false
    );
    this.name = 'MarketNotFoundError';
  }
}

/** API is down or unreachable */
export class ApiDownError extends PolymarketError {
  constructor(
    public readonly endpoint: string,
    public readonly statusCode?: number
  ) {
    super(
      `Polymarket API unavailable: ${endpoint}${statusCode ? ` (HTTP ${statusCode})` : ''}`,
      'API_DOWN',
      true
    );
    this.name = 'ApiDownError';
  }
}

/** Request timed out */
export class TimeoutError extends PolymarketError {
  constructor(
    public readonly endpoint: string,
    public readonly timeoutMs: number
  ) {
    super(
      `Request to ${endpoint} timed out after ${timeoutMs}ms.`,
      'TIMEOUT',
      true
    );
    this.name = 'TimeoutError';
  }
}
