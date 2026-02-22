import { Injectable } from '@angular/core';
import { Observable, Subscriber, from, throwError } from 'rxjs';
import { switchMap, catchError } from 'rxjs/operators';
import {
  ServerGenerationOptions,
  ServerGenerationEvent,
  ServerGenerationJob,
  CreateJobResponse,
  GetJobsResponse,
  RateLimitError
} from '../models/generation.interface';

const GENERATION_SESSION_KEY = 'generation-session-id';

@Injectable({
  providedIn: 'root'
})
export class ServerGenerationService {
  private clientId: string;

  constructor() {
    this.clientId = this.getOrCreateSessionId();
  }

  private getOrCreateSessionId(): string {
    const existing = localStorage.getItem(GENERATION_SESSION_KEY);
    if (existing) {
      return existing;
    }

    const id = this.generateUUID();
    localStorage.setItem(GENERATION_SESSION_KEY, id);
    return id;
  }

  /**
   * Generate a UUID v4, with fallback for non-secure contexts.
   * crypto.randomUUID() requires HTTPS or localhost, so we need a fallback
   * for HTTP access on LAN IPs during development.
   */
  private generateUUID(): string {
    // crypto.randomUUID requires secure context (HTTPS or localhost)
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      try {
        return crypto.randomUUID();
      } catch {
        // Falls through to fallback
      }
    }

