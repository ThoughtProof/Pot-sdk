import { describe, it, expect } from 'vitest';
import {
  canonicalize,
  canonicalizeJcs,
  canonicalizeForAlgorithm,
  DIGEST_ALG_JCS,
  DIGEST_ALG_LEGACY,
} from '../src/schema.js';
import { createAttestation } from '../src/attestation.js';
import { verifyCredential } from '../src/credential.js';
import type { VerificationResult, TPVerificationCredential } from '../src/types.js';
import { createHash } from 'crypto';

function baseResult(): VerificationResult {
  return {
    verdict: 'ALLOW',
    confidence: 0.8,
    severity_score: null,
    mdi: 0.7,
    objections: [],
    domain: 'general',
    stakeLevel: 'medium',
    tier: 'standard',
    durationMs: 1,
    verified: true,
    flags: [],
    timestamp: new Date().toISOString(),
    synthesis: 'ok',
    dissent: [],
  } as unknown as VerificationResult;
}

describe('JCS canonicalize (PR-C hygiene)', () => {
  it('JCS sorts object keys (RFC 8785)', () => {
    const a = canonicalizeJcs({ b: 1, a: 2 });
    const b = canonicalizeJcs({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  it('legacy and JCS may differ on the same object', () => {
    const obj = { z: true, a: [2, 1], m: { y: 1, x: 2 } };
    // Both deterministic; equality not required across algorithms
    expect(canonicalize(obj)).toBe(canonicalize(obj));
    expect(canonicalizeJcs(obj)).toBe(canonicalizeJcs(obj));
  });

  it('canonicalizeForAlgorithm routes by algorithm id', () => {
    const obj = { b: 1, a: 2 };
    expect(canonicalizeForAlgorithm(obj, DIGEST_ALG_JCS)).toBe(canonicalizeJcs(obj));
    expect(canonicalizeForAlgorithm(obj, DIGEST_ALG_LEGACY)).toBe(canonicalize(obj));
    expect(canonicalizeForAlgorithm(obj, undefined)).toBe(canonicalize(obj));
  });

  it('createAttestation emits JCS digest algorithm', () => {
    const vc = createAttestation(baseResult(), { claim: 'jcs test claim' });
    expect(vc.proof.algorithm).toBe(DIGEST_ALG_JCS);
    expect(vc.proof.type).toBe('SHA256-JCS-Digest');
    expect(vc.proof.hash.startsWith('sha256:')).toBe(true);

    const check = verifyCredential(vc);
    expect(check.valid).toBe(true);
    expect(check.hash_match).toBe(true);
  });

  it('verifyCredential still accepts legacy digests', () => {
    // Build a minimal VC body and sign with legacy canon
    const body = {
      '@context': 'https://thoughtproof.ai/ctx/a2a/v1',
      type: 'VerificationCredential' as const,
      tp_version: '2.0',
      id: 'tp:vc:legacy-test',
      issued_at: '2026-01-01T00:00:00.000Z',
      expires_at: null,
      issuer: {
        id: 'https://thoughtproof.ai',
        sdk_version: '2.0.0',
        pipeline: 'PoT-5-Stage',
        unaudited: true,
      },
      subject: {
        claim_hash: 'sha256:abc',
        claim_preview: 'legacy',
        type: 'text',
        request_id: 'req_legacy',
      },
      result: {
        verdict: 'ALLOW' as const,
        confidence: 0.9,
        consensus_threshold: 0.7,
        consensus_reached: true,
        metrics: {
          mdi: 0.5,
          sas: 0.5,
          dpr: {
            score: 0,
            total_objections: 0,
            preserved: 0,
            false_consensus: false,
            objection_keywords: [],
          },
        },
        synthesis: 'ok',
        dissent: [],
        adversarial_patterns_detected: [],
        false_consensus_flag: false,
      },
      pipeline: {
        mode: 'standard' as const,
        generators: [],
        critic: '',
        synthesizer: '',
        rounds: 1,
        duration_ms: 1,
      },
    };

    const legacyCanon = canonicalize(body);
    const hash = `sha256:${createHash('sha256').update(legacyCanon, 'utf8').digest('hex')}`;
    const vc = {
      ...body,
      proof: {
        type: 'SHA256-Canonical-Digest',
        algorithm: DIGEST_ALG_LEGACY,
        hash,
        signed_at: '2026-01-01T00:00:00.000Z',
      },
    } as TPVerificationCredential;

    const check = verifyCredential(vc);
    expect(check.valid).toBe(true);
    expect(check.hash_match).toBe(true);
  });

  it('tampered JCS VC fails verify', () => {
    const vc = createAttestation(baseResult(), { claim: 'tamper me' });
    const bad = {
      ...vc,
      result: { ...vc.result, synthesis: 'tampered' },
    } as TPVerificationCredential;
    const check = verifyCredential(bad);
    expect(check.valid).toBe(false);
    expect(check.status).toBe('hash-mismatch');
  });
});
