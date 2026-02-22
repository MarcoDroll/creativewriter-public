import { BaseProvider } from './base';
import { ProviderOptions } from '../../types';

interface OpenAICompatStreamChunk {
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

export class OpenAICompatProvider extends BaseProvider {
  protected name = 'openai-compat';

  async generate(options: ProviderOptions): Promise<void> {
    const { apiKey, prompt, model, maxTokens, temperature, providerUrl, signal, onChunk } = options;

    const timeout = this.getTimeout();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Link to parent signal if provided (store handler for cleanup)
    const abortHandler = () => controller.abort();
    if (signal) {
      signal.addEventListener('abort', abortHandler);
    }

    // Use provided URL or default
    const baseUrl = providerUrl || 'http://localhost:1234';
    const endpoint = `${baseUrl}/v1/chat/completions`;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
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
        throw new Error(`OpenAI-Compatible API error: ${response.status} - ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();

      for await (const data of this.parseSSEStream(reader, controller.signal)) {
        const chunk = this.safeParseJSON<OpenAICompatStreamChunk>(data);
        if (!chunk) continue;

        if (chunk.error) {
          throw new Error(`OpenAI-Compatible streaming error: ${chunk.error.message}`);
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
