/**
 * @pot-sdk/pay — Payment reasoning verification for the ThoughtProof Protocol
 *
 * Adds x402-compatible attestation headers to agent payment requests by
 * verifying the agent's reasoning chain through external multi-model review.
 *
 * @example
 * import { verifyPayment, wrapClient } from '@pot-sdk/pay';
 *
 * // Direct verification
 * const result = await verifyPayment(reasoningChain, {
 *   amount: 50,
 *   currency: 'USDC',
 *   providers: [
 *     { name: 'Anthropic', model: 'claude-sonnet-4-5', apiKey: process.env.ANTHROPIC_API_KEY },
 *     { name: 'DeepSeek', model: 'deepseek-chat', apiKey: process.env.DEEPSEEK_API_KEY },
 *   ]
 * });
 *
 * if (result.verdict === 'PASS') {
 *   await x402client.pay({ headers: result.attestationHeaders, ... });
 * }
 *
 * // Middleware wrapper
 * const client = wrapClient(x402client, { policy: 'tiered', providers: [...] });
 * await client.pay({ amount: 50, currency: 'USDC', resource: url, reasoningChain });
 */

export { verifyPayment } from './verify-payment.js';
export { wrapClient } from './middleware.js';
export { resolvePolicy } from './policy.js';
export { TransactionPolicy } from './transaction-policy.js';
export type { TransactionPolicyConfig, PolicyCheckResult } from './transaction-policy.js';
export { buildAttestationHeaders } from './headers.js';
export {
  VERIFIER_PROFILES,
  getProfile,
  getRecommendedVerifiers,
  warnIfNoHighPerformanceVerifier,
  getWeight,
} from './profiles.js';

export type { VerifierProfile } from './profiles.js';
export type {
  PayVerifyOptions,
  PayVerifyResult,
  PaymentIntent,
  PayWrapOptions,
} from './types.js';
