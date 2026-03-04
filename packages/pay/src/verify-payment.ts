import { createHash, randomUUID } from 'crypto';
import { verify, createProviderFromConfig } from 'pot-sdk';
import { buildAttestationHeaders } from './headers.js';
import { resolvePolicy } from './policy.js';
import { getWeight, warnIfNoHighPerformanceVerifier } from './profiles.js';
import { buildPaymentVerifierPrompt } from './prompts.js';
import {
  CALIBRATED_NORMALIZE_SYSTEM,
  buildCalibratedNormalizePrompt,
  parseCalibratedNormalizeOutput,
} from 'pot-sdk';
import type { NormalizeOutput } from 'pot-sdk';
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

/**
 * Format verifier outputs for the calibrated normalize prompt.
 */
function formatVerifierOutputs(
  providers: PayVerifyOptions['providers'],
  potResult: Awaited<ReturnType<typeof verify>>,
  isFlagged: boolean,
  confidence: number
): string {
  // Reconstruct per-verifier signal from aggregate pot-sdk result
  // Until pot-sdk exposes per-verifier breakdown, we synthesize from known weights
  const verifierWeightMap: Record<string, number> = {
    'sonnet': 0.916, 'claude': 0.916,
    'grok': 0.448,
    'kimi': 0.264, 'moonshot': 0.264,
    'deepseek': 0.88,
  };
  return providers.map((p) => {
    const modelKey = Object.keys(verifierWeightMap).find(k => p.model.toLowerCase().includes(k));
    const weight = modelKey ? verifierWeightMap[modelKey] : 0.5;
    const verdict = isFlagged ? 'FLAG' : 'PASS';
    return `- ${p.model}: ${verdict} (confidence: ${(confidence * weight).toFixed(2)}, weight: ${weight})`;
  }).join('\n');
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
    useCalibratedNormalize = false,
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
  let verdict: 'PASS' | 'FLAG' = consensusFlagged ? 'FLAG' : 'PASS';
  let finalConfidence = confidence;

  // DSPy Calibrated Normalize — optional final step (90% adversarial detection)
  if (useCalibratedNormalize) {
    try {
      const normalizeProvider = providers.find(p => (p as any).role === 'normalize') ?? providers[0];
      const provider = createProviderFromConfig(normalizeProvider);
      const verifierText = formatVerifierOutputs(providers, potResult, isFlagged, confidence);
      const userPrompt = buildCalibratedNormalizePrompt({
        context: options.context ?? 'Payment verification',
        reasoning: reasoningChain,
        amount: `${amount} ${currency}`,
        verifiers: verifierText,
      });
      // Combine system + user prompt — provider.call() takes a single prompt string
      const combinedPrompt = `${CALIBRATED_NORMALIZE_SYSTEM}\n\n---\n\n${userPrompt}`;
      const rawResponse = await provider.call(normalizeProvider.model, combinedPrompt);
      const normalized: NormalizeOutput = parseCalibratedNormalizeOutput(rawResponse.content);
      // Map normalize verdict → PASS/FLAG
      verdict = (normalized.verdict === 'VERIFIED') ? 'PASS' : 'FLAG';
      finalConfidence = normalized.confidence;
      if (normalized.verdict === 'UNCERTAIN') verdict = 'FLAG'; // conservative
      if (normalized.verdict === 'DISSENT') verdict = 'FLAG';   // escalate
      concerns.push(...(normalized.verdict !== 'VERIFIED'
        ? [`calibrated-normalize: ${normalized.calibration_reason}`]
        : []));
    } catch (err) {
      // Normalize call failed — fall back to consensus verdict silently
      console.warn('[pot-sdk/pay] Calibrated normalize failed, using consensus:', err);
    }
  }

  const partialResult = {
    verdict,
    confidence: finalConfidence,
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
