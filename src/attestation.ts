/**
 * A2A Verification Credential (TP-VC) — v0.3
 *
 * Creates a self-describing, hash-signed Verification Credential
 * from a VerificationResult. The TP-VC can be passed between agents
 * and independently verified via verifyCredential().
 */

import { createHash, randomUUID } from 'crypto';
import type { VerificationResult, TPVerificationCredential, DPRResult } from './types.js';
import { canonicalize } from './schema.js';

const SDK_VERSION = '0.3.0';

export interface AttestationOptions {
  /** The original claim text that was verified */
  claim: string;
  /** Claim type classification */
  type?: 'text' | 'code' | 'decision' | 'medical' | 'financial' | 'legal';
  /** Optional external request ID for tracing */
  requestId?: string;
  /** Whether this is a self-issued (unaudited) credential. Default: true */
  unaudited?: boolean;
}

/**
 * Create a ThoughtProof Verification Credential (TP-VC) from a verification result.
 *
 * @param result - Output from verify()
 * @param options - Claim metadata and attestation settings
 * @returns A complete, hash-signed TP-VC
 *
 * @example
 * ```typescript
 * const result = await verify(output, { claim: "Earth is round", mode: "standard", providers: [...] });
 * const vc = createAttestation(result, { claim: "Earth is round", type: "text" });
 * // vc is a TP-VC — pass to another agent or store as audit trail
 * ```
 */
export function createAttestation(
  result: VerificationResult,
  options: AttestationOptions
): TPVerificationCredential {
  const id = `tp:vc:${randomUUID()}`;
  const now = new Date().toISOString();

  const claimHash = `sha256:${createHash('sha256').update(options.claim, 'utf8').digest('hex')}`;
  const claimPreview = options.claim.slice(0, 120) + (options.claim.length > 120 ? '...' : '');

  const defaultDpr: DPRResult = {
    score: 0,
    total_objections: 0,
    preserved: 0,
    false_consensus: false,
    objection_keywords: [],
  };

  // Build VC body (without proof — proof is computed over this)
  const vcBody: Omit<TPVerificationCredential, 'proof'> = {
    '@context': 'https://thoughtproof.ai/ctx/a2a/v1',
    type: 'VerificationCredential',
    tp_version: '0.3',
    id,
    issued_at: now,
    expires_at: null,

    issuer: {
      id: 'https://thoughtproof.ai',
      sdk_version: SDK_VERSION,
      pipeline: 'PoT-5-Stage',
      unaudited: options.unaudited !== false,
    },

    subject: {
      claim_hash: claimHash,
      claim_preview: claimPreview,
      type: options.type || 'text',
      request_id: options.requestId || `req_${randomUUID()}`,
    },

    result: {
      verdict: result.verdict || 'UNCERTAIN',
      confidence: result.confidence,
      consensus_threshold: 0.70,
      consensus_reached: result.confidence >= 0.70,
      metrics: {
        mdi: result.mdi || 0,
        sas: result.sas || 0,
        dpr: result.dpr || defaultDpr,
      },
      synthesis: result.synthesis || '',
      dissent: Array.isArray(result.dissent) ? result.dissent : [],
      adversarial_patterns_detected: (result.flags || []).filter((f: string) => f.startsWith('adversarial')),
      false_consensus_flag: result.dpr?.false_consensus || false,
    },

    pipeline: result.pipeline || {
      mode: result.tier === 'pro' ? 'standard' : 'basic',
      generators: [],
      critic: '',
      synthesizer: '',
      rounds: 1,
      duration_ms: 0,
    },
  };

  // Compute proof hash over canonical JSON of the VC body
  const canonical = canonicalize(vcBody);
  const hash = `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;

  return {
    ...vcBody,
    proof: {
      type: 'SHA256-Canonical',
      algorithm: 'pot-schema-signing-v1',
      hash,
      signed_at: now,
    },
  };
}
