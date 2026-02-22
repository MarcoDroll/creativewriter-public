import { BaseProvider } from './base';
import { ProviderOptions } from '../../types';

interface OllamaStreamChunk {
  response?: string;
  message?: {
    content?: string;
  };
  done?: boolean;
  error?: string;
}

export class OllamaProvider extends BaseProvider {
  protected name = 'ollama';

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

    // Ollama doesn't use API keys but we support the providerUrl
    const baseUrl = providerUrl || 'http://localhost:11434';

    try {
      // Try chat endpoint first (newer Ollama versions)
      const response = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          options: {
            num_predict: maxTokens,
            temperature: temperature ?? 0.7
          },
          stream: true
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();

      // Ollama uses NDJSON format, not SSE
      for await (const data of this.parseNDJSONStream(reader, controller.signal)) {
        const chunk = this.safeParseJSON<OllamaStreamChunk>(data);
        if (!chunk) continue;

        if (chunk.error) {
          throw new Error(`Ollama streaming error: ${chunk.error}`);
        }

        // Chat endpoint format
        const content = chunk.message?.content;
        if (content) {
          onChunk(content);
        }

        // Legacy generate endpoint format
        if (chunk.response) {
          onChunk(chunk.response);
        }

        if (chunk.done) {
          break;
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
