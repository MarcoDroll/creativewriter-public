import { Injectable, inject, OnDestroy } from '@angular/core';
import { Observable, BehaviorSubject, Subscription, firstValueFrom } from 'rxjs';
import { map, filter, take } from 'rxjs/operators';
import { ServerGenerationService } from '../../core/services/server-generation.service';
import { PendingJobsService, StreamingEvent } from '../../core/services/pending-jobs.service';
import { SettingsService } from '../../core/services/settings.service';
import { ServerProviderType } from '../../core/models/generation.interface';
import { StoryResearchSceneFinding } from '../models/story-research.interface';

export interface ResearchSceneInfo {
  chapterId: string;
  sceneId: string;
  chapterTitle: string;
  sceneTitle: string;
  prompt: string;
}

export interface ResearchGroupProgress {
  groupId: string;
  storyId: string;
  task: string;
  model: string;
  totalScenes: number;
  completedScenes: number;
  failedScenes: number;
  pendingScenes: number;
  processingScenes: number;
  isActive: boolean;
  isSummaryPhase: boolean;
  summaryComplete: boolean;
  findings: StoryResearchSceneFinding[];
  summary?: string;
  error?: string;
}

export interface ResearchGroupState {
  groupId: string;
  storyId: string;
  task: string;
  model: string;
  scenes: ResearchSceneInfo[];
  jobIds: Map<number, string>;  // sceneIndex -> jobId
  summaryJobId?: string;
  findings: Map<number, StoryResearchSceneFinding>;  // sceneIndex -> finding
  summary?: string;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class ResearchJobService implements OnDestroy {
  private static readonly PROVIDER_MAP: Record<string, ServerProviderType> = {
    'claude': 'claude',
    'gemini': 'gemini',
    'openrouter': 'openrouter',
    'ollama': 'ollama',
    'openaiCompatible': 'openai-compat'
  };

  private readonly serverGeneration = inject(ServerGenerationService);
  private readonly pendingJobs = inject(PendingJobsService);
  private readonly settingsService = inject(SettingsService);

  // Track active research groups
  private activeGroups = new Map<string, ResearchGroupState>();
  private groupProgressSubject = new BehaviorSubject<Map<string, ResearchGroupProgress>>(new Map());
  private streamSubscriptions = new Map<string, Subscription>();

  /**
   * Observable of all research group progress
   */
  groupProgress$ = this.groupProgressSubject.asObservable();

  /**
   * Generate a unique group ID
   */
  generateGroupId(): string {
    return this.generateUUID();
  }

  /**
   * Start a new research group with the given scenes
   * Returns the groupId
   */
  async startResearchGroup(
    storyId: string,
    scenes: ResearchSceneInfo[],
    task: string,
    model: string
  ): Promise<string> {
    const groupId = this.generateGroupId();
    const totalScenes = scenes.length;

    // Parse model to get provider and model name (before group state to fail fast)
    const [providerStr, ...modelParts] = model.split(':');
    const provider = this.mapToServerProvider(providerStr);
    const modelName = modelParts.join(':');

    // Get API key and provider URL
    const apiKey = this.getApiKeyForProvider(provider);
    if (!apiKey) {
      throw new Error(`No API key configured for provider: ${provider}`);
    }
    const providerUrl = this.getProviderUrl(provider);

    // Initialize group state
    const groupState: ResearchGroupState = {
      groupId,
      storyId,
      task,
      model,
      scenes,
      jobIds: new Map(),
      findings: new Map()
    };
    this.activeGroups.set(groupId, groupState);

    // Start all scene jobs
    const jobPromises = scenes.map(async (scene, index) => {
      try {
        const result = await firstValueFrom(this.serverGeneration.startJob({
          prompt: scene.prompt,
          provider,
          model: modelName,
          maxTokens: 900,
          temperature: 0.7,
          apiKey,
          providerUrl,
          jobType: 'research-scene',
          groupId,
          sceneIndex: index,
          totalScenes,
          beatId: `research-${groupId}-${index}`, // Synthetic beatId for tracking
          storyId,
          chapterId: scene.chapterId,
          sceneId: scene.sceneId
        }));
        groupState.jobIds.set(index, result.jobId);
        return { index, jobId: result.jobId, success: true };
      } catch (error) {
        console.error(`[ResearchJob] Failed to start job for scene ${index}:`, error);
        return { index, jobId: null, success: false, error };
      }
    });

    const results = await Promise.all(jobPromises);
    const failedStarts = results.filter(r => !r.success);

    if (failedStarts.length === scenes.length) {
      // All jobs failed to start
      this.activeGroups.delete(groupId);
      throw new Error('Failed to start any research jobs');
    }

    // Subscribe to streaming events for this group
    this.subscribeToGroupEvents(groupId);

    // Update progress
    this.updateGroupProgress(groupId);

    // Refresh pending jobs to pick up new jobs
    await this.pendingJobs.refreshJobs();

    return groupId;
  }

  /**
   * Resume a research group from pending jobs (after page refresh)
   */
  async resumeResearchGroup(groupId: string): Promise<ResearchGroupState | null> {
    // Get all jobs for this group
    const jobs = await firstValueFrom(this.pendingJobs.getJobsForGroup(groupId).pipe(take(1)));

    if (jobs.length === 0) {
      return null;
    }

    // Reconstruct group state from jobs
    const firstJob = jobs[0];
    const sceneJobs = jobs.filter(j => j.jobType === 'research-scene');
    const summaryJob = jobs.find(j => j.jobType === 'research-summary');

    const groupState: ResearchGroupState = {
      groupId,
      storyId: firstJob.storyId,
      task: '', // Will need to be restored from somewhere else
      model: '', // Will need to be restored from somewhere else
      scenes: [], // Will need to be restored
      jobIds: new Map(),
      findings: new Map(),
      summaryJobId: summaryJob?.id
    };

    // Populate job IDs and findings from scene jobs
    sceneJobs.forEach(job => {
      if (job.sceneIndex !== undefined) {
        groupState.jobIds.set(job.sceneIndex, job.id);
        if (job.status === 'completed' && job.content) {
          groupState.findings.set(job.sceneIndex, {
            chapterId: job.chapterId || '',
            sceneId: job.sceneId || '',
            chapterTitle: '', // Would need to be stored in job or fetched
            sceneTitle: '', // Would need to be stored in job or fetched
            prompt: '', // Not stored in job response
            response: job.content
          });
        }
      }
    });

    // Get summary if completed
    if (summaryJob?.status === 'completed' && summaryJob.content) {
      groupState.summary = summaryJob.content;
    }

    this.activeGroups.set(groupId, groupState);
    this.subscribeToGroupEvents(groupId);
    this.updateGroupProgress(groupId);

    return groupState;
  }

  /**
   * Get current progress for a research group
   */
  getGroupProgress(groupId: string): Observable<ResearchGroupProgress | null> {
    return this.groupProgress$.pipe(
      map(progressMap => progressMap.get(groupId) || null)
    );
  }

  /**
   * Get completed findings from a group
   */
  getGroupFindings(groupId: string): StoryResearchSceneFinding[] {
    const state = this.activeGroups.get(groupId);
    if (!state) return [];

    return Array.from(state.findings.entries())
      .sort(([a], [b]) => a - b)
      .map(([, finding]) => finding);
  }

  /**
   * Start summary generation for a completed research group
   */
  async startSummaryJob(
    groupId: string,
    summaryPrompt: string
  ): Promise<string> {
    const state = this.activeGroups.get(groupId);
    if (!state) {
      throw new Error(`Research group not found: ${groupId}`);
    }

    // Parse model to get provider and model name
    const [providerStr, ...modelParts] = state.model.split(':');
    const provider = this.mapToServerProvider(providerStr);
    const modelName = modelParts.join(':');

    // Get API key and provider URL
    const apiKey = this.getApiKeyForProvider(provider);
    if (!apiKey) {
      throw new Error(`No API key configured for provider: ${provider}`);
    }
    const providerUrl = this.getProviderUrl(provider);

    const result = await firstValueFrom(this.serverGeneration.startJob({
      prompt: summaryPrompt,
      provider,
      model: modelName,
      maxTokens: 1200,
      temperature: 0.7,
      apiKey,
      providerUrl,
      jobType: 'research-summary',
      groupId,
      beatId: `research-summary-${groupId}`,
      storyId: state.storyId
    }));

    state.summaryJobId = result.jobId;
    this.updateGroupProgress(groupId);

    // Refresh pending jobs to pick up new job
    await this.pendingJobs.refreshJobs();

    return result.jobId;
  }

  /**
   * Cancel all jobs in a research group
   */
  async cancelResearchGroup(groupId: string): Promise<void> {
    const state = this.activeGroups.get(groupId);
    if (!state) return;

    // Cancel all scene jobs
    const cancelPromises: Promise<unknown>[] = [];
    state.jobIds.forEach(jobId => {
      cancelPromises.push(
        firstValueFrom(this.serverGeneration.cancelJob(jobId)).catch(() => {
          /* ignore cancel errors */
        })
      );
    });

    // Cancel summary job if exists
    if (state.summaryJobId) {
      cancelPromises.push(
        firstValueFrom(this.serverGeneration.cancelJob(state.summaryJobId)).catch(() => {
          /* ignore cancel errors */
        })
      );
    }

    await Promise.all(cancelPromises);

    // Clean up subscriptions
    const subscription = this.streamSubscriptions.get(groupId);
    if (subscription) {
      subscription.unsubscribe();
      this.streamSubscriptions.delete(groupId);
    }

    // Remove from active groups
    this.activeGroups.delete(groupId);
    this.updateAllProgress();
  }

  /**
   * Check if there are any recoverable research groups
   */
  async getRecoverableGroups(): Promise<string[]> {
    const jobs = await firstValueFrom(this.pendingJobs.pendingJobs$.pipe(take(1)));

    // Find unique group IDs from research jobs
    const groupIds = new Set<string>();
    jobs.forEach(job => {
      if (job.groupId && (job.jobType === 'research-scene' || job.jobType === 'research-summary')) {
        groupIds.add(job.groupId);
      }
    });

    // Filter to groups that are not already active in this session
    return Array.from(groupIds).filter(id => !this.activeGroups.has(id));
  }

  /**
   * Subscribe to streaming events for a group
   */
  private subscribeToGroupEvents(groupId: string): void {
    // Don't double-subscribe
    if (this.streamSubscriptions.has(groupId)) return;

    const subscription = this.pendingJobs.streamingEvent$.pipe(
      filter(event => event.groupId === groupId)
    ).subscribe(event => {
      this.handleStreamingEvent(groupId, event);
    });

    this.streamSubscriptions.set(groupId, subscription);
  }

  /**
   * Handle streaming events for a group
   */
  private handleStreamingEvent(groupId: string, event: StreamingEvent): void {
    const state = this.activeGroups.get(groupId);
    if (!state) return;

    if (event.isComplete) {
      // A job completed - update progress
      this.updateGroupProgress(groupId);
    }
  }

  /**
   * Update progress for a specific group
   */
  private async updateGroupProgress(groupId: string): Promise<void> {
    const state = this.activeGroups.get(groupId);
    if (!state) return;

    // Get jobs from pending jobs service
    const jobs = await firstValueFrom(this.pendingJobs.getJobsForGroup(groupId).pipe(take(1)));
    const sceneJobs = jobs.filter(j => j.jobType === 'research-scene');
    const summaryJob = jobs.find(j => j.jobType === 'research-summary');

    // Count statuses
    let completedScenes = 0;
    let failedScenes = 0;
    let pendingScenes = 0;
    let processingScenes = 0;

    sceneJobs.forEach(job => {
      switch (job.status) {
        case 'completed':
          completedScenes++;
          // Update findings if we have content
          if (job.content && job.sceneIndex !== undefined) {
            const scene = state.scenes[job.sceneIndex];
            if (scene && !state.findings.has(job.sceneIndex)) {
              state.findings.set(job.sceneIndex, {
                chapterId: scene.chapterId,
                sceneId: scene.sceneId,
                chapterTitle: scene.chapterTitle,
                sceneTitle: scene.sceneTitle,
                prompt: scene.prompt,
                response: job.content
              });
            }
          }
          break;
        case 'failed':
          failedScenes++;
          break;
        case 'pending':
          pendingScenes++;
          break;
        case 'processing':
          processingScenes++;
          break;
      }
    });

    // Check summary status
    const isSummaryPhase = !!summaryJob;
    const summaryComplete = summaryJob?.status === 'completed';
    if (summaryComplete && summaryJob?.content) {
      state.summary = summaryJob.content;
    }

    // Determine if group is still active
    const isActive = pendingScenes > 0 || processingScenes > 0 ||
      (isSummaryPhase && !summaryComplete && summaryJob?.status !== 'failed');

    // Build progress object
    const progress: ResearchGroupProgress = {
      groupId,
      storyId: state.storyId,
      task: state.task,
      model: state.model,
      totalScenes: state.scenes.length || (sceneJobs[0]?.totalScenes ?? sceneJobs.length),
      completedScenes,
      failedScenes,
      pendingScenes,
      processingScenes,
      isActive,
      isSummaryPhase,
      summaryComplete,
      findings: this.getGroupFindings(groupId),
      summary: state.summary,
      error: summaryJob?.status === 'failed' ? summaryJob.error : undefined
    };

    // Update the progress map
    const currentProgress = this.groupProgressSubject.value;
    const newProgress = new Map(currentProgress);
    newProgress.set(groupId, progress);
    this.groupProgressSubject.next(newProgress);
  }

  /**
   * Update progress for all active groups
   */
  private updateAllProgress(): void {
    const currentProgress = this.groupProgressSubject.value;
    const newProgress = new Map<string, ResearchGroupProgress>();

    // Keep only progress for active groups
    this.activeGroups.forEach((_, groupId) => {
      const existing = currentProgress.get(groupId);
      if (existing) {
        newProgress.set(groupId, existing);
      }
    });

    this.groupProgressSubject.next(newProgress);
  }

  /**
   * Map frontend provider string to ServerProviderType
   */
  private mapToServerProvider(provider: string): ServerProviderType {
    const mapped = ResearchJobService.PROVIDER_MAP[provider];
    if (!mapped) {
      throw new Error(`Unsupported provider for server-side research: ${provider}`);
    }
    return mapped;
  }

  /**
   * Get the provider URL for providers that need it (Ollama, OpenAI-compatible)
   */
  private getProviderUrl(provider: ServerProviderType): string | undefined {
    const settings = this.settingsService.getSettings();
    switch (provider) {
      case 'ollama':
        return settings.ollama.baseUrl || undefined;
      case 'openai-compat':
        return settings.openAICompatible.baseUrl || undefined;
      default:
        return undefined;
    }
  }

  /**
   * Get API key for a provider
   */
  private getApiKeyForProvider(provider: ServerProviderType): string | undefined {
    const settings = this.settingsService.getSettings();

    switch (provider) {
      case 'openrouter':
        return settings.openRouter.apiKey;
      case 'gemini':
        return settings.googleGemini.apiKey;
      case 'claude':
        return settings.claude.apiKey;
      case 'ollama':
        return 'ollama'; // Ollama doesn't need a real key
      case 'openai-compat':
        return settings.openAICompatible.apiKey || 'local';
      default:
        return undefined;
    }
  }

  /**
   * Generate a UUID v4, with fallback for non-secure contexts
   */
  private generateUUID(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      try {
        return crypto.randomUUID();
      } catch {
        // Falls through to fallback
      }
    }

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  /**
   * Clean up when service is destroyed
   */
  ngOnDestroy(): void {
    this.streamSubscriptions.forEach(sub => sub.unsubscribe());
    this.streamSubscriptions.clear();
  }
}
