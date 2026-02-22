import { ProviderOptions } from '../../types';
import { config } from '../../config';

export abstract class BaseProvider {
  protected abstract name: string;

  /**
   * Execute the generation with streaming
   */
  abstract generate(options: ProviderOptions): Promise<void>;

  /**
   * Get the timeout for this provider
   */
  protected getTimeout(): number {
    return config.providerTimeouts[this.name as keyof typeof config.providerTimeouts] || 5 * 60 * 1000;
  }

  /**
   * Helper to read and parse SSE stream
   */
  protected async *parseSSEStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (signal?.aborted) {
          throw new Error('Request aborted');
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data && data !== '[DONE]') {
              yield data;
            }
          }
        }
      }

      // Process any remaining buffer
      if (buffer.startsWith('data: ')) {
        const data = buffer.slice(6).trim();
        if (data && data !== '[DONE]') {
          yield data;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Helper to read NDJSON stream (used by Ollama)
   */
  protected async *parseNDJSONStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    signal?: AbortSignal
  ): AsyncGenerator<string, void, unknown> {
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (signal?.aborted) {
          throw new Error('Request aborted');
        }

        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim()) {
            yield line.trim();
          }
        }
      }

      // Process any remaining buffer
      if (buffer.trim()) {
        yield buffer.trim();
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Safely parse JSON with error handling
   */
  protected safeParseJSON<T>(data: string): T | null {
    try {
      return JSON.parse(data);
    } catch {
      console.warn(`[${this.name}] Failed to parse JSON:`, data.substring(0, 100));
      return null;
    }
  }

  /**
   * Sleep helper for retry backoff
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
