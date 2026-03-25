/**
 * @pot-sdk2/polymarket — Data Fetcher
 *
 * Zero-dependency HTTP client for Polymarket's free APIs.
 * Uses native fetch() — no axios, no node-fetch needed.
 *
 * Endpoints used (all public, no auth required):
 * - Gamma API: Market discovery, events, search
 * - CLOB API: Order book data, prices, spreads
 */

import type {
  PolymarketConfig,
  PolymarketEvent,
  PolymarketMarket,
} from './types.js';
import { DEFAULT_CONFIG } from './types.js';

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
  // Events data
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

interface ClobPriceResponse {
  mid: string;
  bid: string;
  ask: string;
  spread: string;
  last_trade_price?: string;
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
  config: PolymarketConfig
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ThoughtProof-SDK/0.1.0',
      },
    });

    if (!response.ok) {
      throw new Error(
        `Polymarket API error: ${response.status} ${response.statusText} for ${url}`
      );
    }

    return (await response.json()) as T;
  } finally {
    clearTimeout(timeoutId);
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

  const raw = await fetchJson<GammaEventResponse[]>(url, config);

  const events: PolymarketEvent[] = raw.map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description || '',
    category: e.category || 'unknown',
    endDate: e.end_date_iso,
    active: e.active,
    markets: (e.markets || []).map((m) => parseGammaMarket(m, config)),
  }));

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

  const raw = await fetchJson<GammaMarketResponse[]>(url, config);

  const markets = raw.map((m) => parseGammaMarket(m, config));

  // Also try searching by question text
  const url2 = `${config.gammaApiUrl}/markets?question_contains=${encoded}&active=true&closed=false&limit=${config.maxMarkets}&order=volume24hr&ascending=false`;

  try {
    const raw2 = await fetchJson<GammaMarketResponse[]>(url2, config);
    const markets2 = raw2.map((m) => parseGammaMarket(m, config));

    // Deduplicate by conditionId
    const seen = new Set(markets.map((m) => m.conditionId));
    for (const m of markets2) {
      if (!seen.has(m.conditionId)) {
        markets.push(m);
        seen.add(m.conditionId);
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
  const raw = await fetchJson<GammaMarketResponse[]>(url, config);

  if (!raw.length) return null;

  const market = parseGammaMarket(raw[0], config);
  setCache(cacheKey, market);
  return market;
}

// ─── CLOB API (Order Book Data) ────────────────────────────

/**
 * Fetch order book for a market to get real-time spread data.
 */
export async function getOrderBook(
  tokenId: string,
  config: PolymarketConfig = DEFAULT_CONFIG
): Promise<{ bestBid: number; bestAsk: number; spread: number } | null> {
  try {
    const url = `${config.clobApiUrl}/book?token_id=${tokenId}`;
    const raw = await fetchJson<ClobBookResponse>(url, config);

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
    const raw = await fetchJson<{ mid: string }>(url, config);
    return parseFloat(raw.mid);
  } catch {
    return null;
  }
}

// ─── Helpers ───────────────────────────────────────────────

function parseGammaMarket(
  m: GammaMarketResponse,
  config: PolymarketConfig
): PolymarketMarket {
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
  const spread = Math.abs(1 - yesPrice - noPrice);

  return {
    conditionId: m.condition_id,
    question: m.question,
    outcomePriceYes: yesPrice,
    outcomePriceNo: noPrice,
    volume24h: 0, // Gamma doesn't always return this separately
    volumeTotal: m.volume_num || parseFloat(m.volume || '0'),
    openInterest: oi,
    uniqueTraders: 0, // Requires separate API call
    bestBid: yesPrice - spread / 2,
    bestAsk: yesPrice + spread / 2,
    spread,
    meetsLiquidityThreshold:
      oi >= config.minOpenInterest && spread <= config.maxSpread,
  };
}

/**
 * Clear the internal cache. Useful for testing.
 */
export function clearCache(): void {
  cache.clear();
}
