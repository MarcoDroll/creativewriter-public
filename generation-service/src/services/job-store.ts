import { v4 as uuidv4 } from 'uuid';
import { Job, CreateJobRequest, JobResponse, JobType } from '../types';
import { config } from '../config';

class JobStore {
  private jobs: Map<string, Job> = new Map();
  private activeStreams: Map<string, import('express').Response> = new Map();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startCleanup();
  }

  /**
   * Create a new job.
   * Rate limiting:
   * - Beat jobs: One active job per client (original behavior)
   * - Research jobs: One active research GROUP per client (multiple scene jobs allowed in same group)
   */
  createJob(request: CreateJobRequest): { job?: Job; error?: string; existingJobId?: string } {
    const jobType: JobType = request.jobType || 'beat';
    const isResearchJob = jobType === 'research-scene' || jobType === 'research-summary';

    if (isResearchJob && request.groupId) {
      // For research jobs: check if client has an active research group that doesn't match
      const existingResearchGroup = this.getActiveResearchGroupForClient(request.clientId);
      if (existingResearchGroup && existingResearchGroup !== request.groupId) {
        // Find any job from the existing group to return its ID
        const existingGroupJob = this.getJobsForGroup(existingResearchGroup)[0];
        return {
          error: 'Rate limit exceeded - another research group is active',
          existingJobId: existingGroupJob?.id
        };
      }
      // Allow job creation if it's part of the same group
    } else {
      // For beat jobs: check for existing active job from this client (original behavior)
      const existingJob = this.getActiveJobForClient(request.clientId);
      if (existingJob) {
        return {
          error: 'Rate limit exceeded',
          existingJobId: existingJob.id
        };
      }
    }

    const now = new Date();
    const job: Job = {
      id: uuidv4(),
      clientId: request.clientId,
      status: 'pending',
      prompt: request.prompt,
      provider: request.provider,
      model: request.model,
      maxTokens: request.maxTokens,
      temperature: request.temperature,
      providerUrl: request.providerUrl,
      content: '',
      jobType,
      groupId: request.groupId,
      sceneIndex: request.sceneIndex,
      totalScenes: request.totalScenes,
      beatId: request.beatId,
      storyId: request.storyId,
      chapterId: request.chapterId,
      sceneId: request.sceneId,
      createdAt: now,
      expiresAt: new Date(now.getTime() + config.jobTtlMs),
      activeStreamCount: 0
    };

    this.jobs.set(job.id, job);
    console.log(`[JobStore] Created ${jobType} job ${job.id} for client ${request.clientId}${request.groupId ? ` (group: ${request.groupId})` : ''}`);
    return { job };
  }

  /**
   * Get a job by ID
   */
  getJob(jobId: string): Job | undefined {
    return this.jobs.get(jobId);
  }

  /**
   * Get all jobs for a client
   */
  getJobsForClient(clientId: string): Job[] {
    const jobs: Job[] = [];
    this.jobs.forEach(job => {
      if (job.clientId === clientId) {
        jobs.push(job);
      }
    });
    return jobs;
  }

  /**
   * Get active job (pending or processing) for a client (beat jobs only)
   */
  getActiveJobForClient(clientId: string): Job | undefined {
    for (const job of this.jobs.values()) {
      if (job.clientId === clientId &&
          job.jobType === 'beat' &&
          (job.status === 'pending' || job.status === 'processing')) {
        return job;
      }
    }
    return undefined;
  }

  /**
   * Get all jobs for a specific research group
   */
  getJobsForGroup(groupId: string): Job[] {
    const jobs: Job[] = [];
    this.jobs.forEach(job => {
      if (job.groupId === groupId) {
        jobs.push(job);
      }
    });
    return jobs.sort((a, b) => (a.sceneIndex ?? 0) - (b.sceneIndex ?? 0));
  }

  /**
   * Get the active research group ID for a client (if any)
   * Returns the groupId if there's an active research job group
   */
  getActiveResearchGroupForClient(clientId: string): string | undefined {
    for (const job of this.jobs.values()) {
      if (job.clientId === clientId &&
          job.groupId &&
          (job.jobType === 'research-scene' || job.jobType === 'research-summary') &&
          (job.status === 'pending' || job.status === 'processing')) {
        return job.groupId;
      }
    }
    return undefined;
  }

  /**
   * Update job status
   */
  updateJobStatus(jobId: string, status: Job['status'], error?: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.status = status;
      if (status === 'completed' || status === 'failed') {
        job.completedAt = new Date();
      }
      if (error) {
        job.error = error;
      }
      console.log(`[JobStore] Job ${jobId} status updated to ${status}`);
    }
  }

  /**
   * Append content to job
   */
  appendContent(jobId: string, chunk: string): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.content += chunk;
    }
  }

  /**
   * Set abort controller for job
   */
  setAbortController(jobId: string, controller: AbortController): void {
    const job = this.jobs.get(jobId);
    if (job) {
      job.abortController = controller;
    }
  }

  /**
   * Increment active stream count.
   * If there's already an active stream, close it first (handles stale connections
   * from browser refresh/close where disconnect wasn't properly detected).
   */
  incrementStreamCount(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (job) {
      // If there's already an active stream, close it (stale connection cleanup)
      if (job.activeStreamCount > 0) {
        const existingStream = this.activeStreams.get(jobId);
        if (existingStream) {
          console.log(`[JobStore] Closing stale stream for job ${jobId} to allow new connection`);
          try {
            if (!existingStream.writableEnded) {
              existingStream.end();
            }
          } catch {
            // Stream already closed, ignore
          }
          this.activeStreams.delete(jobId);
        }
        job.activeStreamCount = 0;
      }
      job.activeStreamCount++;
      return true;
    }
    return false;
  }

  /**
   * Decrement active stream count
   */
  decrementStreamCount(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (job && job.activeStreamCount > 0) {
      job.activeStreamCount--;
    }
  }

  /**
   * Cancel a job (marks as failed, aborts request)
   */
  cancelJob(jobId: string): boolean {
    const job = this.jobs.get(jobId);
    if (job) {
      // Abort any ongoing request
      if (job.abortController) {
        job.abortController.abort();
      }
      job.status = 'failed';
      job.error = 'Cancelled by client';
      job.completedAt = new Date();
      console.log(`[JobStore] Job ${jobId} cancelled`);
      return true;
    }
    return false;
  }

  /**
   * Set stream response for a job
   */
  setStream(jobId: string, res: import('express').Response): void {
    this.activeStreams.set(jobId, res);
  }

  /**
   * Get stream response for a job
   */
  getStream(jobId: string): import('express').Response | undefined {
    return this.activeStreams.get(jobId);
  }

  /**
   * Delete stream for a job
   */
  deleteStream(jobId: string): void {
    this.activeStreams.delete(jobId);
  }

  /**
   * Get count of active jobs
   */
  getActiveJobCount(): number {
    let count = 0;
    this.jobs.forEach(job => {
      if (job.status === 'pending' || job.status === 'processing') {
        count++;
      }
    });
    return count;
  }

  /**
   * Convert job to response format
   */
  toResponse(job: Job): JobResponse {
    return {
      id: job.id,
      clientId: job.clientId,
      status: job.status,
      content: job.content || undefined,
      error: job.error,
      jobType: job.jobType,
      groupId: job.groupId,
      sceneIndex: job.sceneIndex,
      totalScenes: job.totalScenes,
      beatId: job.beatId,
      storyId: job.storyId,
      chapterId: job.chapterId,
      sceneId: job.sceneId,
      createdAt: job.createdAt.toISOString(),
      completedAt: job.completedAt?.toISOString()
    };
  }

  /**
   * Start periodic cleanup of expired jobs
   */
  private startCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      const now = new Date();
      let cleanedCount = 0;

      this.jobs.forEach((job, id) => {
        if (job.expiresAt < now) {
          // Abort any ongoing request before deleting
          if (job.abortController) {
            job.abortController.abort();
          }
          this.jobs.delete(id);
          cleanedCount++;
        }
      });

      if (cleanedCount > 0) {
        console.log(`[JobStore] Cleaned up ${cleanedCount} expired jobs`);
      }
    }, config.cleanupIntervalMs);
  }

  /**
   * Stop cleanup interval (for graceful shutdown)
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// Export singleton instance
export const jobStore = new JobStore();
