/**
 * ERC-8004 Validation Provider Adapter
 *
 * Converts ThoughtProof verification results into ERC-8004 Validation Registry
 * compatible records. Bridges off-chain epistemic verification with on-chain
 * trust infrastructure.
 *
 * ERC-8004 ("Trustless Agents") defines three on-chain registries:
 *   - Identity Registry (ERC-721 agent NFTs)
 *   - Reputation Registry (feedback & performance scores)
 *   - Validation Registry (task correctness evidence)
 *
 * The Validation Registry accepts pluggable validation methods. This module
 * provides "epistemic-verification" as a validation method, using multi-model
 * consensus as the verification mechanism.
 *
 * @see https://eips.ethereum.org/EIPS/eip-8004
 * @see https://thoughtproof.ai/blog/erc-8004-validation
 */

import { createHash } from 'crypto';
import type { VerificationResult, TPVerificationCredential } from './types.js';
import { canonicalize } from './schema.js';

// ── Types ──────────────────────────────────────────────────────────────────

/**
 * ERC-8004 Validation Record — the on-chain compatible output.
 *
 * This maps to the Validation Registry's expected interface:
 * - validationScore: 0-100 (uint8)
 * - validationMethod: string identifier
 * - evidenceUri: IPFS CID or HTTP URL to full Epistemic Block
 * - validatorId: ERC-8004 agent token ID of the validator
 */
export interface ERC8004ValidationRecord {
  /** Validation score (0-100), derived from confidence */
  validationScore: number;
  /** Validation method identifier */
  validationMethod: 'epistemic-verification';
  /** URI to full evidence (IPFS CID or HTTPS URL) */
  evidenceUri: string;
  /** SHA-256 hash of the canonical evidence JSON */
  evidenceHash: string;
  /** ISO timestamp of validation */
  validatedAt: string;
  /** ERC-8004 agent token ID of the validator (ThoughtProof operator) */
  validatorAgentId?: string;
  /** Chain ID where the validation should be recorded */
  chainId?: number;
  /** Target agent's ERC-8004 token ID being validated */
  targetAgentId?: string;
}

/**
 * ERC-8004 Trust Declaration — for agent registration metadata.
 *
 * Agents include this in their registration file's `supportedTrust` array
 * to advertise ThoughtProof epistemic verification support.
 */
export interface ERC8004TrustDeclaration {
  type: 'epistemic-verification';
  provider: 'thoughtproof';
  endpoint: string;
  verifierCount: number;
  verifierDiversity: string[];
  signatureScheme: 'EdDSA-Ed25519' | 'SHA256-Canonical';
  jwksUri?: string;
}

/**
 * Full evidence payload pinned to IPFS or stored off-chain.
 * Contains everything needed to independently verify the validation.
 */
export interface ERC8004Evidence {
  /** Schema version */
  '@context': 'https://thoughtproof.ai/ctx/erc8004/v1';
  /** Evidence type */
  type: 'EpistemicValidationEvidence';
  /** ThoughtProof Verification Credential (if available) */
  credential?: TPVerificationCredential;
  /** Raw verification result */
  result: {
    verdict: string;
    confidence: number;
    mdi?: number;
    sas?: number;
    dpr?: {
      score: number;
      total_objections: number;
      preserved: number;
      false_consensus: boolean;
    };
    synthesis?: string;
    dissent?: Array<{ position: string; weight: number }>;
    flags: string[];
  };
  /** Pipeline details */
  pipeline: {
    mode: string;
    generators: string[];
    critic: string;
    synthesizer: string;
    rounds: number;
    duration_ms: number;
  };
  /** Validation metadata */
  metadata: {
    sdk_version: string;
    validated_at: string;
    evidence_hash: string;
  };
}

/**
 * Options for creating an ERC-8004 validation record.
 */
export interface ERC8004Options {
  /** URI where evidence will be stored (e.g., ipfs://Qm... or https://...) */
  evidenceUri: string;
  /** Optional hash of the full evidence payload (recommended: evidence.metadata.evidence_hash) */
  evidenceHash?: string;
  /** ThoughtProof operator's ERC-8004 agent token ID */
  validatorAgentId?: string;
  /** Target agent's ERC-8004 token ID */
  targetAgentId?: string;
  /** Chain ID for on-chain recording (1=mainnet, 8453=Base, 10=Optimism, etc.) */
  chainId?: number;
}

// ── Constants ──────────────────────────────────────────────────────────────

const SDK_VERSION = '0.6.2';
const DEFAULT_ENDPOINT = 'https://api.thoughtproof.ai/v1/verify';
const DEFAULT_JWKS = 'https://api.thoughtproof.ai/.well-known/jwks.json';

// ── Core Functions ─────────────────────────────────────────────────────────

/**
 * Convert a ThoughtProof VerificationResult into an ERC-8004 Validation Record.
 *
 * The validation score is derived from confidence:
 *   - confidence 0.0-1.0 → score 0-100
 *   - Clamped to integer range [0, 100]
 *
 * @param result - Output from verify()
 * @param options - ERC-8004 specific options (evidence URI, agent IDs, chain)
 * @returns ERC-8004 compatible validation record
 *
 * @example
 * ```typescript
 * import { verify, buildEvidence, toValidationRecord } from 'pot-sdk';
 *
 * const result = await verify(agentOutput, { claim: "...", providers: [...] });
 * const evidence = buildEvidence(result);
 * const record = toValidationRecord(result, {
 *   evidenceUri: 'ipfs://QmXyz...',
 *   evidenceHash: evidence.metadata.evidence_hash,
 *   validatorAgentId: 'erc8004:1:12345',
 *   targetAgentId: 'erc8004:1:67890',
 *   chainId: 1,
 * });
 * // Submit record to ERC-8004 Validation Registry contract
 * ```
 */
