/**
 * @pot-sdk2/polymarket — Data Fetcher
 *
 * Zero-dependency HTTP client for Polymarket's free APIs.
 * Uses native fetch() — no axios, no node-fetch needed.
 *
 * Endpoints used (all public, no auth required):
 * - Gamma API: Market discovery, events, search
 * - CLOB API: Order book data, prices, spreads
 *
 * Includes:
 * - Token bucket rate limiting (self-throttle before getting 429'd)
 * - Typed errors (RateLimitError, MarketNotFoundError, etc.)
 * - CLOB order book integration for real bid-ask spreads
 */

import type {
  PolymarketConfig,
  PolymarketEvent,
  PolymarketMarket,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import {
  RateLimitError,
  ApiDownError,
  TimeoutError,
} from './errors.js';
import { waitAndConsume } from './rate-limiter.js';

// ─── Response Types (Polymarket API shapes) ────────────────

interface GammaMarketResponse {
  id: string;
  question: string;
  description: string;
  end_date_iso: string;
  active: boolean;
  closed: boolean;
  market_slug: string;
  condition_id: string;
  outcome_prices: string; // JSON string: "[\"0.95\",\"0.05\"]"
  volume: string;
  volume_num: number;
  liquidity: string;
  liquidity_num: number;
  open_interest?: number;
  clobTokenIds?: string; // JSON string: "[\"token1\",\"token2\"]"
  events?: Array<{
    id: string;
    title: string;
    category: string;
  }>;
}

interface GammaEventResponse {
  id: string;
  title: string;
  description: string;
  end_date_iso: string;
  active: boolean;
  category: string;
  markets: GammaMarketResponse[];
}

interface ClobBookResponse {
  market: string;
  asset_id: string;
  bids: Array<{ price: string; size: string }>;
  asks: Array<{ price: string; size: string }>;
}

// ─── Cache ─────────────────────────────────────────────────

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function getCached<T>(key: string, ttlMs: number): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, { data, fetchedAt: Date.now() });
}

// ─── HTTP Helpers ──────────────────────────────────────────

async function fetchJson<T>(
  url: string,
  config: PolymarketConfig,
  endpoint: 'gamma' | 'clob' = 'gamma'
): Promise<T> {
  // Rate limit check — wait if needed
  await waitAndConsume(endpoint);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ThoughtProof-SDK/0.2.0',
      },
    });

    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('retry-after') || '10', 10);
      throw new RateLimitError(url, retryAfter * 1000);
    }

    if (response.status >= 500) {
      throw new ApiDownError(url, response.status);
    }

    if (!response.ok) {
      throw new ApiDownError(url, response.status);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof RateLimitError || error instanceof ApiDownError) {
      throw error;
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new TimeoutError(url, config.timeout);
    }
    throw new ApiDownError(url);
  } finally {
    clearTimeout(timeoutId);
  }
}

// ─── CLOB API (Order Book Data) ────────────────────────────

/**
 * Fetch order book for a market to get REAL bid-ask spread.
 * This is the accurate spread — not the vigorish estimate from prices.
 */
export async function getOrderBook(
  tokenId: string,
  config: PolymarketConfig = DEFAULT_CONFIG
): Promise<{ bestBid: number; bestAsk: number; spread: number } | null> {
  try {
    const url = `${config.clobApiUrl}/book?token_id=${tokenId}`;
    const raw = await fetchJson<ClobBookResponse>(url, config, 'clob');

    const bestBid =
      raw.bids.length > 0 ? parseFloat(raw.bids[0].price) : 0;
    const bestAsk =
      raw.asks.length > 0 ? parseFloat(raw.asks[0].price) : 1;
    const spread = bestAsk - bestBid;

    return { bestBid, bestAsk, spread };
  } catch {
    return null;
  }
}

/**
 * Fetch mid-price for a market from CLOB.
 */
export async function getMidPrice(
  tokenId: string,
  config: PolymarketConfig = DEFAULT_CONFIG
): Promise<number | null> {
  try {
    const url = `${config.clobApiUrl}/midpoint?token_id=${tokenId}`;
    const raw = await fetchJson<{ mid: string }>(url, config, 'clob');
    return parseFloat(raw.mid);
  } catch {
    return null;
  }
}

// ─── Gamma API (Market Discovery) ──────────────────────────

/**
 * Search Polymarket events by keyword.
 * Uses Gamma API — free, no auth required.
 */
export async function searchEvents(
  query: string,
  config: PolymarketConfig = DEFAULT_CONFIG
): Promise<PolymarketEvent[]> {
  const cacheKey = `events:${query}`;
  const cached = getCached<PolymarketEvent[]>(
    cacheKey,
    config.cacheTtlSeconds * 1000
  );
  if (cached) return cached;

  const encoded = encodeURIComponent(query);
  const url = `${config.gammaApiUrl}/events?title_contains=${encoded}&active=true&closed=false&limit=${config.maxMarkets}&order=volume24hr&ascending=false`;

  const raw = await fetchJson<GammaEventResponse[]>(url, config, 'gamma');

  const events: PolymarketEvent[] = [];
  for (const e of raw) {
    const markets: PolymarketMarket[] = [];
    for (const m of e.markets || []) {
      markets.push(await parseGammaMarket(m, config));
    }
    events.push({
      id: e.id,
      title: e.title,
      description: e.description || '',
      category: e.category || 'unknown',
      endDate: e.end_date_iso,
      active: e.active,
      markets,
    });
  }

  setCache(cacheKey, events);
  return events;
}

