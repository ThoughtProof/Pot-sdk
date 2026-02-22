import type { VerificationResult, Proposal, Synthesis, VerificationFlag, GeneratorConfig } from './types.js';
import { runGenerators } from './pipeline/generator.js';
import { runCritic } from './pipeline/critic.js';
import { runSynthesizer, computeSynthesisBalance } from './pipeline/synthesizer.js';
import { createProvider } from './providers/index.js';
import { parseConfidence, computeMdi } from './utils.js';

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
  tier?: 'basic' | 'pro';
  providers?: {
    generators?: string[];
    critic?: string;
    synthesizer?: string;
  };
  apiKeys: Record<string, string>;
  question: string;
  output?: string;
  language?: 'en' | 'de';
  debug?: boolean;
}

const DEFAULT_GEN_NAMES = ['anthropic', 'xai', 'deepseek', 'moonshot'] as const;
const DEFAULT_MODELS: Record<string, string> = {
  'anthropic': 'claude-3-5-sonnet-20241022',
  'xai': 'grok-beta',
  'deepseek': 'deepseek-chat',
  'moonshot': 'moonshot-v1-8k',
};

export async function verify(output: string, params: VerifyParams): Promise<VerificationResult> {
  const tier = params.tier || 'basic';
  const lang = params.language || 'en';

  const MAX_INPUT_LENGTH = { basic: 2000, pro: 8000, deep: 32000 };
  if (params.question.length > MAX_INPUT_LENGTH[tier as keyof typeof MAX_INPUT_LENGTH]) {
    throw new Error(`Input exceeds ${tier} tier limit (${MAX_INPUT_LENGTH[tier as keyof typeof MAX_INPUT_LENGTH]} chars)`);
  }

  const genNames = params.providers?.generators || DEFAULT_GEN_NAMES.slice(0, tier === 'pro' ? 4 : 1);
  const criticName = params.providers?.critic || 'anthropic';
  const synthName = params.providers?.synthesizer || 'anthropic';

  function buildConfig(name: string): GeneratorConfig {
    const model = DEFAULT_MODELS[name as keyof typeof DEFAULT_MODELS] || DEFAULT_MODELS.anthropic;
    const apiKey = params.apiKeys[name];
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
  const gensProviders = genConfigs.map((c) => {
    const provider = createProvider(c);
    if ((c as any).apiKey) (c as any).apiKey = undefined;
    return { provider, model: c.model };
  });

  let proposals: Proposal[] = await runGenerators(gensProviders, params.question, lang);
  if (output) {
    proposals.push({ model: 'user-output', content: output });
  }

  const criticConfig = buildConfig(criticName);
  const criticProvider = createProvider(criticConfig);
  if ((criticConfig as any).apiKey) (criticConfig as any).apiKey = undefined;
  const critique = await runCritic(criticProvider, criticConfig.model, proposals, lang);

  const synthConfig = buildConfig(synthName);
  const synthProvider = createProvider(synthConfig);
  if ((synthConfig as any).apiKey) (synthConfig as any).apiKey = undefined;

  let synthesis: Synthesis;
  let dissent: any = undefined;

  if (tier === 'pro' && gensProviders.length >= 2) {
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
    const synth_model = synthConfig.model;
    if (tier === 'pro') {
      dissent = {
        dual_synthesis: false,
        single_source_warning: "Only one provider available; dual synthesis skipped",
      };
    }
    synthesis = await runSynthesizer(synthProvider, synth_model, proposals, critique, lang);
  }

  const genProposals = proposals.filter(p => p.model !== 'user-output');
  const balance = computeSynthesisBalance(genProposals, synthesis.content);
  const mdi = computeMdi(genProposals);
  const confidence = parseConfidence(synthesis.content);

  const flags: VerificationFlag[] = [];
  const UNVERIFIED_PATTERN = /\bunverified\b/i;
  if (UNVERIFIED_PATTERN.test(critique.content)) flags.push('unverified-claims');
  if (balance.warning) flags.push('synthesis-dominance');
  if (mdi < 0.3) flags.push('low-model-diversity');
  if (confidence < 0.5) flags.push('low-confidence');

  const verified = confidence > 0.75 && flags.length === 0 && balance.score > 0.6;

  const biasMap = balance.generator_coverage.reduce((acc: Record<string, number>, d: { generator: string; share: number }) => {
    acc[d.generator] = d.share;
    return acc;
  }, {});

  const result = {
    verified,
    confidence,
    tier,
    flags,
    timestamp: new Date().toISOString(),
    mdi: parseFloat(mdi.toFixed(3)),
    sas: balance.score,
    biasMap,
    dissent,
  } as VerificationResult;

  if (params.debug) {
    (result as any).raw = { proposals, critique, synthesis };
  }

  return result;
}