export function toValidationRecord(
  result: VerificationResult,
  options: ERC8004Options
): ERC8004ValidationRecord {
  const score = Math.round(Math.min(100, Math.max(0, result.confidence * 100)));
  const evidenceHash = options.evidenceHash || computeEvidenceHash(result);

  return {
    validationScore: score,
    validationMethod: 'epistemic-verification',
    evidenceUri: options.evidenceUri,
    evidenceHash,
    validatedAt: result.timestamp || new Date().toISOString(),
    ...(options.validatorAgentId ? { validatorAgentId: options.validatorAgentId } : {}),
    ...(options.targetAgentId ? { targetAgentId: options.targetAgentId } : {}),
    ...(options.chainId ? { chainId: options.chainId } : {}),
  };
}

/**
 * Build the full evidence payload for off-chain storage (IPFS / HTTPS).
 *
 * This contains everything needed for independent verification:
 * - The complete verification result
 * - Pipeline details (which models, how many rounds)
 * - The TP-VC credential (if provided)
 * - A content-addressable hash for integrity
 *
 * @param result - Output from verify()
 * @param credential - Optional TP-VC from createAttestation()
 * @returns Evidence payload ready for IPFS pinning
 */
export function buildEvidence(
  result: VerificationResult,
  credential?: TPVerificationCredential
): ERC8004Evidence {
  const evidence: ERC8004Evidence = {
    '@context': 'https://thoughtproof.ai/ctx/erc8004/v1',
    type: 'EpistemicValidationEvidence',
    ...(credential ? { credential } : {}),
    result: {
      verdict: result.verdict || 'UNCERTAIN',
      confidence: result.confidence,
      mdi: result.mdi,
      sas: result.sas,
      dpr: result.dpr ? {
        score: result.dpr.score,
        total_objections: result.dpr.total_objections,
        preserved: result.dpr.preserved,
        false_consensus: result.dpr.false_consensus,
      } : undefined,
      synthesis: result.synthesis,
      dissent: result.dissent,
      flags: result.flags || [],
    },
    pipeline: result.pipeline || {
      mode: 'unknown',
      generators: [],
      critic: '',
      synthesizer: '',
      rounds: 0,
      duration_ms: 0,
    },
    metadata: {
      sdk_version: SDK_VERSION,
      validated_at: result.timestamp || new Date().toISOString(),
      evidence_hash: '', // filled below
    },
  };

  // Compute hash over everything except the hash field itself
  const hashInput = { ...evidence, metadata: { ...evidence.metadata, evidence_hash: '' } };
  evidence.metadata.evidence_hash = `sha256:${createHash('sha256').update(canonicalize(hashInput), 'utf8').digest('hex')}`;

  return evidence;
}

/**
 * Generate an ERC-8004 Trust Declaration for agent registration.
 *
 * Include this in the agent's registration file under `supportedTrust`
 * so other agents can discover that this agent supports epistemic verification.
 *
 * @param verifierProviders - List of provider names used for verification
 * @param options - Optional overrides for endpoint and JWKS URI
 * @returns Trust declaration for agent registration metadata
 *
 * @example
 * ```typescript
 * const declaration = createTrustDeclaration(
 *   ['openai', 'anthropic', 'xai', 'deepseek'],
 *   { endpoint: 'https://api.thoughtproof.ai/v1/verify' }
 * );
 * // Add to agent's ERC-8004 registration file:
 * // { "supportedTrust": [declaration] }
 * ```
 */
export function createTrustDeclaration(
  verifierProviders: string[],
  options?: { endpoint?: string; jwksUri?: string }
): ERC8004TrustDeclaration {
  return {
    type: 'epistemic-verification',
    provider: 'thoughtproof',
    endpoint: options?.endpoint || DEFAULT_ENDPOINT,
    verifierCount: verifierProviders.length,
    verifierDiversity: verifierProviders,
    signatureScheme: 'EdDSA-Ed25519',
    ...(options?.jwksUri !== undefined ? { jwksUri: options.jwksUri } : { jwksUri: DEFAULT_JWKS }),
  };
}

/**
 * Map ThoughtProof confidence to ERC-8004 finality level.
 *
 * ERC-8004 supports progressive finality (soft → hard).
 * This helper categorizes based on verification depth.
 *
 * @param result - Verification result
 * @returns Finality level string
 *
 * Note: this is a local heuristic for UX/routing. Actual ERC-8004 finality
 * semantics are determined by the validation protocol / registry integration.
 */
export function getFinalityLevel(result: VerificationResult): 'soft' | 'medium' | 'hard' {
  const mode = result.pipeline?.mode || 'basic';
  const rounds = result.pipeline?.rounds || 1;
  const generatorCount = result.pipeline?.generators?.length || 0;

  if (mode === 'deep' || rounds > 1 || generatorCount >= 5) {
    return 'hard';
  }
  if (mode === 'standard' || generatorCount >= 3) {
    return 'medium';
  }
  return 'soft';
}

// ── Internal Helpers ───────────────────────────────────────────────────────

function computeEvidenceHash(result: VerificationResult): string {
  const input = {
    verdict: result.verdict,
    confidence: result.confidence,
    mdi: result.mdi,
    sas: result.sas,
    flags: result.flags,
    timestamp: result.timestamp,
  };
  return `sha256:${createHash('sha256').update(canonicalize(input), 'utf8').digest('hex')}`;
}
