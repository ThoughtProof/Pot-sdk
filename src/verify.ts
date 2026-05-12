import type {
  VerificationResult, Proposal, Synthesis, VerificationFlag,
  GeneratorConfig, ProviderConfig, Verdict, InternalVerdict,
  VerificationMode, CriticMode, DomainProfile, OutputFormat,
  ReceptiveMode, ClassifiedObjection, FailureCost, Audience,
  PipelineResult, StakeLevel,
} from './types.js';
import { DOMAIN_PROFILES, DOMAIN_REFERENCE_CONTEXT, checkToxicCombination, resolveDomain, detectDomain } from './domains.js';
import type { DomainConfig, DomainLockfile } from './domains.js';
import { parseClassifiedObjections, parseCalibrationCriticResult, parseMaterialityClassifications, calculateMaterialityConfidence } from './pipeline/critic.js';
import type { MaterialityResult } from './pipeline/critic.js';
import { factCheckCritic } from './pipeline/factcheck.js';
import { runGenerators } from './pipeline/generator.js';
import { runCritic } from './pipeline/critic.js';
import { runSynthesizer, computeSynthesisBalance } from './pipeline/synthesizer.js';
import { computeDPR } from './metrics/dpr.js';
import { createProvider, createProviderFromConfig, assignRoles } from './providers/index.js';
import { parseConfidence, computeMdi, computeModelFamilyMDI, extractModelFamilies, extractMinorityPositions } from './utils.js';
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
import { decomposeClaim } from './pipeline/decomposer.js';
import { compositionalSynthesize } from './pipeline/compositor.js';
import type { SubVerdict } from './pipeline/compositor.js';
import { detectStake } from './stake.js';

// ── Map internal verdict → public 3-tier ─────────────────────────────────────
//
// Canonical verdict model: see ThoughtProof/pot-cli docs/adr/0001-verdict-model.md
//
//   ALLOW     → ALLOW
//   HOLD      → UNCERTAIN  (epistemic: insufficient evidence, needs review)
//   DISSENT   → UNCERTAIN  (epistemic: evaluators do not converge)
//   UNCERTAIN → UNCERTAIN
//
// Safety-critical consumers SHOULD treat UNCERTAIN-with-metadata
// (review_needed, dissent) as BLOCK in their policy layer.

function mapVerdict(internal: InternalVerdict): Verdict {
  if (internal === 'ALLOW') return 'ALLOW';
  // HOLD, DISSENT, and UNCERTAIN all surface as public UNCERTAIN per ADR-0001.
  // Distinguishing metadata is carried on PipelineResult.flags / dissent fields.
  return 'UNCERTAIN';
}

/**
 * Compute severity_score.
 *
 * Per ADR-0001, HOLD and DISSENT both map to public UNCERTAIN (an epistemic
 * state, not a severity-graded BLOCK). severity_score is therefore null for
 * all current internal verdicts. This is the v3.0.0 breaking change relative
 * to v2.x where HOLD returned 0.30–0.65 and DISSENT returned 0.70–1.0.
 *
 * Reserved for future use: severity_score may be populated again when the
 * engine emits an explicit hard-BLOCK internal verdict.
 */
function computeSeverityScore(_internal: InternalVerdict, _confidence: number): number | null {
  return null;
}

// ── Extract public objections from pipeline output ─────────────────────────────

function extractPublicObjections(
  classifiedObjections: ClassifiedObjection[] | undefined,
  critiqueContent: string,
  limit = 3,
): string[] {
  // Prefer structured classified objections (already ranked by severity)
  if (classifiedObjections && classifiedObjections.length > 0) {
    return classifiedObjections.slice(0, limit).map((o) => o.claim);
  }

  // Fall back to parsing objection lines from critique text
  const lines = critiqueContent.split('\n').map((l) => l.trim()).filter(Boolean);
  const objections: string[] = [];

  for (const line of lines) {
    if (objections.length >= limit) break;
    // Match: bullet points, numbered items, or OBJECTION: prefix
    const isBullet = /^[-•*]\s+/.test(line);
    const isNumbered = /^\d+[.)]\s+/.test(line);
    const isObjection = /^objection:/i.test(line);
    if (isBullet || isNumbered || isObjection) {
      const text = line
        .replace(/^[-•*\d.)\s]+/, '')
        .replace(/^objection:\s*/i, '')
        .replace(/\[.*?\]\s*/g, '') // strip [TYPE:...] tags
        .trim();
      if (text.length > 10) objections.push(text);
    }
  }

  return objections;
}

