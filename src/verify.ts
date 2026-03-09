import type { VerificationResult, Proposal, Synthesis, VerificationFlag, GeneratorConfig, ProviderConfig, Verdict, VerificationMode, CriticMode, DomainProfile, OutputFormat, ReceptiveMode, ClassifiedObjection, FailureCost, Audience, PipelineResult } from './types.js';
import { DOMAIN_PROFILES, checkToxicCombination, resolveDomain } from './domains.js';
import type { DomainConfig, DomainLockfile } from './domains.js';
import { parseClassifiedObjections, parseCalibrationCriticResult } from './pipeline/critic.js';
import { factCheckCritic } from './pipeline/factcheck.js';
import { runGenerators } from './pipeline/generator.js';
import { runCritic } from './pipeline/critic.js';
import { runSynthesizer, computeSynthesisBalance } from './pipeline/synthesizer.js';
import { computeDPR } from './metrics/dpr.js';
import { createProvider, createProviderFromConfig, assignRoles } from './providers/index.js';
import { parseConfidence, computeMdi } from './utils.js';
import { scanForAdversarialPatterns } from './security.js';
import { runSandboxCheck } from './sandbox.js';
import { calibrateConfidence } from './calibration.js';
import { runGuard } from './pipeline/guard.js';
import type { GuardResult } from './pipeline/guard.js';
import { runExtractor, extractFeaturesStatic, reconstructFromFeatures } from './pipeline/extractor.js';
import type { ExtractionResult } from './pipeline/extractor.js';
import { aggregateFromReasoning } from './pipeline/aggregator.js';
import type { AggregationResult } from './pipeline/aggregator.js';
import { diversifyInput } from './pipeline/diversifier.js';
import type { DiversifiedInput } from './pipeline/diversifier.js';

async function runDualSynthesizer(
  provider1: ReturnType<typeof createProvider>, model1: string,
  provider2: ReturnType<typeof createProvider>, model2: string,
  proposals: Proposal[], critique: { model: string; content: string }, lang: 'en' | 'de',
  receptiveMode?: 'open' | 'defensive' | 'adaptive'
): Promise<{ primary: Synthesis; verification: { similarity_score: number; diverged: boolean; synth_coverage?: number } }> {
  if (provider1 === provider2 && model1 === model2) {
    throw new Error('Dual synthesizer requires distinct provider+model pairs');
  }

  const SIMILARITY_DIVERGENCE_THRESHOLD = 0.6;

  const synthCalls = [
    runSynthesizer(provider1, model1, proposals, critique, lang, false, undefined, receptiveMode),
    runSynthesizer(provider2, model2, proposals, critique, lang, false, undefined, receptiveMode),
  ];

  const results = await Promise.allSettled(synthCalls);

  const fulfilled = results.filter((result) => result.status === 'fulfilled') as { value: Synthesis }[];

  if (fulfilled.length === 0) {
    throw new Error('Both synthesizers failed');
  }

  const primary = fulfilled[0].value;

  const verification = {
    similarity_score: 0,
    diverged: true,
    synth_coverage: fulfilled.length / 2,
  };

  if (fulfilled.length > 1) {
    const secondary = fulfilled[1].value;
    const tokensA = new Set(primary.content.toLowerCase().split(/\s+/));
    const tokensB = new Set(secondary.content.toLowerCase().split(/\s+/));
    const intersection = new Set([...tokensA].filter(t => tokensB.has(t)));
    const union = new Set([...tokensA, ...tokensB]);
    verification.similarity_score = union.size === 0 ? 1.0 : intersection.size / union.size;
    verification.diverged = verification.similarity_score < SIMILARITY_DIVERGENCE_THRESHOLD;
  }

  return {
    primary,
    verification,
  };
}

