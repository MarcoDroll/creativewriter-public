import { BaseProvider } from './base';
import { ProviderOptions } from '../../types';

interface ClaudeStreamEvent {
  type: string;
  delta?: {
    type: string;
    text?: string;
  };
  message?: {
    content: Array<{ type: string; text: string }>;
  };
  error?: {
    type: string;
    message: string;
  };
}

export class ClaudeProvider extends BaseProvider {
  protected name = 'claude';

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
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
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
        throw new Error(`Claude API error: ${response.status} - ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();

      for await (const data of this.parseSSEStream(reader, controller.signal)) {
        const event = this.safeParseJSON<ClaudeStreamEvent>(data);
        if (!event) continue;

        if (event.type === 'content_block_delta' && event.delta?.text) {
          onChunk(event.delta.text);
        } else if (event.type === 'error' && event.error) {
          throw new Error(`Claude streaming error: ${event.error.message}`);
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
