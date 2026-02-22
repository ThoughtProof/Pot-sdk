import type { GeneratorConfig, Provider } from '../types.js';
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
  'anthropic': 'claude-3-5-sonnet-20241022',
  'xai': 'grok-beta',
  'deepseek': 'deepseek-chat',
  'moonshot': 'moonshot-v1-8k',
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

export { AnthropicProvider, XAIProvider, MoonshotProvider, DeepSeekProvider, OpenAIProvider };