interface VerifyParams {
  /** @deprecated Use `mode` instead. Kept for backward compat. */
  tier?: 'basic' | 'pro';
  /**
   * v0.3+: Verification mode.
   *   - basic: 1 generator + 1 critic, <30s
   *   - standard: 3+ generators + 1 critic, 1 round, 1-3 min
   *   - deep: 3+ generators + 1 critic, 2 rounds, 5-15 min
   * Takes precedence over `tier`. If omitted, falls back to `tier`.
   */
  mode?: VerificationMode;
  /**
   * v0.2+: Full provider list. SDK assigns roles automatically.
   */
  providers?: ProviderConfig[] | {
    generators?: string[];
    critic?: string;
    synthesizer?: string;
  };
  /** v0.1 legacy: API keys by provider name. */
  apiKeys?: Record<string, string>;
  /** @deprecated Use `claim` instead. */
  question?: string;
  /** v0.3+: The claim or content to verify. Alias for `question`. */
  claim?: string;
  output?: string;
  language?: 'en' | 'de';
  debug?: boolean;
  /**
   * Enable WASM sandbox check (Layer 4). Requires `pot-sandbox` to be installed.
   */
  sandbox?: boolean;
  /**
   * v0.4+: Controls how the critic evaluates proposals.
   *   - adversarial: "Find every flaw" — explicit red-team, highest dissent surfacing
   *   - resistant: "Verify evidence exists" — skeptical prior, fewer false positives
   *   - balanced: Adversarial on facts, resistant on logic (default)
   *
   * If omitted, defaults to 'adversarial' (backward compatible with v0.3 behavior).
   */
  criticMode?: CriticMode;
  /** v0.5+: Domain profile — auto-configures criticMode, requireCitation, classifyObjections, receptiveMode, maxConfidence */
  domain?: DomainProfile;
  /** v0.5+: Require critic to cite exact text for every objection (~40% fewer false positives) */
  requireCitation?: boolean;
  /** v0.5+: Classify each objection by type and severity */
  classifyObjections?: boolean;
  /** v0.5+: Output format for downstream consumers */
  outputFormat?: OutputFormat;
  /** v0.5+: How the synthesizer receives critique */
  receptiveMode?: ReceptiveMode;
  /** v0.5.1+: Domain lockfile — enforces minimum domain severity. Ratchet, not slider. (inspired by @evil_robot_jas) */
  domainLockfile?: DomainLockfile;
  /** v0.6+: Explicit cost-of-being-wrong. Adjusts verdict thresholds. Credit: @evil_robot_jas */
  failureCost?: FailureCost;
  /** v0.6+: Auto fact-check the critic using a different provider. Credit: ThoughtProof ibuprofen benchmark */
  multiRound?: boolean;
  /** v0.6+: Require synthesizer to explain WHY each claim is verified/unverified */
  requireExplanation?: boolean;
  /** v0.6+: Auto-correct toxic combinations instead of just warning */
  autoCorrectToxic?: boolean;
  /**
   * v0.6.1+: Audience-aware output formatting.
   *   - 'human' (default): Full synthesis, all objections, dissent, reasoning chain.
   *   - 'pipeline': Minimal actionable signal — verdict, confidence, flags, top objection.
   * Credit: Moltbook "Not all friction" discussion — @carbondialogue et al.
   */
  audience?: Audience;
  /**
   * v0.6.3+: LLM-based injection guard (Anthropic Sectioning pattern).
   * Runs a separate cheap LLM call BEFORE verification to detect prompt injection.
   * Set to false to disable. Defaults to true when providers are configured.
   * Credit: Anthropic "Building Effective Agents" — Parallelization/Sectioning
   */
  guard?: boolean;
  /**
   * v1.1+: Out-of-band feature extraction (voipbin-cco STIR/SHAKEN pattern).
   * Extracts structured claims from raw content BEFORE verification.
   * Verifiers see extracted features, not raw text — injections in raw
   * content cannot reach verifiers.
   * Set to true to enable. Defaults to false (opt-in for v1.1, planned default-on in v2.0).
   * Falls back to static extraction if LLM extraction fails.
   * Credit: voipbin-cco (Moltbook) — "The Identity header, not the audio stream"
   */
  extractFeatures?: boolean;
  /**
   * v1.1+: Input representation diversity (voipbin-cco common-mode failure pattern).
   * Each generator receives a structurally different representation of the claim:
   * original, skeptical, structured, inverted, factual-core.
   * An injection crafted for one representation won't work on others.
   * Set to true to enable. Defaults to false (opt-in for v1.1).
   * Credit: voipbin-cco — "running them on different data snapshots"
   */
  diversifyInputs?: boolean;
}

