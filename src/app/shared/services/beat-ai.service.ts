import { Injectable, OnDestroy, inject } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Observable, ReplaySubject, Subject, Subscription, bufferTime, catchError, filter, from, map, of, switchMap, take, tap } from 'rxjs';
import { BeatAI, BeatAIGenerationEvent } from '../../stories/models/beat-ai.interface';
import {
  Story, NarrativePerspective, StoryTense,
  DEFAULT_BEAT_TEMPLATE_SECTIONS, DEFAULT_SCENE_BEAT_TEMPLATE_SECTIONS
} from '../../stories/models/story.interface';
import { sectionsToTemplate, sceneBeatSectionsToTemplate, mergeBeatSections, mergeSceneBeatSections, mergeEnvisionBeatSections } from '../utils/template-migration';
import { OpenRouterApiService } from '../../core/services/openrouter-api.service';
import { GoogleGeminiApiService } from '../../core/services/google-gemini-api.service';
import { OllamaApiService } from '../../core/services/ollama-api.service';
import { ClaudeApiService } from '../../core/services/claude-api.service';
import { OpenAICompatibleApiService } from '../../core/services/openai-compatible-api.service';
import { SettingsService } from '../../core/services/settings.service';
import { AIProviderValidationService } from '../../core/services/ai-provider-validation.service';
import { StoryService } from '../../stories/services/story.service';
import { PromptManagerService } from './prompt-manager.service';
import { CodexEntry } from '../../stories/models/codex.interface';
import { CodexContextService } from './codex-context.service';
import { DatabaseService } from '../../core/services/database.service';
import { ServerGenerationService } from '../../core/services/server-generation.service';
import { PendingJobsService } from '../../core/services/pending-jobs.service';
import { ServerProviderType } from '../../core/models/generation.interface';

type ProviderType = 'ollama' | 'claude' | 'gemini' | 'openrouter' | 'openaiCompatible';

interface GenerationContext {
  beatId: string;
  provider: ProviderType;
  prompt: string;
  options: {
    model?: string;
    temperature?: number;
    topP?: number;
  };
  wordCount: number;
  maxTokens: number;
  requestId: string;
  resultSubject: ReplaySubject<string>;
  streamingSubscription?: Subscription;
  fallbackSubscription?: Subscription;
  fallbackStatus: 'idle' | 'prepared' | 'running' | 'completed';
  latestContent?: string;
  isCompleted?: boolean; // Tracks whether generation completed normally (vs cancelled)
}

@Injectable({
  providedIn: 'root'
})
export class BeatAIService implements OnDestroy {
  private readonly openRouterApi = inject(OpenRouterApiService);
  private readonly googleGeminiApi = inject(GoogleGeminiApiService);
  private readonly ollamaApi = inject(OllamaApiService);
  private readonly claudeApi = inject(ClaudeApiService);
  private readonly openAICompatibleApi = inject(OpenAICompatibleApiService);
  private readonly settingsService = inject(SettingsService);
  private readonly storyService = inject(StoryService);
  private readonly promptManager = inject(PromptManagerService);
  private readonly codexContextService = inject(CodexContextService);
  private readonly document = inject(DOCUMENT);
  private readonly aiProviderValidation = inject(AIProviderValidationService);
  private readonly databaseService = inject(DatabaseService);
  private readonly serverGeneration = inject(ServerGenerationService);
  private readonly pendingJobsService = inject(PendingJobsService);

  private generationSubject = new Subject<BeatAIGenerationEvent>();
  public generation$ = this.generationSubject.asObservable();
  private activeGenerations = new Map<string, string>(); // beatId -> requestId
  private isStreamingSubject = new Subject<boolean>();
  public isStreaming$ = this.isStreamingSubject.asObservable();
  private htmlEntityDecoder: HTMLTextAreaElement | null = null;
  private entityDecodeBuffers = new Map<string, string>();
  private generationContexts = new Map<string, GenerationContext>();
  private pendingVisibilityFallbacks = new Set<string>();
  private pendingJobsSubscription = new Subscription();

  constructor() {
    const doc = this.document;
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', this.handleVisibilityChange);
    }

