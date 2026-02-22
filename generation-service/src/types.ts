export type ProviderType = 'claude' | 'gemini' | 'openrouter' | 'ollama' | 'openai-compat';

export type JobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export type JobType = 'beat' | 'research-scene' | 'research-summary';

export interface Job {
  id: string;
  clientId: string;
  status: JobStatus;
  prompt: string;
  provider: ProviderType;
  model: string;
  maxTokens: number;
  temperature?: number;
  providerUrl?: string;
  content: string; // Accumulated content for recovery
  error?: string;
  // Job type (default: 'beat')
  jobType: JobType;
  // Research job grouping - multiple scene jobs share the same groupId
  groupId?: string;
  sceneIndex?: number;  // 0-based index within the research group
  totalScenes?: number; // Total number of scenes in the research group
  // Context for recovery
  beatId: string;
  storyId: string;
  chapterId?: string;
  sceneId?: string;
  // Timestamps
  createdAt: Date;
  completedAt?: Date;
  expiresAt: Date;
  // Streaming state
  activeStreamCount: number;
  abortController?: AbortController;
}

export interface CreateJobRequest {
  clientId: string;
  apiKey: string;
  prompt: string;
  provider: ProviderType;
  model: string;
  maxTokens: number;
  temperature?: number;
  providerUrl?: string;
  // Job type and grouping (for research jobs)
  jobType?: JobType;     // Default: 'beat'
  groupId?: string;      // For research: groups scene jobs together
  sceneIndex?: number;   // For research: which scene (0-based)
  totalScenes?: number;  // For research: total scenes in group
  // Context
  beatId: string;
  storyId: string;
  chapterId?: string;
  sceneId?: string;
}

export interface JobResponse {
  id: string;
  clientId: string;
  status: JobStatus;
  content?: string;
  error?: string;
  // Job type and grouping
  jobType: JobType;
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

export interface StreamEvent {
  type: 'chunk' | 'complete' | 'error';
  text?: string;
  error?: string;
}

export interface ProviderOptions {
  apiKey: string;
  prompt: string;
  model: string;
  maxTokens: number;
  temperature?: number;
  providerUrl?: string;
  signal?: AbortSignal;
  onChunk: (chunk: string) => void;
}

export interface HealthResponse {
  status: 'ok';
  uptime: number;
  activeJobs: number;
}
