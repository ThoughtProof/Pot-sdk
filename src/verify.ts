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
): Promise<{ primary: Synthesis; verification: { similarity_score: number; diverged: boolean } }> {
  const [primary, secondary] = await Promise.all([
    runSynthesizer(provider1, model1, proposals, critique, lang),
    runSynthesizer(provider2, model2, proposals, critique, lang),
  ]);
  const overlap = primary.content.slice(0, 120) === secondary.content.slice(0, 120) ? 0.9 : 0.4;
  return {
    primary,
    verification: { similarity_score: overlap, diverged: overlap < 0.6 },
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

  const genNames = params.providers?.generators || DEFAULT_GEN_NAMES.slice(0, tier === 'pro' ? 4 : 1);
  const criticName = params.providers?.critic || 'anthropic';
  const synthName = params.providers?.synthesizer || 'anthropic';

  function buildConfig(name: string): GeneratorConfig {
    const model = DEFAULT_MODELS[name as keyof typeof DEFAULT_MODELS] || DEFAULT_MODELS.anthropic;
    const apiKey = params.apiKeys[name];
    if (!apiKey) {
      throw new Error(`Missing API key for provider '${name}'.`);
    }
    return {
      name,
      model,
      apiKey,
      ...(name === 'anthropic' ? { provider: 'anthropic' as const } : {}),
    };
  }

  const genConfigs = genNames.map(buildConfig);
  const gensProviders = genConfigs.map(c => ({ provider: createProvider(c), model: c.model }));

  let proposals: Proposal[] = await runGenerators(gensProviders, params.question, lang);
  if (output) {
    proposals.push({ model: 'user-output', content: output });
  }

  const criticConfig = buildConfig(criticName);
  const criticProvider = createProvider(criticConfig);
  const critique = await runCritic(criticProvider, criticConfig.model, proposals, lang);

  const synthConfig = buildConfig(synthName);
  const synthProvider = createProvider(synthConfig);

  let synthesis: Synthesis;
  let dissent = undefined;

  if (tier === 'pro') {
    // For pro, use dual synthesizer for verification
    const { primary, verification } = await runDualSynthesizer(
      synthProvider, synthConfig.model,
      synthProvider, synthConfig.model, // same for simple, could rotate
      proposals, critique, lang
    );
    synthesis = primary;
    dissent = {
      similarity_score: verification.similarity_score,
      diverged: verification.diverged,
    };
  } else {
    synthesis = await runSynthesizer(synthProvider, synthConfig.model, proposals, critique, lang);
  }

  const genProposals = proposals.filter(p => p.model !== 'user-output');
  const balance = computeSynthesisBalance(genProposals, synthesis.content);
  const mdi = computeMdi(genProposals);
  const confidence = parseConfidence(synthesis.content);

  const flags: VerificationFlag[] = [];
  if (critique.content.toLowerCase().includes('unverified')) flags.push('unverified-claims');
  if (balance.warning) flags.push('synthesis-dominance');
  if (mdi < 0.3) flags.push('low-model-diversity');
  if (confidence < 0.5) flags.push('low-confidence');

  const verified = confidence > 0.75 && flags.length === 0 && balance.score > 0.6;

  const biasMap = balance.generator_coverage.reduce((acc: Record<string, number>, d: { generator: string; share: number }) => {
    acc[d.generator] = d.share;
    return acc;
  }, {});

  return {
    verified,
    confidence,
    tier,
    flags,
    timestamp: new Date().toISOString(),
    mdi: parseFloat(mdi.toFixed(3)),
    sas: balance.score,
    biasMap,
    dissent,
    raw: { proposals, critique, synthesis },
  };
}