// ── Parse lite-tier generator vote ───────────────────────────────────────────

function parseLiteVote(content: string): 'ALLOW' | 'BLOCK' {
  const lower = content.toLowerCase();
  const allowScore = (lower.match(/\b(allow|safe|sound|proceed|recommend|verified|approved|valid)\b/g) ?? []).length;
  const blockScore = (lower.match(/\b(block|hold|stop|deny|unverified|risky|danger|unsafe|reject|dissent|concern|flaw|error|incorrect|insufficient)\b/g) ?? []).length;
  return allowScore > blockScore ? 'ALLOW' : 'BLOCK';
}

// ── Dual synthesizer ──────────────────────────────────────────────────────────

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

  return { primary, verification };
}

// ── VerifyParams ──────────────────────────────────────────────────────────────

interface VerifyParams {
  /**
   * v2.0: Pipeline tier.
   *   - 'lite':     2-model fast gate. Low/medium stake only. ~$0.003, 5–10s.
   *   - 'standard': Full 3-model pipeline with synthesizer. Any stake. ~$0.008, 10–20s.
   *
   * @deprecated 'basic' maps to 'lite', 'pro' maps to 'standard' for backward compat.
   */
  tier?: 'lite' | 'standard' | 'basic' | 'pro';
  /**
   * v2.0: Skip escalation on lite split. Returns UNCERTAIN instead of upgrading to standard.
   * Ignored for high/critical stake (always standard, no opt-out).
   */
  no_escalation?: boolean;
  /** @deprecated Use `tier: 'standard'` instead. Internal pipeline dispatch only. */
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
  /**
   * v1.2.1+: Classify objections by materiality (material/notable/minor).
   * When enabled, confidence is recalculated based on materiality weights.
   * Credit: ISA 320 / PCAOB AS 1105 — "materiality = threshold for decision-changing"
   */
  classifyMateriality?: boolean;
  /**
   * v1.2+: Trust boundaries — separates trusted context from claims to verify.
   * When context.trusted is provided, the critic accepts those facts as given
   * and only evaluates whether the decision follows from them.
   * When omitted, critic challenges everything (v1.1 behavior preserved).
   * Credit: ThoughtProof Prior Auth + Commerce PoC (2026-03-14)
   */
  context?: import('./types.js').TrustContext;
  /**
   * v2.0+: Stake level — controls confidence threshold, tier eligibility, and critic depth.
   * If omitted, auto-detected via detectStake() (multi-signal).
   */
  stakeLevel?: StakeLevel;
  /**
   * v1.3+: Recursive claim decomposition.
   * When true, the claim is first analyzed for compound structure.
   * If compound (>= minComplexity sub-claims), each sub-claim is verified
   * independently and results are composed via compositionalSynthesize().
   * Credit: RECURSIVE-VERIFY-SPEC.md, arxiv:2512.24601
   */
  recursive?: boolean;
  /**
   * v1.3+: Maximum recursion depth for nested compound claims.
   * Prevents infinite recursion. Defaults to 2.
   */
  maxDepth?: number;
  /**
   * v1.3+: Minimum number of sub-claims required to trigger recursive verification.
   * If decomposition yields fewer sub-claims, falls through to normal pipeline.
   * Defaults to 3.
   */
  minComplexity?: number;
  /**
   * v1.3+: Internal recursion depth tracker. Do not set manually.
   * Used to guard against infinite recursion across recursive verify() calls.
   */
  _recursionDepth?: number;
}

// ── Failure cost thresholds ──────────────────────────────────────────────────

const FAILURE_COST_THRESHOLDS: Record<FailureCost, number> = {
  negligible: 0.50,
  low: 0.60,
  moderate: 0.70,
  high: 0.80,
  critical: 0.90,
};

// ── Cousin bias detection ────────────────────────────────────────────────────

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

// ── Provider setup ────────────────────────────────────────────────────────────

export const DEFAULT_GEN_NAMES = ['anthropic', 'xai', 'deepseek', 'gemini'] as const;
export const DEFAULT_MODELS: Record<string, string> = {
  'anthropic': 'claude-sonnet-4-6',
  'xai': 'grok-4-1-fast-non-reasoning',
  'deepseek': 'deepseek-chat',
  'gemini': 'gemini-3.1-flash-lite',
  'moonshot': 'kimi-k2.6',
};

// ── Main verify() ─────────────────────────────────────────────────────────────

