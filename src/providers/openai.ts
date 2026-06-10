import { BaseProvider } from './base.js';
import type { APIResponse } from '../types.js';

export class OpenAIProvider extends BaseProvider {
  name = 'OpenAI';
  protected baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string, providerName?: string) {
    super(apiKey);
    this.name = providerName || 'OpenAI';
    this.baseUrl = baseUrl || 'https://api.openai.com/v1/chat/completions';
  }

  async call(model: string, prompt: string, maxTokens: number = 8192): Promise<APIResponse> {
    if (!this.apiKey) {
      throw new Error(`${this.name} API key not configured`);
    }

    const response = await this.makeRequest(
      this.baseUrl,
      {
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: maxTokens,
      },
      {
        'Authorization': `Bearer ${this.apiKey}`,
      }
    );

    const message = response.choices[0].message;
    // Reasoning models (kimi-k2-thinking*) put output in reasoning_content, content may be empty
    const content = message.content || message.reasoning_content || '';
    const tokens = response.usage?.total_tokens || 0;
    const cost = this.estimateCost(tokens, model);

    return { content, tokens, cost };
  }
}

export class XAIProvider extends OpenAIProvider {
  name = 'xAI';
  
  constructor(apiKey?: string) {
    super(apiKey, 'https://api.x.ai/v1/chat/completions');
  }
}

export class MoonshotProvider extends OpenAIProvider {
  name = 'Moonshot';
  
  constructor(apiKey?: string) {
    super(apiKey, 'https://api.moonshot.ai/v1/chat/completions');
  }
}

export class DeepSeekProvider extends OpenAIProvider {
  name = 'DeepSeek';
  
  constructor(apiKey?: string) {
    super(apiKey, 'https://api.deepseek.com/chat/completions');
  }
}

/**
 * OpenServ SERV Reasoning provider (BRAID framework, OpenAI SDK-compatible).
 * Differs from the generic OpenAI provider in ONE critical way: SERV rejects
 * `max_tokens` with HTTP 400 ("Unsupported parameter: 'max_tokens' ... Use
 * 'max_completion_tokens' instead"). This affects ALL serv-* models, so we
 * override call() to send the correct parameter. Endpoint is OpenAI-compatible
 * otherwise (Bearer auth, /chat/completions, choices[0].message.content).
 */
export class ServProvider extends OpenAIProvider {
  name = 'SERV';

  constructor(apiKey?: string) {
    super(apiKey, 'https://inference-api.openserv.ai/v1/chat/completions', 'SERV');
  }

  async call(model: string, prompt: string, maxTokens: number = 8192): Promise<APIResponse> {
    if (!this.apiKey) {
      throw new Error(`${this.name} API key not configured`);
    }

    const response = await this.makeRequest(
      this.baseUrl,
      {
        model,
        messages: [
          // SERV requires a system/developer message — a request with only a
          // user message returns HTTP 400 ("A system prompt is required").
          { role: 'system', content: 'You are a careful reasoning verifier. Follow the user instructions precisely.' },
          { role: 'user', content: prompt },
        ],
        max_completion_tokens: maxTokens, // SERV requires this, NOT max_tokens
      },
      {
        'Authorization': `Bearer ${this.apiKey}`,
      }
    );

    const message = response.choices[0].message;
    // SERV/BRAID reasoning models may place output in reasoning_content.
    const content = message.content || message.reasoning_content || '';
    const tokens = response.usage?.total_tokens || 0;
    const cost = this.estimateCost(tokens, model);

    return { content, tokens, cost };
  }
}