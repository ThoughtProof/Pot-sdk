/**
 * Tests for detectStake() — v2.0 multi-signal stake detection.
 * Ref: SPEC-v2.0-production-design.md §5
 */
import { describe, it, expect } from 'vitest';
import { detectStake } from '../src/stake.js';

describe('detectStake — caller override', () => {
  it('caller override wins over all signals', () => {
    // $50 normally → low, but caller says critical
    expect(detectStake('Invest $50', 'critical')).toBe('critical');
    expect(detectStake('Invest $50', 'high')).toBe('high');
    expect(detectStake('Invest $50K with seed phrase', 'low')).toBe('low');
  });
});

describe('detectStake — threat keyword floors', () => {
  it('seed phrase → critical floor', () => {
    expect(detectStake('Transfer using my seed phrase')).toBe('critical');
  });

  it('private key → critical floor', () => {
    expect(detectStake('Sign with private key and send all funds')).toBe('critical');
  });

  it('root access → critical floor', () => {
    expect(detectStake('Grant root access to the agent')).toBe('critical');
  });

  it('all funds → critical floor', () => {
    expect(detectStake('Send all funds immediately')).toBe('critical');
  });

  it('leverage → high floor', () => {
    expect(detectStake('Enter trade with 10x leverage')).toBe('high');
  });

  it('no stop loss → high floor', () => {
    expect(detectStake('Buy ETH with no stop loss')).toBe('high');
  });

  it('liquidation → high floor', () => {
    expect(detectStake('Approaching liquidation threshold')).toBe('high');
  });

  it('margin call → high floor', () => {
    expect(detectStake('This position may trigger a margin call')).toBe('high');
  });

  it('threat keyword beats amount (all funds + $50 → critical)', () => {
    // $50 → low, "all funds" → critical floor. max = critical
    expect(detectStake('Send $50 — that is all funds')).toBe('critical');
  });
});

describe('detectStake — domain minimum floors', () => {
  it('medical domain → high floor', () => {
    expect(detectStake('Administer 500mg medication', undefined, 'medical')).toBe('high');
  });

  it('legal domain → high floor', () => {
    expect(detectStake('Sign the contract', undefined, 'legal')).toBe('high');
  });

  it('financial domain → medium floor', () => {
    expect(detectStake('Execute a trade', undefined, 'financial')).toBe('medium');
  });

  it('code domain → medium floor', () => {
    expect(detectStake('Deploy the update', undefined, 'code')).toBe('medium');
  });

  it('agentic domain → low floor (can be overridden by amount)', () => {
    expect(detectStake('Pay for tool call', undefined, 'agentic')).toBe('low');
  });

  it('agentic domain + $50K → critical (amount beats domain floor)', () => {
    expect(detectStake('Pay $50,000 for tool call', undefined, 'agentic')).toBe('critical');
  });

  it('medical domain + $50 → high (medical floor beats amount)', () => {
    // medical = high, $50 = low → max = high
    expect(detectStake('Administer $50 worth of medication', undefined, 'medical')).toBe('high');
  });
});

describe('detectStake — amount heuristic', () => {
  it('< $100 → low (amount floor=low; agentic domain floor=low; max=low)', () => {
    expect(detectStake('Invest $50', undefined, 'agentic')).toBe('low');
  });

  it('< $100 with no domain → low (amount floor=low is the only floor; fallback=medium only applies when NO floors)', () => {
    // $50 → low floor detected; fallback (medium) only applies when floors=[] → not triggered here
    expect(detectStake('Invest $50')).toBe('low');
  });

  it('$100–$4999 → medium', () => {
    expect(detectStake('Invest $500', undefined, 'agentic')).toBe('medium');
    expect(detectStake('Invest $4999', undefined, 'agentic')).toBe('medium');
  });

  it('$5000 and up to $24999 → high (spec: $5,000–$25,000 = high)', () => {
    // Spec: $5,000–$25,000 → high. Boundary $5,000 inclusive.
    expect(detectStake('Invest $5000', undefined, 'agentic')).toBe('high');
    expect(detectStake('Invest $10,000', undefined, 'agentic')).toBe('high');
    expect(detectStake('Transfer $24999', undefined, 'agentic')).toBe('high');
  });

  it('$25000+ → critical', () => {
    // Spec: > $25,000 → critical. Boundary $25,000 = first critical value.
    expect(detectStake('Transfer $25000', undefined, 'agentic')).toBe('critical');
    expect(detectStake('Buy 50K USDC', undefined, 'agentic')).toBe('critical');
    expect(detectStake('Invest $100,000', undefined, 'agentic')).toBe('critical');
  });

  it('parses 250 USDC correctly', () => {
    expect(detectStake('Send 250 USDC to address', undefined, 'agentic')).toBe('medium');
  });

  it('parses $50K shorthand', () => {
    expect(detectStake('Send $50K to the fund', undefined, 'agentic')).toBe('critical');
  });

  it('parses $1.5M', () => {
    expect(detectStake('Invest $1.5M in the protocol', undefined, 'agentic')).toBe('critical');
  });
});

describe('detectStake — fallback', () => {
  it('no signals → medium', () => {
    expect(detectStake('Check the weather today')).toBe('medium');
  });

  it('no signals with general domain → medium', () => {
    expect(detectStake('Summarize this document', undefined, 'general')).toBe('medium');
  });
});

describe('detectStake — resolution: max of applicable floors', () => {
  it('threat keyword (critical) beats domain floor (medium)', () => {
    // financial domain → medium, seed phrase → critical → max = critical
    expect(detectStake('Sweep all funds using seed phrase', undefined, 'financial')).toBe('critical');
  });

  it('domain floor (high) beats amount (low)', () => {
    // medical → high, $50 → low → max = high
    expect(detectStake('Administer $50 medication', undefined, 'medical')).toBe('high');
  });

  it('leverage (high) + financial (medium) → high', () => {
    expect(detectStake('Enter trade with leverage on margin', undefined, 'financial')).toBe('high');
  });
});
