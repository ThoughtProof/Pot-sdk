import { BaseProvider } from './base.js';
import type { APIResponse } from '../types.js';

export class AnthropicProvider extends BaseProvider {
  name = 'Anthropic';
  protected baseUrl = 'https://api.anthropic.com/v1/messages';

  constructor(apiKey?: string, providerName?: string) {
    super(apiKey);
    this.name = providerName || 'Anthropic';
  }

  async call(model: string, prompt: string, maxTokens: number = 8192, temperature?: number): Promise<APIResponse> {
    if (!this.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const response = await this.makeRequest(
      this.baseUrl,
      {
        model,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
        // Deterministic-ish sampling for judgment tasks (critic materiality
        // classification). Omitted unless explicitly requested — generators
        // keep default temperature for proposal diversity.
        ...(temperature !== undefined ? { temperature } : {}),
      },
      {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      300000 // 5 min timeout for Opus
    );

    const content = response.content[0].text;
    const tokens = response.usage.input_tokens + response.usage.output_tokens;
    const cost = this.estimateCost(tokens, model);

    return { content, tokens, cost };
  }
}