    // Initialize from pending jobs (handles page refresh scenario)
    this.initializeFromPendingJobs();
  }

  /**
   * Initialize streaming state from pending server jobs.
   * Called on service construction to restore generation status after page refresh.
   */
  private initializeFromPendingJobs(): void {
    // Subscribe to streaming events from resumed server jobs
    this.pendingJobsSubscription.add(
      this.pendingJobsService.streamingEvent$.subscribe(event => {
        // Forward to UI
        this.generationSubject.next(event);

        // Track as active if not already
        if (!this.activeGenerations.has(event.beatId) && !event.isComplete) {
          this.activeGenerations.set(event.beatId, `resumed_${event.beatId}`);
          this.isStreamingSubject.next(true);
        }

        // Clean up on completion
        if (event.isComplete) {
          this.activeGenerations.delete(event.beatId);
          if (this.activeGenerations.size === 0) {
            this.isStreamingSubject.next(false);
          }
        }
      })
    );

    // Check for active jobs on init to set initial streaming state
    this.pendingJobsSubscription.add(
      this.pendingJobsService.pendingJobs$.pipe(take(1)).subscribe(jobs => {
        const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'processing');
        if (activeJobs.length > 0) {
          console.log('[BeatAI] Detected active server jobs on init:', activeJobs.map(j => j.beatId));
          activeJobs.forEach(job => {
            this.activeGenerations.set(job.beatId, `resumed_${job.id}`);
          });
          this.isStreamingSubject.next(true);
        }
      })
    );
  }

  ngOnDestroy(): void {
    const doc = this.document;
    if (doc && typeof doc.removeEventListener === 'function') {
      doc.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.pendingJobsSubscription.unsubscribe();
    this.cleanupAllContexts();
  }

  /**
   * Map internal ProviderType to ServerProviderType for server-side generation
   */
  private mapToServerProvider(provider: ProviderType): ServerProviderType | null {
    const mapping: Record<ProviderType, ServerProviderType> = {
      'claude': 'claude',
      'gemini': 'gemini',
      'openrouter': 'openrouter',
      'ollama': 'ollama',
      'openaiCompatible': 'openai-compat'
    };
    return mapping[provider] || null;
  }

  /**
   * Get the API key for a specific provider
   */
  private getApiKeyForProvider(provider: ProviderType, settings: ReturnType<SettingsService['getSettings']>): string {
    switch (provider) {
      case 'claude':
        return settings.claude.apiKey || '';
      case 'gemini':
        return settings.googleGemini.apiKey || '';
      case 'openrouter':
        return settings.openRouter.apiKey || '';
      case 'ollama':
        return 'ollama'; // Ollama doesn't use API keys
      case 'openaiCompatible':
        return settings.openAICompatible.apiKey || 'local';
      default:
        return '';
    }
  }

  /**
   * Get the provider URL for providers that need it (Ollama, OpenAI-compatible)
   */
  private getProviderUrl(provider: ProviderType, settings: ReturnType<SettingsService['getSettings']>): string | undefined {
    switch (provider) {
      case 'ollama':
        return settings.ollama.baseUrl || undefined;
      case 'openaiCompatible':
        return settings.openAICompatible.baseUrl || undefined;
      default:
        return undefined;
    }
  }

  /**
   * Execute server-side generation for a beat
   * Returns Observable that emits accumulated content as chunks arrive
   */
  private executeServerSideGeneration(
    enhancedPrompt: string,
    beatId: string,
    provider: ProviderType,
    actualModelId: string,
    maxTokens: number,
    settings: ReturnType<SettingsService['getSettings']>,
    options: {
      storyId?: string;
      chapterId?: string;
      sceneId?: string;
      temperature?: number;
    }
  ): Observable<string> {
    const serverProvider = this.mapToServerProvider(provider);
    if (!serverProvider) {
      console.error('[BeatAI] Cannot map provider to server provider:', provider);
      return this.generateFallbackContent(enhancedPrompt, beatId);
    }

    const apiKey = this.getApiKeyForProvider(provider, settings);
    const providerUrl = this.getProviderUrl(provider, settings);

    let accumulatedContent = '';

    return this.serverGeneration.generateWithStream({
      prompt: enhancedPrompt,
      provider: serverProvider,
      model: actualModelId,
      maxTokens,
      temperature: options.temperature,
      apiKey,
      providerUrl,
      beatId,
      storyId: options.storyId || '',
      chapterId: options.chapterId,
      sceneId: options.sceneId
    }).pipe(
      tap(event => {
        if (event.type === 'chunk' && event.text) {
          accumulatedContent += event.text;
          this.generationSubject.next({
            beatId,
            chunk: event.text,
            isComplete: false
          });
        } else if (event.type === 'complete') {
          this.generationSubject.next({
            beatId,
            chunk: '',
            isComplete: true
          });
          this.activeGenerations.delete(beatId);
          if (this.activeGenerations.size === 0) {
            this.isStreamingSubject.next(false);
            this.databaseService.resumeSync();
          }
        }
      }),
      filter(event => event.type === 'complete'),
      map(() => accumulatedContent),
      catchError(error => {
        console.error('[BeatAI] Server-side generation error:', error);
        this.generationSubject.next({
          beatId,
          chunk: '',
          isComplete: true
        });
        this.activeGenerations.delete(beatId);
        if (this.activeGenerations.size === 0) {
          this.isStreamingSubject.next(false);
          this.databaseService.resumeSync();
        }
        // Fallback to client-side generation
        return this.generateFallbackContent(enhancedPrompt, beatId);
      })
    );
  }

  private handleVisibilityChange = (): void => {
    const doc = this.document;
    if (!doc) {
      return;
    }

    if (doc.hidden) {
      this.prepareVisibilityFallbacks();
    } else {
      this.resumeVisibilityFallbacks();
    }
  };

  private cleanupAllContexts(): void {
    this.generationContexts.forEach(context => {
      context.streamingSubscription?.unsubscribe();
      context.fallbackSubscription?.unsubscribe();
    });
    this.generationContexts.clear();
    this.pendingVisibilityFallbacks.clear();
    this.activeGenerations.clear();
    this.entityDecodeBuffers.clear();
  }

  private prepareVisibilityFallbacks(): void {
    if (this.activeGenerations.size === 0) {
      return;
    }

    this.activeGenerations.forEach((requestId, beatId) => {
      const context = this.generationContexts.get(beatId);
      if (!context || context.fallbackStatus !== 'idle') {
        return;
      }

      this.pendingVisibilityFallbacks.add(beatId);
      context.fallbackStatus = 'prepared';

      if (requestId) {
        this.abortProviderRequest(context.provider, requestId);
      }

      this.entityDecodeBuffers.delete(beatId);
      this.activeGenerations.delete(beatId);
    });

    this.resumeVisibilityFallbacks();
  }

  private resumeVisibilityFallbacks(): void {
    if (this.pendingVisibilityFallbacks.size === 0) {
      return;
    }

    Array.from(this.pendingVisibilityFallbacks).forEach(beatId => {
      const context = this.generationContexts.get(beatId);
      if (!context || context.fallbackStatus === 'running' || context.fallbackStatus === 'completed') {
        return;
      }

      context.fallbackStatus = 'running';
      const fallbackRequestId = this.createProviderRequestId(context.provider);
      context.requestId = fallbackRequestId;
      this.activeGenerations.set(beatId, fallbackRequestId);

      const fallback$ = this.executeNonStreamingFallback(context).pipe(
        tap(content => {
          context.latestContent = content;
        })
      );

      const subscription = fallback$.subscribe({
        next: content => {
          context.resultSubject.next(content);
        },
        error: error => {
          this.generationSubject.next({ beatId, chunk: '', isComplete: true });
          context.resultSubject.error(error);
          this.handleFallbackCleanup(beatId);
        },
        complete: () => {
          this.generationSubject.next({ beatId, chunk: '', isComplete: true });
          context.resultSubject.complete();
          this.handleFallbackCleanup(beatId);
        }
      });

      context.fallbackSubscription = subscription;
    });
  }

  private handleFallbackCleanup(beatId: string): void {
    const context = this.generationContexts.get(beatId);
    if (context) {
      context.fallbackStatus = 'completed';
    }
    this.cleanupContext(beatId);
  }

  private createProviderRequestId(provider: ProviderType): string {
    const suffix = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    switch (provider) {
      case 'gemini':
        return `gemini_visibility_${suffix}`;
      case 'claude':
        return `claude_visibility_${suffix}`;
      case 'openrouter':
        return `openrouter_visibility_${suffix}`;
      case 'ollama':
        return `ollama_visibility_${suffix}`;
      case 'openaiCompatible':
        return `openaiCompatible_visibility_${suffix}`;
      default:
        return `beat_visibility_${suffix}`;
    }
  }

  private abortProviderRequest(provider: ProviderType, requestId: string): void {
    if (!requestId) {
      return;
    }

    switch (provider) {
      case 'gemini':
        this.googleGeminiApi.abortRequest(requestId);
        break;
      case 'claude':
        this.claudeApi.abortRequest(requestId);
        break;
      case 'openrouter':
        this.openRouterApi.abortRequest(requestId);
        break;
      case 'ollama':
        this.ollamaApi.abortRequest(requestId);
        break;
      case 'openaiCompatible':
        this.openAICompatibleApi.abortRequest(requestId);
        break;
    }
  }

  private executeNonStreamingFallback(context: GenerationContext): Observable<string> {
    const { provider, prompt, options, maxTokens, wordCount, requestId, beatId } = context;
    const messages = this.parseStructuredPrompt(prompt);

    switch (provider) {
      case 'gemini':
        return this.googleGeminiApi.generateText(prompt, {
          model: options.model,
          maxTokens,
          temperature: options.temperature,
          topP: options.topP,
          wordCount,
          requestId,
          messages
        }).pipe(
          map(response => {
            const pending = this.flushEntityDecodeBuffer(beatId);
            const rawContent = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const decodedContent = this.decodeHtmlEntities(rawContent);
            const combined = pending ? pending + decodedContent : decodedContent;
            return this.removeDuplicateCharacterAnalyses(combined);
          })
        );
      case 'claude':
        return this.claudeApi.generateText(prompt, {
          model: options.model,
          maxTokens,
          temperature: options.temperature,
          topP: options.topP,
          wordCount,
          requestId,
          messages
        }).pipe(
          map(response => {
            const pending = this.flushEntityDecodeBuffer(beatId);
            const rawContent = response.content?.[0]?.text || '';
            const decodedContent = this.decodeHtmlEntities(rawContent);
            const combined = pending ? pending + decodedContent : decodedContent;
            return this.removeDuplicateCharacterAnalyses(combined);
          })
        );
      case 'openrouter':
        return this.openRouterApi.generateText(prompt, {
          model: options.model,
          maxTokens,
          temperature: options.temperature,
          topP: options.topP,
          wordCount,
          requestId,
          messages
        }).pipe(
          map(response => {
            const pending = this.flushEntityDecodeBuffer(beatId);
            const rawContent = response.choices?.[0]?.message?.content || '';
            const decodedContent = this.decodeHtmlEntities(rawContent);
            const combined = pending ? pending + decodedContent : decodedContent;
            return this.removeDuplicateCharacterAnalyses(combined);
          })
        );
      case 'ollama':
        return this.ollamaApi.generateText(prompt, {
          model: options.model,
          maxTokens,
          temperature: options.temperature,
          topP: options.topP,
          requestId,
          messages,
          stream: false
        }).pipe(
          map(response => {
            const pending = this.flushEntityDecodeBuffer(beatId);
            let rawContent = '';
            if (response && 'response' in response && response.response) {
              rawContent = response.response;
            } else if (response && 'message' in response && response.message?.content) {
              rawContent = response.message.content;
            }
            const decodedContent = this.decodeHtmlEntities(rawContent);
            const combined = pending ? pending + decodedContent : decodedContent;
            return this.removeDuplicateCharacterAnalyses(combined);
          })
        );
      case 'openaiCompatible':
        return this.openAICompatibleApi.generateText(prompt, {
          model: options.model,
          maxTokens,
          temperature: options.temperature,
          topP: options.topP,
          wordCount,
          requestId,
          messages
        }).pipe(
          map(response => {
            const pending = this.flushEntityDecodeBuffer(beatId);
            const rawContent = response.choices?.[0]?.message?.content || '';
            const decodedContent = this.decodeHtmlEntities(rawContent);
            const combined = pending ? pending + decodedContent : decodedContent;
            return this.removeDuplicateCharacterAnalyses(combined);
          })
        );
      default:
        return of('');
    }
  }

  private cleanupContext(beatId: string): void {
    const context = this.generationContexts.get(beatId);
    if (context) {
      context.streamingSubscription?.unsubscribe();
      context.fallbackSubscription?.unsubscribe();
    }

    this.generationContexts.delete(beatId);
    this.pendingVisibilityFallbacks.delete(beatId);
    this.activeGenerations.delete(beatId);
    this.entityDecodeBuffers.delete(beatId);

    if (this.activeGenerations.size === 0) {
      this.isStreamingSubject.next(false);
      // Resume database sync now that all generations are complete
      this.databaseService.resumeSync();
    }
  }

  private decodeHtmlEntities(text: string): string {
    if (!text || text.indexOf('&') === -1) {
      return text;
    }

    const doc = this.document;
    if (!doc || typeof doc.createElement !== 'function') {
      return text;
    }

    if (!this.htmlEntityDecoder) {
      this.htmlEntityDecoder = doc.createElement('textarea');
    }

    this.htmlEntityDecoder.innerHTML = text;
    const decoded = this.htmlEntityDecoder.value || this.htmlEntityDecoder.textContent || text;
    this.htmlEntityDecoder.value = '';
    this.htmlEntityDecoder.textContent = '';
    return decoded;
  }

  private decodeStreamingChunk(beatId: string, chunk: string): string {
    if (!chunk) {
      return chunk;
    }

    const buffered = (this.entityDecodeBuffers.get(beatId) || '') + chunk;

    if (buffered.indexOf('&') === -1) {
      this.entityDecodeBuffers.set(beatId, '');
      return buffered;
    }

    let remainder = '';
    let processable = buffered;
    const lastAmpIndex = buffered.lastIndexOf('&');
    if (lastAmpIndex !== -1) {
      const nextSemicolonIndex = buffered.indexOf(';', lastAmpIndex);
      if (nextSemicolonIndex === -1) {
        remainder = buffered.substring(lastAmpIndex);
        processable = buffered.substring(0, lastAmpIndex);
      }
    }

    const decoded = this.decodeHtmlEntities(processable);
    this.entityDecodeBuffers.set(beatId, remainder);
    return decoded;
  }

  private flushEntityDecodeBuffer(beatId: string): string {
    const remainder = this.entityDecodeBuffers.get(beatId);
    if (remainder === undefined) {
      return '';
    }

    this.entityDecodeBuffers.delete(beatId);
    if (!remainder) {
      return '';
    }

    return this.decodeHtmlEntities(remainder);
  }

  generateBeatContent(prompt: string, beatId: string, options: {
    wordCount?: number;
    model?: string;
    temperature?: number;
    topP?: number;
    storyId?: string;
    chapterId?: string;
    sceneId?: string;
    beatPosition?: number;
    beatType?: 'story' | 'scene' | 'envision';
    customContext?: {
      selectedScenes: string[];
      includeStoryOutline: boolean;
      selectedSceneContexts: { sceneId: string; chapterId: string; content: string; }[];
    };
    action?: 'generate' | 'regenerate' | 'rewrite' | 'polish';
    existingText?: string;
    textAfterBeat?: string; // Text that follows this beat position (for scene beat bridging)
    stagingNotes?: string; // Meta-context for physical/positional consistency
    originalPrompt?: string; // Original beat prompt (for history, separate from AI prompt for rewrites)
    rewriteInstruction?: string; // Rewrite instruction (for history)
  } = {}): Observable<string> {
    const settings = this.settingsService.getSettings();

    let provider: ProviderType | null = null;
    let actualModelId: string | null = null;

    if (options.model) {
      const [modelProvider, ...modelIdParts] = options.model.split(':');
      provider = modelProvider as ProviderType;
      actualModelId = modelIdParts.join(':');
    }

    if (!provider || !this.aiProviderValidation.isProviderAvailable(provider, settings)) {
      console.warn('No AI API configured, using fallback content');
      return this.generateFallbackContent(prompt, beatId);
    }

    this.isStreamingSubject.next(true);
    // Pause database sync during streaming to prevent performance issues
    this.databaseService.pauseSync();
    this.generationSubject.next({
      beatId,
      chunk: '',
      isComplete: false
    });

    const wordCount = options.wordCount || 400;

    return this.buildStructuredPromptFromTemplate(prompt, beatId, { ...options, wordCount }).pipe(
      switchMap(enhancedPrompt => {
        const calculatedTokens = Math.ceil(wordCount * 2.5);
        const maxTokens = Math.max(calculatedTokens, 3000);
        // Use provider directly as it's already validated
        const resolvedProvider: ProviderType = provider;

        // Check if server-side generation is enabled
        if (settings.serverGeneration?.enabled) {
          console.log('[BeatAI] Using server-side generation for beat:', beatId);
          this.activeGenerations.set(beatId, `server_${beatId}`);
          return this.executeServerSideGeneration(
            enhancedPrompt,
            beatId,
            resolvedProvider,
            actualModelId || '',
            maxTokens,
            settings,
            {
              storyId: options.storyId,
              chapterId: options.chapterId,
              sceneId: options.sceneId,
              temperature: options.temperature
            }
          );
        }

        // Client-side generation (existing code)
        const requestId = this.createProviderRequestId(resolvedProvider);

        this.activeGenerations.set(beatId, requestId);

        const updatedOptions = { ...options, model: actualModelId || undefined };

        let apiCall: Observable<string>;
        if (resolvedProvider === 'ollama') {
          apiCall = this.callOllamaAPI(enhancedPrompt, updatedOptions, maxTokens, wordCount, requestId, beatId);
        } else if (resolvedProvider === 'claude') {
          apiCall = this.callClaudeStreamingAPI(enhancedPrompt, updatedOptions, maxTokens, wordCount, requestId, beatId);
        } else if (resolvedProvider === 'gemini') {
          apiCall = this.callGoogleGeminiStreamingAPI(enhancedPrompt, updatedOptions, maxTokens, wordCount, requestId, beatId);
        } else if (resolvedProvider === 'openaiCompatible') {
          apiCall = this.callOpenAICompatibleStreamingAPI(enhancedPrompt, updatedOptions, maxTokens, wordCount, requestId, beatId);
        } else {
          apiCall = this.callOpenRouterStreamingAPI(enhancedPrompt, updatedOptions, maxTokens, wordCount, requestId, beatId);
        }

        const guardedApiCall = apiCall.pipe(
          catchError(() => {
            this.pendingVisibilityFallbacks.delete(beatId);
            this.activeGenerations.delete(beatId);
            this.entityDecodeBuffers.delete(beatId);
            if (this.activeGenerations.size === 0) {
              this.isStreamingSubject.next(false);
            }
            this.generationSubject.next({
              beatId,
              chunk: '',
              isComplete: true
            });
            return this.generateFallbackContent(prompt, beatId);
          })
        );

        const resultSubject = new ReplaySubject<string>(1);
        const context: GenerationContext = {
          beatId,
          provider: resolvedProvider,
          prompt: enhancedPrompt,
          options: {
            model: updatedOptions.model,
            temperature: updatedOptions.temperature,
            topP: updatedOptions.topP
          },
          wordCount,
          maxTokens,
          requestId,
          resultSubject,
          fallbackStatus: 'idle'
        };

        this.generationContexts.set(beatId, context);

        const subscription = guardedApiCall.subscribe({
          next: value => {
            context.latestContent = value;
            resultSubject.next(value);
          },
          error: error => {
            resultSubject.error(error);
            this.cleanupContext(beatId);
          },
          complete: () => {
            if (this.pendingVisibilityFallbacks.has(beatId) && context.fallbackStatus !== 'completed') {
              return;
            }
            // Mark as completed normally (not cancelled)
            context.isCompleted = true;
            resultSubject.complete();
            this.cleanupContext(beatId);
          }
        });

        context.streamingSubscription = subscription;

        return new Observable<string>(observer => {
          const subjectSubscription = resultSubject.subscribe(observer);
          return () => {
            subjectSubscription.unsubscribe();
            if (this.generationContexts.has(beatId)) {
              this.stopGeneration(beatId);
            }
          };
        });
      })
    );
  }

  private callGoogleGeminiStreamingAPI(prompt: string, options: { model?: string; temperature?: number; topP?: number }, maxTokens: number, wordCount: number, requestId: string, beatId: string): Observable<string> {
    // Parse the structured prompt to extract messages
    const messages = this.parseStructuredPrompt(prompt);
    
    let accumulatedContent = '';
    this.entityDecodeBuffers.set(beatId, '');
    return this.googleGeminiApi.generateTextStream(prompt, {
      model: options.model,
      maxTokens: maxTokens,
      wordCount: wordCount,
      requestId: requestId,
      messages: messages
    }).pipe(
      // Batch chunks every 50ms for smoother DOM updates (reduces operations for thinking models)
      bufferTime(50),
      filter((chunks: string[]) => chunks.length > 0),
      map((chunks: string[]) => chunks.join('')),
      map(chunk => this.decodeStreamingChunk(beatId, chunk)),
      tap((decodedChunk: string) => {
        // Emit each chunk as it arrives
        accumulatedContent += decodedChunk;
        this.generationSubject.next({
          beatId,
          chunk: decodedChunk,
          isComplete: false
        });
      }),
      // Note: Removed redundant scan() - accumulatedContent already tracks full content
      tap({
        complete: () => {
          if (this.pendingVisibilityFallbacks.has(beatId)) {
            return;
          }
          const remainder = this.flushEntityDecodeBuffer(beatId);
          if (remainder) {
            accumulatedContent += remainder;
            this.generationSubject.next({
              beatId,
              chunk: remainder,
              isComplete: false
            });
          }
          // Post-process to remove duplicate character analyses
          accumulatedContent = this.removeDuplicateCharacterAnalyses(accumulatedContent);
          
          // Emit completion
          this.generationSubject.next({
            beatId,
            chunk: '',
            isComplete: true
          });
          
          // Clean up active generation
          this.activeGenerations.delete(beatId);
          
          // Signal streaming stopped if no more active generations
          if (this.activeGenerations.size === 0) {
            this.isStreamingSubject.next(false);
          }
        },
        error: () => {
          // Clean up on error
          this.activeGenerations.delete(beatId);
          this.entityDecodeBuffers.delete(beatId);
          
          // Signal streaming stopped if no more active generations
          if (this.activeGenerations.size === 0) {
            this.isStreamingSubject.next(false);
          }
        }
      }),
      map(() => accumulatedContent), // Return full content at the end
      catchError(() => {
        
        // Try non-streaming API as fallback
        return this.googleGeminiApi.generateText(prompt, {
          model: options.model,
          maxTokens: maxTokens,
          temperature: options.temperature,
          topP: options.topP,
          wordCount: wordCount,
          requestId: requestId,
          messages: messages
        }).pipe(
          map(response => {
            const pending = this.flushEntityDecodeBuffer(beatId);
            const rawContent = response.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const decodedContent = this.decodeHtmlEntities(rawContent);
            accumulatedContent = pending ? pending + decodedContent : decodedContent;
            
            // Simulate streaming by emitting in chunks
            const chunkSize = 50;
            for (let i = 0; i < accumulatedContent.length; i += chunkSize) {
              const chunk = accumulatedContent.substring(i, i + chunkSize);
              this.generationSubject.next({
                beatId,
                chunk: chunk,
                isComplete: false
              });
            }
            
            // Emit completion
            this.generationSubject.next({
              beatId,
              chunk: '',
              isComplete: true
            });
            
            // Clean up
            this.activeGenerations.delete(beatId);
            
            // Signal streaming stopped if no more active generations
            if (this.activeGenerations.size === 0) {
              this.isStreamingSubject.next(false);
            }
            
            return accumulatedContent;
          })
        );
      })
    );
  }

  private callOpenRouterStreamingAPI(prompt: string, options: { model?: string; temperature?: number; topP?: number }, maxTokens: number, wordCount: number, requestId: string, beatId: string): Observable<string> {
    // Parse the structured prompt to extract messages
    const messages = this.parseStructuredPrompt(prompt);

    let accumulatedContent = '';
    this.entityDecodeBuffers.set(beatId, '');
    
    return this.openRouterApi.generateTextStream(prompt, {
      model: options.model,
      maxTokens: maxTokens,
      wordCount: wordCount,
      requestId: requestId,
      messages: messages
    }).pipe(
      // Batch chunks every 50ms for smoother DOM updates (reduces operations for thinking models)
      bufferTime(50),
      filter((chunks: string[]) => chunks.length > 0),
      map((chunks: string[]) => chunks.join('')),
      map(chunk => this.decodeStreamingChunk(beatId, chunk)),
      tap((decodedChunk: string) => {
        // Emit each chunk as it arrives
        accumulatedContent += decodedChunk;
        this.generationSubject.next({
          beatId,
          chunk: decodedChunk,
          isComplete: false
        });
      }),
      // Note: Removed redundant scan() - accumulatedContent already tracks full content
      tap({
        complete: () => {
          if (this.pendingVisibilityFallbacks.has(beatId)) {
            return;
          }
          const remainder = this.flushEntityDecodeBuffer(beatId);
          if (remainder) {
            accumulatedContent += remainder;
            this.generationSubject.next({
              beatId,
              chunk: remainder,
              isComplete: false
            });
          }
          // Post-process to remove duplicate character analyses
          accumulatedContent = this.removeDuplicateCharacterAnalyses(accumulatedContent);
          
          // Emit completion
          this.generationSubject.next({
            beatId,
            chunk: '',
            isComplete: true
          });
          
          // Clean up active generation
          this.activeGenerations.delete(beatId);
          
          // Signal streaming stopped if no more active generations
          if (this.activeGenerations.size === 0) {
            this.isStreamingSubject.next(false);
          }
        },
        error: () => {
          // Clean up on error
          this.activeGenerations.delete(beatId);
          this.entityDecodeBuffers.delete(beatId);
          
          // Signal streaming stopped if no more active generations
          if (this.activeGenerations.size === 0) {
            this.isStreamingSubject.next(false);
          }
        }
      }),
      map(() => accumulatedContent) // Return full content at the end
    );
  }

  private callOllamaAPI(prompt: string, options: { model?: string; temperature?: number; topP?: number }, maxTokens: number, wordCount: number, requestId: string, beatId: string): Observable<string> {
    // Parse the structured prompt to extract messages
    const messages = this.parseStructuredPrompt(prompt);
    
    let accumulatedContent = '';
    this.entityDecodeBuffers.set(beatId, '');
    
    return this.ollamaApi.generateTextStream(prompt, {
      model: options.model,
      maxTokens: maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      wordCount: wordCount,
      requestId: requestId,
      messages: messages
    }).pipe(
      // Batch chunks every 50ms for smoother DOM updates (reduces operations for thinking models)
      bufferTime(50),
      filter((chunks: string[]) => chunks.length > 0),
      map((chunks: string[]) => chunks.join('')),
      map(chunk => this.decodeStreamingChunk(beatId, chunk)),
      tap((decodedChunk: string) => {
        // Emit each chunk as it arrives
        accumulatedContent += decodedChunk;
        this.generationSubject.next({
          beatId,
          chunk: decodedChunk,
          isComplete: false
        });
      }),
      // Note: Removed redundant scan() - accumulatedContent already tracks full content
      tap({
        complete: () => {
          if (this.pendingVisibilityFallbacks.has(beatId)) {
            return;
          }
          const remainder = this.flushEntityDecodeBuffer(beatId);
          if (remainder) {
            accumulatedContent += remainder;
            this.generationSubject.next({
              beatId,
              chunk: remainder,
              isComplete: false
            });
          }
          // Post-process to remove duplicate character analyses
          accumulatedContent = this.removeDuplicateCharacterAnalyses(accumulatedContent);
          
          // Emit completion
          this.generationSubject.next({
            beatId,
            chunk: '',
            isComplete: true
          });
          
          // Clean up active generation
          this.activeGenerations.delete(beatId);
          
          // Signal streaming stopped if no more active generations
          if (this.activeGenerations.size === 0) {
            this.isStreamingSubject.next(false);
          }
        },
        error: () => {
          // Clean up on error
          this.activeGenerations.delete(beatId);
          this.entityDecodeBuffers.delete(beatId);
          
          // Signal streaming stopped if no more active generations
          if (this.activeGenerations.size === 0) {
            this.isStreamingSubject.next(false);
          }
        }
      }),
      map(() => accumulatedContent) // Return full content at the end
    );
  }

  private callClaudeStreamingAPI(prompt: string, options: { model?: string; temperature?: number; topP?: number }, maxTokens: number, wordCount: number, requestId: string, beatId: string): Observable<string> {
    // Parse the structured prompt to extract messages
    const messages = this.parseStructuredPrompt(prompt);
    
    let accumulatedContent = '';
    this.entityDecodeBuffers.set(beatId, '');
    
    return this.claudeApi.generateTextStream(prompt, {
      model: options.model,
      maxTokens: maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      wordCount: wordCount,
      requestId: requestId,
      messages: messages
    }).pipe(
      // Batch chunks every 50ms for smoother DOM updates (reduces operations for thinking models)
      bufferTime(50),
      filter((chunks: string[]) => chunks.length > 0),
      map((chunks: string[]) => chunks.join('')),
      map(chunk => this.decodeStreamingChunk(beatId, chunk)),
      tap((decodedChunk: string) => {
        // Emit each chunk as it arrives
        accumulatedContent += decodedChunk;
        this.generationSubject.next({
          beatId,
          chunk: decodedChunk,
          isComplete: false
        });
      }),
      // Note: Removed redundant scan() - accumulatedContent already tracks full content
      tap({
        complete: () => {
          if (this.pendingVisibilityFallbacks.has(beatId)) {
            return;
          }
          const remainder = this.flushEntityDecodeBuffer(beatId);
          if (remainder) {
            accumulatedContent += remainder;
            this.generationSubject.next({
              beatId,
              chunk: remainder,
              isComplete: false
            });
          }
          // Post-process to remove duplicate character analyses
          accumulatedContent = this.removeDuplicateCharacterAnalyses(accumulatedContent);
          
          // Emit completion
          this.generationSubject.next({
            beatId,
            chunk: '',
            isComplete: true
          });
          
          // Clean up active generation
          this.activeGenerations.delete(beatId);
          
          // Signal streaming stopped if no more active generations
          if (this.activeGenerations.size === 0) {
            this.isStreamingSubject.next(false);
          }
        },
        error: () => {
          // Clean up on error
          this.activeGenerations.delete(beatId);
          this.entityDecodeBuffers.delete(beatId);
          
          // Signal streaming stopped if no more active generations
          if (this.activeGenerations.size === 0) {
            this.isStreamingSubject.next(false);
          }
        }
      }),
      map(() => accumulatedContent), // Return full content at the end
      catchError(() => {
        // Try non-streaming API as fallback
        return this.claudeApi.generateText(prompt, {
          model: options.model,
          maxTokens: maxTokens,
          temperature: options.temperature,
          topP: options.topP,
          wordCount: wordCount,
          requestId: requestId,
          messages: messages
        }).pipe(
          map(response => {
            const pending = this.flushEntityDecodeBuffer(beatId);
            const rawContent = response.content?.[0]?.text || '';
            const decodedContent = this.decodeHtmlEntities(rawContent);
            accumulatedContent = pending ? pending + decodedContent : decodedContent;
            
            // Simulate streaming by emitting in chunks
            const chunkSize = 50;
            for (let i = 0; i < accumulatedContent.length; i += chunkSize) {
              const chunk = accumulatedContent.substring(i, i + chunkSize);
              this.generationSubject.next({
                beatId,
                chunk: chunk,
                isComplete: false
              });
            }
            
            // Emit completion
            this.generationSubject.next({
              beatId,
              chunk: '',
              isComplete: true
            });
            
            // Clean up
            this.activeGenerations.delete(beatId);
            
            // Signal streaming stopped if no more active generations
            if (this.activeGenerations.size === 0) {
              this.isStreamingSubject.next(false);
            }
            
            return accumulatedContent;
          })
        );
      })
    );
  }

  private callOpenAICompatibleStreamingAPI(prompt: string, options: { model?: string; temperature?: number; topP?: number }, maxTokens: number, wordCount: number, requestId: string, beatId: string): Observable<string> {
    // Parse the structured prompt to extract messages
    const messages = this.parseStructuredPrompt(prompt);

    let accumulatedContent = '';
    this.entityDecodeBuffers.set(beatId, '');

    return this.openAICompatibleApi.generateTextStream(prompt, {
      model: options.model,
      maxTokens: maxTokens,
      temperature: options.temperature,
      topP: options.topP,
      wordCount: wordCount,
      requestId: requestId,
      messages: messages
    }).pipe(
      // Batch chunks every 50ms for smoother DOM updates (reduces operations for thinking models)
      bufferTime(50),
      filter((chunks: string[]) => chunks.length > 0),
      map((chunks: string[]) => chunks.join('')),
      map(chunk => this.decodeStreamingChunk(beatId, chunk)),
      tap((decodedChunk: string) => {
        // Emit each chunk as it arrives
        accumulatedContent += decodedChunk;
        this.generationSubject.next({
          beatId,
          chunk: decodedChunk,
          isComplete: false
        });
      }),
      // Note: Removed redundant scan() - accumulatedContent already tracks full content
      tap({
        complete: () => {
          if (this.pendingVisibilityFallbacks.has(beatId)) {
            return;
          }
          const remainder = this.flushEntityDecodeBuffer(beatId);
          if (remainder) {
            accumulatedContent += remainder;
            this.generationSubject.next({
              beatId,
              chunk: remainder,
              isComplete: false
            });
          }
          // Post-process to remove duplicate character analyses
          accumulatedContent = this.removeDuplicateCharacterAnalyses(accumulatedContent);

          // Emit completion
          this.generationSubject.next({
            beatId,
            chunk: '',
            isComplete: true
          });

          // Clean up active generation
          this.activeGenerations.delete(beatId);

          // Signal streaming stopped if no more active generations
          if (this.activeGenerations.size === 0) {
            this.isStreamingSubject.next(false);
          }
        },
        error: () => {
          // Clean up on error
          this.activeGenerations.delete(beatId);
          this.entityDecodeBuffers.delete(beatId);

          // Signal streaming stopped if no more active generations
          if (this.activeGenerations.size === 0) {
            this.isStreamingSubject.next(false);
          }
        }
      }),
      map(() => accumulatedContent), // Return full content at the end
      catchError(() => {
        // Try non-streaming API as fallback
        return this.openAICompatibleApi.generateText(prompt, {
          model: options.model,
          maxTokens: maxTokens,
          temperature: options.temperature,
          topP: options.topP,
          wordCount: wordCount,
          requestId: requestId,
          messages: messages
        }).pipe(
          map(response => {
            const pending = this.flushEntityDecodeBuffer(beatId);
            const rawContent = response.choices?.[0]?.message?.content || '';
            const decodedContent = this.decodeHtmlEntities(rawContent);
            accumulatedContent = pending ? pending + decodedContent : decodedContent;

            // Simulate streaming by emitting in chunks
            const chunkSize = 50;
            for (let i = 0; i < accumulatedContent.length; i += chunkSize) {
              const chunk = accumulatedContent.substring(i, i + chunkSize);
              this.generationSubject.next({
                beatId,
                chunk: chunk,
                isComplete: false
              });
            }

            // Emit completion
            this.generationSubject.next({
              beatId,
              chunk: '',
              isComplete: true
            });

            // Clean up
            this.activeGenerations.delete(beatId);

            // Signal streaming stopped if no more active generations
            if (this.activeGenerations.size === 0) {
              this.isStreamingSubject.next(false);
            }

            return accumulatedContent;
          })
        );
      })
    );
  }

  private parseStructuredPrompt(prompt: string): {role: 'system' | 'user' | 'assistant', content: string}[] {
    const messages: {role: 'system' | 'user' | 'assistant', content: string}[] = [];
    const validRoles = ['system', 'user', 'assistant'];

    // Try new delimiter format first: ---SYSTEM---, ---USER---, ---ASSISTANT---
    const delimiterPattern = /---\s*(SYSTEM|USER|ASSISTANT)\s*---/gi;
    const parts = prompt.split(delimiterPattern);

    if (parts.length > 1) {
      // New delimiter format detected
      let i = 1; // Skip any content before first delimiter
      while (i < parts.length - 1) {
        const roleStr = parts[i].toLowerCase().trim();
        const content = parts[i + 1]?.trim() || '';
        if (validRoles.includes(roleStr) && content) {
          messages.push({ role: roleStr as 'system' | 'user' | 'assistant', content });
        }
        i += 2;
      }
    }

    // Fallback to legacy XML format if no delimiter messages found
    if (messages.length === 0) {
      const messagePattern = /<message role="(system|user|assistant)">([\s\S]*?)<\/message>/gi;
      let match;
      while ((match = messagePattern.exec(prompt)) !== null) {
        const role = match[1] as 'system' | 'user' | 'assistant';
        const content = match[2].trim();
        messages.push({ role, content });
      }
    }

    // Final fallback: treat as single user message
    if (messages.length === 0) {
      messages.push({ role: 'user', content: prompt });
    }

    return messages;
  }

  // Legacy template - now replaced by story.settings.beatGenerationTemplate

  private buildStructuredPromptFromTemplate(userPrompt: string, beatId: string, options: {
    storyId?: string;
    chapterId?: string;
    sceneId?: string;
    wordCount?: number;
    beatType?: 'story' | 'scene' | 'envision';
    customContext?: {
      selectedScenes: string[];
      includeStoryOutline: boolean;
      selectedSceneContexts: { sceneId: string; chapterId: string; content: string; }[];
    };
    action?: 'generate' | 'regenerate' | 'rewrite' | 'polish';
    existingText?: string;
    textAfterBeat?: string; // Text that follows this beat position (for scene beat bridging)
    stagingNotes?: string; // Meta-context for physical/positional consistency
  }): Observable<string> {
    if (!options.storyId) {
      return of(userPrompt);
    }

    return from(this.storyService.getStory(options.storyId)).pipe(
      switchMap((story: Story | null) => {
        if (!story || !story.settings) {
          return of(userPrompt);
        }

        // Set current story in prompt manager
        return from(this.promptManager.setCurrentStory(story.id)).pipe(
          switchMap(async () => {
            // Get scene context - either from custom context or default behavior
            let sceneContext = '';

            if (options.customContext && options.customContext.selectedScenes.length > 0) {
              // Check if we'll be using a modified story outline
              if (options.customContext.includeStoryOutline) {
                // Story outline is included. Check if current scene is selected
                const currentSceneSelected = options.customContext.selectedSceneContexts.some(
                  ctx => ctx.sceneId === options.sceneId
                );

                if (currentSceneSelected) {
                  // Current scene is selected and will be included via sceneFullText
                  // Get its content from our selected scenes
                  const currentScene = options.customContext.selectedSceneContexts.find(
                    ctx => ctx.sceneId === options.sceneId
                  );
                  sceneContext = currentScene ? currentScene.content : '';
                } else {
                  // Current scene not explicitly selected, get default content
                  sceneContext = options.sceneId
                    ? await this.promptManager.getCurrentOrPreviousSceneText(options.sceneId, beatId)
                    : '';
                }
              } else {
                // If no story outline, use custom selected scenes context
                sceneContext = options.customContext.selectedScenes.join('\n\n');
              }
            } else {
              // Default behavior: get current scene text
              sceneContext = options.sceneId
                ? await this.promptManager.getCurrentOrPreviousSceneText(options.sceneId, beatId)
                : '';
            }

            // Get codex entries via CodexContextService
            const codexResult = await this.codexContextService.buildCodexXml(
              options.storyId!, userPrompt, options.stagingNotes || '', sceneContext
            );
            const codexText = codexResult.xml;

            // Find protagonist for point of view from Codex
            const protagonist = this.findProtagonist(codexResult.categories);
            const pointOfViewText = this.generatePointOfViewText(
              story.settings?.narrativePerspective,
              protagonist
            );

            // Generate tense text
            const tenseText = this.generateTenseText(story.settings?.tense);


        // Get story so far in XML format
        // Check custom context settings first, then fallback to beatType
        let storySoFar = '';
        if (options.sceneId) {
          if (options.customContext !== undefined) {
            // Use custom context settings
            if (options.customContext.includeStoryOutline) {
              if (options.customContext.selectedSceneContexts.length > 0) {
                // Build modified story outline with selected scenes replaced by their full text
                storySoFar = await this.buildModifiedStoryOutline(
                  options.sceneId, 
                  options.customContext.selectedSceneContexts,
                  story
                );
              } else {
                // No scenes selected, use default story outline
                storySoFar = await this.promptManager.getStoryXmlFormat(options.sceneId);
              }
            } else {
              storySoFar = '';
            }
          } else {
            // Both Story Beat and Scene Beat use full story context
            // The difference is in the task instructions, not the context
            storySoFar = await this.promptManager.getStoryXmlFormat(options.sceneId);
          }
        }

        // Build the prompt - for rewrites, include the existing text
        let finalPrompt = userPrompt;
        if (options.action === 'polish' && options.existingText) {
          finalPrompt = `TEXT TO POLISH:\n${options.existingText}`;
          if (userPrompt.trim()) {
            finalPrompt += `\n\nADDITIONAL GUIDANCE:\n${userPrompt}`;
          }
          finalPrompt += `\n\nPolish the expression, wording, tone, and voice of the above text. Do NOT change the plot, events, dialogue content, or story progression. Only refine HOW things are expressed, not WHAT happens. Output only the polished text.`;
        } else if (options.action === 'rewrite' && options.existingText) {
          finalPrompt = `EXISTING TEXT TO REWRITE:
${options.existingText}

REWRITE INSTRUCTIONS:
${userPrompt}

Please rewrite the above text according to the instructions. Only output the rewritten text, nothing else.`;
        }

        // Build rules text if rules exist
        const rulesText = this.buildRulesText(story.settings?.beatRules);

        // Strip heavy context for polish - we only need style/codex, not full story
        if (options.action === 'polish') {
          storySoFar = '';
          sceneContext = '';
        }

        // Build template placeholders
        const placeholdersRaw = {
          systemMessage: story.settings!.systemMessage,
          codexEntries: codexText,
          storySoFar: storySoFar,
          storyTitle: story.title || 'Story',
          sceneFullText: sceneContext, // Use the sceneContext we built above
          wordCount: (options.wordCount || 200).toString(),
          prompt: finalPrompt,
          pointOfView: pointOfViewText,
          tense: tenseText,
          rules: rulesText,
          stagingNotes: options.stagingNotes || ''
        } as const;

        // Escape plain-text placeholders, keep XML fragments (codexEntries, storySoFar) as-is
        const placeholders: Record<string, string> = {
          systemMessage: this.escapeXml(placeholdersRaw.systemMessage),
          codexEntries: placeholdersRaw.codexEntries,
          storySoFar: placeholdersRaw.storySoFar,
          storyTitle: this.escapeXml(placeholdersRaw.storyTitle),
          sceneFullText: this.escapeXml(placeholdersRaw.sceneFullText),
          wordCount: placeholdersRaw.wordCount,
          prompt: this.escapeXml(placeholdersRaw.prompt),
          pointOfView: this.escapeXml(placeholdersRaw.pointOfView),
          tense: this.escapeXml(placeholdersRaw.tense),
          rules: this.escapeXml(placeholdersRaw.rules),
          stagingNotes: this.escapeXml(placeholdersRaw.stagingNotes)
        };

        // Log the final codex text to debug

        // Build template from sections (always use section-based templates)
        let processedTemplate: string;
        console.log('[BeatAI] Using section-based template, beatType:', options.beatType, 'action:', options.action);

        // For polish actions, use lightweight polish-specific template sections
        if (options.action === 'polish') {
          const polishSections = {
            ...DEFAULT_BEAT_TEMPLATE_SECTIONS,
            userMessagePreamble: 'You are polishing the expression and wording of a piece of story content.',
            objective: `Polish ONLY the expression, wording, tone, and voice of the text provided in <beat_requirements>.
Do NOT change the plot, events, dialogue content, character actions, or story progression.
Only refine HOW things are expressed — not WHAT happens.
Use the style instructions and codex voice data to guide your refinement.`,
            narrativeParameters: `<point_of_view>{pointOfView}</point_of_view>
<tense>Match the tense of the original text</tense>
<length>Preserve the approximate length of the original text</length>`,
            beatRequirements: '{prompt}',
            styleGuidance: `- Closely follow the author's style instructions (system message) for tone and voice
- Use codex entries to ensure character voice consistency
- Enhance prose quality: tighten phrasing, vary sentence structure, strengthen word choices
- Preserve the author's intended meaning and narrative flow`,
            constraints: `- Do NOT add, remove, or reorder scenes, events, or dialogue beats
- Do NOT change character actions or decisions
- Do NOT introduce new information or story elements
- Preserve the original paragraph structure and approximate length
- Output only the polished text, no commentary`,
            generatePrompt: 'Output the polished text now:'
          };
          processedTemplate = sectionsToTemplate(polishSections);
          console.log('[BeatAI] Built template for polish action');
        }
        // For rewrite actions, use rewrite-specific template sections
        else if (options.action === 'rewrite') {
          const rewriteSections = {
            ...DEFAULT_BEAT_TEMPLATE_SECTIONS,
            userMessagePreamble: 'You are rewriting a specific piece of story content. Here is the context:',
            objective: `Rewrite ONLY the text provided in the <beat_requirements> section under "EXISTING TEXT TO REWRITE".
Do NOT generate new content beyond what is provided.
Only make changes where the rewrite instructions specifically require it.
Preserve all aspects of the original text that are not addressed by the instructions.`,
            narrativeParameters: `<point_of_view>{pointOfView}</point_of_view>
<tense>Match the tense of the original text</tense>
<length>Preserve the approximate length of the original text unless instructions specify otherwise</length>`,
            beatRequirements: '{prompt}',  // prompt contains EXISTING TEXT TO REWRITE and REWRITE INSTRUCTIONS
            styleGuidance: `- Maintain the exact tone and narrative voice of the original text
- Preserve the writing style unless the rewrite instructions specifically request a change`,
            constraints: `- Rewrite ONLY the provided text - do not add new scenes, paragraphs, or story elements
- Only modify what the rewrite instructions specifically ask for
- Preserve the original length unless the instructions explicitly request a change
- Maintain consistency with the story context provided above
- Do NOT continue the story or add new content`,
            generatePrompt: 'Output the rewritten text now:'
          };
          processedTemplate = sectionsToTemplate(rewriteSections);
          console.log('[BeatAI] Built template for rewrite action');
        } else if (options.beatType === 'scene') {
          // Use scene beat sections - smart merge that prefers non-empty values over defaults
          const sceneSections = mergeSceneBeatSections(
            DEFAULT_SCENE_BEAT_TEMPLATE_SECTIONS,
            story.settings?.sceneBeatTemplateSections
          );
          processedTemplate = sceneBeatSectionsToTemplate(
            sceneSections,
            undefined, // systemMessage placeholder will be replaced below
            options.textAfterBeat
          );
          console.log('[BeatAI] Built template from scene beat sections, textAfterBeat:', options.textAfterBeat ? 'present' : 'none');
        } else if (options.beatType === 'envision') {
          // Use envision beat sections - smart merge that prefers non-empty values over defaults
          // Envision beats use the same interface as story beats (BeatTemplateSections)
          const envisionSections = mergeEnvisionBeatSections(
            story.settings?.envisionBeatTemplateSections
          );
          processedTemplate = sectionsToTemplate(envisionSections);
          console.log('[BeatAI] Built template from envision beat sections');
        } else {
          // Use story beat sections - smart merge that prefers non-empty values over defaults
          const beatSections = mergeBeatSections(
            DEFAULT_BEAT_TEMPLATE_SECTIONS,
            story.settings?.beatTemplateSections
          );
          processedTemplate = sectionsToTemplate(beatSections);
          console.log('[BeatAI] Built template from story beat sections');
        }

        // Replace placeholders in the template
        Object.entries(placeholders).forEach(([key, value]) => {
          const placeholder = `{${key}}`;
          const regex = new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
          processedTemplate = processedTemplate.replace(regex, value || '');
        });

        // Note: Empty staging notes are handled gracefully - the placeholder {stagingNotes}
        // gets replaced with empty string, leaving just the instruction text which is fine.

            return processedTemplate;
          })
        );
      }),
      map(result => result)
    );
  }

  private generateFallbackContent(prompt: string, beatId: string): Observable<string> {
    const fallbackContent = this.generateSampleContent(prompt);
    this.entityDecodeBuffers.delete(beatId);
    
    
    // Emit generation complete with fallback
    this.generationSubject.next({
      beatId,
      chunk: fallbackContent,
      isComplete: true
    });
    
    // Signal streaming stopped
    this.isStreamingSubject.next(false);
    
    return of(fallbackContent);
  }

  private generateSampleContent(prompt: string): string {
    // This would be replaced with actual AI API call
    const templates = [
      `Der Protagonist ${this.getRandomName()} betritt den Raum und bemerkt sofort die angespannte Atmosphäre. Die Luft scheint zu knistern vor unausgesprochenen Worten und unterdrückten Emotionen.`,
      
      `Mit einem tiefen Atemzug sammelt ${this.getRandomName()} Mut und tritt vor. Was als einfache Begegnung begann, entwickelt sich schnell zu einem Wendepunkt, der alles verändern wird.`,
      
      `Die Stille wird durchbrochen, als ${this.getRandomName()} endlich die Worte ausspricht, die schon so lange auf der Zunge lagen. Ein Moment der Wahrheit, der keine Rückkehr zulässt.`,
      
      `Plötzlich wird ${this.getRandomName()} klar, dass nichts mehr so sein wird wie zuvor. Die Realität bricht über sie herein wie eine kalte Welle, die alles mit sich reißt.`,
      
      `In diesem entscheidenden Augenblick muss ${this.getRandomName()} eine Wahl treffen. Links oder rechts, vorwärts oder zurück - jede Entscheidung wird Konsequenzen haben.`
    ];
    
    // Simple keyword matching for more relevant content
    const keywords = prompt.toLowerCase();
    if (keywords.includes('konfrontation') || keywords.includes('streit')) {
      return `Der Konflikt eskaliert, als ${this.getRandomName()} nicht länger schweigen kann. Die aufgestauten Emotionen brechen sich Bahn und verwandeln das Gespräch in eine hitzige Auseinandersetzung, bei der keine Seite bereit ist nachzugeben.`;
    } else if (keywords.includes('entdeckung') || keywords.includes('geheimnis')) {
      return `${this.getRandomName()} stößt auf etwas Unerwartetes. Was zunächst wie ein belangloser Fund aussieht, entpuppt sich als Schlüssel zu einem gut gehüteten Geheimnis, das alles in Frage stellt.`;
    } else if (keywords.includes('flucht') || keywords.includes('entkommen')) {
      return `Die Zeit drängt. ${this.getRandomName()} muss schnell handeln, denn die Gelegenheit zur Flucht wird nicht lange bestehen. Jeder Herzschlag zählt, jeder Schritt könnte der letzte sein.`;
    }
    
    return templates[Math.floor(Math.random() * templates.length)];
  }

  private getRandomName(): string {
    const names = ['Sarah', 'Michael', 'Lisa', 'David', 'Anna', 'Thomas', 'Julia', 'Martin', 'Sophie', 'Alex'];
    return names[Math.floor(Math.random() * names.length)];
  }

  /**
   * Replace the beat_generation_task section with scene-beat-specific instructions.
   * Scene beats focus on expanding moments with depth and detail, and can bridge
   * to existing text that follows.
   */
  private replaceWithSceneBeatInstructions(
    template: string,
    placeholders: Record<string, string>,
    textAfterBeat?: string
  ): string {
    // Build bridging instruction if there's text after the beat
    let bridgingSection = '';
    if (textAfterBeat && textAfterBeat.trim().length > 0) {
      const escapedTextAfter = this.escapeXml(textAfterBeat.trim());
      bridgingSection = `
  <bridging_context>
    <instruction>Your generation must seamlessly connect to the existing text that follows. End in a way that flows naturally into this text:</instruction>
    <text_after_beat>${escapedTextAfter}</text_after_beat>
  </bridging_context>`;
    }

    // Build the scene beat task block
    const sceneBeatTask = `<beat_generation_task>
  <objective>
    Expand this moment with rich detail, deepening the reader's immersion in the scene.
    Focus on the immediate experience rather than advancing the plot.
  </objective>

  <narrative_parameters>
    ${placeholders['pointOfView']}
    <word_count>${placeholders['wordCount']} words (±50 words acceptable)</word_count>
    <tense>${placeholders['tense']}</tense>
  </narrative_parameters>

  <focus_areas>
    <area>Internal character thoughts and emotional reactions</area>
    <area>Sensory details - sight, sound, touch, smell, taste</area>
    <area>Micro-actions and body language</area>
    <area>Atmosphere and mood of the moment</area>
    <area>Subtext in dialogue (if present)</area>
  </focus_areas>

  <beat_requirements>
    ${placeholders['prompt']}
  </beat_requirements>
${bridgingSection}
  <style_guidance>
    - Match the exact tone and narrative voice of the current scene
    - Maintain the established balance of dialogue, action, and introspection
    - Deepen the reader's connection to the viewpoint character
  </style_guidance>

  <constraints>
    - Stay within this moment - do NOT advance to new scenes or time jumps
    - Do NOT resolve conflicts or make major plot progress
    - Do NOT have characters act inconsistently with their established personalities
    - Do NOT introduce major new story elements
    - Match the exact tone and narrative voice
    ${textAfterBeat ? '- End in a way that flows naturally into the text that follows' : ''}
  </constraints>

  <output_format>
    Pure narrative prose. No meta-commentary, scene markers, chapter headings, or author notes.
  </output_format>
</beat_generation_task>`;

    // Replace the beat_generation_task section in the template
    // Match from <beat_generation_task> to </beat_generation_task>
    const taskRegex = /<beat_generation_task>[\s\S]*?<\/beat_generation_task>/;
    if (taskRegex.test(template)) {
      console.log('[BeatAI] Found and replacing beat_generation_task with scene-specific instructions');
      return template.replace(taskRegex, sceneBeatTask);
    }
    console.log('[BeatAI] WARNING: beat_generation_task not found in template');

    // If no beat_generation_task found, append before "Generate the beat now:"
    const generateNowRegex = /Generate the beat now:/;
    if (generateNowRegex.test(template)) {
      return template.replace(generateNowRegex, sceneBeatTask + '\n\nGenerate the beat now:');
    }

    // Fallback: just return original template
    return template;
  }

  createNewBeat(beatType: 'story' | 'scene' | 'envision' = 'story'): BeatAI {
    return {
      id: this.generateId(),
      prompt: '',
      generatedContent: '',
      isGenerating: false,
      isCollapsed: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      wordCount: 400,
      beatType: beatType,
      includeStoryOutline: true
    };
  }

  private generateId(): string {
    return 'beat-' + Math.random().toString(36).substring(2, 11);
  }

  // Public method to preview the structured prompt
  previewPrompt(userPrompt: string, beatId: string, options: {
    storyId?: string;
    chapterId?: string;
    sceneId?: string;
    wordCount?: number;
    beatType?: 'story' | 'scene' | 'envision';
    customContext?: {
      selectedScenes: string[];
      includeStoryOutline: boolean;
      selectedSceneContexts: { sceneId: string; chapterId: string; content: string; }[];
    };
    textAfterBeat?: string;
    stagingNotes?: string;
  }): Observable<string> {
    return this.buildStructuredPromptFromTemplate(userPrompt, beatId, options);
  }

  stopGeneration(beatId: string): void {
    const context = this.generationContexts.get(beatId);
    const requestId = this.activeGenerations.get(beatId) || context?.requestId;

    if (context && requestId) {
      this.abortProviderRequest(context.provider, requestId);
    } else if (requestId) {
      if (requestId.startsWith('gemini_')) {
        this.googleGeminiApi.abortRequest(requestId);
      } else if (requestId.startsWith('claude_')) {
        this.claudeApi.abortRequest(requestId);
      } else if (requestId.startsWith('ollama_')) {
        this.ollamaApi.abortRequest(requestId);
      } else if (requestId.startsWith('openaiCompatible_')) {
        this.openAICompatibleApi.abortRequest(requestId);
      } else {
        this.openRouterApi.abortRequest(requestId);
      }
    }

    context?.resultSubject.complete();

    this.cleanupContext(beatId);

    this.generationSubject.next({
      beatId,
      chunk: '',
      isComplete: true
    });
  }

  isGenerating(beatId: string): boolean {
    return this.activeGenerations.has(beatId);
  }

  private escapeXml(text: string | unknown): string {
    // Ensure the input is a string
    const str = String(text || '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private buildRulesText(rules?: string): string {
    if (!rules || rules.trim().length === 0) {
      return '';
    }
    return rules.trim();
  }

  private findProtagonist(codexEntries: { category: string; entries: CodexEntry[]; icon?: string }[]): string | null {
    // Look for character entries with storyRole "Protagonist"
    for (const categoryData of codexEntries) {
      if (categoryData.category === 'Characters') {
        for (const entry of categoryData.entries) {
          const storyRole = entry.metadata?.['storyRole'];
          if (storyRole === 'Protagonist') {
            return entry.title;
          }
        }
      }
    }
    return null;
  }

  private generatePointOfViewText(
    perspective: NarrativePerspective | undefined,
    protagonistName: string | null
  ): string {
    const effectivePerspective = perspective || 'third-person-limited';

    const povTypeMap: Record<NarrativePerspective, string> = {
      'first-person': 'first person',
      'third-person-limited': 'third person limited',
      'third-person-omniscient': 'third person omniscient',
      'second-person': 'second person'
    };

    const povType = povTypeMap[effectivePerspective];

    // Include character for first/third-limited/second person when protagonist is known
    if (protagonistName && ['first-person', 'third-person-limited', 'second-person'].includes(effectivePerspective)) {
      return `${povType}, character: ${protagonistName}`;
    }

    return povType;
  }

  private generateTenseText(tense: StoryTense | undefined): string {
    const effectiveTense = tense || 'past';

    const tenseMap: Record<StoryTense, string> = {
      'past': 'past tense',
      'present': 'present tense'
    };

    return tenseMap[effectiveTense];
  }

  private removeDuplicateCharacterAnalyses(content: string): string {
    // Pattern to detect character analysis sections
    // Look for patterns like "Character: Name" or "Charakter: Name" or similar variations
    const characterAnalysisPattern = /(?:^|\n)((?:Character|Charakter|Figur|Person)[:\s]+[^\n]+(?:\n(?!(?:Character|Charakter|Figur|Person)[:\s])[^\n]*)*)/gi;
    
    // Find all character analysis sections
    const analyses = new Map<string, string>();
    let match;
    
    while ((match = characterAnalysisPattern.exec(content)) !== null) {
      const fullAnalysis = match[1];
      // Extract character name (first line)
      const firstLine = fullAnalysis.split('\n')[0];
      const characterName = firstLine.replace(/^(?:Character|Charakter|Figur|Person)[:\s]+/i, '').trim();
      
      // Store only the first occurrence of each character analysis
      if (characterName && !analyses.has(characterName.toLowerCase())) {
        analyses.set(characterName.toLowerCase(), match[0]);
      }
    }
    
    // If we found duplicate analyses, rebuild the content without duplicates
    if (analyses.size > 0) {
      let processedContent = content;
      const seenCharacters = new Set<string>();
      
      // Replace all character analyses with markers first
      let markerIndex = 0;
      const markers = new Map<string, string>();
      
      processedContent = content.replace(characterAnalysisPattern, (match, analysis) => {
        const firstLine = analysis.split('\n')[0];
        const characterName = firstLine.replace(/^(?:Character|Charakter|Figur|Person)[:\s]+/i, '').trim().toLowerCase();
        
        if (characterName && !seenCharacters.has(characterName)) {
          seenCharacters.add(characterName);
          const marker = `###CHAR_ANALYSIS_${markerIndex}###`;
          markers.set(marker, match);
          markerIndex++;
          return marker;
        }
        return ''; // Remove duplicate
      });
      
      // Replace markers back with original content
      markers.forEach((original, marker) => {
        processedContent = processedContent.replace(marker, original);
      });
      
      // Clean up any resulting double newlines
      processedContent = processedContent.replace(/\n{3,}/g, '\n\n');
      
      return processedContent.trim();
    }
    
    return content;
  }

  /**
   * Build a modified story outline where selected scenes have their full text instead of summaries
   */
  private async buildModifiedStoryOutline(
    targetSceneId: string, 
    selectedSceneContexts: { sceneId: string; chapterId: string; content: string; }[],
    story: Story
  ): Promise<string> {
    // Create a map of scene IDs to their full content for quick lookup
    const sceneTextMap = new Map<string, string>();
    selectedSceneContexts.forEach(context => {
      sceneTextMap.set(context.sceneId, context.content);
    });

    if (!story || !story.chapters) return '';

    let xml = '<act number="1">\n';

    const sortedChapters = [...story.chapters].sort((a, b) => a.order - b.order);

    for (const chapter of sortedChapters) {
      if (!chapter.scenes || chapter.scenes.length === 0) continue;

      xml += `  <chapter title="${this.escapeXml(chapter.title)}" number="${chapter.order}">\n`;

      const sortedScenes = [...chapter.scenes].sort((a, b) => a.order - b.order);

      for (const scene of sortedScenes) {
        // Stop before the target scene
        if (scene.id === targetSceneId) {
          xml += '  </chapter>\n';
          xml += '</act>';
          return xml;
        }

        xml += `    <scene title="${this.escapeXml(scene.title)}" number="${scene.order}">`;

        // Check if this scene should use full text instead of summary
        if (sceneTextMap.has(scene.id)) {
          // Use the full text from selected scenes
          const fullText = sceneTextMap.get(scene.id)!;
          xml += this.escapeXml(fullText);
        } else {
          // Use summary if available, otherwise use full text from scene
          const content = scene.summary || this.extractFullTextFromScene(scene);
          xml += this.escapeXml(content);
        }

        xml += '</scene>\n';
      }

      xml += '  </chapter>\n';
    }

    xml += '</act>';

    return xml;
  }

  private extractFullTextFromScene(scene: { content?: string }): string {
    if (!scene.content) return '';

    // Use DOM parser for more reliable HTML parsing
    const parser = new DOMParser();
    const doc = parser.parseFromString(scene.content, 'text/html');
    
    // Remove all beat AI wrapper elements and their contents
    const beatWrappers = doc.querySelectorAll('.beat-ai-wrapper, .beat-ai-node');
    beatWrappers.forEach(element => element.remove());
    
    // Remove beat markers and comments
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }
    
    textNodes.forEach(textNode => {
      // Remove beat markers like [Beat: description]
      textNode.textContent = textNode.textContent?.replace(/\[Beat:[^\]]*\]/g, '') || '';
    });
    
    // Convert to text while preserving paragraph structure
    let cleanText = '';
    const paragraphs = doc.querySelectorAll('p');
    
    for (const p of paragraphs) {
      const text = p.textContent?.trim() || '';
      if (text) {
        cleanText += text + '\n\n';
      } else {
        // Empty paragraph becomes single newline
        cleanText += '\n';
      }
    }
    
    // If no paragraphs found, fall back to body text
    if (!paragraphs.length) {
      cleanText = doc.body.textContent || '';
    }
    
    // Clean up extra whitespace
    cleanText = cleanText.replace(/\n\s*\n\s*\n/g, '\n\n');
    cleanText = cleanText.trim();

    return cleanText;
  }
}
