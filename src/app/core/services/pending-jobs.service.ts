import { Injectable, inject, OnDestroy } from '@angular/core';
import { BehaviorSubject, Observable, Subject, Subscription, firstValueFrom } from 'rxjs';
import { filter, map, take } from 'rxjs/operators';
import { ServerGenerationService } from './server-generation.service';
import { ServerGenerationJob } from '../models/generation.interface';

export interface RecoverableJob {
  job: ServerGenerationJob;
  canRecover: boolean;
  recoveryAction?: 'insert' | 'resume';
}

export interface StreamingEvent {
  beatId: string;
  chunk: string;
  isComplete: boolean;
  // Research job context
  groupId?: string;
  sceneIndex?: number;
  totalScenes?: number;
}

@Injectable({
  providedIn: 'root'
})
export class PendingJobsService implements OnDestroy {
  private readonly serverGeneration = inject(ServerGenerationService);

  private pendingJobsSubject = new BehaviorSubject<ServerGenerationJob[]>([]);
  private completedJobsSubject = new Subject<ServerGenerationJob>();
  private streamingEventSubject = new Subject<StreamingEvent>();
  private initialized = false;
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private streamSubscriptions = new Map<string, Subscription>();
  private isVisible = true;
  private boundHandleVisibilityChange = this.handleVisibilityChange.bind(this);

  /**
   * Observable of all pending/processing jobs
   */
  pendingJobs$ = this.pendingJobsSubject.asObservable();

  /**
   * Observable of jobs that just completed (for notification)
   */
  completedJobs$ = this.completedJobsSubject.asObservable();

  /**
   * Observable of streaming events from resumed server jobs.
   * Used by BeatAIService to forward events to the UI after page refresh.
   */
  streamingEvent$ = this.streamingEventSubject.asObservable();

  ngOnDestroy(): void {
    this.stopPolling();
    this.streamSubscriptions.forEach(sub => sub.unsubscribe());
    this.streamSubscriptions.clear();
    document.removeEventListener('visibilitychange', this.boundHandleVisibilityChange);
  }

  /**
   * Initialize the service and check for pending jobs
   * Call this early in app startup
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    // Set up visibility change listener for mobile battery optimization
    document.addEventListener('visibilitychange', this.boundHandleVisibilityChange);

    // Check if service is available
    const available = await this.serverGeneration.isServiceAvailable();
    if (!available) {
      console.log('[PendingJobs] Server generation service not available');
      return;
    }

    // Load existing jobs
    await this.refreshJobs();

    // Start polling for status updates (only if visible)
    if (this.isVisible) {
      this.startPolling();
    }
  }

  /**
   * Handle visibility change - pause polling when backgrounded for battery optimization
   */
  private handleVisibilityChange(): void {
    this.isVisible = !document.hidden;

    if (this.isVisible) {
      console.log('[PendingJobs] App visible - resuming polling');
      // Refresh immediately when becoming visible
      this.refreshJobs();
      // Resume polling
      if (!this.pollingInterval && this.initialized) {
        this.startPolling();
      }
      // Resume any paused streams
      const jobs = this.pendingJobsSubject.value;
      const activeJobs = jobs.filter(j => j.status === 'processing' || j.status === 'pending');
      activeJobs.forEach(job => this.resumeStreaming(job.id));
    } else {
      console.log('[PendingJobs] App hidden - pausing polling for battery optimization');
      // Stop polling when backgrounded
      this.stopPolling();
      // Pause stream subscriptions (server continues, we'll catch up on resume)
      this.streamSubscriptions.forEach(sub => sub.unsubscribe());
      this.streamSubscriptions.clear();
    }
  }

  /**
   * Refresh the list of jobs from server
   */
  async refreshJobs(): Promise<void> {
    try {
      const response = await firstValueFrom(this.serverGeneration.getPendingJobs());
      if (response) {
        const jobs = response.jobs;
        this.pendingJobsSubject.next(jobs);

        // Process any completed or failed jobs
        jobs.forEach(job => {
          if (job.status === 'completed') {
            this.completedJobsSubject.next(job);
          }
        });

        // Resume streaming for any processing jobs (only if visible)
        if (this.isVisible) {
          const processingJobs = jobs.filter(j => j.status === 'processing' || j.status === 'pending');
          processingJobs.forEach(job => this.resumeStreaming(job.id));
        }
      }
    } catch (error) {
      console.error('[PendingJobs] Failed to refresh jobs:', error);
    }
  }

