import type { PayVerifyResult } from './types.js';

/**
 * Generates X-402-Attestation-* headers from a verify result.
 * These headers can be attached to x402 payment requests.
 */
export function buildAttestationHeaders(
  result: Omit<PayVerifyResult, 'attestationHeaders'>,
  provider = 'thoughtproof.ai'
): Record<string, string> {
  return {
    'X-402-Attestation-Version': '1',
    'X-402-Attestation-Provider': provider,
    'X-402-Attestation-Chain-Hash': `sha256:${result.chainHash}`,
    'X-402-Attestation-Verdict': result.verdict,
    'X-402-Attestation-Confidence': result.confidence.toFixed(2),
    'X-402-Attestation-Verifiers': `${result.verifiers}/${result.verifiers}`,
    'X-402-Attestation-Audit-URL': `https://${provider}/chain/${result.auditId}`,
    'X-402-Attestation-Timestamp': new Date().toISOString(),
  };
}
