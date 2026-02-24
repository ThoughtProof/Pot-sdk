import type { GeneratorConfig, ProviderConfig, Provider } from '../types.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAIProvider, XAIProvider, MoonshotProvider, DeepSeekProvider } from './openai.js';

const DEFAULT_BASE_URLS: Record<string, string> = {
  'xai': 'https://api.x.ai/v1/chat/completions',
  'grok': 'https://api.x.ai/v1/chat/completions',
  'moonshot': 'https://api.moonshot.ai/v1/chat/completions',
  'kimi': 'https://api.moonshot.ai/v1/chat/completions',
  'deepseek': 'https://api.deepseek.com/chat/completions',
  'openai': 'https://api.openai.com/v1/chat/completions',
};

const DEFAULT_MODELS: Record<string, string> = {
  'anthropic': 'claude-sonnet-4-6',
  'xai': 'grok-4-1-fast-non-reasoning',
  'deepseek': 'deepseek-chat',
  'moonshot': 'kimi-k2-turbo-preview',
};

export function detectBaseUrl(providerName: string, model: string): string {
  const nameLower = providerName.toLowerCase();
  const modelLower = model.toLowerCase();

  if (DEFAULT_BASE_URLS[nameLower]) {
    return DEFAULT_BASE_URLS[nameLower];
  }

  for (const [key, url] of Object.entries(DEFAULT_BASE_URLS)) {
    if (modelLower.includes(key)) {
      return url;
    }
  }

  return DEFAULT_BASE_URLS['openai'];
}

export function createProvider(config: GeneratorConfig): Provider {
  if (config.provider === 'anthropic') {
    return new AnthropicProvider(config.apiKey, config.name);
  }

  const baseUrl = config.baseUrl || detectBaseUrl(config.name, config.model);
  return new OpenAIProvider(config.apiKey, baseUrl, config.name);
}

/**
 * Create a Provider from a user-facing ProviderConfig (v0.2+).
 * Automatically selects Anthropic or OpenAI-compatible backend.
 */
export function createProviderFromConfig(config: ProviderConfig): Provider {
  const nameLower = config.name.toLowerCase();
  const isAnthropic =
    nameLower === 'anthropic' ||
    config.model.toLowerCase().startsWith('claude');

  if (isAnthropic) {
    return new AnthropicProvider(config.apiKey, config.name);
  }

  const baseUrl = config.baseUrl || detectBaseUrl(config.name, config.model);
  return new OpenAIProvider(config.apiKey, baseUrl, config.name);
}

/**
 * Assign generator/critic/synthesizer roles to a flat ProviderConfig array.
 *
 * Rules (when role is not set explicitly):
 *   1 provider  → used for all three roles
 *   2 providers → [0] = generators + critic, [1] = synthesizer
 *   3+ providers → [0..n-2] = generators, [n-2] = critic (shared with last generator), [n-1] = synthesizer
 */
export function assignRoles(providers: ProviderConfig[]): {
  generators: ProviderConfig[];
  critic: ProviderConfig;
  synthesizer: ProviderConfig;
} {
  if (providers.length === 0) {
    throw new Error('At least one provider is required');
  }

  // If explicit roles are set, use them
  const explicitGenerators = providers.filter(p => p.role === 'generator' || p.role === 'any');
  const explicitCritic = providers.find(p => p.role === 'critic' || p.role === 'any');
  const explicitSynth = providers.find(p => p.role === 'synthesizer' || p.role === 'any');

  if (explicitCritic && explicitSynth && explicitGenerators.length > 0) {
    return {
      generators: explicitGenerators,
      critic: explicitCritic,
      synthesizer: explicitSynth,
    };
  }

  // Auto-assign by position
  if (providers.length === 1) {
    return { generators: providers, critic: providers[0], synthesizer: providers[0] };
  }
  if (providers.length === 2) {
    return { generators: [providers[0]], critic: providers[0], synthesizer: providers[1] };
  }
  // 3+
  const generators = providers.slice(0, -1);
  const critic = providers[providers.length - 2];
  const synthesizer = providers[providers.length - 1];
  return { generators, critic, synthesizer };
}

export { AnthropicProvider, XAIProvider, MoonshotProvider, DeepSeekProvider, OpenAIProvider };