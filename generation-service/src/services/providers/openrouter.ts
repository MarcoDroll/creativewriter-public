import { BaseProvider } from './base';
import { ProviderOptions } from '../../types';

interface OpenRouterStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
    finish_reason?: string;
  }>;
  error?: {
    message: string;
    code?: string;
  };
}

export class OpenRouterProvider extends BaseProvider {
  protected name = 'openrouter';

  async generate(options: ProviderOptions): Promise<void> {
    const { apiKey, prompt, model, maxTokens, temperature, signal, onChunk } = options;

    const timeout = this.getTimeout();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Link to parent signal if provided (store handler for cleanup)
    const abortHandler = () => controller.abort();
    if (signal) {
      signal.addEventListener('abort', abortHandler);
    }

    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://creativewriter.app',
          'X-Title': 'CreativeWriter'
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature: temperature ?? 0.7,
          stream: true
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();

      for await (const data of this.parseSSEStream(reader, controller.signal)) {
        const chunk = this.safeParseJSON<OpenRouterStreamChunk>(data);
        if (!chunk) continue;

        if (chunk.error) {
          throw new Error(`OpenRouter streaming error: ${chunk.error.message}`);
        }

        const content = chunk.choices?.[0]?.delta?.content;
        if (content) {
          onChunk(content);
        }
      }
    } finally {
      clearTimeout(timeoutId);
      if (signal) {
        signal.removeEventListener('abort', abortHandler);
      }
    }
  }
}
