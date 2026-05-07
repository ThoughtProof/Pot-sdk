import { describe, it, expect } from 'vitest';
import { resolvePolicy } from '../src/policy.js';
import { buildAttestationHeaders } from '../src/headers.js';

// --- Policy Tests ---

describe('resolvePolicy', () => {
  describe('tiered mode', () => {
    it('skip tier for micro-payment', () => {
      const skip = resolvePolicy(0.10, 'tiered');
      expect(skip.mode).toBe('skip');
      expect(skip.minVerifiers).toBe(0);
      expect(skip.tiebreakerOnAnyFlag).toBe(false);
    });

    it('skip tier just below threshold', () => {
      expect(resolvePolicy(0.49, 'tiered').mode).toBe('skip');
    });

    it('async tier at $0.50 (2 verifiers)', () => {
      const async2 = resolvePolicy(0.50, 'tiered');
      expect(async2.mode).toBe('async');
      expect(async2.minVerifiers).toBe(2);
    });

    it('async tier at $50', () => {
      expect(resolvePolicy(50, 'tiered').mode).toBe('async');
    });

    it('async tier at $99.99', () => {
      expect(resolvePolicy(99.99, 'tiered').mode).toBe('async');
    });

    it('sync tier at $100 (3 verifiers)', () => {
      const sync3 = resolvePolicy(100, 'tiered');
      expect(sync3.mode).toBe('sync');
      expect(sync3.minVerifiers).toBe(3);
      expect(sync3.tiebreakerOnAnyFlag).toBe(false);
    });

    it('sync tier at $500', () => {
      expect(resolvePolicy(500, 'tiered').mode).toBe('sync');
    });

    it('sync tier at $999.99', () => {
      expect(resolvePolicy(999.99, 'tiered').mode).toBe('sync');
    });

    it('sync-plus tier at $1000 (3 verifiers + tiebreaker)', () => {
      const syncPlus = resolvePolicy(1000, 'tiered');
      expect(syncPlus.mode).toBe('sync-plus');
      expect(syncPlus.minVerifiers).toBe(3);
      expect(syncPlus.tiebreakerOnAnyFlag).toBe(true);
    });

    it('sync-plus tier at $5000', () => {
      expect(resolvePolicy(5000, 'tiered').mode).toBe('sync-plus');
    });

    it('sync-plus tier at $50000', () => {
      expect(resolvePolicy(50000, 'tiered').mode).toBe('sync-plus');
    });
  });

  describe('override policies', () => {
    it('always overrides micro to sync', () => {
      expect(resolvePolicy(0.01, 'always').mode).toBe('sync');
    });

    it('skip overrides large to skip', () => {
      expect(resolvePolicy(1000, 'skip').mode).toBe('skip');
    });
  });
});

// --- Header Tests ---

describe('buildAttestationHeaders', () => {
  it('builds correct headers for a PASS verdict', () => {
    const mockResult = {
      verdict: 'PASS' as const,
      confidence: 0.94,
      verifiers: 3,
      chainHash: 'abc123def456',
      auditId: 'test-audit-id',
      latencyMs: 1200,
    };
    const headers = buildAttestationHeaders(mockResult);

    expect(headers['X-402-Attestation-Version']).toBe('1');
    expect(headers['X-402-Attestation-Provider']).toBe('thoughtproof.ai');
    expect(headers['X-402-Attestation-Chain-Hash']).toBe('sha256:abc123def456');
    expect(headers['X-402-Attestation-Verdict']).toBe('PASS');
    expect(headers['X-402-Attestation-Confidence']).toBe('0.94');
    expect(headers['X-402-Attestation-Verifiers']).toBe('3/3');
    expect(headers['X-402-Attestation-Audit-URL']).toContain('test-audit-id');
    expect(headers['X-402-Attestation-Timestamp']).toContain('202');
  });

  it('builds correct headers for a SKIP verdict', () => {
    const skipResult = {
      verdict: 'SKIP' as const,
      confidence: 1.0,
      verifiers: 0,
      chainHash: 'deadbeef',
      auditId: 'skip-audit',
      latencyMs: 0,
    };
    const headers = buildAttestationHeaders(skipResult);

    expect(headers['X-402-Attestation-Verdict']).toBe('SKIP');
    expect(headers['X-402-Attestation-Verifiers']).toBe('0/0');
  });
});