/**
 * v0.6: failureCost → verdict threshold mapping.
 * Credit: @evil_robot_jas — "a liability dressed up as a safety feature"
 */
const FAILURE_COST_THRESHOLDS: Record<FailureCost, number> = {
  negligible: 0.50,
  low: 0.60,
  moderate: 0.70,
  high: 0.80,
  critical: 0.90,
};

/**
 * v0.6: Detect cousin bias — providers sharing training lineage.
 * Credit: @evil_robot_jas — "polite argument between cousins"
 */
function detectCousinBias(
  generatorModels: string[],
  criticModel: string,
  providers: ProviderConfig[] | undefined,
): { detected: boolean; reason: string; sharedProviders: string[] } {
  if (!providers || !Array.isArray(providers)) {
    return { detected: false, reason: '', sharedProviders: [] };
  }
  const providerNames = providers.map(p => p.name.toLowerCase());
  const uniqueNames = new Set(providerNames);
  if (uniqueNames.size === 1) {
    return {
      detected: true,
      reason: `All providers share the same source (${[...uniqueNames][0]}) — shared training bias likely`,
      sharedProviders: [...uniqueNames],
    };
  }
  const bigLabs = new Set(['anthropic', 'openai', 'google', 'deepmind']);
  const allBigLab = providerNames.every(n => bigLabs.has(n));
  if (allBigLab && uniqueNames.size <= 2) {
    return {
      detected: true,
      reason: `All providers from major labs (${[...uniqueNames].join(', ')}) — shared pretraining data likely`,
      sharedProviders: [...uniqueNames],
    };
  }
  return { detected: false, reason: '', sharedProviders: [] };
}

const DEFAULT_GEN_NAMES = ['anthropic', 'xai', 'deepseek', 'moonshot'] as const;
const DEFAULT_MODELS: Record<string, string> = {
  'anthropic': 'claude-sonnet-4-6',
  'xai': 'grok-4-1-fast-non-reasoning',
  'deepseek': 'deepseek-chat',
  'moonshot': 'kimi-k2-turbo-preview',
};

