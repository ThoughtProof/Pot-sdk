/**
 * @pot-sdk2/polymarket — Tests
 *
 * Tests for signal analysis, claim matching, enrichment logic,
 * error types, rate limiting, and alignment with agent intent.
 */

import { describe, it, expect } from 'vitest';
import {
  classifySignalStrength,
  computeSignalConfidence,
  extractSearchTerms,
  matchScore,
  marketToSignal,
  determineAlignmentWithIntent,
} from '../src/analyzer.js';
import {
  PolymarketError,
  RateLimitError,
  MarketNotFoundError,
  ApiDownError,
  TimeoutError,
} from '../src/errors.js';
import { tryConsume, resetRateLimiter } from '../src/rate-limiter.js';
import type { PolymarketMarket, PolymarketConfig } from '../src/types.js';
import { DEFAULT_CONFIG } from '../src/types.js';

// ─── Test Fixtures ─────────────────────────────────────────

const liquidMarket: PolymarketMarket = {
  conditionId: '0xabc123',
  question: 'Will Bitcoin reach $200K by end of 2026?',
  outcomePriceYes: 0.35,
  outcomePriceNo: 0.65,
  volume24h: 2_500_000,
  volumeTotal: 150_000_000,
  openInterest: 5_000_000,
  uniqueTraders: 12_000,
  bestBid: 0.34,
  bestAsk: 0.36,
  spread: 0.02,
  spreadFromClob: true,
};

const thinMarket: PolymarketMarket = {
  conditionId: '0xdef456',
  question: 'Will Solana flip Ethereum by market cap in 2026?',
  outcomePriceYes: 0.08,
  outcomePriceNo: 0.92,
  volume24h: 5_000,
  volumeTotal: 50_000,
  openInterest: 20_000,
  uniqueTraders: 45,
  bestBid: 0.05,
  bestAsk: 0.12,
  spread: 0.07,
  spreadFromClob: false,
};

const moderateMarket: PolymarketMarket = {
  conditionId: '0xghi789',
  question: 'Will the EU AI Act be fully enforced by August 2027?',
  outcomePriceYes: 0.72,
  outcomePriceNo: 0.28,
  volume24h: 500_000,
  volumeTotal: 8_000_000,
  openInterest: 800_000,
  uniqueTraders: 2_500,
  bestBid: 0.71,
  bestAsk: 0.74,
  spread: 0.03,
  spreadFromClob: true,
};

const highYesMarket: PolymarketMarket = {
  conditionId: '0xhigh',
  question: 'Will CFTC maintain jurisdiction over prediction markets?',
  outcomePriceYes: 0.85,
  outcomePriceNo: 0.15,
  volume24h: 1_000_000,
  volumeTotal: 50_000_000,
  openInterest: 3_000_000,
  uniqueTraders: 5_000,
  bestBid: 0.84,
  bestAsk: 0.86,
  spread: 0.02,
  spreadFromClob: true,
};

const lowYesMarket: PolymarketMarket = {
  conditionId: '0xlow',
  question: 'Will MiCA ban all prediction markets by 2027?',
  outcomePriceYes: 0.12,
  outcomePriceNo: 0.88,
  volume24h: 800_000,
  volumeTotal: 30_000_000,
  openInterest: 2_000_000,
  uniqueTraders: 3_000,
  bestBid: 0.11,
  bestAsk: 0.13,
  spread: 0.02,
  spreadFromClob: true,
};

// ─── Signal Strength Tests ─────────────────────────────────

describe('classifySignalStrength', () => {
  it('classifies highly liquid market as strong', () => {
    expect(classifySignalStrength(liquidMarket)).toBe('strong');
  });

  it('classifies moderate market correctly', () => {
    expect(classifySignalStrength(moderateMarket)).toBe('moderate');
  });

  it('classifies thin market as insufficient', () => {
    expect(classifySignalStrength(thinMarket)).toBe('insufficient');
  });

  it('downgrades when spread exceeds max', () => {
    const wideSpread: PolymarketMarket = {
      ...liquidMarket,
      spread: 0.06,
      spreadFromClob: true,
    };
    const strength = classifySignalStrength(wideSpread);
    expect(strength).not.toBe('strong');
  });
});

// ─── Confidence Score Tests ────────────────────────────────

