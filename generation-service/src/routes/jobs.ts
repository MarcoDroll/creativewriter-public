import { Router, Request, Response } from 'express';
import { jobStore } from '../services/job-store';
import { getProvider } from '../services/providers';
import { CreateJobRequest, ProviderType } from '../types';

const router = Router();

/**
 * POST /api/generation/jobs - Create a new generation job
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body as CreateJobRequest;
    const jobType = body.jobType || 'beat';
    const isResearchJob = jobType === 'research-scene' || jobType === 'research-summary';

    // Validate required fields
    // Note: beatId is optional for research jobs (they use groupId instead)
    const missingFields: string[] = [];
    if (!body.clientId) missingFields.push('clientId');
    if (!body.apiKey) missingFields.push('apiKey');
    if (!body.prompt) missingFields.push('prompt');
    if (!body.provider) missingFields.push('provider');
    if (!body.model) missingFields.push('model');
    if (!body.storyId) missingFields.push('storyId');
    if (!isResearchJob && !body.beatId) missingFields.push('beatId');
    if (isResearchJob && !body.groupId) missingFields.push('groupId');

    if (missingFields.length > 0) {
      res.status(400).json({
        error: 'Bad request',
        message: `Missing required fields: ${missingFields.join(', ')}`
      });
      return;
    }

    // Validate maxTokens
    if (!body.maxTokens || body.maxTokens < 1 || body.maxTokens > 200000) {
      res.status(400).json({
        error: 'Bad request',
        message: 'maxTokens must be between 1 and 200000'
      });
      return;
    }

    // Validate provider type
    const validProviders: ProviderType[] = ['claude', 'gemini', 'openrouter', 'ollama', 'openai-compat'];
    if (!validProviders.includes(body.provider)) {
      res.status(400).json({
        error: 'Bad request',
        message: `Invalid provider. Must be one of: ${validProviders.join(', ')}`
      });
      return;
    }

    // Validate jobType if provided
    const validJobTypes = ['beat', 'research-scene', 'research-summary'];
    if (body.jobType && !validJobTypes.includes(body.jobType)) {
      res.status(400).json({
        error: 'Bad request',
        message: `Invalid jobType. Must be one of: ${validJobTypes.join(', ')}`
      });
      return;
    }

    // Create job
    const result = jobStore.createJob(body);

    if (result.error) {
      res.status(429).json({
        error: 'Rate limit exceeded',
        message: result.error,
        existingJobId: result.existingJobId
      });
      return;
    }

    const job = result.job!;
    console.log(`[Jobs] Created ${jobType} job ${job.id} for provider ${body.provider}${body.groupId ? ` (group: ${body.groupId})` : ''}`);

    res.status(201).json({
      jobId: job.id,
      status: job.status
    });

    // Start generation in background (don't await)
    startGeneration(job.id, body.apiKey).catch(err => {
      console.error(`[Jobs] Generation error for job ${job.id}:`, err);
    });

  } catch (error) {
    console.error('[Jobs] Error creating job:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/generation/jobs/:jobId/stream - SSE stream for job
 */
router.get('/:jobId/stream', async (req: Request, res: Response) => {
  const { jobId } = req.params;

  const job = jobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({
      error: 'Not found',
      message: 'Job not found'
    });
    return;
  }

  // Check if another stream is already active
  if (!jobStore.incrementStreamCount(jobId)) {
    res.status(409).json({
      error: 'Conflict',
      message: 'Another stream is already active for this job'
    });
    return;
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  // Send any existing content first (for recovery)
  if (job.content) {
    res.write(`data: ${JSON.stringify({ type: 'chunk', text: job.content })}\n\n`);
  }

  // If job is already completed or failed, send final event
  if (job.status === 'completed') {
    res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
    jobStore.decrementStreamCount(jobId);
    res.end();
    return;
  }

  if (job.status === 'failed') {
    res.write(`data: ${JSON.stringify({ type: 'error', error: job.error || 'Generation failed' })}\n\n`);
    jobStore.decrementStreamCount(jobId);
    res.end();
    return;
  }

  // Store the response for streaming chunks (using Map instead of global)
  jobStore.setStream(jobId, res);

  // Handle client disconnect
  req.on('close', () => {
    console.log(`[Jobs] Client disconnected from stream for job ${jobId}`);
    jobStore.deleteStream(jobId);
    jobStore.decrementStreamCount(jobId);
  });

  // Keep connection alive with periodic heartbeat
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(':heartbeat\n\n');
    } else {
      clearInterval(heartbeat);
    }
  }, 30000);

  // Clean up heartbeat when response ends
  res.on('close', () => {
    clearInterval(heartbeat);
  });
});

