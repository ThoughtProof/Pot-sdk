import { describe, it, expect } from 'vitest';
import {
  toValidationRecord,
  buildEvidence,
  createTrustDeclaration,
  getFinalityLevel,
} from '../src/erc8004.js';
import type { VerificationResult } from '../src/types.js';

const mockResult: VerificationResult = {
  verified: true,
  verdict: 'VERIFIED',
  confidence: 0.87,
  tier: 'pro',
  flags: [],
  timestamp: '2026-03-07T22:00:00.000Z',
  mdi: 0.72,
  sas: 0.85,
  dpr: {
    score: 0.33,
    total_objections: 3,
    preserved: 1,
    false_consensus: false,
    objection_keywords: ['evidence'],
  },
  synthesis: 'The claim is well-supported by multiple verifiers.',
  dissent: [{ position: 'Minor concern about source quality', weight: 0.15 }],
  pipeline: {
    mode: 'standard',
    generators: ['gpt-4o', 'deepseek-chat', 'grok-3'],
    critic: 'claude-sonnet-4-5',
    synthesizer: 'gpt-4o',
    rounds: 1,
    duration_ms: 8500,
  },
};

describe('toValidationRecord', () => {
  it('should convert confidence to 0-100 score', () => {
    const evidence = buildEvidence(mockResult);
    const record = toValidationRecord(mockResult, {
      evidenceUri: 'ipfs://QmTest123',
      evidenceHash: evidence.metadata.evidence_hash,
    });

    expect(record.validationScore).toBe(87);
    expect(record.validationMethod).toBe('epistemic-verification');
    expect(record.evidenceUri).toBe('ipfs://QmTest123');
    expect(record.evidenceHash).toBe(evidence.metadata.evidence_hash);
    expect(record.validatedAt).toBe('2026-03-07T22:00:00.000Z');
  });

  it('should clamp score to 0-100', () => {
    const lowResult = { ...mockResult, confidence: -0.1 };
    const highResult = { ...mockResult, confidence: 1.5 };

    expect(toValidationRecord(lowResult, { evidenceUri: 'test' }).validationScore).toBe(0);
    expect(toValidationRecord(highResult, { evidenceUri: 'test' }).validationScore).toBe(100);
  });

  it('should include optional agent IDs and chain', () => {
    const record = toValidationRecord(mockResult, {
      evidenceUri: 'ipfs://QmTest',
      validatorAgentId: 'erc8004:1:12345',
      targetAgentId: 'erc8004:1:67890',
      chainId: 8453,
    });

    expect(record.validatorAgentId).toBe('erc8004:1:12345');
    expect(record.targetAgentId).toBe('erc8004:1:67890');
    expect(record.chainId).toBe(8453);
  });

  it('should round confidence correctly', () => {
    const r1 = { ...mockResult, confidence: 0.875 };
    const r2 = { ...mockResult, confidence: 0.874 };

    expect(toValidationRecord(r1, { evidenceUri: 'test' }).validationScore).toBe(88);
    expect(toValidationRecord(r2, { evidenceUri: 'test' }).validationScore).toBe(87);
  });
});