export async function verify(output: string, params: VerifyParams): Promise<VerificationResult> {
  const startTime = Date.now();

  // v0.3: mode takes precedence over tier
  const mode: VerificationMode = params.mode || (params.tier === 'pro' ? 'standard' : params.tier as VerificationMode) || 'basic';
  // Map mode back to legacy tier for backward compat
  const tier = mode === 'basic' ? 'basic' : 'pro';
  const lang = params.language || 'en';

  // v0.3: claim alias for question
  const question = params.claim || params.question;
  if (!question) {
    throw new Error('Either `claim` or `question` must be provided');
  }

  const MAX_INPUT_LENGTH = { basic: 2000, standard: 8000, deep: 32000 };
  const maxLen = MAX_INPUT_LENGTH[mode] || MAX_INPUT_LENGTH.standard;
  if (question.length > maxLen) {
    throw new Error(`Input exceeds ${mode} mode limit (${maxLen} chars)`);
  }

  // Static adversarial scan — runs BEFORE AI pipeline
  // Injection patterns can bypass semantic analysis, so we check here first.
  const adversarialScan = scanForAdversarialPatterns(output);

  // v0.6.3: LLM-based injection guard (Anthropic Sectioning pattern)
  // Runs as SEPARATE model call before verification — not the verifier itself.
  // "One model screens for inappropriate content while another processes queries.
  //  This tends to perform better." — Anthropic, Building Effective Agents
  let guardResult: GuardResult | undefined;
  if (params.guard !== false && Array.isArray(params.providers) && params.providers.length > 0) {
    try {
      // Use the first/cheapest provider for guard duty
      const guardConfig = params.providers[0];
      const guardProvider = createProviderFromConfig(guardConfig);
      guardResult = await runGuard(guardProvider, guardConfig.model, output + '\n\n' + question);
      if (guardResult.injected) {
        console.warn(`[pot-sdk] ⚠️ Injection detected by guard (${guardResult.model}): ${guardResult.evidence}`);
      }
    } catch (err) {
      // Guard failure = don't block, continue with verification
      console.warn('[pot-sdk] Guard check failed, continuing:', err instanceof Error ? err.message : err);
    }
  }

  // v1.1: Out-of-band feature extraction (STIR/SHAKEN pattern)
  // Extract structured claims from raw content BEFORE it enters the pipeline.
  // Verifiers see features, not raw text. Credit: voipbin-cco (Moltbook)
  let extractionResult: ExtractionResult | undefined;
  let sanitizedOutput = output;

  if (params.extractFeatures === true && Array.isArray(params.providers) && params.providers.length > 0) {
    try {
      // Use a DIFFERENT provider than the guard to avoid common-mode failure.
      // Guard uses providers[0], extractor uses providers[1] (or [0] if only one available).
      // Credit: Steel Man review — "Guard + Extractor = same provider = common-mode failure"
      const providerList = params.providers as ProviderConfig[];
      const extractorConfig = providerList.length > 1 ? providerList[1] : providerList[0];
      const extractorProvider = createProviderFromConfig(extractorConfig);
      // Pass adversarial scanner for post-extraction validation
      const scanFn = (text: string) => {
        const scan = scanForAdversarialPatterns(text);
        return { detected: scan.detected, patterns: scan.patterns };
      };
      extractionResult = await runExtractor(extractorProvider, extractorConfig.model, output, scanFn);
      if (extractionResult.claimCount > 0) {
        sanitizedOutput = extractionResult.sanitizedContent;
      }
      // If extraction found 0 claims but LLM succeeded, the content may be pure noise/injection
      if (extractionResult.llmExtracted && extractionResult.claimCount === 0) {
        console.warn('[pot-sdk] ⚠️ Feature extractor found 0 claims — content may be empty or injection-only');
      }
    } catch (err) {
      // Extraction failure = fall back to raw output (don't block pipeline)
      console.warn('[pot-sdk] Feature extraction failed, using raw output:', err instanceof Error ? err.message : err);
      // Static fallback
      const staticFeatures = extractFeaturesStatic(output);
      if (staticFeatures.length > 0) {
        sanitizedOutput = reconstructFromFeatures(staticFeatures);
        extractionResult = {
          features: staticFeatures,
          sanitizedContent: sanitizedOutput,
          model: 'static',
          latencyMs: 0,
          claimCount: staticFeatures.length,
          llmExtracted: false,
          rejectedClaims: 0,
          rejectionReasons: [],
        };
      }
    }
  }

  // WASM sandbox check — runs in parallel with pipeline (opt-in via params.sandbox)
  const sandboxPromise = params.sandbox
    ? runSandboxCheck(output)  // Note: sandbox still checks raw output (it's code analysis, not semantic)
    : Promise.resolve(null);

  // ── v0.2: ProviderConfig[] path ──────────────────────────────────────────
  const isV2Providers = Array.isArray(params.providers);

  let gensProviders: { provider: ReturnType<typeof createProvider>; model: string }[];
  let criticProvider: ReturnType<typeof createProvider>;
  let criticModel: string;
  let synthProvider: ReturnType<typeof createProvider>;
  let synthModel: string;

  if (isV2Providers) {
    const providerList = params.providers as ProviderConfig[];
    if (providerList.length === 0) {
      throw new Error('providers array must not be empty');
    }
    const { generators, critic, synthesizer } = assignRoles(providerList);

    gensProviders = generators.map(cfg => ({
      provider: createProviderFromConfig(cfg),
      model: cfg.model,
    }));
    criticProvider = createProviderFromConfig(critic);
    criticModel = critic.model;
    synthProvider = createProviderFromConfig(synthesizer);
    synthModel = synthesizer.model;

  } else {
    // ── v0.1 legacy: string-based provider names + apiKeys dict ─────────────
    const apiKeys = params.apiKeys ?? {};
    const legacyProviders = params.providers as { generators?: string[]; critic?: string; synthesizer?: string } | undefined;
    const genNames = legacyProviders?.generators || DEFAULT_GEN_NAMES.slice(0, mode !== 'basic' ? 4 : 1);
    const criticName = legacyProviders?.critic || 'anthropic';
    const synthName = legacyProviders?.synthesizer || 'anthropic';

    function buildConfig(name: string): GeneratorConfig {
      const model = DEFAULT_MODELS[name as keyof typeof DEFAULT_MODELS] || DEFAULT_MODELS.anthropic;
      const apiKey = apiKeys[name];
      if (!apiKey) {
        throw new Error('Provider configuration invalid');
      }
      return {
        name,
        model,
        apiKey,
        ...(name === 'anthropic' ? { provider: 'anthropic' as const } : {}),
      };
    }

    const genConfigs = genNames.map(buildConfig);
    gensProviders = genConfigs.map((c) => {
      const provider = createProvider(c);
      if ((c as any).apiKey) (c as any).apiKey = undefined;
      return { provider, model: c.model };
    });

    const criticConfig = buildConfig(criticName);
    criticProvider = createProvider(criticConfig);
    if ((criticConfig as any).apiKey) (criticConfig as any).apiKey = undefined;
    criticModel = criticConfig.model;

    const synthConfig = buildConfig(synthName);
    synthProvider = createProvider(synthConfig);
    if ((synthConfig as any).apiKey) (synthConfig as any).apiKey = undefined;
    synthModel = synthConfig.model;
  }

  // ── Track model names for pipeline info ───────────────────────────────────
  const generatorModelNames = gensProviders.map(g => g.model);

  // ── Run pipeline ─────────────────────────────────────────────────────────
  // v1.1: Diversify inputs if enabled — each generator gets a different representation
  // Fix 6 (Steel Man): When BOTH extractFeatures and diversifyInputs are active,
  // diversify the SANITIZED output, not the raw claim. This is true defense-in-depth:
  // Layer 1 removes injections → Layer 3 diversifies the clean features.
  let diversifiedInputsForGenerators: DiversifiedInput[] | undefined;
  if (params.diversifyInputs === true && gensProviders.length > 1) {
    // If extraction produced a sanitized version, diversify that instead of raw question
    const inputToDiversify = (params.extractFeatures === true && extractionResult?.claimCount && extractionResult.claimCount > 0)
      ? extractionResult.sanitizedContent
      : question;
    diversifiedInputsForGenerators = diversifyInput(inputToDiversify, gensProviders.length, lang);
  }

  let proposals: Proposal[] = await runGenerators(gensProviders, question, lang, false, undefined, diversifiedInputsForGenerators);
  if (output) {
    // v1.1: Use sanitized (feature-extracted) output instead of raw content.
    // Raw content may contain injections; sanitized content is structured claims only.
    // Credit: voipbin-cco — "out-of-band verification"
    proposals.push({ model: 'user-output', content: sanitizedOutput });
  }

  // v0.5: Domain profile defaults
  // v0.5.1: Domain lockfile — resolve effective domain (ratchet, not slider)
  const effectiveDomain = resolveDomain(params.domain, params.domainLockfile);
  let domainConfig: DomainConfig | undefined;
  if (effectiveDomain) {
    domainConfig = DOMAIN_PROFILES[effectiveDomain];
  }

  const criticMode: CriticMode = params.criticMode || domainConfig?.criticMode || 'adversarial';
  const requireCitation = params.requireCitation ?? domainConfig?.requireCitation ?? false;
  const classifyObjections = params.classifyObjections ?? domainConfig?.classifyObjections ?? false;
  const receptiveMode = params.receptiveMode ?? domainConfig?.receptiveMode;
  const outputFormat = params.outputFormat ?? 'human';

  // v0.6: Toxic combination auto-correction (upgrade from v0.5.1 warning-only)
  let effectiveCriticMode = criticMode;
  let effectiveReceptiveMode = receptiveMode;
  let toxicCorrected: any = undefined;
  const toxicWarning = effectiveReceptiveMode ? checkToxicCombination(effectiveCriticMode, effectiveReceptiveMode) : null;

  if (toxicWarning && params.autoCorrectToxic) {
    const original = { criticMode: effectiveCriticMode, receptiveMode: effectiveReceptiveMode! };
    if (effectiveCriticMode === 'adversarial' && effectiveReceptiveMode === 'defensive') {
      effectiveReceptiveMode = 'adaptive';
    } else if (effectiveCriticMode === 'balanced' && effectiveReceptiveMode === 'defensive') {
      effectiveCriticMode = 'resistant';
      effectiveReceptiveMode = 'open';
    }
    toxicCorrected = {
      original,
      corrected: { criticMode: effectiveCriticMode, receptiveMode: effectiveReceptiveMode },
      reason: toxicWarning,
    };
  }

  const critique = await runCritic(criticProvider, criticModel, proposals, lang, false, undefined, effectiveCriticMode, { requireCitation, classifyObjections });

  // v0.6: Multi-round fact-checking — the critic gets checked
  let factCheckedObjections: import('./pipeline/factcheck.js').FactCheckedObjection[] | undefined;
  let effectiveCritiqueContent = critique.content;
  let multiRoundSkipped = false;

  if (params.multiRound && classifyObjections) {
    const parsedObjs = parseClassifiedObjections(critique.content);
    if (parsedObjs.length > 0) {
      const factCheckProv = gensProviders.find(g => g.model !== criticModel) || gensProviders[0];
      if (factCheckProv.model !== criticModel) {
        const fcResult = await factCheckCritic(
          factCheckProv.provider, factCheckProv.model,
          critique.content, parsedObjs, question, lang,
        );
        factCheckedObjections = fcResult.checkedObjections;
        effectiveCritiqueContent = fcResult.filteredCritiqueContent;
      } else {
        multiRoundSkipped = true;
      }
    }
  }

  const critiqueForSynthesis = { model: critique.model, content: effectiveCritiqueContent };

  let synthesis: Synthesis;
  let dissent: any = undefined;

  if (mode !== 'basic' && gensProviders.length >= 2) {
    const synth1 = gensProviders[0];
    const synth2 = gensProviders[1];
    const { primary, verification } = await runDualSynthesizer(
      synth1.provider, synth1.model,
      synth2.provider, synth2.model,
      proposals, critiqueForSynthesis, lang,
      effectiveReceptiveMode
    );
    synthesis = primary;
    dissent = verification;
  } else {
    if (mode !== 'basic') {
      dissent = {
        dual_synthesis: false,
        single_source_warning: "Only one provider available; dual synthesis skipped",
      };
    }
    synthesis = await runSynthesizer(synthProvider, synthModel, proposals, critiqueForSynthesis, lang, false, undefined, effectiveReceptiveMode);
  }

  const genProposals = proposals.filter(p => p.model !== 'user-output');
  const balance = computeSynthesisBalance(genProposals, synthesis.content);
  const mdi = computeMdi(genProposals);
  const statedConfidence = parseConfidence(synthesis.content);
  const dpr = computeDPR(critique.content, synthesis.content, balance.warning);

  // v1.1: Reasoning-based aggregation — derive independent confidence from patterns
  // instead of trusting the synthesizer's stated number.
  // Credit: voipbin-cco — "fool the consensus mechanism, not individual verifiers"
  const aggregation = aggregateFromReasoning(
    genProposals,
    critique.content,
    synthesis.content,
    statedConfidence,
    classifyObjections ? parseClassifiedObjections(critique.content) : undefined,
  );

  // Use aggregated confidence if it detects the stated value is inflated
  const confidence = aggregation.shouldOverride
    ? aggregation.aggregatedConfidence
    : statedConfidence;

  const flags: VerificationFlag[] = [];

  // Adversarial pattern detection (static, pre-pipeline)
  if (adversarialScan.detected) {
    flags.push('adversarial-pattern');
    // Append matched pattern names for transparency
    for (const p of adversarialScan.patterns) {
      flags.push(`adversarial:${p}`);
    }
  }

  // Semantic flags from AI pipeline
  const UNVERIFIED_PATTERN = /\bunverified\b/i;
  if (UNVERIFIED_PATTERN.test(critique.content)) flags.push('unverified-claims');
  if (balance.warning) flags.push('synthesis-dominance');
  if (dpr.false_consensus) flags.push('false-consensus');
  if (mdi < 0.3) flags.push('low-model-diversity');
  if (confidence < 0.5) flags.push('low-confidence');
  if (toxicWarning) flags.push('toxic-combination');
  if (multiRoundSkipped) flags.push('multiround-same-provider');

  // Collect WASM sandbox result (was running in parallel with pipeline)
  const sandboxResult = await sandboxPromise;
  if (sandboxResult?.flags && sandboxResult.flags.length > 0) {
    flags.push(...sandboxResult.flags);
  }

  // v1.1: Feature extraction flags
  if (extractionResult?.llmExtracted && extractionResult.claimCount === 0) {
    flags.push('empty-extraction');
  }

  // v1.1: Reasoning aggregation flags
  if (aggregation.divergesFromStated) {
    flags.push('confidence-divergence');
  }
  if (aggregation.shouldOverride) {
    flags.push('confidence-overridden');
  }

  // v0.6.3: LLM guard injection flag
  if (guardResult?.injected) {
    flags.push('injection-detected');
    flags.push(`guard:${guardResult.model}`);
  }

  // Cap confidence if adversarial patterns detected (static OR LLM guard)
  const guardCap = guardResult?.injected ? 0.25 : 1.0;
  const finalConfidence = (adversarialScan.detected || guardResult?.injected)
    ? Math.min(confidence, adversarialScan.confidence_cap, guardCap)
    : confidence;

  // v0.5: Apply domain maxConfidence cap
  let cappedConfidence = finalConfidence;
  if (domainConfig?.maxConfidence) {
    cappedConfidence = Math.min(finalConfidence, domainConfig.maxConfidence);
  }

  // v0.6: Auto-calibration — entropy-based confidence adjustment
  // v1.1: Skip hedging-based calibration when aggregation already overrode confidence,
  // because both analyze hedging language → double-counting would deflate unfairly.
  // Credit: Steel Man review — "Calibration and Aggregation do the same thing on hedging"
  let calibration: ReturnType<typeof calibrateConfidence>;
  if (aggregation.shouldOverride) {
    // Aggregation already corrected for hedging — skip calibration to avoid double-count
    calibration = { calibratedConfidence: cappedConfidence, adjusted: false, delta: 0, originalConfidence: cappedConfidence, reason: 'skipped: aggregation override active' };
  } else {
    calibration = calibrateConfidence(cappedConfidence, synthesis.content);
  }
  let finalCalibratedConfidence = calibration.calibratedConfidence;
  if (calibration.reason && !calibration.adjusted && calibration.reason.includes('mismatch')) {
    flags.push('calibration-mismatch');
  }

  // v0.6.1: Calibrative critic mode — apply structural confidence adjustment
  let calibrativeDelta: number | undefined;
  let calibrativeReason: string | undefined;
  if (effectiveCriticMode === 'calibrative') {
    const calibrativeResult = parseCalibrationCriticResult(critique.content);
    calibrativeDelta = calibrativeResult.adjustment;
    calibrativeReason = calibrativeResult.reason;
    finalCalibratedConfidence = Math.max(0, Math.min(1, finalCalibratedConfidence + calibrativeDelta));
    if (calibrativeDelta < -0.05) flags.push('calibrative-downward');
    if (calibrativeDelta > 0.05) flags.push('calibrative-upward');
  }

  const verified = finalCalibratedConfidence > 0.75 && flags.length === 0 && balance.score > 0.6;

  // v0.5: Parse classified objections if enabled
  const classifiedObjs = classifyObjections ? parseClassifiedObjections(critique.content) : undefined;

  // v0.6: failureCost-adjusted verdict thresholds
  const verdictThreshold = params.failureCost
    ? FAILURE_COST_THRESHOLDS[params.failureCost]
    : 0.70;

  // v0.3+v0.6: Compute verdict enum with failureCost-aware thresholds
  let verdict: Verdict;
  if (dpr.false_consensus && finalCalibratedConfidence >= verdictThreshold) {
    verdict = 'DISSENT';
  } else if (finalCalibratedConfidence >= verdictThreshold && flags.length === 0 && balance.score > 0.6) {
    verdict = 'VERIFIED';
  } else if (finalCalibratedConfidence >= verdictThreshold) {
    verdict = 'UNVERIFIED';
  } else {
    verdict = 'UNCERTAIN';
  }

  const durationMs = Date.now() - startTime;

  const biasMap = balance.generator_coverage.reduce((acc: Record<string, number>, d: { generator: string; share: number }) => {
    acc[d.generator] = d.share;
    return acc;
  }, {});

  // v0.6: Cousin bias detection
  const cousinWarning = detectCousinBias(
    generatorModelNames, criticModel,
    Array.isArray(params.providers) ? params.providers as ProviderConfig[] : undefined,
  );
  if (cousinWarning.detected) flags.push('cousin-bias-risk');

  const result = {
    verified,
    verdict,
    confidence: finalCalibratedConfidence,
    tier,
    flags,
    timestamp: new Date().toISOString(),
    mdi: parseFloat(mdi.toFixed(3)),
    sas: balance.score,
    dpr,
    biasMap,
    dissent,
    synthesis: synthesis.content,
    pipeline: {
      mode,
      generators: generatorModelNames,
      critic: criticModel,
      synthesizer: synthModel,
      rounds: params.multiRound ? (mode === 'deep' ? 3 : 2) : (mode === 'deep' ? 2 : 1),
      duration_ms: durationMs,
      ...(diversifiedInputsForGenerators ? { diversifiedInputs: diversifiedInputsForGenerators.map(d => d.type) } : {}),
    },
    ...(sandboxResult ? { sandbox: sandboxResult } : {}),
    ...(guardResult ? { guard: guardResult } : {}),
    ...(extractionResult ? { extraction: { model: extractionResult.model, claimCount: extractionResult.claimCount, llmExtracted: extractionResult.llmExtracted, latencyMs: extractionResult.latencyMs, rejectedClaims: extractionResult.rejectedClaims, ...(extractionResult.rejectionReasons.length > 0 ? { rejectionReasons: extractionResult.rejectionReasons } : {}) } } : {}),
    aggregation: {
      statedConfidence: statedConfidence,
      aggregatedConfidence: aggregation.aggregatedConfidence,
      divergence: aggregation.divergenceAmount,
      overridden: aggregation.shouldOverride,
      signals: aggregation.signals.map(s => ({ name: s.name, value: s.value, weight: s.weight, reason: s.reason })),
    },
    ...(classifiedObjs ? { classifiedObjections: classifiedObjs } : {}),
    ...(effectiveDomain ? { domain: effectiveDomain } : {}),
    ...(outputFormat !== 'human' ? { outputFormat } : {}),
    ...(factCheckedObjections ? { factCheckedObjections } : {}),
    ...(cousinWarning.detected ? { cousinWarning } : {}),
    ...(calibration.adjusted ? { calibrationAdjusted: true, calibrationDelta: calibration.delta } : {}),
    ...(params.failureCost ? { failureCostApplied: params.failureCost } : {}),
    ...(toxicCorrected ? { toxicCorrected } : {}),
    // v0.6.1: calibrative mode metadata
    ...(calibrativeDelta !== undefined ? { calibrativeDelta, calibrativeReason } : {}),
    // v0.6.1: audience metadata (only store if explicitly set)
    ...(params.audience ? { audience: params.audience } : {}),
  } as VerificationResult;

  if (params.debug) {
    (result as any).raw = { proposals, critique, synthesis };
  }

  // v0.6.1: Audience-aware output formatting
  // 'human' (default): no transformation — full result returned
  // 'pipeline': minimal actionable shape appended as pipelineResult
  if (params.audience === 'pipeline') {
    const topObj = result.classifiedObjections?.[0];
    const pipelineResult: PipelineResult = {
      pass: verdict === 'VERIFIED',
      confidence: result.confidence,
      flags: result.flags,
      verdict: result.verdict,
      audience: 'pipeline',
      ...(topObj ? {
        topObjection: {
          type: topObj.type,
          severity: topObj.severity,
          claim: topObj.claim,
        },
      } : {}),
    };
    result.pipelineResult = pipelineResult;
  }

  return result;
}