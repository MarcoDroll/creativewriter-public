import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, takeUntil, Subject, catchError, throwError, map } from 'rxjs';
import { SettingsService } from './settings.service';
import { AIRequestLoggerService } from './ai-request-logger.service';

export interface OpenAICompatibleRequest {
  model: string;
  messages: {
    role: 'system' | 'user' | 'assistant';
    content: string;
  }[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

export interface OpenAICompatibleResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAICompatibleModelsResponse {
  object: string;
  data: {
    id: string;
    object: string;
    created?: number;
    owned_by?: string;
  }[];
}

@Injectable({
  providedIn: 'root'
})
export class OpenAICompatibleApiService {
  private http = inject(HttpClient);
  private settingsService = inject(SettingsService);
  private aiLogger = inject(AIRequestLoggerService);

  private abortSubjects = new Map<string, Subject<void>>();
  private requestMetadata = new Map<string, { logId: string; startTime: number }>();

  generateText(prompt: string, options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    wordCount?: number;
    requestId?: string;
    messages?: {role: 'system' | 'user' | 'assistant', content: string}[];
    stream?: boolean;
  } = {}): Observable<OpenAICompatibleResponse> {
    const settings = this.settingsService.getSettings();
    const startTime = Date.now();

    if (!settings.openAICompatible.enabled || !settings.openAICompatible.baseUrl) {
      return throwError(() => new Error('OpenAI-Compatible API is not enabled or base URL is missing'));
    }

    const model = options.model || settings.openAICompatible.model;
    if (!model) {
      return throwError(() => new Error('No AI model selected'));
    }

    const maxTokens = options.maxTokens || settings.openAICompatible.maxTokens;
    const wordCount = options.wordCount || Math.floor(maxTokens / 1.3);

    // Build prompt for logging - use messages if prompt is empty
    let promptForLogging = prompt;
    if (!promptForLogging && options.messages && options.messages.length > 0) {
      promptForLogging = options.messages
        .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
        .join('\n\n');
    }

    const baseUrl = this.normalizeBaseUrl(settings.openAICompatible.baseUrl);
    const url = `${baseUrl}/v1/chat/completions`;

    // Log the request
    const logId = this.aiLogger.logRequest({
      endpoint: url,
      model: model,
      wordCount: wordCount,
      maxTokens: maxTokens,
      prompt: promptForLogging,
      apiProvider: 'openaiCompatible',
      streamingMode: options.stream || false,
      requestDetails: {
        temperature: options.temperature !== undefined ? options.temperature : settings.openAICompatible.temperature,
        topP: options.topP !== undefined ? options.topP : settings.openAICompatible.topP,
        baseUrl: settings.openAICompatible.baseUrl
      }
    });

    const request: OpenAICompatibleRequest = {
      model: model,
      messages: options.messages && options.messages.length > 0
        ? options.messages
        : [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: options.temperature !== undefined ? options.temperature : settings.openAICompatible.temperature,
      top_p: options.topP !== undefined ? options.topP : settings.openAICompatible.topP
    };

    // Create abort subject for this request
    const requestId = options.requestId || this.generateRequestId();
    const abortSubject = new Subject<void>();
    this.abortSubjects.set(requestId, abortSubject);

    // Store request metadata for abort handling
    this.requestMetadata.set(requestId, { logId, startTime });

    return this.http.post<OpenAICompatibleResponse>(url, request, {
      headers: this.buildHeaders(settings)
    }).pipe(
      takeUntil(abortSubject),
      tap({
        next: (response) => {
          const duration = Date.now() - startTime;
          const content = response.choices?.[0]?.message?.content || '';
          this.aiLogger.logSuccess(logId, content, duration);
          this.cleanupRequest(requestId);
        },
        error: (error) => {
          const duration = Date.now() - startTime;
          let errorMessage = 'Unknown error';

          // Extract detailed error information
          if (error.status) {
            errorMessage = `HTTP ${error.status}: `;
            if (error.status === 400) {
              errorMessage += 'Bad Request - ';
            } else if (error.status === 401) {
              errorMessage += 'Unauthorized - ';
            } else if (error.status === 403) {
              errorMessage += 'Forbidden - ';
            } else if (error.status === 404) {
              errorMessage += 'Not Found - ';
            } else if (error.status === 429) {
              errorMessage += 'Rate Limited - ';
            } else if (error.status === 500) {
              errorMessage += 'Server Error - ';
            }
          }

          // Add error details
          if (error.error?.error?.message) {
            errorMessage += error.error.error.message;
          } else if (error.error?.message) {
            errorMessage += error.error.message;
          } else if (error.message) {
            errorMessage += error.message;
          }

          this.aiLogger.logError(logId, errorMessage, duration);
          this.cleanupRequest(requestId);
        }
      }),
      catchError(error => {
        return throwError(() => error);
      })
    );
  }

  abortRequest(requestId: string): void {
    const abortSubject = this.abortSubjects.get(requestId);
    const metadata = this.requestMetadata.get(requestId);

    if (abortSubject && metadata) {
      // Log the abort
      const duration = Date.now() - metadata.startTime;
      this.aiLogger.logAborted(metadata.logId, duration);

      // Abort the request
      abortSubject.next();
      this.cleanupRequest(requestId);
    }
  }

  private cleanupRequest(requestId: string): void {
    const abortSubject = this.abortSubjects.get(requestId);
    if (abortSubject) {
      abortSubject.complete();
      this.abortSubjects.delete(requestId);
    }
    this.requestMetadata.delete(requestId);
  }

  generateTextStream(prompt: string, options: {
    model?: string;
    maxTokens?: number;
    temperature?: number;
    topP?: number;
    wordCount?: number;
    requestId?: string;
    messages?: {role: 'system' | 'user' | 'assistant', content: string}[];
  } = {}): Observable<string> {
    const settings = this.settingsService.getSettings();
    const startTime = Date.now();

    if (!settings.openAICompatible.enabled || !settings.openAICompatible.baseUrl) {
      return throwError(() => new Error('OpenAI-Compatible API is not enabled or base URL is missing'));
    }

    const model = options.model || settings.openAICompatible.model;
    if (!model) {
      return throwError(() => new Error('No AI model selected'));
    }

    const maxTokens = options.maxTokens || settings.openAICompatible.maxTokens;
    const wordCount = options.wordCount || Math.floor(maxTokens / 1.3);

    // Build prompt for logging - use messages if prompt is empty
    let promptForLogging = prompt;
    if (!promptForLogging && options.messages && options.messages.length > 0) {
      promptForLogging = options.messages
        .map(m => `[${m.role.toUpperCase()}]: ${m.content}`)
        .join('\n\n');
    }

    const baseUrl = this.normalizeBaseUrl(settings.openAICompatible.baseUrl);
    const url = `${baseUrl}/v1/chat/completions`;

    // Log the request
    const logId = this.aiLogger.logRequest({
      endpoint: url,
      model: model,
      wordCount: wordCount,
      maxTokens: maxTokens,
      prompt: promptForLogging,
      apiProvider: 'openaiCompatible',
      streamingMode: true,
      requestDetails: {
        temperature: options.temperature !== undefined ? options.temperature : settings.openAICompatible.temperature,
        topP: options.topP !== undefined ? options.topP : settings.openAICompatible.topP,
        baseUrl: settings.openAICompatible.baseUrl
      }
    });

    const request: OpenAICompatibleRequest = {
      model: model,
      messages: options.messages && options.messages.length > 0
        ? options.messages
        : [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: options.temperature !== undefined ? options.temperature : settings.openAICompatible.temperature,
      top_p: options.topP !== undefined ? options.topP : settings.openAICompatible.topP,
      stream: true
    };

    // Create abort subject for this request
    const requestId = options.requestId || this.generateRequestId();
    const abortSubject = new Subject<void>();
    this.abortSubjects.set(requestId, abortSubject);

    // Store request metadata for abort handling
    this.requestMetadata.set(requestId, { logId, startTime });

    return new Observable<string>(observer => {
      let accumulatedContent = '';
      let aborted = false;

      // Create AbortController for cancellation
      const abortController = new AbortController();

      // Subscribe to abort signal
      const abortSubscription = abortSubject.subscribe(() => {
        aborted = true;
        abortController.abort();
        observer.complete();
        this.cleanupRequest(requestId);
      });

      // Use fetch for streaming
      fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(settings),
        body: JSON.stringify(request),
        signal: abortController.signal
      }).then(async response => {
        if (!response.ok) {
          // Try to get error body
          const errorBody = await response.text();
          throw new Error(`HTTP error! status: ${response.status}, body: ${errorBody}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Failed to get response reader');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        const readStream = (): Promise<void> => {
          return reader.read().then(({ done, value }) => {
            if (aborted || done) {
              if (done && !aborted) {
                const duration = Date.now() - startTime;
                observer.complete();
                this.aiLogger.logSuccess(logId, accumulatedContent, duration);
                this.cleanupRequest(requestId);
                abortSubscription.unsubscribe();
              }
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  continue;
                }

                try {
                  const parsed = JSON.parse(data);
                  const delta = parsed.choices?.[0]?.delta;
                  if (delta) {
                    // Filter out thinking/reasoning content from thinking models
                    // DeepSeek R1 uses reasoning_content, Kimi K2 uses thinking field
                    if (delta.reasoning_content || delta.thinking) {
                      // Skip thinking content - only emit actual output
                      continue;
                    }
                    // Only emit actual content
                    if (delta.content) {
                      accumulatedContent += delta.content;
                      observer.next(delta.content);
                    }
                  }
                } catch {
                  // Ignore parsing errors for incomplete JSON
                }
              }
            }

            return readStream();
          });
        };

        return readStream();
      }).catch(error => {
        if (aborted) return; // Don't handle errors if we aborted

        const duration = Date.now() - startTime;
        let errorMessage = 'Unknown error';

        // Extract detailed error information for streaming
        if (error.message) {
          errorMessage = error.message;
        }

        observer.error(error);
        this.aiLogger.logError(logId, errorMessage, duration);
        this.cleanupRequest(requestId);
        abortSubscription.unsubscribe();
      });

      return () => {
        aborted = true;
        abortController.abort();
        abortSubscription.unsubscribe();
      };
    }).pipe(
      takeUntil(abortSubject)
    );
  }

  listModels(): Observable<OpenAICompatibleModelsResponse> {
    const settings = this.settingsService.getSettings();

    if (!settings.openAICompatible.baseUrl) {
      return throwError(() => new Error('OpenAI-Compatible base URL is not configured'));
    }

    const baseUrl = this.normalizeBaseUrl(settings.openAICompatible.baseUrl);
    const url = `${baseUrl}/v1/models`;

    return this.http.get<OpenAICompatibleModelsResponse>(url, {
      headers: this.buildHeaders(settings)
    }).pipe(
        catchError(error => {
          console.error('Failed to load OpenAI-Compatible models:', error);
          return throwError(() => error);
        })
      );
  }

  testConnection(): Observable<boolean> {
    const settings = this.settingsService.getSettings();

    if (!settings.openAICompatible.baseUrl) {
      return throwError(() => new Error('OpenAI-Compatible base URL is not configured'));
    }

    const baseUrl = this.normalizeBaseUrl(settings.openAICompatible.baseUrl);
    const url = `${baseUrl}/v1/models`;

    return this.http.get(url, {
      headers: this.buildHeaders(settings)
    }).pipe(
        map(() => true),
        tap(() => console.log('OpenAI-Compatible connection test successful')),
        catchError(error => {
          console.error('OpenAI-Compatible connection test failed:', error);
          return throwError(() => new Error('Failed to connect to OpenAI-Compatible server'));
        })
      );
  }

  cancelRequest(requestId: string): void {
    const abortSubject = this.abortSubjects.get(requestId);
    if (abortSubject) {
      abortSubject.next();
      abortSubject.complete();
      this.abortSubjects.delete(requestId);

      const metadata = this.requestMetadata.get(requestId);
      if (metadata) {
        const duration = Date.now() - metadata.startTime;
        this.aiLogger.logError(metadata.logId, 'Request cancelled by user', duration);
        this.requestMetadata.delete(requestId);
      }
    }
  }

  private normalizeBaseUrl(baseUrl: string): string {
    // Strip trailing slashes
    let url = baseUrl.replace(/\/+$/, '');
    // Remove trailing version path (e.g., /v1, /v2) to prevent double /v1
    url = url.replace(/\/v\d+$/, '');
    return url;
  }

  private buildHeaders(settings: { openAICompatible: { apiKey?: string } }): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };
    if (settings.openAICompatible.apiKey) {
      headers['Authorization'] = `Bearer ${settings.openAICompatible.apiKey}`;
    }
    return headers;
  }

  private generateRequestId(): string {
    return 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
  }
}