export async function verify(output: string, params: VerifyParams): Promise<VerificationResult> {
  const startTime = Date.now();

  // ── Tier resolution ────────────────────────────────────────────────────────
  // v2.0: 'lite' | 'standard'. Backward compat: 'basic' → 'lite', 'pro' → 'standard'.
  const rawTier = params.tier;
  const requestedTier: 'lite' | 'standard' =
    rawTier === 'lite' ? 'lite' :
    rawTier === 'basic' ? 'lite' :
    'standard'; // default to standard; 'pro' and undefined → standard

  // Internal mode (kept for pipeline dispatch)
  const mode: VerificationMode = params.mode ||
    (requestedTier === 'lite' ? 'basic' : 'standard');

  const lang = params.language || 'en';

  // v0.3: claim alias for question
  const question = params.claim || params.question;
  if (!question) {
    throw new Error('Either `claim` or `question` must be provided');
  }

  // ── Domain detection ───────────────────────────────────────────────────────
  // Computed early for reference context and stake detection.
  const _earlyDomain = detectDomain(question);
  const _earlyRefCtx = DOMAIN_REFERENCE_CONTEXT[params.domain ?? _earlyDomain];
  const claimWithContext: string = _earlyRefCtx
    ? `[Domain Context]\n${_earlyRefCtx}\n\n[Claim to Evaluate]\n${question}`
    : question;

  const MAX_INPUT_LENGTH = { basic: 2000, standard: 8000, deep: 32000 };
  const maxLen = MAX_INPUT_LENGTH[mode] || MAX_INPUT_LENGTH.standard;
  if (question.length > maxLen) {
    throw new Error(`Input exceeds ${mode} mode limit (${maxLen} chars)`);
  }

  // ── Effective domain (after lockfile ratchet) ─────────────────────────────
  const autoDetectedDomain = !params.domain ? detectDomain(question) : undefined;
  const effectiveDomain = resolveDomain(params.domain ?? autoDetectedDomain ?? 'general', params.domainLockfile);

  // ── Stake detection ────────────────────────────────────────────────────────
  // v2.0: Multi-signal auto-detection with caller override as absolute precedence.
  const effectiveStakeLevel: StakeLevel = detectStake(
    question,
    params.stakeLevel,
    effectiveDomain,
  );

  // ── Tier override: high/critical always execute standard ───────────────────
  // No opt-out. no_escalation has no effect for high/critical.
  const executedTier: 'lite' | 'standard' =
    requestedTier === 'lite' && (effectiveStakeLevel === 'high' || effectiveStakeLevel === 'critical')
      ? 'standard'
      : requestedTier;

  // ── Adversarial scan ───────────────────────────────────────────────────────
  const adversarialScan = scanForAdversarialPatterns(output);

  // ── LLM Guard ─────────────────────────────────────────────────────────────
  let guardResult: GuardResult | undefined;
  if (params.guard !== false && Array.isArray(params.providers) && params.providers.length > 0) {
    try {
      const guardConfig = params.providers[0];
      const guardProvider = createProviderFromConfig(guardConfig);
      guardResult = await runGuard(guardProvider, guardConfig.model, output + '\n\n' + question);
      if (guardResult.injected) {
        console.warn(`[pot-sdk] ⚠️ Injection detected by guard (${guardResult.model}): ${guardResult.evidence}`);
      }
    } catch (err) {
      console.warn('[pot-sdk] Guard check failed, continuing:', err instanceof Error ? err.message : err);
    }
  }

  // ── Feature extraction ─────────────────────────────────────────────────────
  let extractionResult: ExtractionResult | undefined;
  let sanitizedOutput = output;

  if (params.extractFeatures === true && Array.isArray(params.providers) && params.providers.length > 0) {
    try {
      const providerList = params.providers as ProviderConfig[];
      const extractorConfig = providerList.length > 1 ? providerList[1] : providerList[0];
      const extractorProvider = createProviderFromConfig(extractorConfig);
      const scanFn = (text: string) => {
        const scan = scanForAdversarialPatterns(text);
        return { detected: scan.detected, patterns: scan.patterns };
      };
      extractionResult = await runExtractor(extractorProvider, extractorConfig.model, output, scanFn);
      if (extractionResult.claimCount > 0) {
        sanitizedOutput = extractionResult.sanitizedContent;
      }
      if (extractionResult.llmExtracted && extractionResult.claimCount === 0) {
        console.warn('[pot-sdk] ⚠️ Feature extractor found 0 claims — content may be empty or injection-only');
      }
    } catch (err) {
      console.warn('[pot-sdk] Feature extraction failed, using raw output:', err instanceof Error ? err.message : err);
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

  // ── Provider setup ─────────────────────────────────────────────────────────
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

  const generatorModelNames = gensProviders.map(g => g.model);

  // ── Recursive decomposition ────────────────────────────────────────────────
  if (
    params.recursive === true &&
    Array.isArray(params.providers) &&
    params.providers.length > 0 &&
    (params._recursionDepth === undefined || params._recursionDepth < (params.maxDepth ?? 2))
  ) {
    const providerList = params.providers as import('./types.js').ProviderConfig[];
    const minComplexity = params.minComplexity ?? 3;

    const decomposition = await decomposeClaim(question, providerList);

    if (decomposition.isCompound && decomposition.subClaims.length >= minComplexity) {
      const subVerdicts: SubVerdict[] = [];

      for (const subClaim of decomposition.subClaims) {
        const subStakeLevel = (subClaim.stakeLevel as StakeLevel | undefined) ?? params.stakeLevel;

        const subResult = await verify(output, {
          ...params,
          claim: subClaim.claim,
          recursive: false,
          _recursionDepth: (params._recursionDepth ?? 0) + 1,
          ...(subStakeLevel ? { stakeLevel: subStakeLevel } : {}),
        });

        subVerdicts.push({
          claim: subClaim.claim,
          verdict: subResult.verdict,
          confidence: subResult.confidence,
          synthesis: subResult.synthesis,
          flags: subResult.flags,
        });
      }

      const compResult = await compositionalSynthesize(
        question,
        subVerdicts,
        decomposition.dependencies,
        providerList,
      );

      const compDurationMs = Date.now() - startTime;
      const compPublicVerdict: Verdict = compResult.verdict;
      const compInternalVerdict: InternalVerdict =
        compResult.verdict === 'ALLOW' ? 'ALLOW' :
        compResult.verdict === 'UNCERTAIN' ? 'UNCERTAIN' :
        'HOLD'; // compositional BLOCK is treated as HOLD severity

      return {
        verdict: compPublicVerdict,
        confidence: compResult.confidence,
        severity_score: computeSeverityScore(compInternalVerdict, compResult.confidence),
        mdi: null, // compositional path does not compute MDI
        objections: [],
        domain: effectiveDomain,
        stakeLevel: effectiveStakeLevel,
        tier: executedTier,
        durationMs: compDurationMs,
        verified: compPublicVerdict === 'ALLOW',
        flags: subVerdicts.flatMap(sv => (sv.flags ?? []).map(f => `subclaim:${f}`)),
        timestamp: new Date().toISOString(),
        synthesis: compResult.synthesis,
        subVerdicts,
        compositionRisk: compResult.compositionRisk,
        pipeline: {
          mode,
          generators: [],
          critic: 'compositional',
          synthesizer: 'compositional',
          rounds: 1,
          duration_ms: compDurationMs,
        },
      };
    }
  }

  // ── LITE TIER PATH ─────────────────────────────────────────────────────────
  // 2-model fast gate: DeepSeek + Grok. No synthesizer. No MDI.
  // Split → escalate to standard (default) or UNCERTAIN (no_escalation:true).
  if (executedTier === 'lite') {
    // Use first 2 generators for lite gate
    const liteGens = gensProviders.slice(0, 2);
    if (liteGens.length < 2) {
      // Insufficient providers for lite — fall through to standard
      // (handled below; executedTier effectively becomes standard)
    } else {
      let diversifiedInputsLite: DiversifiedInput[] | undefined;
      if (params.diversifyInputs === true && liteGens.length > 1) {
        diversifiedInputsLite = diversifyInput(
          params.extractFeatures === true && extractionResult?.claimCount && extractionResult.claimCount > 0
            ? extractionResult.sanitizedContent
            : question,
          liteGens.length,
          lang,
        );
      }

      const liteProposals = await runGenerators(
        liteGens, claimWithContext, lang, false, undefined, diversifiedInputsLite,
      );

      // Gate: parse each generator's vote
      const votes = liteProposals.map(p => parseLiteVote(p.content));
      const allAllow = votes.every(v => v === 'ALLOW');
      const allBlock = votes.every(v => v === 'BLOCK');
      const isSplit = !allAllow && !allBlock;

      if (isSplit && !params.no_escalation) {
        // Split + escalation allowed → fall through to standard pipeline below.
        // executedTier stays 'lite' in label but we run standard. We'll track this
        // separately and set tier = 'standard' in the response (reflects executed tier).
        //
        // We do NOT return here — fall through to standard path.
        // Mark as escalated for response header (X-ThoughtProof-Tier-Overridden).
      } else {
        // Determinate lite result: both agree, or split + no_escalation
        const liteConfidence = liteProposals.reduce((sum, p) => sum + parseConfidence(p.content), 0) / liteProposals.length;
        const liteCapGuard = adversarialScan.detected ? adversarialScan.confidence_cap : 1.0;
        const liteCapGuardResult = guardResult?.injected ? 0.25 : 1.0;
        const liteConf = Math.min(liteConfidence, liteCapGuard, liteCapGuardResult);

        let liteInternalVerdict: InternalVerdict;
        let litePublicVerdict: Verdict;
        let liteObjsSource = '';

        if (allAllow) {
          liteInternalVerdict = 'ALLOW';
          litePublicVerdict = 'ALLOW';
        } else if (allBlock) {
          liteInternalVerdict = 'HOLD'; // lite BLOCK = HOLD severity (no synthesizer to confirm DISSENT)
          litePublicVerdict = 'BLOCK';
          liteObjsSource = liteProposals[0].content;
        } else {
          // isSplit + no_escalation:true → UNCERTAIN
          liteInternalVerdict = 'UNCERTAIN';
          litePublicVerdict = 'UNCERTAIN';
          liteObjsSource = liteProposals[0].content;
        }

        const liteObjections = liteObjsSource
          ? extractPublicObjections(undefined, liteObjsSource)
          : [];

        const liteFlags: VerificationFlag[] = [];
        if (adversarialScan.detected) {
          liteFlags.push('adversarial-pattern');
          for (const p of adversarialScan.patterns) {
            liteFlags.push(`adversarial:${p}`);
          }
        }
        if (guardResult?.injected) {
          liteFlags.push('injection-detected');
          liteFlags.push(`guard:${guardResult.model}`);
        }
        if (isSplit) liteFlags.push('lite-split');
        if (extractionResult?.llmExtracted && extractionResult.claimCount === 0) {
          liteFlags.push('empty-extraction');
        }

        const liteDurationMs = Date.now() - startTime;

        const liteResult: VerificationResult = {
          verdict: litePublicVerdict,
          confidence: parseFloat(liteConf.toFixed(3)),
          severity_score: computeSeverityScore(liteInternalVerdict, liteConf),
          mdi: null, // lite: always null
          objections: liteObjections,
          domain: effectiveDomain,
          stakeLevel: effectiveStakeLevel,
          tier: 'lite',
          durationMs: liteDurationMs,
          verified: litePublicVerdict === 'ALLOW',
          flags: liteFlags,
          timestamp: new Date().toISOString(),
          ...(guardResult ? { guard: guardResult } : {}),
          ...(extractionResult ? {
            extraction: {
              model: extractionResult.model,
              claimCount: extractionResult.claimCount,
              llmExtracted: extractionResult.llmExtracted,
              latencyMs: extractionResult.latencyMs,
              rejectedClaims: extractionResult.rejectedClaims,
              ...(extractionResult.rejectionReasons.length > 0 ? { rejectionReasons: extractionResult.rejectionReasons } : {}),
            } as any,
          } : {}),
          pipeline: {
            mode: 'basic',
            generators: liteGens.map(g => g.model),
            critic: 'none',
            synthesizer: 'none',
            rounds: 1,
            duration_ms: liteDurationMs,
          },
        };

        return liteResult;
      }
    }
  }

  // ── STANDARD TIER PATH ────────────────────────────────────────────────────
  // Full pipeline: generators + critic + synthesizer.
  // Reached when: executedTier='standard', or lite fell through (split + escalation).
  // When escalated from lite split, this is the actual executed tier = standard.
  const standardExecutedTier: 'lite' | 'standard' = 'standard';

  // Sandbox check (runs in parallel with pipeline)
  const sandboxPromise = params.sandbox
    ? runSandboxCheck(output)
    : Promise.resolve(null);

  // Domain config
  let domainConfig: DomainConfig | undefined;
  if (effectiveDomain) {
    domainConfig = DOMAIN_PROFILES[effectiveDomain];
  }

  const criticMode: CriticMode = params.criticMode || domainConfig?.criticMode || 'adversarial';
  const requireCitation = params.requireCitation ?? domainConfig?.requireCitation ?? false;
  const classifyObjections = params.classifyObjections ?? domainConfig?.classifyObjections ?? false;
  const receptiveMode = params.receptiveMode ?? domainConfig?.receptiveMode;
  const outputFormat = params.outputFormat ?? 'human';

  // v1.2: Proportional critic for low-stakes decisions
  const useProportional = (effectiveStakeLevel === 'low') && !params.criticMode;

  let effectiveCriticMode = useProportional ? 'proportional' as CriticMode : criticMode;
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

  // Diversify inputs if enabled
  let diversifiedInputsForGenerators: DiversifiedInput[] | undefined;
  if (params.diversifyInputs === true && gensProviders.length > 1) {
    const inputToDiversify = (params.extractFeatures === true && extractionResult?.claimCount && extractionResult.claimCount > 0)
      ? extractionResult.sanitizedContent
      : question;
    diversifiedInputsForGenerators = diversifyInput(inputToDiversify, gensProviders.length, lang);
  }

  let proposals: Proposal[] = await runGenerators(
    gensProviders, claimWithContext, lang, false, undefined, diversifiedInputsForGenerators,
  );
  if (output) {
    proposals.push({ model: 'user-output', content: sanitizedOutput });
  }

  const critique = await runCritic(
    criticProvider, criticModel, proposals, lang, false, undefined, effectiveCriticMode,
    { requireCitation, classifyObjections, classifyMateriality: params.classifyMateriality, trustContext: params.context },
    gensProviders,
  );

  // Multi-round fact-checking
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

  // Synthesizer
  let synthesis: Synthesis;
  let dissent: any = undefined;

  if (gensProviders.length >= 2) {
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
    dissent = {
      dual_synthesis: false,
      single_source_warning: "Only one provider available; dual synthesis skipped",
    };
    synthesis = await runSynthesizer(
      synthProvider, synthModel, proposals, critiqueForSynthesis, lang, false, undefined, effectiveReceptiveMode,
    );
  }

  const genProposals = proposals.filter(p => p.model !== 'user-output');
  const balance = computeSynthesisBalance(genProposals, synthesis.content);
  const mdiValue = computeMdi(genProposals);
  const statedConfidence = parseConfidence(synthesis.content);

  // Patent Claim 4: Model Family MDI (Herfindahl-Hirschman Index)
  const allPipelineModels = [...generatorModelNames, criticModel, synthModel];
  const modelFamilyMDI = computeModelFamilyMDI(allPipelineModels);

  // Patent Claim 1(e): Model families used in pipeline
  const modelFamiliesUsed = extractModelFamilies(generatorModelNames, criticModel, synthModel);
  const dpr = computeDPR(critique.content, synthesis.content, balance.warning);

  // Reasoning-based aggregation
  const aggregation = aggregateFromReasoning(
    genProposals,
    critique.content,
    synthesis.content,
    statedConfidence,
    classifyObjections ? parseClassifiedObjections(critique.content) : undefined,
  );

  const confidence = aggregation.shouldOverride
    ? aggregation.aggregatedConfidence
    : statedConfidence;

  const flags: VerificationFlag[] = [];

  if (adversarialScan.detected) {
    flags.push('adversarial-pattern');
    for (const p of adversarialScan.patterns) {
      flags.push(`adversarial:${p}`);
    }
  }

  const UNVERIFIED_PATTERN = /\bunverified\b/i;
  if (UNVERIFIED_PATTERN.test(critique.content)) flags.push('unverified-claims');
  if (balance.warning && gensProviders.length >= 3) flags.push('synthesis-dominance');
  if (dpr.false_consensus) flags.push('false-consensus');
  if (mdiValue < 0.3) flags.push('low-model-diversity');
  if (confidence < 0.5) flags.push('low-confidence');

  // Disagreement detection
  const proposalContents = genProposals.map(p => p.content.toLowerCase());
  const allowSignals  = proposalContents.filter(c => /\ballow\b|\bsafe\b|\brecommend\b/.test(c)).length;
  const blockSignals  = proposalContents.filter(c => /\bblock\b|\bhold\b|\bdissent\b|\brisky\b|\bdanger/.test(c)).length;
  const totalSignals  = allowSignals + blockSignals;
  const splitRatio    = totalSignals > 0 ? Math.min(allowSignals, blockSignals) / totalSignals : 0;
  const maxProposalConf = genProposals.reduce((max, p) => {
    const c = parseConfidence(p.content);
    return c > max ? c : max;
  }, 0);
  const hasDisagreement = splitRatio >= 0.4 || maxProposalConf < 0.50;
  if (hasDisagreement) flags.push('generator-disagreement');
  if (toxicWarning) flags.push('toxic-combination');
  if (multiRoundSkipped) flags.push('multiround-same-provider');

  // Sandbox result
  const sandboxResult = await sandboxPromise;
  if (sandboxResult?.flags && sandboxResult.flags.length > 0) {
    flags.push(...sandboxResult.flags);
  }

  if (extractionResult?.llmExtracted && extractionResult.claimCount === 0) {
    flags.push('empty-extraction');
  }

  if (aggregation.divergesFromStated) flags.push('confidence-divergence');
  if (aggregation.shouldOverride) flags.push('confidence-overridden');

  if (guardResult?.injected) {
    flags.push('injection-detected');
    flags.push(`guard:${guardResult.model}`);
  }

  // Confidence caps
  const guardCap = guardResult?.injected ? 0.25 : 1.0;
  const finalConfidence = (adversarialScan.detected || guardResult?.injected)
    ? Math.min(confidence, adversarialScan.confidence_cap, guardCap)
    : confidence;

  let cappedConfidence = finalConfidence;
  if (domainConfig?.maxConfidence) {
    cappedConfidence = Math.min(finalConfidence, domainConfig.maxConfidence);
  }

  // Auto-calibration
  let calibration: ReturnType<typeof calibrateConfidence>;
  if (aggregation.shouldOverride) {
    calibration = { calibratedConfidence: cappedConfidence, adjusted: false, delta: 0, originalConfidence: cappedConfidence, reason: 'skipped: aggregation override active' };
  } else {
    calibration = calibrateConfidence(cappedConfidence, synthesis.content);
  }
  let finalCalibratedConfidence = calibration.calibratedConfidence;
  if (calibration.reason && !calibration.adjusted && calibration.reason.includes('mismatch')) {
    flags.push('calibration-mismatch');
  }

  // Calibrative critic mode
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

  // Materiality override
  let materialityResult: MaterialityResult | undefined;
  if (params.classifyMateriality) {
    materialityResult = parseMaterialityClassifications(critique.content);
    const materialityConfidence = calculateMaterialityConfidence(materialityResult);

    if (materialityResult.hasMaterialDefect) {
      finalCalibratedConfidence = Math.min(finalCalibratedConfidence, materialityConfidence);
    } else {
      const assessmentCaps: Record<string, number> = { sound: 0.95, adequate: 0.80, questionable: 0.60, deficient: 0.30 };
      const cap = assessmentCaps[materialityResult.overallAssessment] ?? 0.60;
      finalCalibratedConfidence = Math.min(cap, Math.max(finalCalibratedConfidence, materialityConfidence));
    }
  }

  // ── Verdict threshold (stake > failureCost > default) ─────────────────────
  const STAKE_THRESHOLDS_MAP: Record<string, number> = { low: 0.50, medium: 0.60, high: 0.75, critical: 0.85 };
  const verdictThreshold = STAKE_THRESHOLDS_MAP[effectiveStakeLevel] ??
    (params.failureCost ? FAILURE_COST_THRESHOLDS[params.failureCost] : 0.70);

  // ── Internal four-tier verdict ────────────────────────────────────────────
  let internalVerdict: InternalVerdict;
  if (materialityResult?.hasMaterialDefect || (dpr.false_consensus && finalCalibratedConfidence >= verdictThreshold)) {
    internalVerdict = 'DISSENT';
  } else if (hasDisagreement && !dpr.false_consensus) {
    internalVerdict = 'UNCERTAIN';
  } else if (finalCalibratedConfidence >= verdictThreshold && flags.length === 0 && balance.score > 0.6) {
    internalVerdict = 'ALLOW';
  } else if (finalCalibratedConfidence >= verdictThreshold) {
    internalVerdict = 'HOLD';
  } else {
    internalVerdict = 'UNCERTAIN';
  }

  // ── Map to public three-tier verdict ──────────────────────────────────────
  const verdict: Verdict = mapVerdict(internalVerdict);
  const severity_score = computeSeverityScore(internalVerdict, finalCalibratedConfidence);

  // ── Domain mismatch UNCERTAIN trigger ─────────────────────────────────────
  // Standard tier only: detected_domain="general" + stakeLevel ∈ {high, critical}
  // → UNCERTAIN (pipeline lacks domain context for the risk level)
  let domainMismatchUncertain = false;
  if (
    verdict !== 'UNCERTAIN' &&
    effectiveDomain === 'general' &&
    (effectiveStakeLevel === 'high' || effectiveStakeLevel === 'critical')
  ) {
    domainMismatchUncertain = true;
    flags.push('domain-mismatch-escalation');
  }

  const finalVerdict: Verdict = domainMismatchUncertain ? 'UNCERTAIN' : verdict;
  const finalSeverityScore: number | null = domainMismatchUncertain ? null : severity_score;

  const durationMs = Date.now() - startTime;

  // ── Objections ────────────────────────────────────────────────────────────
  const classifiedObjs = classifyObjections ? parseClassifiedObjections(critique.content) : undefined;
  const objections: string[] = extractPublicObjections(classifiedObjs, critique.content);

  // ── BiasMap ───────────────────────────────────────────────────────────────
  const biasMap = balance.generator_coverage.reduce((acc: Record<string, number>, d: { generator: string; share: number }) => {
    acc[d.generator] = d.share;
    return acc;
  }, {});

  // ── Cousin bias ───────────────────────────────────────────────────────────
  const cousinWarning = detectCousinBias(
    generatorModelNames, criticModel,
    Array.isArray(params.providers) ? params.providers as ProviderConfig[] : undefined,
  );
  if (cousinWarning.detected) flags.push('cousin-bias-risk');

  // ── Patent Claim 1(e): Minority positions (explicit dissent) ─────────────
  const minorityPositions = extractMinorityPositions(genProposals, finalVerdict, synthesis.content);

  // Merge minority positions into dissent structure
  const structuredDissent = {
    ...(typeof dissent === 'object' && dissent !== null ? dissent : {}),
    minority_positions: minorityPositions,
    minority_count: minorityPositions.length,
    consensus_reached: minorityPositions.length === 0,
  };

  // ── Build result ──────────────────────────────────────────────────────────
  const result = {
    // v2.0 public fields (always present, invariants enforced)
    verdict: finalVerdict,
    confidence: parseFloat(finalCalibratedConfidence.toFixed(3)),
    severity_score: finalSeverityScore,
    mdi: parseFloat(mdiValue.toFixed(3)),
    objections,
    domain: effectiveDomain,
    stakeLevel: effectiveStakeLevel,
    tier: standardExecutedTier,
    durationMs,

    // Patent alignment fields (v2.1)
    model_family_mdi: modelFamilyMDI,
    model_families_used: modelFamiliesUsed,

    // Legacy / extended fields
    verified: finalVerdict === 'ALLOW',
    flags,
    timestamp: new Date().toISOString(),
    sas: balance.score,
    dpr,
    biasMap,
    dissent: structuredDissent,
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
    aggregation: {
      statedConfidence,
      aggregatedConfidence: aggregation.aggregatedConfidence,
      divergence: aggregation.divergenceAmount,
      overridden: aggregation.shouldOverride,
      signals: aggregation.signals.map(s => ({ name: s.name, value: s.value, weight: s.weight, reason: s.reason })),
    },
    ...(sandboxResult ? { sandbox: sandboxResult } : {}),
    ...(guardResult ? { guard: guardResult } : {}),
    ...(extractionResult ? { extraction: { model: extractionResult.model, claimCount: extractionResult.claimCount, llmExtracted: extractionResult.llmExtracted, latencyMs: extractionResult.latencyMs, rejectedClaims: extractionResult.rejectedClaims, ...(extractionResult.rejectionReasons.length > 0 ? { rejectionReasons: extractionResult.rejectionReasons } : {}) } } : {}),
    ...(classifiedObjs ? { classifiedObjections: classifiedObjs } : {}),
    ...(materialityResult ? { materiality: materialityResult } : {}),
    ...(outputFormat !== 'human' ? { outputFormat } : {}),
    ...(factCheckedObjections ? { factCheckedObjections } : {}),
    ...(cousinWarning.detected ? { cousinWarning } : {}),
    ...(calibration.adjusted ? { calibrationAdjusted: true, calibrationDelta: calibration.delta } : {}),
    ...(params.failureCost ? { failureCostApplied: params.failureCost } : {}),
    ...(toxicCorrected ? { toxicCorrected } : {}),
    ...(calibrativeDelta !== undefined ? { calibrativeDelta, calibrativeReason } : {}),
    ...(params.audience ? { audience: params.audience } : {}),
  } as VerificationResult;

  if (params.debug) {
    (result as any).raw = { proposals, critique, synthesis };
  }

  // Audience: pipeline formatting
  if (params.audience === 'pipeline') {
    const topObj = result.classifiedObjections?.[0];
    const pipelineResult: PipelineResult = {
      pass: finalVerdict === 'ALLOW',
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