/**
 * GET /api/generation/jobs/:jobId - Get job status
 */
router.get('/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;

  const job = jobStore.getJob(jobId);
  if (!job) {
    res.status(404).json({
      error: 'Not found',
      message: 'Job not found'
    });
    return;
  }

  res.json(jobStore.toResponse(job));
});

/**
 * GET /api/generation/jobs - Get all jobs for a client (optionally filtered by groupId)
 */
router.get('/', (req: Request, res: Response) => {
  const { clientId, groupId } = req.query;

  if (!clientId || typeof clientId !== 'string') {
    res.status(400).json({
      error: 'Bad request',
      message: 'clientId query parameter is required'
    });
    return;
  }

  let jobs = jobStore.getJobsForClient(clientId);

  // Optional: filter by groupId
  if (groupId && typeof groupId === 'string') {
    jobs = jobs.filter(job => job.groupId === groupId);
  }

  res.json({
    jobs: jobs.map(job => jobStore.toResponse(job))
  });
});

/**
 * DELETE /api/generation/jobs/:jobId - Cancel a job
 */
router.delete('/:jobId', (req: Request, res: Response) => {
  const { jobId } = req.params;

  const success = jobStore.cancelJob(jobId);
  if (!success) {
    res.status(404).json({
      error: 'Not found',
      message: 'Job not found'
    });
    return;
  }

  // Send error event to any connected stream (using Map instead of global)
  const streamRes = jobStore.getStream(jobId);
  if (streamRes && !streamRes.writableEnded) {
    streamRes.write(`data: ${JSON.stringify({ type: 'error', error: 'Cancelled by client' })}\n\n`);
    streamRes.end();
  }
  jobStore.deleteStream(jobId);

  res.json({ success: true });
});

/**
 * Start generation for a job
 */
async function startGeneration(jobId: string, apiKey: string): Promise<void> {
  const job = jobStore.getJob(jobId);
  if (!job) {
    console.error(`[Jobs] Job ${jobId} not found for generation`);
    return;
  }

  // Create abort controller for this job
  const abortController = new AbortController();
  jobStore.setAbortController(jobId, abortController);

  // Update status to processing
  jobStore.updateJobStatus(jobId, 'processing');

  try {
    const provider = getProvider(job.provider);

    await provider.generate({
      apiKey,
      prompt: job.prompt,
      model: job.model,
      maxTokens: job.maxTokens,
      temperature: job.temperature,
      providerUrl: job.providerUrl,
      signal: abortController.signal,
      onChunk: (chunk: string) => {
        // Accumulate content for recovery
        jobStore.appendContent(jobId, chunk);

        // Send to connected stream if any (using Map instead of global)
        const streamRes = jobStore.getStream(jobId);
        if (streamRes && !streamRes.writableEnded) {
          streamRes.write(`data: ${JSON.stringify({ type: 'chunk', text: chunk })}\n\n`);
        }
      }
    });

    // Mark as completed
    jobStore.updateJobStatus(jobId, 'completed');

    // Send complete event (using Map instead of global)
    const streamRes = jobStore.getStream(jobId);
    if (streamRes && !streamRes.writableEnded) {
      streamRes.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
      streamRes.end();
    }

    console.log(`[Jobs] Job ${jobId} completed successfully`);

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Jobs] Job ${jobId} failed:`, errorMessage);

    // Mark as failed
    jobStore.updateJobStatus(jobId, 'failed', errorMessage);

    // Send error event (using Map instead of global)
    const streamRes = jobStore.getStream(jobId);
    if (streamRes && !streamRes.writableEnded) {
      streamRes.write(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`);
      streamRes.end();
    }
  } finally {
    // Clean up stream reference (using Map instead of global)
    jobStore.deleteStream(jobId);
  }
}

export default router;