/**
 * Search markets directly by keyword.
 */
export async function searchMarkets(
  query: string,
  config: PolymarketConfig = DEFAULT_CONFIG
): Promise<PolymarketMarket[]> {
  const cacheKey = `markets:${query}`;
  const cached = getCached<PolymarketMarket[]>(
    cacheKey,
    config.cacheTtlSeconds * 1000
  );
  if (cached) return cached;

  const encoded = encodeURIComponent(query);
  const url = `${config.gammaApiUrl}/markets?tag_contains=${encoded}&active=true&closed=false&limit=${config.maxMarkets}&order=volume24hr&ascending=false`;

  const rawResults = await fetchJson<GammaMarketResponse[]>(url, config, 'gamma');

  const markets: PolymarketMarket[] = [];
  for (const m of rawResults) {
    markets.push(await parseGammaMarket(m, config));
  }

  // Also try searching by question text
  const url2 = `${config.gammaApiUrl}/markets?question_contains=${encoded}&active=true&closed=false&limit=${config.maxMarkets}&order=volume24hr&ascending=false`;

  try {
    const raw2 = await fetchJson<GammaMarketResponse[]>(url2, config, 'gamma');

    const seen = new Set(markets.map((m) => m.conditionId));
    for (const m of raw2) {
      if (!seen.has(m.condition_id)) {
        markets.push(await parseGammaMarket(m, config));
        seen.add(m.condition_id);
      }
    }
  } catch {
    // Secondary search failed, continue with primary results
  }

  setCache(cacheKey, markets);
  return markets;
}

/**
 * Get a specific market by condition ID.
 */
export async function getMarket(
  conditionId: string,
  config: PolymarketConfig = DEFAULT_CONFIG
): Promise<PolymarketMarket | null> {
  const cacheKey = `market:${conditionId}`;
  const cached = getCached<PolymarketMarket>(
    cacheKey,
    config.cacheTtlSeconds * 1000
  );
  if (cached) return cached;

  const url = `${config.gammaApiUrl}/markets?condition_id=${conditionId}`;
  const raw = await fetchJson<GammaMarketResponse[]>(url, config, 'gamma');

  if (!raw.length) return null;

  const market = await parseGammaMarket(raw[0], config);
  setCache(cacheKey, market);
  return market;
}

// ─── Helpers ───────────────────────────────────────────────

/**
 * Parse a Gamma API market response into our type.
 * Optionally fetches CLOB order book for real bid-ask spread.
 */
async function parseGammaMarket(
  m: GammaMarketResponse,
  config: PolymarketConfig
): Promise<PolymarketMarket> {
  let yesPrice = 0.5;
  let noPrice = 0.5;

  try {
    const prices = JSON.parse(m.outcome_prices || '["0.5","0.5"]');
    yesPrice = parseFloat(prices[0]) || 0.5;
    noPrice = parseFloat(prices[1]) || 0.5;
  } catch {
    // Default to 0.5/0.5
  }

  const oi = m.open_interest || m.liquidity_num || 0;

  // Default: estimate spread from price overround (INACCURATE but free)
  let bestBid = yesPrice;
  let bestAsk = yesPrice;
  let spread = Math.abs(1 - yesPrice - noPrice);
  let spreadFromClob = false;

  // If configured and token ID available, fetch REAL spread from CLOB
  if (config.fetchOrderBook) {
    let tokenId: string | null = null;
    try {
      const tokenIds = JSON.parse(m.clobTokenIds || '[]');
      tokenId = tokenIds[0] || null;
    } catch {
      // No token IDs available
    }

    if (tokenId) {
      const book = await getOrderBook(tokenId, config);
      if (book) {
        bestBid = book.bestBid;
        bestAsk = book.bestAsk;
        spread = book.spread;
        spreadFromClob = true;
      }
    }
  }

  return {
    conditionId: m.condition_id,
    question: m.question,
    outcomePriceYes: yesPrice,
    outcomePriceNo: noPrice,
    volume24h: 0,
    volumeTotal: m.volume_num || parseFloat(m.volume || '0'),
    openInterest: oi,
    uniqueTraders: 0,
    bestBid,
    bestAsk,
    spread,
    spreadFromClob,
  };
}

/**
 * Check if a market meets liquidity threshold at runtime.
 * This is a FUNCTION, not a cached boolean — always uses current data.
 */
export function meetsLiquidityThreshold(
  market: PolymarketMarket,
  config: PolymarketConfig = DEFAULT_CONFIG
): boolean {
  return (
    market.openInterest >= config.minOpenInterest &&
    market.spread <= config.maxSpread
  );
}

/**
 * Clear the internal cache. Useful for testing.
 */
export function clearCache(): void {
  cache.clear();
}
