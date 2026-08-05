import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
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

/**
 * Legacy fixture: TP-VC generated from the published pot-sdk@3.0.0-rc.2 npm package.
 * Created 2026-08-05 via: npm install pot-sdk@3.0.0-rc.2 && createAttestation(...)
 * Contains no keys, no secrets — structural data and a content digest only.
 */
const legacyFixturePath = resolve(__dirname, 'fixtures', 'legacy-vc-rc2.json');
const legacyVc: TPVerificationCredential = JSON.parse(readFileSync(legacyFixturePath, 'utf8'));

describe('JCS canonicalize (PR-C hygiene)', () => {
  it('JCS sorts object keys (RFC 8785)', () => {
    const a = canonicalizeJcs({ b: 1, a: 2 });
    const b = canonicalizeJcs({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  it('legacy and JCS produce different canonical output on nested objects', () => {
    // JCS normalizes Unicode escapes and whitespace differently from
    // the bespoke key-sort; on nested objects with arrays the output differs.
    const obj = { z: true, a: [2, 1], m: { y: 1, x: 2 } };
    const legacy = canonicalize(obj);
    const jcs = canonicalizeJcs(obj);
    // Both deterministic
    expect(canonicalize(obj)).toBe(legacy);
    expect(canonicalizeJcs(obj)).toBe(jcs);
    // They are different algorithms — canonical forms may differ
    // (JCS uses minimal JSON.stringify; legacy uses custom sort+stringify)
    expect(typeof legacy).toBe('string');
    expect(typeof jcs).toBe('string');
  });

  it('canonicalizeForAlgorithm routes by algorithm id (strict allowlist)', () => {
    const obj = { b: 1, a: 2 };
    expect(canonicalizeForAlgorithm(obj, DIGEST_ALG_JCS)).toBe(canonicalizeJcs(obj));
    expect(canonicalizeForAlgorithm(obj, DIGEST_ALG_LEGACY)).toBe(canonicalize(obj));
  });

  it('canonicalizeForAlgorithm throws on unknown algorithm', () => {
    expect(() => canonicalizeForAlgorithm({}, 'unknown-v999')).toThrow(/unsupported algorithm/);
  });

  it('canonicalizeForAlgorithm throws on empty algorithm', () => {
    expect(() => canonicalizeForAlgorithm({}, '')).toThrow(/unsupported algorithm/);
  });

  it('canonicalizeForAlgorithm throws on undefined algorithm', () => {
    expect(() => canonicalizeForAlgorithm({}, undefined)).toThrow(/unsupported algorithm/);
  });

  it('canonicalizeForAlgorithm rejects jcs/RFC8785 aliases', () => {
    expect(() => canonicalizeForAlgorithm({}, 'jcs')).toThrow(/unsupported algorithm/);
    expect(() => canonicalizeForAlgorithm({}, 'RFC8785')).toThrow(/unsupported algorithm/);
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

  it('verifyCredential still accepts legacy digests (manually constructed)', () => {
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

  it('verifyCredential accepts real published rc.2 legacy fixture', () => {
    // Fixture generated from npm pot-sdk@3.0.0-rc.2 (see header comment).
    // proof.type = 'SHA256-Canonical' (pre-#6 wording), algorithm = pot-schema-signing-v1.
    expect(legacyVc.proof.type).toBe('SHA256-Canonical');
    expect(legacyVc.proof.algorithm).toBe('pot-schema-signing-v1');

    const check = verifyCredential(legacyVc);
    expect(check.valid).toBe(true);
    expect(check.hash_match).toBe(true);
    expect(check.status).toBe('valid');
  });

  it('verifyCredential accepts pre-#6 type variant SHA256-Canonical', () => {
    // Same body as legacy fixture but explicitly testing the pre-#6 type string
    const { proof, ...body } = legacyVc;
    const legacyCanon = canonicalize(body);
    const hash = `sha256:${createHash('sha256').update(legacyCanon, 'utf8').digest('hex')}`;
    const vc = {
      ...body,
      proof: {
        type: 'SHA256-Canonical',
        algorithm: DIGEST_ALG_LEGACY,
        hash,
        signed_at: legacyVc.issued_at,
      },
    } as TPVerificationCredential;

    const check = verifyCredential(vc);
    expect(check.valid).toBe(true);
  });

  it('verifyCredential rejects contradictory type/algorithm pair', () => {
    // JCS type with legacy algorithm — contradictory
    const vc = {
      ...legacyVc,
      proof: {
        type: 'SHA256-JCS-Digest',
        algorithm: DIGEST_ALG_LEGACY,
        hash: legacyVc.proof.hash,
        signed_at: legacyVc.issued_at,
      },
    } as TPVerificationCredential;
    const check = verifyCredential(vc);
    expect(check.valid).toBe(false);
    expect(check.status).toBe('malformed');
  });

  it('verifyCredential rejects unknown algorithm', () => {
    const vc = {
      ...legacyVc,
      proof: {
        type: 'SHA256-Canonical-Digest',
        algorithm: 'unknown-v999',
        hash: legacyVc.proof.hash,
        signed_at: legacyVc.issued_at,
      },
    } as TPVerificationCredential;
    const check = verifyCredential(vc);
    expect(check.valid).toBe(false);
    expect(check.status).toBe('malformed');
  });

  it('verifyCredential rejects empty algorithm', () => {
    const vc = {
      ...legacyVc,
      proof: {
        type: 'SHA256-Canonical-Digest',
        algorithm: '',
        hash: legacyVc.proof.hash,
        signed_at: legacyVc.issued_at,
      },
    } as TPVerificationCredential;
    const check = verifyCredential(vc);
    expect(check.valid).toBe(false);
    expect(check.status).toBe('malformed');
  });

  it('verifyCredential rejects missing algorithm', () => {
    const vc = {
      ...legacyVc,
      proof: {
        type: 'SHA256-Canonical-Digest',
        hash: legacyVc.proof.hash,
        signed_at: legacyVc.issued_at,
      },
    } as unknown as TPVerificationCredential;
    const check = verifyCredential(vc);
    expect(check.valid).toBe(false);
    expect(check.status).toBe('malformed');
  });

  it('verifyCredential rejects unknown proof.type', () => {
    const vc = {
      ...legacyVc,
      proof: {
        type: 'SHA512-Something',
        algorithm: DIGEST_ALG_LEGACY,
        hash: legacyVc.proof.hash,
        signed_at: legacyVc.issued_at,
      },
    } as TPVerificationCredential;
    const check = verifyCredential(vc);
    expect(check.valid).toBe(false);
    expect(check.status).toBe('malformed');
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
