import { ProviderType } from './types';

export const config = {
  port: parseInt(process.env.PORT || '3004', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  geminiProxyUrl: process.env.GEMINI_PROXY_URL || 'http://gemini-proxy:3002',

  // Job settings
  jobTtlMs: 60 * 60 * 1000, // 1 hour
  cleanupIntervalMs: 60 * 1000, // 1 minute

  // Provider timeouts (in milliseconds)
  providerTimeouts: {
    'claude': 5 * 60 * 1000,         // 5 minutes
    'openrouter': 15 * 60 * 1000,    // 15 minutes (Reasoning Models)
    'gemini': 10 * 60 * 1000,        // 10 minutes
    'ollama': 20 * 60 * 1000,        // 20 minutes (local, variable)
    'openai-compat': 15 * 60 * 1000  // 15 minutes
  } as Record<ProviderType, number>,

  // Retry settings
  maxRetries: 3,
  retryBaseDelayMs: 1000,

  // CORS
  corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['*']
};
