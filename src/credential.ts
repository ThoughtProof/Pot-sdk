/**
 * TP-VC Verification — v0.3
 *
 * Verify the integrity and validity of a received Verification Credential.
 * Used by agents consuming TP-VCs from other agents.
 */

import { createHash } from 'crypto';
import type { TPVerificationCredential } from './types.js';
import { canonicalize } from './schema.js';

export interface CredentialVerifyResult {
  /** Overall validity (hash matches + not expired + well-formed) */
  valid: boolean;
  /** Whether the proof hash matches the VC body */
  hash_match: boolean;
  /** Recomputed hash of the VC body */
  current_hash: string;
  /** Hash from the VC's proof field */
  expected_hash: string;
  /** Whether the credential has expired */
  expired: boolean;
  /** Human-readable status */
  status: 'valid' | 'hash-mismatch' | 'expired' | 'malformed';
}

/**
 * Verify a ThoughtProof Verification Credential (TP-VC).
 *
 * Checks:
 * 1. Structure — required fields present
 * 2. Integrity — proof hash matches canonical body
 * 3. Expiry — not past expires_at
 *
 * @example
 * ```typescript
 * const check = verifyCredential(vc);
 * if (check.valid) {
 *   // VC is authentic and untampered
 * }
 * ```
 */
export function verifyCredential(vc: TPVerificationCredential): CredentialVerifyResult {
  // Malformed check
  if (!vc || !vc.proof || !vc.proof.hash || !vc.type || vc.type !== 'VerificationCredential') {
    return {
      valid: false,
      hash_match: false,
      current_hash: '',
      expected_hash: vc?.proof?.hash || '',
      expired: false,
      status: 'malformed',
    };
  }

  // Check expiry
  const expired = vc.expires_at ? new Date(vc.expires_at) < new Date() : false;

  // Recompute hash over VC body (everything except `proof`)
  const { proof, ...body } = vc;
  const canonical = canonicalize(body);
  const currentHash = `sha256:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
  const hashMatch = currentHash === vc.proof.hash;

  if (expired) {
    return {
      valid: false,
      hash_match: hashMatch,
      current_hash: currentHash,
      expected_hash: vc.proof.hash,
      expired: true,
      status: 'expired',
    };
  }

  return {
    valid: hashMatch,
    hash_match: hashMatch,
    current_hash: currentHash,
    expected_hash: vc.proof.hash,
    expired: false,
    status: hashMatch ? 'valid' : 'hash-mismatch',
  };
}
