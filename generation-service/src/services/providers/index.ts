import { ProviderType } from '../../types';
import { BaseProvider } from './base';
import { ClaudeProvider } from './claude';
import { OpenRouterProvider } from './openrouter';
import { GeminiProvider } from './gemini';
import { OllamaProvider } from './ollama';
import { OpenAICompatProvider } from './openai-compat';

const providers: Record<ProviderType, BaseProvider> = {
  'claude': new ClaudeProvider(),
  'openrouter': new OpenRouterProvider(),
  'gemini': new GeminiProvider(),
  'ollama': new OllamaProvider(),
  'openai-compat': new OpenAICompatProvider()
};

export function getProvider(type: ProviderType): BaseProvider {
  const provider = providers[type];
  if (!provider) {
    throw new Error(`Unknown provider type: ${type}`);
  }
  return provider;
}
