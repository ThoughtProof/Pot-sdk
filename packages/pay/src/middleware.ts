import { verifyPayment } from './verify-payment.js';
import type { PayWrapOptions, PaymentIntent, PayVerifyResult } from './types.js';

/**
 * Wraps any x402-compatible client with ThoughtProof payment verification.
 * Adds a `pay()` method that verifies the reasoning chain before executing.
 *
 * @example
 * const client = wrapClient(x402client, {
 *   policy: 'tiered',
 *   providers: [{ name: 'Anthropic', model: 'claude-sonnet-4-5', apiKey: '...' }]
 * });
 * await client.pay({ amount: 50, currency: 'USDC', resource: url, reasoningChain });
 */
export function wrapClient<T extends object>(
  client: T,
  options: PayWrapOptions
): T & { pay: (intent: PaymentIntent) => Promise<{ result: PayVerifyResult; headers: Record<string, string> }> } {
  const wrapped = Object.create(client) as T & {
    pay: (intent: PaymentIntent) => Promise<{ result: PayVerifyResult; headers: Record<string, string> }>;
  };

  wrapped.pay = async (intent: PaymentIntent) => {
    const chain = intent.reasoningChain ?? '[no reasoning chain provided]';

    const result = await verifyPayment(chain, {
      amount: intent.amount,
      currency: intent.currency,
      providers: options.providers,
      policy: options.policy,
      minConfidence: options.minConfidence,
      minVerifiers: options.minVerifiers,
      attestationProvider: options.attestationProvider,
    });

    if (result.verdict === 'FLAG') {
      if (options.onFlag) {
        options.onFlag(result, intent);
      } else {
        throw new Error(
          `[pot-sdk/pay] Payment flagged by verifiers. ` +
          `Confidence: ${result.confidence.toFixed(2)}. ` +
          `Audit: ${result.attestationHeaders['X-402-Attestation-Audit-URL']}`
        );
      }
    }

    return {
      result,
      headers: result.attestationHeaders,
    };
  };

  return wrapped;
}