  /**
   * Get pending jobs for a specific beat
   */
  getJobsForBeat(beatId: string): Observable<ServerGenerationJob[]> {
    return this.pendingJobs$.pipe(
      map(jobs => jobs.filter(j => j.beatId === beatId))
    );
  }

  /**
   * Get pending jobs for a specific story
   */
  getJobsForStory(storyId: string): Observable<ServerGenerationJob[]> {
    return this.pendingJobs$.pipe(
      map(jobs => jobs.filter(j => j.storyId === storyId))
    );
  }

  /**
   * Get the most recent completed job for a beat (for recovery)
   */
  getCompletedJobForBeat(beatId: string): Observable<ServerGenerationJob | null> {
    return this.pendingJobs$.pipe(
      map(jobs => {
        const completedJobs = jobs
          .filter(j => j.beatId === beatId && j.status === 'completed' && j.content)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return completedJobs[0] || null;
      })
    );
  }

  /**
   * Wait for a specific job to complete
   */
  waitForCompletion(jobId: string): Observable<ServerGenerationJob> {
    return this.completedJobs$.pipe(
      filter(job => job.id === jobId),
      take(1)
    );
  }

  /**
   * Resume streaming for a job (after page reload)
   */
  private resumeStreaming(jobId: string): void {
    // Don't resume if already streaming or attempting to stream
    if (this.streamSubscriptions.has(jobId)) return;

    // Get the job to access its beatId and group context
    const job = this.pendingJobsSubject.value.find(j => j.id === jobId);

    // Mark as "attempting" immediately to prevent duplicate requests during async gaps
    // This prevents race conditions when resumeStreaming is called multiple times
    // (e.g., from both handleVisibilityChange and refreshJobs)
    const placeholder = new Subscription();
    this.streamSubscriptions.set(jobId, placeholder);

    const subscription = this.serverGeneration.streamJob(jobId).subscribe({
      next: event => {
        if (event.type === 'chunk') {
          // Update accumulated content in local cache
          this.updateJobContent(jobId, event.text || '');
          // Forward streaming event to subscribers (for UI updates after refresh)
          if (job) {
            this.streamingEventSubject.next({
              beatId: job.beatId,
              chunk: event.text || '',
              isComplete: false,
              groupId: job.groupId,
              sceneIndex: job.sceneIndex,
              totalScenes: job.totalScenes
            });
          }
        } else if (event.type === 'complete') {
          this.markJobComplete(jobId);
          // Forward completion event to subscribers
          if (job) {
            this.streamingEventSubject.next({
              beatId: job.beatId,
              chunk: '',
              isComplete: true,
              groupId: job.groupId,
              sceneIndex: job.sceneIndex,
              totalScenes: job.totalScenes
            });
          }
        } else if (event.type === 'error') {
          this.markJobFailed(jobId, event.error);
          // Forward completion event on error too
          if (job) {
            this.streamingEventSubject.next({
              beatId: job.beatId,
              chunk: '',
              isComplete: true,
              groupId: job.groupId,
              sceneIndex: job.sceneIndex,
              totalScenes: job.totalScenes
            });
          }
        }
      },
      error: error => {
        console.error(`[PendingJobs] Stream error for job ${jobId}:`, error);
        this.markJobFailed(jobId, error.message);
        // Forward completion event on stream error
        if (job) {
          this.streamingEventSubject.next({
            beatId: job.beatId,
            chunk: '',
            isComplete: true,
            groupId: job.groupId,
            sceneIndex: job.sceneIndex,
            totalScenes: job.totalScenes
          });
        }
      },
      complete: () => {
        this.streamSubscriptions.delete(jobId);
      }
    });

    this.streamSubscriptions.set(jobId, subscription);
  }

  /**
   * Update job content in local cache
   */
  private updateJobContent(jobId: string, chunk: string): void {
    const jobs = this.pendingJobsSubject.value;
    const index = jobs.findIndex(j => j.id === jobId);
    if (index >= 0) {
      const updatedJobs = [...jobs];
      updatedJobs[index] = {
        ...updatedJobs[index],
        content: (updatedJobs[index].content || '') + chunk
      };
      this.pendingJobsSubject.next(updatedJobs);
    }
  }