describe('computeSignalConfidence', () => {
  it('returns high confidence for liquid markets', () => {
    const confidence = computeSignalConfidence(liquidMarket);
    expect(confidence).toBeGreaterThan(0.7);
  });

  it('returns low confidence for thin markets', () => {
    const confidence = computeSignalConfidence(thinMarket);
    expect(confidence).toBeLessThan(0.3);
  });

  it('returns moderate confidence for moderate markets', () => {
    const confidence = computeSignalConfidence(moderateMarket);
    expect(confidence).toBeGreaterThan(0.3);
    expect(confidence).toBeLessThan(0.85);
  });

  it('confidence is between 0 and 1', () => {
    const confidence = computeSignalConfidence(liquidMarket);
    expect(confidence).toBeGreaterThanOrEqual(0);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it('respects custom confidence weights', () => {
    const customConfig: PolymarketConfig = {
      ...DEFAULT_CONFIG,
      confidenceWeights: {
        liquidity: 1.0,
        spread: 0,
        volume: 0,
      },
    };
    const confidenceDefault = computeSignalConfidence(liquidMarket);
    const confidenceCustom = computeSignalConfidence(liquidMarket, customConfig);
    // With 100% liquidity weight, result should differ
    expect(confidenceCustom).not.toEqual(confidenceDefault);
  });
});

// ─── Search Term Extraction Tests ──────────────────────────

describe('extractSearchTerms', () => {
  it('extracts meaningful terms from a claim', () => {
    const terms = extractSearchTerms(
      'Will Bitcoin reach $200K by end of 2026?'
    );
    expect(terms).toContain('bitcoin');
    expect(terms).toContain('reach');
    expect(terms).not.toContain('will');
    expect(terms).not.toContain('by');
    expect(terms).not.toContain('of');
  });

  it('removes stop words', () => {
    const terms = extractSearchTerms(
      'The quick brown fox jumps over the lazy dog'
    );
    expect(terms).not.toContain('the');
    expect(terms).toContain('fox');
    expect(terms).toContain('quick');
    expect(terms).toContain('brown');
  });

  it('limits to 5 terms', () => {
    const terms = extractSearchTerms(
      'Bitcoin Ethereum Solana Cardano Polkadot Avalanche Cosmos Polygon'
    );
    expect(terms.length).toBeLessThanOrEqual(5);
  });

  it('handles empty input', () => {
    expect(extractSearchTerms('')).toEqual([]);
  });
});

// ─── Match Score Tests ─────────────────────────────────────

describe('matchScore', () => {
  it('returns high score for exact topic match', () => {
    const score = matchScore(
      'Will Bitcoin reach $200K by 2026?',
      'Will Bitcoin reach $200K by end of 2026?'
    );
    expect(score).toBeGreaterThan(0.7);
  });

  it('returns low score for unrelated topics', () => {
    const score = matchScore(
      'Will Bitcoin reach $200K?',
      'Will Democrats win the 2028 presidential election?'
    );
    expect(score).toBeLessThan(0.3);
  });

  it('handles partial matches', () => {
    const score = matchScore(
      'EU AI Act enforcement 2027',
      'Will the EU AI Act be fully enforced by 2027?'
    );
    expect(score).toBeGreaterThan(0.3);
  });

  it('returns 0 for empty claim', () => {
    expect(matchScore('', 'Any market question')).toBe(0);
  });
});

// ─── Market to Signal Tests ────────────────────────────────

describe('marketToSignal', () => {
  it('converts liquid market to signal with high confidence', () => {
    const signal = marketToSignal(liquidMarket);
    expect(signal.probability).toBe(0.35);
    expect(signal.strength).toBe('strong');
    expect(signal.signalConfidence).toBeGreaterThan(0.7);
    expect(signal.backedBy).toBe(5_000_000);
    expect(signal.rationale).toContain('High-confidence');
  });

  it('converts thin market to weak signal', () => {
    const signal = marketToSignal(thinMarket);
    expect(signal.strength).toBe('insufficient');
    expect(signal.signalConfidence).toBeLessThan(0.3);
    expect(signal.rationale).toContain('Insufficient');
  });

  it('includes market question in rationale', () => {
    const signal = marketToSignal(liquidMarket);
    expect(signal.rationale).toContain('Bitcoin');
  });

  it('includes spread source in rationale', () => {
    const signal = marketToSignal(liquidMarket);
    expect(signal.rationale).toContain('CLOB');

    const signal2 = marketToSignal(thinMarket);
    expect(signal2.rationale).toContain('estimated');
  });
});

// ─── Alignment with Agent Intent Tests ─────────────────────

describe('determineAlignmentWithIntent', () => {
  it('supports when agent buys YES and market says YES is likely', () => {
    const signal = marketToSignal(highYesMarket);
    const alignment = determineAlignmentWithIntent(signal, 'YES');
    expect(alignment).toBe('supports');
  });

  it('contradicts when agent buys YES and market says NO is likely', () => {
    const signal = marketToSignal(lowYesMarket);
    const alignment = determineAlignmentWithIntent(signal, 'YES');
    expect(alignment).toBe('contradicts');
  });

  it('supports when agent buys NO and market says NO is likely', () => {
    // Market: YES=0.12, NO=0.88 → agent buying NO → 0.88 > 0.7 → supports
    const signal = marketToSignal(lowYesMarket);
    const alignment = determineAlignmentWithIntent(signal, 'NO');
    expect(alignment).toBe('supports');
  });

  it('contradicts when agent buys NO and market says YES is likely', () => {
    // Market: YES=0.85, NO=0.15 → agent buying NO → 0.15 < 0.3 → contradicts
    const signal = marketToSignal(highYesMarket);
    const alignment = determineAlignmentWithIntent(signal, 'NO');
    expect(alignment).toBe('contradicts');
  });

  it('returns neutral for markets in the middle', () => {
    // Market: YES=0.35, NO=0.65 → agent buying YES → 0.35 is between 0.3-0.7
    const signal = marketToSignal(liquidMarket);
    const alignment = determineAlignmentWithIntent(signal, 'YES');
    expect(alignment).toBe('neutral');
  });

  it('returns neutral for insufficient markets regardless', () => {
    const signal = marketToSignal(thinMarket);
    const alignment = determineAlignmentWithIntent(signal, 'YES');
    expect(alignment).toBe('neutral');
  });
});

// ─── Direct Market Reference Tests ─────────────────────────

describe('MarketReference type', () => {
  it('supports conditionId only (minimal)', () => {
    const ref = { conditionId: '0xabc123' };
    expect(ref.conditionId).toBe('0xabc123');
  });

  it('supports full reference with outcome and snapshot', () => {
    const ref = {
      conditionId: '0xabc123',
      tokenId: '12345',
      outcome: 'YES' as const,
      snapshot: liquidMarket,
    };
    expect(ref.outcome).toBe('YES');
    expect(ref.snapshot?.openInterest).toBe(5_000_000);
  });
});

// ─── Error Types Tests ─────────────────────────────────────

describe('Error types', () => {
  it('RateLimitError is retryable', () => {
    const err = new RateLimitError('/books', 10_000);
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('RATE_LIMIT');
    expect(err.retryAfterMs).toBe(10_000);
    expect(err.endpoint).toBe('/books');
    expect(err instanceof PolymarketError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('MarketNotFoundError is not retryable', () => {
    const err = new MarketNotFoundError('0xdead');
    expect(err.retryable).toBe(false);
    expect(err.code).toBe('MARKET_NOT_FOUND');
    expect(err.conditionId).toBe('0xdead');
  });

  it('ApiDownError is retryable', () => {
    const err = new ApiDownError('/markets', 503);
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('API_DOWN');
    expect(err.statusCode).toBe(503);
  });

  it('TimeoutError is retryable', () => {
    const err = new TimeoutError('/events', 10_000);
    expect(err.retryable).toBe(true);
    expect(err.code).toBe('TIMEOUT');
    expect(err.timeoutMs).toBe(10_000);
  });

  it('all errors have message', () => {
    const errors = [
      new RateLimitError('/test'),
      new MarketNotFoundError('0x1'),
      new ApiDownError('/test', 500),
      new TimeoutError('/test', 5000),
    ];
    for (const err of errors) {
      expect(err.message.length).toBeGreaterThan(0);
    }
  });
});

// ─── Rate Limiter Tests ────────────────────────────────────

describe('Rate limiter', () => {
  it('allows requests within burst limit', () => {
    resetRateLimiter();
    // Gamma bucket has 30 tokens
    for (let i = 0; i < 25; i++) {
      expect(tryConsume('gamma')).toBe(true);
    }
  });

  it('blocks requests when bucket exhausted', () => {
    resetRateLimiter();
    // Exhaust the gamma bucket (30 tokens)
    for (let i = 0; i < 30; i++) {
      tryConsume('gamma');
    }
    expect(tryConsume('gamma')).toBe(false);
  });

  it('has separate buckets for gamma and clob', () => {
    resetRateLimiter();
    // Exhaust gamma
    for (let i = 0; i < 30; i++) tryConsume('gamma');
    // CLOB should still work
    expect(tryConsume('clob')).toBe(true);
  });

  it('reset clears all buckets', () => {
    resetRateLimiter();
    for (let i = 0; i < 30; i++) tryConsume('gamma');
    expect(tryConsume('gamma')).toBe(false);
    resetRateLimiter();
    expect(tryConsume('gamma')).toBe(true);
  });
});

// ─── Enrichment Logic Tests (computeVerdictAdjustment) ─────

// We test the enrichment logic by verifying the expected behavior patterns.
// Since computeVerdictAdjustment is private, we test via the public types
// and the alignment + strength combinations it depends on.

describe('Verdict adjustment logic patterns', () => {
  // These test the decision matrix that enrichment.ts implements:
  //
  // | Model Verdict | PM Alignment  | Stake   | Expected Adjustment |
  // |---------------|---------------|---------|---------------------|
  // | ALLOW         | supports      | any     | strengthen          |
  // | BLOCK         | contradicts   | any     | strengthen          |
  // | ALLOW         | contradicts   | high    | flag                |
  // | ALLOW         | contradicts   | medium  | weaken or flag      |
  // | BLOCK         | supports      | any     | weaken              |
  // | UNCERTAIN     | strong signal | any     | strengthen          |
  // | any           | no_data       | any     | none                |
  // | any           | weak signal   | any     | none                |

  it('strong signal determines alignment correctly for YES buyer', () => {
    // Agent buys YES on a market where YES = 85%
    const signal = marketToSignal(highYesMarket);
    const alignment = determineAlignmentWithIntent(signal, 'YES');
    expect(alignment).toBe('supports');
    expect(signal.strength).toBe('strong');
    // → Model ALLOW + PM supports + strong = STRENGTHEN
  });

  it('contradicting signal for YES buyer flags concern', () => {
    // Agent buys YES on a market where YES = 12% (low)
    const signal = marketToSignal(lowYesMarket);
    const alignment = determineAlignmentWithIntent(signal, 'YES');
    expect(alignment).toBe('contradicts');
    // lowYesMarket has $30M volume but $2M OI → moderate (not strong)
    expect(['strong', 'moderate']).toContain(signal.strength);
    // → Model ALLOW + PM contradicts + high stake = FLAG
  });

  it('insufficient signal does not affect verdict', () => {
    const signal = marketToSignal(thinMarket);
    expect(signal.strength).toBe('insufficient');
    // → No matter what alignment, insufficient = NONE adjustment
  });

  it('NO buyer gets correct alignment on bearish market', () => {
    // Market: YES=0.12, NO=0.88 → buying NO makes sense
    const signal = marketToSignal(lowYesMarket);
    const alignment = determineAlignmentWithIntent(signal, 'NO');
    expect(alignment).toBe('supports');
    // → Crowd and agent agree: NO is the right play
  });

  it('NO buyer gets flagged on bullish market', () => {
    // Market: YES=0.85, NO=0.15 → buying NO is contrarian
    const signal = marketToSignal(highYesMarket);
    const alignment = determineAlignmentWithIntent(signal, 'NO');
    expect(alignment).toBe('contradicts');
    // → Crowd says YES is 85% → agent buying NO should be flagged
  });
});

// ─── Config Tests ──────────────────────────────────────────

describe('DEFAULT_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_CONFIG.minOpenInterest).toBe(500_000);
    expect(DEFAULT_CONFIG.maxSpread).toBe(0.05);
    expect(DEFAULT_CONFIG.cacheTtlSeconds).toBe(300);
    expect(DEFAULT_CONFIG.timeout).toBe(10_000);
    expect(DEFAULT_CONFIG.fetchOrderBook).toBe(true);
  });

  it('has documented confidence weights', () => {
    const weights = DEFAULT_CONFIG.confidenceWeights;
    expect(weights.liquidity).toBe(0.45);
    expect(weights.spread).toBe(0.25);
    expect(weights.volume).toBe(0.30);
    // Weights should sum to 1.0
    expect(weights.liquidity + weights.spread + weights.volume).toBeCloseTo(1.0);
  });
});

// ─── Spread Source Tests ───────────────────────────────────

describe('Spread data source tracking', () => {
  it('liquidMarket has CLOB spread', () => {
    expect(liquidMarket.spreadFromClob).toBe(true);
  });

  it('thinMarket has estimated spread', () => {
    expect(thinMarket.spreadFromClob).toBe(false);
  });

  it('signal rationale includes spread source', () => {
    const signal1 = marketToSignal(liquidMarket);
    expect(signal1.rationale).toContain('CLOB');

    const signal2 = marketToSignal(thinMarket);
    expect(signal2.rationale).toContain('estimated');
  });
});
