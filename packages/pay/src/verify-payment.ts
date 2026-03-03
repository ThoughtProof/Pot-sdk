import { createHash, randomUUID } from 'crypto';
import { verify } from 'pot-sdk';
import { buildAttestationHeaders } from './headers.js';
import { resolvePolicy } from './policy.js';
import { getWeight, warnIfNoHighPerformanceVerifier } from './profiles.js';
import { buildPaymentVerifierPrompt } from './prompts.js';
import type { PayVerifyOptions, PayVerifyResult } from './types.js';

function buildChainHash(chain: string, txNonce: string): string {
  return createHash('sha256')
    .update(chain + txNonce)
    .digest('hex');
}

/**
 * Resolve the effective consensus mode, accounting for valueThreshold auto-switch.
 */
function resolveConsensusMode(
  amount: number,
  consensusMode: PayVerifyOptions['consensusMode'] = 'majority',
  valueThreshold: number = 50
): 'majority' | 'conservative' | 'weighted' {
  if (amount > valueThreshold) return 'conservative';
  return consensusMode;
}

/**
 * Apply consensus logic to a set of per-verifier verdicts.
 * Returns true if the aggregate verdict is FLAG.
 */
function applyConsensus(
  verifierVerdicts: Array<{ modelId: string; flagged: boolean }>,
  mode: 'majority' | 'conservative' | 'weighted'
): boolean {
  if (verifierVerdicts.length === 0) return false;

  if (mode === 'conservative') {
    // Any verifier flagging is sufficient
    return verifierVerdicts.some((v) => v.flagged);
  }

  if (mode === 'weighted') {
    const totalWeight = verifierVerdicts.reduce((sum, v) => sum + getWeight(v.modelId), 0);
    const flagWeight = verifierVerdicts
      .filter((v) => v.flagged)
      .reduce((sum, v) => sum + getWeight(v.modelId), 0);
    return flagWeight > totalWeight / 2;
  }

  // majority: flag if ≥ ceil(2/3) verifiers flag
  const flagCount = verifierVerdicts.filter((v) => v.flagged).length;
  const threshold = Math.ceil((2 / 3) * verifierVerdicts.length);
  return flagCount >= threshold;
}

export async function verifyPayment(
  reasoningChain: string,
  options: PayVerifyOptions
): Promise<PayVerifyResult> {
  const startMs = Date.now();
  const {
    amount,
    currency,
    providers,
    policy = 'tiered',
    minConfidence = 0.80,
    attestationProvider = 'thoughtproof.ai',
    consensusMode = 'majority',
    valueThreshold = 50,
  } = options;

  // Warn if no high-performance verifier in the provider list
  const modelIds = providers.map((p) => p.model);
  const perfWarning = warnIfNoHighPerformanceVerifier(modelIds);
  if (perfWarning) {
    console.warn(`[pot-sdk/pay] ${perfWarning}`);
  }

  // Resolve effective consensus mode (auto-switch for high-value tx)
  const effectiveConsensusMode = resolveConsensusMode(amount, consensusMode, valueThreshold);

  const policyResult = resolvePolicy(amount, policy);
  const auditId = randomUUID();
  const txNonce = randomUUID();
  const chainHash = buildChainHash(reasoningChain, txNonce);

  // Skip — no verification for micro-payments
  if (policyResult.mode === 'skip') {
    const partialResult = {
      verdict: 'SKIP' as const,
      confidence: 1.0,
      verifiers: 0,
      chainHash,
      auditId,
      latencyMs: Date.now() - startMs,
    };
    return {
      ...partialResult,
      attestationHeaders: buildAttestationHeaders(partialResult, attestationProvider),
    };
  }

  // Run verification via pot-sdk core (DSPy-optimized prompt, v0.9.4+)
  const claim = buildPaymentVerifierPrompt(reasoningChain, amount, currency, options.context);

  let potResult: Awaited<ReturnType<typeof verify>>;
  try {
    potResult = await verify(claim, { providers });
  } catch (err) {
    // Verification service unavailable — fail open (SKIP) with warning
    console.warn('[pot-sdk/pay] Verification failed, failing open:', err);
    const partialResult = {
      verdict: 'SKIP' as const,
      confidence: 0,
      verifiers: 0,
      chainHash,
      auditId,
      concerns: ['Verification service unavailable'],
      latencyMs: Date.now() - startMs,
    };
    return {
      ...partialResult,
      attestationHeaders: buildAttestationHeaders(partialResult, attestationProvider),
    };
  }

  // Derive verdict from pot-sdk result
  const confidence = potResult.confidence ?? 0;
  const verifiers = providers.length;

  // Check flags for manipulation signals
  const concerns: string[] = [];
  for (const flag of potResult.flags ?? []) {
    if (
      flag.toLowerCase().includes('inject') ||
      flag.toLowerCase().includes('manipulat') ||
      flag.toLowerCase().includes('drift') ||
      flag.toLowerCase().includes('inconsisten')
    ) {
      concerns.push(flag);
    }
  }

  // Build per-verifier verdicts for consensus evaluation
  // pot-sdk returns aggregate verdict; map per-provider based on flags + confidence
  const potVerdict = potResult.verdict;
  const isFlagged = potVerdict !== 'VERIFIED' || confidence < minConfidence || concerns.length > 0;

  // For consensus: treat each provider as one verifier vote
  // (pot-sdk aggregates internally; we apply our consensus layer on top)
  const verifierVerdicts = providers.map((p) => ({
    modelId: p.model,
    // Distribute flag proportionally: if aggregate is flagged, all vote flag
    // This is conservative but correct for MVP until per-verifier responses are available
    flagged: isFlagged,
  }));

  const consensusFlagged = applyConsensus(verifierVerdicts, effectiveConsensusMode);
  const verdict: 'PASS' | 'FLAG' = consensusFlagged ? 'FLAG' : 'PASS';

  const partialResult = {
    verdict,
    confidence,
    verifiers,
    chainHash,
    auditId,
    concerns: concerns.length > 0 ? concerns : undefined,
    latencyMs: Date.now() - startMs,
  };

  return {
    ...partialResult,
    attestationHeaders: buildAttestationHeaders(partialResult, attestationProvider),
  };
}
