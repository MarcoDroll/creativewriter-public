import { BaseProvider } from './base';
import { ProviderOptions } from '../../types';
import { config } from '../../config';

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  error?: {
    message: string;
    code?: number;
  };
}

export class GeminiProvider extends BaseProvider {
  protected name = 'gemini';

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

    // Use gemini-proxy service
    const proxyUrl = `${config.geminiProxyUrl}/api/gemini/models/${model}:streamGenerateContent?alt=sse`;

    try {
      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: maxTokens,
            temperature: temperature ?? 0.7
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
      }

      if (!response.body) {
        throw new Error('No response body');
      }

      const reader = response.body.getReader();

      for await (const data of this.parseSSEStream(reader, controller.signal)) {
        const chunk = this.safeParseJSON<GeminiStreamChunk>(data);
        if (!chunk) continue;

        if (chunk.error) {
          throw new Error(`Gemini streaming error: ${chunk.error.message}`);
        }

        const text = chunk.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          onChunk(text);
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
