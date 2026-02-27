import type { VerificationResult, Proposal, Synthesis, VerificationFlag, GeneratorConfig, ProviderConfig, Verdict, VerificationMode, CriticMode } from './types.js';
import { runGenerators } from './pipeline/generator.js';
import { runCritic } from './pipeline/critic.js';
import { runSynthesizer, computeSynthesisBalance } from './pipeline/synthesizer.js';
import { computeDPR } from './metrics/dpr.js';
import { createProvider, createProviderFromConfig, assignRoles } from './providers/index.js';
import { parseConfidence, computeMdi } from './utils.js';
import { scanForAdversarialPatterns } from './security.js';
import { runSandboxCheck } from './sandbox.js';

async function runDualSynthesizer(
  provider1: ReturnType<typeof createProvider>, model1: string,
  provider2: ReturnType<typeof createProvider>, model2: string,
  proposals: Proposal[], critique: { model: string; content: string }, lang: 'en' | 'de'
): Promise<{ primary: Synthesis; verification: { similarity_score: number; diverged: boolean; synth_coverage?: number } }> {
  if (provider1 === provider2 && model1 === model2) {
    throw new Error('Dual synthesizer requires distinct provider+model pairs');
  }

  const SIMILARITY_DIVERGENCE_THRESHOLD = 0.6;

  const synthCalls = [
    runSynthesizer(provider1, model1, proposals, critique, lang),
    runSynthesizer(provider2, model2, proposals, critique, lang),
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

  // WASM sandbox check — runs in parallel with pipeline (opt-in via params.sandbox)
  const sandboxPromise = params.sandbox
    ? runSandboxCheck(output)
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
  let proposals: Proposal[] = await runGenerators(gensProviders, question, lang);
  if (output) {
    proposals.push({ model: 'user-output', content: output });
  }

  const criticMode: CriticMode = params.criticMode || 'adversarial';
  const critique = await runCritic(criticProvider, criticModel, proposals, lang, false, undefined, criticMode);

  let synthesis: Synthesis;
  let dissent: any = undefined;

  if (mode !== 'basic' && gensProviders.length >= 2) {
    const synth1 = gensProviders[0];
    const synth2 = gensProviders[1];
    const { primary, verification } = await runDualSynthesizer(
      synth1.provider, synth1.model,
      synth2.provider, synth2.model,
      proposals, critique, lang
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
    synthesis = await runSynthesizer(synthProvider, synthModel, proposals, critique, lang);
  }

  const genProposals = proposals.filter(p => p.model !== 'user-output');
  const balance = computeSynthesisBalance(genProposals, synthesis.content);
  const mdi = computeMdi(genProposals);
  const confidence = parseConfidence(synthesis.content);
  const dpr = computeDPR(critique.content, synthesis.content, balance.warning);

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

  // Collect WASM sandbox result (was running in parallel with pipeline)
  const sandboxResult = await sandboxPromise;
  if (sandboxResult?.flags && sandboxResult.flags.length > 0) {
    flags.push(...sandboxResult.flags);
  }

  // Cap confidence if adversarial patterns detected
  const finalConfidence = adversarialScan.detected
    ? Math.min(confidence, adversarialScan.confidence_cap)
    : confidence;

  const verified = finalConfidence > 0.75 && flags.length === 0 && balance.score > 0.6;

  // v0.3: Compute verdict enum
  let verdict: Verdict;
  if (dpr.false_consensus && finalConfidence >= 0.70) {
    verdict = 'DISSENT';
  } else if (finalConfidence >= 0.70 && flags.length === 0 && balance.score > 0.6) {
    verdict = 'VERIFIED';
  } else if (finalConfidence >= 0.70) {
    verdict = 'UNVERIFIED';
  } else {
    verdict = 'UNCERTAIN';
  }

  const durationMs = Date.now() - startTime;

  const biasMap = balance.generator_coverage.reduce((acc: Record<string, number>, d: { generator: string; share: number }) => {
    acc[d.generator] = d.share;
    return acc;
  }, {});

  const result = {
    verified,
    verdict,
    confidence: finalConfidence,
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
      rounds: mode === 'deep' ? 2 : 1,
      duration_ms: durationMs,
    },
    ...(sandboxResult ? { sandbox: sandboxResult } : {}),
  } as VerificationResult;

  if (params.debug) {
    (result as any).raw = { proposals, critique, synthesis };
  }

  return result;
}