describe('buildEvidence', () => {
  it('should produce valid evidence with hash', () => {
    const evidence = buildEvidence(mockResult);

    expect(evidence['@context']).toBe('https://thoughtproof.ai/ctx/erc8004/v1');
    expect(evidence.type).toBe('EpistemicValidationEvidence');
    expect(evidence.result.verdict).toBe('VERIFIED');
    expect(evidence.result.confidence).toBe(0.87);
    expect(evidence.metadata.evidence_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(evidence.metadata.sdk_version).toBe('0.6.2');
  });

  it('should include credential when provided', () => {
    const fakeCredential = {
      '@context': 'https://thoughtproof.ai/ctx/a2a/v1',
      type: 'VerificationCredential' as const,
      tp_version: '0.3',
      id: 'tp:vc:test',
      issued_at: '2026-03-07T22:00:00.000Z',
      expires_at: null,
      issuer: { id: 'test', sdk_version: '0.3.0', pipeline: 'test', unaudited: true },
      subject: { claim_hash: 'sha256:abc', claim_preview: 'test', type: 'text', request_id: 'req_1' },
      result: {
        verdict: 'VERIFIED' as const,
        confidence: 0.87,
        consensus_threshold: 0.7,
        consensus_reached: true,
        metrics: { mdi: 0.72, sas: 0.85, dpr: { score: 0.33, total_objections: 3, preserved: 1, false_consensus: false, objection_keywords: [] } },
        synthesis: 'test',
        dissent: [],
        adversarial_patterns_detected: [],
        false_consensus_flag: false,
      },
      pipeline: { mode: 'standard' as const, generators: [], critic: '', synthesizer: '', rounds: 1, duration_ms: 0 },
      proof: { type: 'SHA256-Canonical', algorithm: 'pot-schema-signing-v1', hash: 'sha256:test', signed_at: '2026-03-07T22:00:00.000Z' },
    };

    const evidence = buildEvidence(mockResult, fakeCredential);
    expect(evidence.credential).toBeDefined();
    expect(evidence.credential?.id).toBe('tp:vc:test');
  });

  it('should produce deterministic hash for same input', () => {
    const e1 = buildEvidence(mockResult);
    const e2 = buildEvidence(mockResult);

    expect(e1.metadata.evidence_hash).toBe(e2.metadata.evidence_hash);
  });

  it('should include pipeline details', () => {
    const evidence = buildEvidence(mockResult);

    expect(evidence.pipeline.mode).toBe('standard');
    expect(evidence.pipeline.generators).toEqual(['gpt-4o', 'deepseek-chat', 'grok-3']);
    expect(evidence.pipeline.duration_ms).toBe(8500);
  });
});

describe('createTrustDeclaration', () => {
  it('should produce valid trust declaration', () => {
    const decl = createTrustDeclaration(['openai', 'anthropic', 'xai', 'deepseek']);

    expect(decl.type).toBe('epistemic-verification');
    expect(decl.provider).toBe('thoughtproof');
    expect(decl.verifierCount).toBe(4);
    expect(decl.verifierDiversity).toEqual(['openai', 'anthropic', 'xai', 'deepseek']);
    expect(decl.signatureScheme).toBe('EdDSA-Ed25519');
    expect(decl.endpoint).toBe('https://api.thoughtproof.ai/v1/verify');
    expect(decl.jwksUri).toBe('https://api.thoughtproof.ai/.well-known/jwks.json');
  });

  it('should accept custom endpoint', () => {
    const decl = createTrustDeclaration(['openai'], {
      endpoint: 'https://custom.api/verify',
    });

    expect(decl.endpoint).toBe('https://custom.api/verify');
  });
});

describe('getFinalityLevel', () => {
  it('should return soft for basic mode', () => {
    const result = {
      ...mockResult,
      pipeline: { ...mockResult.pipeline!, mode: 'basic' as const, generators: ['gpt-4o'], rounds: 1 },
    };
    expect(getFinalityLevel(result)).toBe('soft');
  });

  it('should return medium for standard mode with 3+ generators', () => {
    expect(getFinalityLevel(mockResult)).toBe('medium');
  });

  it('should return hard for deep mode', () => {
    const result = {
      ...mockResult,
      pipeline: { ...mockResult.pipeline!, mode: 'deep' as const },
    };
    expect(getFinalityLevel(result)).toBe('hard');
  });

  it('should return hard for multi-round verification', () => {
    const result = {
      ...mockResult,
      pipeline: { ...mockResult.pipeline!, rounds: 2 },
    };
    expect(getFinalityLevel(result)).toBe('hard');
  });

  it('should return hard for 5+ generators', () => {
    const result = {
      ...mockResult,
      pipeline: { ...mockResult.pipeline!, generators: ['a', 'b', 'c', 'd', 'e'] },
    };
    expect(getFinalityLevel(result)).toBe('hard');
  });
});
