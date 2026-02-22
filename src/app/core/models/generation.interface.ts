/**
 * Server-side generation types for the generation-service
 */

export type ServerProviderType = 'claude' | 'gemini' | 'openrouter' | 'ollama' | 'openai-compat';

export type ServerJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type ServerJobType = 'beat' | 'research-scene' | 'research-summary';

export interface ServerGenerationOptions {
  prompt: string;
  provider: ServerProviderType;
  model: string;
  maxTokens: number;
  temperature?: number;
  apiKey: string;
  providerUrl?: string;
  // Job type and grouping (for research jobs)
  jobType?: ServerJobType;     // Default: 'beat'
  groupId?: string;            // For research: groups scene jobs together
  sceneIndex?: number;         // For research: which scene (0-based)
  totalScenes?: number;        // For research: total scenes in group
  // Context
  beatId: string;
  storyId: string;
  chapterId?: string;
  sceneId?: string;
}

export interface ServerGenerationEvent {
  type: 'chunk' | 'complete' | 'error';
  text?: string;
  error?: string;
}

export interface ServerGenerationJob {
  id: string;
  clientId: string;
  status: ServerJobStatus;
  content?: string;
  error?: string;
  // Job type and grouping
  jobType?: ServerJobType;
  groupId?: string;
  sceneIndex?: number;
  totalScenes?: number;
  // Context
  beatId: string;
  storyId: string;
  chapterId?: string;
  sceneId?: string;
  createdAt: string;
  completedAt?: string;
}

export interface CreateJobResponse {
  jobId: string;
  status: ServerJobStatus;
}

export interface GetJobsResponse {
  jobs: ServerGenerationJob[];
}

export interface RateLimitError {
  error: string;
  message: string;
  existingJobId?: string;
}
