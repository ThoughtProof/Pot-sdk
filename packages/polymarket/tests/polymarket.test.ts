/**
 * @pot-sdk2/polymarket — Tests
 *
 * Tests for signal analysis, claim matching, and enrichment logic.
 * API calls are mocked — these test the intelligence layer, not the HTTP client.
 */

import { describe, it, expect } from 'vitest';
import {
  classifySignalStrength,
  computeSignalConfidence,
  extractSearchTerms,
  matchScore,
  marketToSignal,
} from '../src/analyzer.js';
import type { PolymarketMarket } from '../src/types.js';
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
  meetsLiquidityThreshold: true,
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
  meetsLiquidityThreshold: false,
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
  meetsLiquidityThreshold: true,
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

  it('downgrades to moderate when spread is too wide', () => {
    const wideSpread: PolymarketMarket = {
      ...liquidMarket,
      spread: 0.06, // exceeds 5% max
      meetsLiquidityThreshold: false,
    };
    // Won't be 'strong' because spread > maxSpread
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
});

// ─── Search Term Extraction Tests ──────────────────────────

describe('extractSearchTerms', () => {
  it('extracts meaningful terms from a claim', () => {
    const terms = extractSearchTerms(
      'Will Bitcoin reach $200K by end of 2026?'
    );
    expect(terms).toContain('bitcoin');
    expect(terms).toContain('reach');
    expect(terms).toContain('200k');
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
});

// ─── Config Tests ──────────────────────────────────────────

describe('DEFAULT_CONFIG', () => {
  it('has sensible defaults', () => {
    expect(DEFAULT_CONFIG.minOpenInterest).toBe(500_000);
    expect(DEFAULT_CONFIG.maxSpread).toBe(0.05);
    expect(DEFAULT_CONFIG.cacheTtlSeconds).toBe(300);
    expect(DEFAULT_CONFIG.timeout).toBe(10_000);
  });
});