  /**
   * Mark a job as completed
   */
  private markJobComplete(jobId: string): void {
    const jobs = this.pendingJobsSubject.value;
    const index = jobs.findIndex(j => j.id === jobId);
    if (index >= 0) {
      const updatedJobs = [...jobs];
      const completedJob = {
        ...updatedJobs[index],
        status: 'completed' as const,
        completedAt: new Date().toISOString()
      };
      updatedJobs[index] = completedJob;
      this.pendingJobsSubject.next(updatedJobs);
      this.completedJobsSubject.next(completedJob);
    }
  }

  /**
   * Mark a job as failed
   */
  private markJobFailed(jobId: string, error?: string): void {
    const jobs = this.pendingJobsSubject.value;
    const index = jobs.findIndex(j => j.id === jobId);
    if (index >= 0) {
      const updatedJobs = [...jobs];
      updatedJobs[index] = {
        ...updatedJobs[index],
        status: 'failed' as const,
        error: error,
        completedAt: new Date().toISOString()
      };
      this.pendingJobsSubject.next(updatedJobs);
    }
  }

  /**
   * Remove a job from the local cache
   */
  removeJob(jobId: string): void {
    const subscription = this.streamSubscriptions.get(jobId);
    if (subscription) {
      subscription.unsubscribe();
      this.streamSubscriptions.delete(jobId);
    }

    const jobs = this.pendingJobsSubject.value;
    this.pendingJobsSubject.next(jobs.filter(j => j.id !== jobId));
  }

  /**
   * Start polling for job status updates
   */
  private startPolling(): void {
    // Poll every 30 seconds
    this.pollingInterval = setInterval(() => {
      this.refreshJobs();
    }, 30000);
  }

  /**
   * Stop polling
   */
  private stopPolling(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  /**
   * Check if there are any active jobs
   */
  hasActiveJobs(): Observable<boolean> {
    return this.pendingJobs$.pipe(
      map(jobs => jobs.some(j => j.status === 'pending' || j.status === 'processing'))
    );
  }

  /**
   * Get count of active jobs
   */
  getActiveJobCount(): Observable<number> {
    return this.pendingJobs$.pipe(
      map(jobs => jobs.filter(j => j.status === 'pending' || j.status === 'processing').length)
    );
  }

  /**
   * Get jobs for a specific research group
   */
  getJobsForGroup(groupId: string): Observable<ServerGenerationJob[]> {
    return this.pendingJobs$.pipe(
      map(jobs => jobs
        .filter(j => j.groupId === groupId)
        .sort((a, b) => (a.sceneIndex ?? 0) - (b.sceneIndex ?? 0))
      )
    );
  }

  /**
   * Get all active research groups for this client
   * Returns an array of unique groupIds that have at least one active job
   */
  getActiveResearchGroups(): Observable<string[]> {
    return this.pendingJobs$.pipe(
      map(jobs => {
        const groupIds = new Set<string>();
        jobs.forEach(job => {
          if (job.groupId &&
              (job.jobType === 'research-scene' || job.jobType === 'research-summary') &&
              (job.status === 'pending' || job.status === 'processing')) {
            groupIds.add(job.groupId);
          }
        });
        return Array.from(groupIds);
      })
    );
  }

  /**
   * Get research group progress
   */
  getResearchGroupProgress(groupId: string): Observable<{
    completed: number;
    failed: number;
    total: number;
    findings: Map<number, string>;
  }> {
    return this.getJobsForGroup(groupId).pipe(
      map(jobs => {
        const sceneJobs = jobs.filter(j => j.jobType === 'research-scene');
        const total = sceneJobs.length > 0 ? (sceneJobs[0].totalScenes ?? sceneJobs.length) : 0;
        const completed = sceneJobs.filter(j => j.status === 'completed').length;
        const failed = sceneJobs.filter(j => j.status === 'failed').length;
        const findings = new Map<number, string>();
        sceneJobs.forEach(job => {
          if (job.status === 'completed' && job.content && job.sceneIndex !== undefined) {
            findings.set(job.sceneIndex, job.content);
          }
        });
        return { completed, failed, total, findings };
      })
    );
  }

  /**
   * Check if a research group has any active jobs
   */
  isResearchGroupActive(groupId: string): Observable<boolean> {
    return this.getJobsForGroup(groupId).pipe(
      map(jobs => jobs.some(j => j.status === 'pending' || j.status === 'processing'))
    );
  }
}