    // Fallback: generate UUID v4 using getRandomValues (works in non-secure contexts)
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    // Set version (4) and variant (RFC 4122) bits
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /**
   * Check if the generation service is available.
   * We validate the response is actually JSON from our service,
   * not an HTML fallback from nginx when the service is down.
   */
  async isServiceAvailable(): Promise<boolean> {
    try {
      const response = await fetch('/api/generation/health', {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        return false;
      }

      // Verify it's actually JSON from our service, not HTML from nginx fallback
      const contentType = response.headers.get('content-type');
      if (!contentType?.includes('application/json')) {
        return false;
      }

      // Verify the response has expected structure
      const data = await response.json();
      return data && data.status === 'ok';
    } catch {
      return false;
    }
  }

  /**
   * Start a new generation job
   */
  startJob(options: ServerGenerationOptions): Observable<CreateJobResponse> {
    return from(this.startJobAsync(options));
  }

  private async startJobAsync(options: ServerGenerationOptions): Promise<CreateJobResponse> {
    const response = await fetch('/api/generation/jobs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        clientId: this.clientId,
        apiKey: options.apiKey,
        prompt: options.prompt,
        provider: options.provider,
        model: options.model,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        providerUrl: options.providerUrl,
        // Job type and grouping (for research jobs)
        jobType: options.jobType,
        groupId: options.groupId,
        sceneIndex: options.sceneIndex,
        totalScenes: options.totalScenes,
        // Context
        beatId: options.beatId,
        storyId: options.storyId,
        chapterId: options.chapterId,
        sceneId: options.sceneId
      })
    });

    if (response.status === 429) {
      const error: RateLimitError = await response.json();
      throw new Error(`Rate limit: ${error.message}. Existing job: ${error.existingJobId}`);
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `Failed to start job: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Parse and emit a single SSE event.
   * Returns 'terminal' if the stream should end (complete/error), 'continue' otherwise.
   */
  private processSSEEvent(
    event: string,
    observer: Subscriber<ServerGenerationEvent>,
    context: string
  ): 'continue' | 'terminal' {
    const trimmedEvent = event.trim();
    if (!trimmedEvent || trimmedEvent.startsWith(':')) {
      return 'continue';
    }

    if (trimmedEvent.startsWith('data: ')) {
      try {
        const data = JSON.parse(trimmedEvent.slice(6)) as ServerGenerationEvent;

        if (data.type === 'chunk') {
          observer.next({ type: 'chunk', text: data.text });
        } else if (data.type === 'complete') {
          observer.next({ type: 'complete' });
          observer.complete();
          return 'terminal';
        } else if (data.type === 'error') {
          observer.error(new Error(data.error || 'Generation failed'));
          return 'terminal';
        }
      } catch (parseError) {
        console.warn(`[ServerGeneration] SSE parse error (${context}):`, parseError, trimmedEvent);
      }
    }

    return 'continue';
  }

  /**
   * Stream events from a job using fetch (not EventSource, as we need custom handling)
   */
  streamJob(jobId: string): Observable<ServerGenerationEvent> {
    return new Observable(observer => {
      let aborted = false;
      const controller = new AbortController();
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

      (async () => {
        try {
          const response = await fetch(
            `/api/generation/jobs/${jobId}/stream`,
            { signal: controller.signal }
          );

          if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || `HTTP ${response.status}`);
          }

          if (!response.body) {
            throw new Error('No response body');
          }

          reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (!aborted) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() || '';

            for (const event of events) {
              if (this.processSSEEvent(event, observer, 'stream') === 'terminal') {
                return;
              }
            }
          }

          // Flush any remaining data from the decoder (handles multi-byte UTF-8 characters)
          const remaining = decoder.decode();
          if (remaining) {
            buffer += remaining;
          }

          // Process any remaining complete events in the buffer
          // This is critical for job recovery where backend sends all accumulated content at once
          if (buffer.trim()) {
            const remainingEvents = buffer.split('\n\n');
            for (const event of remainingEvents) {
              if (this.processSSEEvent(event, observer, 'buffer flush') === 'terminal') {
                return;
              }
            }
          }

          // Stream ended without explicit complete event
          observer.complete();
        } catch (error) {
          if (!aborted) {
            observer.error(error);
          }
        } finally {
          reader?.cancel().catch(() => { /* Intentionally ignored - reader cleanup */ });
        }
      })();

      // Cleanup function
      return () => {
        aborted = true;
        controller.abort();
      };
    });
  }

  /**
   * Get job status (for recovery/polling)
   */
  getJob(jobId: string): Observable<ServerGenerationJob> {
    return from(this.getJobAsync(jobId));
  }

  private async getJobAsync(jobId: string): Promise<ServerGenerationJob> {
    const response = await fetch(`/api/generation/jobs/${jobId}`);
    if (!response.ok) {
      throw new Error(`Failed to get job: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Get all jobs for this client (for recovery at app start)
   */
  getPendingJobs(): Observable<GetJobsResponse> {
    return from(this.getPendingJobsAsync());
  }

  private async getPendingJobsAsync(): Promise<GetJobsResponse> {
    const response = await fetch(`/api/generation/jobs?clientId=${this.clientId}`);
    if (!response.ok) {
      throw new Error(`Failed to get jobs: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Get all jobs for a specific research group
   */
  getJobsForGroup(groupId: string): Observable<GetJobsResponse> {
    return from(this.getJobsForGroupAsync(groupId));
  }

  private async getJobsForGroupAsync(groupId: string): Promise<GetJobsResponse> {
    const response = await fetch(`/api/generation/jobs?clientId=${this.clientId}&groupId=${encodeURIComponent(groupId)}`);
    if (!response.ok) {
      throw new Error(`Failed to get jobs for group: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Cancel a job
   */
  cancelJob(jobId: string): Observable<{ success: boolean }> {
    return from(this.cancelJobAsync(jobId));
  }

  private async cancelJobAsync(jobId: string): Promise<{ success: boolean }> {
    const response = await fetch(`/api/generation/jobs/${jobId}`, {
      method: 'DELETE'
    });
    if (!response.ok) {
      throw new Error(`Failed to cancel job: ${response.status}`);
    }
    return response.json();
  }

  /**
   * Convenience method: Start a job and stream its results
   */
  generateWithStream(options: ServerGenerationOptions): Observable<ServerGenerationEvent> {
    return this.startJob(options).pipe(
      switchMap(result => this.streamJob(result.jobId)),
      catchError(error => throwError(() => error))
    );
  }

  /**
   * Get the current client ID (for debugging)
   */
  getClientId(): string {
    return this.clientId;
  }
}
