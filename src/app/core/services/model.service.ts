import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, BehaviorSubject, of, forkJoin } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import {
  OpenRouterModelsResponse,
  ReplicateCollectionResponse,
  ModelOption,
  OpenRouterModel,
  ReplicateModel
} from '../models/model.interface';
import { supportsReasoning, REASONING_SUFFIX, BETA_SUFFIX, ANTHROPIC_TOKENIZER, isBetaVariant, isReasoningVariant } from '../models/model-variants.config';
import { SettingsService } from './settings.service';
import { OllamaApiService, OllamaModelsResponse } from './ollama-api.service';
import { ClaudeApiService, ClaudeModel } from './claude-api.service';
import { OpenAICompatibleApiService, OpenAICompatibleModelsResponse } from './openai-compatible-api.service';

export interface OpenRouterProviderInfo {
  name: string;
  slug: string;
}

@Injectable({
  providedIn: 'root'
})
export class ModelService {
  private http = inject(HttpClient);
  private settingsService = inject(SettingsService);
  private ollamaApiService = inject(OllamaApiService);
  private claudeApiService = inject(ClaudeApiService);
  private openAICompatibleApiService = inject(OpenAICompatibleApiService);

  private readonly OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';
  private readonly REPLICATE_API_URL = '/api/replicate';
  private readonly USD_TO_EUR_RATE = 0.92; // Approximate rate, you might want to fetch this dynamically

  private openRouterModelsSubject = new BehaviorSubject<ModelOption[]>([]);
  private replicateModelsSubject = new BehaviorSubject<ModelOption[]>([]);
  private geminiModelsSubject = new BehaviorSubject<ModelOption[]>([]);
  private ollamaModelsSubject = new BehaviorSubject<ModelOption[]>([]);
  private claudeModelsSubject = new BehaviorSubject<ModelOption[]>([]);
  private openAICompatibleModelsSubject = new BehaviorSubject<ModelOption[]>([]);
  private openRouterProvidersSubject = new BehaviorSubject<OpenRouterProviderInfo[]>([]);
  private loadingSubject = new BehaviorSubject<boolean>(false);

  public openRouterModels$ = this.openRouterModelsSubject.asObservable();
  public openRouterProviders$ = this.openRouterProvidersSubject.asObservable();
  public replicateModels$ = this.replicateModelsSubject.asObservable();
  public geminiModels$ = this.geminiModelsSubject.asObservable();
  public ollamaModels$ = this.ollamaModelsSubject.asObservable();
  public claudeModels$ = this.claudeModelsSubject.asObservable();
  public openAICompatibleModels$ = this.openAICompatibleModelsSubject.asObservable();
  public loading$ = this.loadingSubject.asObservable();

  loadOpenRouterModels(): Observable<ModelOption[]> {
    const settings = this.settingsService.getSettings();
    
    if (!settings.openRouter.enabled || !settings.openRouter.apiKey) {
      return of([]);
    }

    this.loadingSubject.next(true);

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${settings.openRouter.apiKey}`,
      'Content-Type': 'application/json'
    });

    return this.http.get<OpenRouterModelsResponse>(`${this.OPENROUTER_API_URL}/models`, { headers })
      .pipe(
        map(response => this.transformOpenRouterModels(response.data)),
        tap(models => {
          this.openRouterModelsSubject.next(models);
          this.loadingSubject.next(false);
        }),
        catchError(error => {
          console.error('Failed to load OpenRouter models:', error);
          this.loadingSubject.next(false);
          return of([]);
        })
      );
  }

  loadOpenRouterProviders(): Observable<OpenRouterProviderInfo[]> {
    const settings = this.settingsService.getSettings();

    if (!settings.openRouter.enabled || !settings.openRouter.apiKey) {
      return of([]);
    }

    // Return cached providers if already loaded
    const cached = this.openRouterProvidersSubject.value;
    if (cached.length > 0) {
      return of(cached);
    }

    const headers = new HttpHeaders({
      'Authorization': `Bearer ${settings.openRouter.apiKey}`,
      'Content-Type': 'application/json'
    });

    return this.http.get<{ data: { id: string; name: string }[] }>(`${this.OPENROUTER_API_URL}/providers`, { headers })
      .pipe(
        map(response => (response.data || []).map(p => ({ name: p.name, slug: p.id }))),
        tap(providers => {
          this.openRouterProvidersSubject.next(providers);
        }),
        catchError(error => {
          console.error('Failed to load OpenRouter providers:', error);
          return of([]);
        })
      );
  }

  loadReplicateModels(): Observable<ModelOption[]> {
    const settings = this.settingsService.getSettings();

    if (!settings.replicate.enabled || !settings.replicate.apiKey) {
      return of([]);
    }

    this.loadingSubject.next(true);

    const headers = new HttpHeaders({
      'X-API-Token': settings.replicate.apiKey,
      'Content-Type': 'application/json'
    });

    // Load language models from Replicate's language-models collection
    return this.http.get<ReplicateCollectionResponse>(`${this.REPLICATE_API_URL}/collections/language-models`, { headers })
      .pipe(
        map(response => this.transformReplicateModels(response.models)),
        tap(models => {
          this.replicateModelsSubject.next(models);
          this.loadingSubject.next(false);
        }),
        catchError(error => {
          console.error('Failed to load Replicate models:', error);
          this.loadingSubject.next(false);
          return of([]);
        })
      );
  }

  loadGeminiModels(): Observable<ModelOption[]> {
    const settings = this.settingsService.getSettings();
    
    if (!settings.googleGemini.enabled || !settings.googleGemini.apiKey) {
      return of([]);
    }

    this.loadingSubject.next(true);

    // Gemini models are predefined since the API doesn't provide a models list endpoint
    const predefinedModels: ModelOption[] = [
      {
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        description: 'Google\'s fastest and most cost-effective model with multimodal capabilities',
        costInputEur: '0.07 €',
        costOutputEur: '0.21 €',
        contextLength: 1000000,
        provider: 'gemini'
      },
      {
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        description: 'Google\'s most capable model with advanced reasoning and multimodal capabilities',
        costInputEur: '3.50 €',
        costOutputEur: '10.50 €',
        contextLength: 2000000,
        provider: 'gemini'
      },
      {
        id: 'gemini-1.5-flash',
        label: 'Gemini 1.5 Flash',
        description: 'Fast and efficient model with good performance for most tasks',
        costInputEur: '0.07 €',
        costOutputEur: '0.21 €',
        contextLength: 1000000,
        provider: 'gemini'
      },
      {
        id: 'gemini-1.5-pro',
        label: 'Gemini 1.5 Pro',
        description: 'Advanced model with superior reasoning capabilities',
        costInputEur: '3.50 €',
        costOutputEur: '10.50 €',
        contextLength: 2000000,
        provider: 'gemini'
      }
    ];

    this.geminiModelsSubject.next(predefinedModels);
    this.loadingSubject.next(false);
    
    return of(predefinedModels);
  }

  loadOllamaModels(): Observable<ModelOption[]> {
    const settings = this.settingsService.getSettings();
    
    if (!settings.ollama.enabled || !settings.ollama.baseUrl) {
      return of([]);
    }

    this.loadingSubject.next(true);

    return this.ollamaApiService.listModels()
      .pipe(
        map(response => this.transformOllamaModels(response)),
        tap(models => {
          this.ollamaModelsSubject.next(models);
          this.loadingSubject.next(false);
        }),
        catchError(error => {
          console.error('Failed to load Ollama models:', error);
          this.loadingSubject.next(false);
          return of([]);
        })
      );
  }

  loadClaudeModels(): Observable<ModelOption[]> {
    const settings = this.settingsService.getSettings();
    
    if (!settings.claude.enabled || !settings.claude.apiKey) {
      return of([]);
    }

    this.loadingSubject.next(true);

    return this.claudeApiService.listModels().pipe(
      map(response => this.transformClaudeModels(response.data)),
      tap(models => {
        this.claudeModelsSubject.next(models);
        this.loadingSubject.next(false);
      }),
      catchError(error => {
        console.error('Failed to load Claude models:', error);
        this.loadingSubject.next(false);
        return of([]);
      })
    );
  }

  loadOpenAICompatibleModels(): Observable<ModelOption[]> {
    const settings = this.settingsService.getSettings();

    if (!settings.openAICompatible.enabled || !settings.openAICompatible.baseUrl) {
      return of([]);
    }

    this.loadingSubject.next(true);

    return this.openAICompatibleApiService.listModels().pipe(
      map(response => this.transformOpenAICompatibleModels(response)),
      tap(models => {
        this.openAICompatibleModelsSubject.next(models);
        this.loadingSubject.next(false);
      }),
      catchError(error => {
        console.error('Failed to load OpenAI-Compatible models:', error);
        this.loadingSubject.next(false);
        return of([]);
      })
    );
  }

  loadAllModels(): Observable<{ openRouter: ModelOption[], replicate: ModelOption[], gemini: ModelOption[], ollama: ModelOption[], claude: ModelOption[], openAICompatible: ModelOption[] }> {
    return forkJoin({
      openRouter: this.loadOpenRouterModels(),
      replicate: this.loadReplicateModels(),
      gemini: this.loadGeminiModels(),
      ollama: this.loadOllamaModels(),
      claude: this.loadClaudeModels(),
      openAICompatible: this.loadOpenAICompatibleModels()
    });
  }

  private transformOpenRouterModels(models: OpenRouterModel[]): ModelOption[] {

    // No filtering - show ALL models, let user search/filter in UI
    const baseModels: ModelOption[] = models.map(model => {
      const promptCostUsd = parseFloat(model.pricing.prompt || '0');
      const completionCostUsd = parseFloat(model.pricing.completion || '0');
      const hasReasoning = supportsReasoning(model.id);

      return {
        id: model.id,
        label: model.name,
        description: model.description,
        costInputEur: promptCostUsd > 0 ? this.formatCostInEur(promptCostUsd * 1000000) : 'N/A', // Per 1M tokens
        costOutputEur: completionCostUsd > 0 ? this.formatCostInEur(completionCostUsd * 1000000) : 'N/A', // Per 1M tokens
        contextLength: model.context_length || 0,
        provider: 'openrouter' as const,
        supportsReasoning: hasReasoning,
        isReasoningVariant: false,
        isModerated: model.top_provider?.is_moderated ?? false
      };
    });

    // Generate reasoning variants for capable models
    const reasoningVariants: ModelOption[] = baseModels
      .filter(model => model.supportsReasoning)
      .map(model => ({
        ...model,
        id: `${model.id}${REASONING_SUFFIX}`,
        label: `${model.label} (Reasoning)`,
        description: model.description
          ? `${model.description} - Extended reasoning mode.`
          : 'Extended reasoning mode for complex tasks.',
        supportsReasoning: false,  // This IS the reasoning mode, not a model that supports it
        isReasoningVariant: true,
        baseModelId: model.id
      }));

    // Generate beta (self-moderated) variants for moderated Anthropic models
    // Beta variants bypass OpenRouter's moderation, resulting in faster responses
    const betaVariants: ModelOption[] = models
      .filter(model =>
        model.architecture?.tokenizer === ANTHROPIC_TOKENIZER &&  // Anthropic models only
        model.top_provider?.is_moderated === true &&              // Has moderation to bypass
        !isBetaVariant(model.id) && !isReasoningVariant(model.id) // Not already a variant
      )
      .map(model => {
        const baseModel = baseModels.find(m => m.id === model.id);
        if (!baseModel) return null;
        return {
          ...baseModel,
          id: `${model.id}${BETA_SUFFIX}`,
          label: `${baseModel.label} (Self-moderated)`,
          description: baseModel.description
            ? `${baseModel.description} - Self-moderated: faster, no OpenRouter moderation.`
            : 'Self-moderated version with reduced latency.',
          isBetaVariant: true,
          baseModelId: model.id
        } as ModelOption;
      })
      .filter((model): model is ModelOption => model !== null);

    // Generate combined beta + reasoning variants for models that support both
    const betaReasoningVariants: ModelOption[] = betaVariants
      .filter(model => {
        // Find original base model to check if it supports reasoning
        const originalBase = baseModels.find(m => m.id === model.baseModelId);
        return originalBase?.supportsReasoning === true;
      })
      .map(model => ({
        ...model,
        id: `${model.id}${REASONING_SUFFIX}`,  // e.g., anthropic/claude-3.5-sonnet:beta:reasoning
        label: `${model.label.replace(' (Self-moderated)', '')} (Self-mod + Reasoning)`,
        description: model.description
          ? `${model.description.replace(' - Self-moderated: faster, no OpenRouter moderation.', '')} - Self-moderated with extended reasoning.`
          : 'Self-moderated version with extended reasoning mode.',
        isReasoningVariant: true,
        isBetaVariant: true  // Keep both flags
        // baseModelId remains pointing to original base (e.g., anthropic/claude-3.5-sonnet)
      }));

    // Combine base models with all variant types
    const allModels = [...baseModels, ...reasoningVariants, ...betaVariants, ...betaReasoningVariants];

    return allModels.sort((a, b) => {
      // Sort by popularity/brand first, then alphabetically
      const getPopularityScore = (label: string) => {
        const lowerLabel = label.toLowerCase();
        if (lowerLabel.includes('claude')) return 1;
        if (lowerLabel.includes('gpt-4')) return 2;
        if (lowerLabel.includes('gpt-3.5')) return 3;
        if (lowerLabel.includes('gemini')) return 4;
        if (lowerLabel.includes('llama')) return 5;
        return 10;
      };

      // Get base model ID for sorting (variants stay with their base)
      const baseIdA = a.baseModelId || a.id;
      const baseIdB = b.baseModelId || b.id;

      // If same base model, order: base → reasoning → beta → combined
      if (baseIdA === baseIdB) {
        const getVariantOrder = (model: ModelOption) => {
          if (!model.isReasoningVariant && !model.isBetaVariant) return 0; // Base model
          if (model.isReasoningVariant && !model.isBetaVariant) return 1;  // Reasoning only
          if (!model.isReasoningVariant && model.isBetaVariant) return 2;  // Beta only
          if (model.isReasoningVariant && model.isBetaVariant) return 3;   // Combined
          return 4;
        };
        return getVariantOrder(a) - getVariantOrder(b);
      }

      const scoreA = getPopularityScore(a.label);
      const scoreB = getPopularityScore(b.label);

      if (scoreA !== scoreB) {
        return scoreA - scoreB;
      }

      return a.label.localeCompare(b.label);
    });
  }

  private transformReplicateModels(models: ReplicateModel[]): ModelOption[] {
    // No filtering - show ALL public models, let user search/filter in UI
    return models
      .filter(model => model.visibility === 'public') // Only exclude private models
      .map(model => {
        // Replicate doesn't provide detailed pricing info via API
        // We'll show estimated costs based on typical Replicate pricing
        const estimatedCost = this.estimateReplicateCost(model.name);
        
        return {
          id: `${model.owner}/${model.name}`,
          label: `${model.owner}/${model.name}`,
          description: model.description,
          costInputEur: this.formatCostInEur(estimatedCost),
          costOutputEur: this.formatCostInEur(estimatedCost),
          contextLength: this.estimateContextLength(model.name),
          provider: 'replicate' as const
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  private transformOllamaModels(response: OllamaModelsResponse): ModelOption[] {
    return response.models
      .map(model => ({
        id: model.name,
        label: model.name,
        description: this.generateOllamaModelDescription(model),
        costInputEur: 'Free',
        costOutputEur: 'Free',
        contextLength: this.estimateOllamaContextLength(model.name),
        provider: 'ollama' as const
      }))
      .sort((a, b) => {
        // Sort by model family and size
        const getModelPriority = (name: string) => {
          const lowerName = name.toLowerCase();
          if (lowerName.includes('llama')) return 1;
          if (lowerName.includes('mistral')) return 2;
          if (lowerName.includes('codellama')) return 3;
          if (lowerName.includes('qwen')) return 4;
          if (lowerName.includes('gemma')) return 5;
          return 10;
        };
        
        const priorityA = getModelPriority(a.label);
        const priorityB = getModelPriority(b.label);
        
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        
        return a.label.localeCompare(b.label);
      });
  }

  private transformClaudeModels(models: ClaudeModel[]): ModelOption[] {
    return models
      .map(model => ({
        id: model.id,
        label: model.display_name,
        description: this.generateClaudeModelDescription(model.id),
        costInputEur: this.estimateClaudeCostInput(model.id),
        costOutputEur: this.estimateClaudeCostOutput(model.id),
        contextLength: this.estimateClaudeContextLength(model.id),
        provider: 'claude' as const
      }))
      .sort((a, b) => {
        // Sort by model generation and tier (newer first, then by tier)
        const getModelPriority = (id: string) => {
          const lowerName = id.toLowerCase();
          if (lowerName.includes('claude-4') || lowerName.includes('sonnet-4') || lowerName.includes('opus-4')) {
            if (lowerName.includes('opus')) return 1; // Opus 4 first
            if (lowerName.includes('sonnet')) return 2; // Sonnet 4 second
            return 3; // Other Claude 4 models
          } else if (lowerName.includes('claude-3')) {
            if (lowerName.includes('opus')) return 4; // Claude 3 Opus
            if (lowerName.includes('sonnet')) return 5; // Claude 3 Sonnet
            if (lowerName.includes('haiku')) return 6; // Claude 3 Haiku
            return 7; // Other Claude 3 models
          }
          return 10; // Older models
        };
        
        const priorityA = getModelPriority(a.id);
        const priorityB = getModelPriority(b.id);
        
        if (priorityA !== priorityB) {
          return priorityA - priorityB;
        }
        
        return a.label.localeCompare(b.label);
      });
  }

  private transformOpenAICompatibleModels(response: OpenAICompatibleModelsResponse): ModelOption[] {
    return response.data
      .map(model => ({
        id: model.id,
        label: model.id,
        description: 'Local OpenAI-compatible model',
        costInputEur: 'Free',
        costOutputEur: 'Free',
        contextLength: this.estimateOpenAICompatibleContextLength(model.id),
        provider: 'openaiCompatible' as const
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  private estimateOpenAICompatibleContextLength(modelId: string): number {
    const lowerName = modelId.toLowerCase();

    // Context length estimates based on common model families
    if (lowerName.includes('llama-3') || lowerName.includes('llama3')) {
      return 128000;
    } else if (lowerName.includes('llama-2') || lowerName.includes('llama2')) {
      return 4000;
    } else if (lowerName.includes('mistral')) {
      return 32000;
    } else if (lowerName.includes('mixtral')) {
      return 32000;
    } else if (lowerName.includes('qwen')) {
      return 32000;
    } else if (lowerName.includes('gemma')) {
      return 8000;
    } else if (lowerName.includes('phi')) {
      return 4000;
    }

    // Default context length for unknown models
    return 4000;
  }

  private generateClaudeModelDescription(modelId: string): string {
    const lowerName = modelId.toLowerCase();
    
    if (lowerName.includes('claude-4') || lowerName.includes('sonnet-4') || lowerName.includes('opus-4')) {
      if (lowerName.includes('opus')) {
        return 'Most capable Claude model with superior reasoning and complex task handling';
      } else if (lowerName.includes('sonnet')) {
        return 'High-performance model with excellent reasoning and efficiency';
      }
      return 'Advanced Claude 4 model with enhanced capabilities';
    } else if (lowerName.includes('claude-3')) {
      if (lowerName.includes('opus')) {
        return 'Powerful model for complex analysis and creative tasks';
      } else if (lowerName.includes('sonnet')) {
        return 'Balanced model with strong performance across all capabilities';
      } else if (lowerName.includes('haiku')) {
        return 'Fast and affordable model for routine tasks';
      }
      return 'Claude 3 series model with strong capabilities';
    }
    
    return 'Claude AI model for text generation and analysis';
  }

  private estimateClaudeCostInput(modelId: string): string {
    const lowerName = modelId.toLowerCase();
    
    // Current Claude pricing (approximated in EUR)
    if (lowerName.includes('claude-4') || lowerName.includes('opus-4')) {
      return '13.80 €'; // Opus pricing tier
    } else if (lowerName.includes('sonnet-4') || (lowerName.includes('claude-4') && lowerName.includes('sonnet'))) {
      return '2.76 €'; // Sonnet 4 pricing
    } else if (lowerName.includes('haiku') && lowerName.includes('3.5')) {
      return '0.92 €'; // Claude 3.5 Haiku
    } else if (lowerName.includes('sonnet') && lowerName.includes('3.5')) {
      return '2.76 €'; // Claude 3.5 Sonnet
    } else if (lowerName.includes('opus') && lowerName.includes('3')) {
      return '13.80 €'; // Claude 3 Opus
    } else if (lowerName.includes('sonnet') && lowerName.includes('3')) {
      return '2.76 €'; // Claude 3 Sonnet
    } else if (lowerName.includes('haiku') && lowerName.includes('3')) {
      return '0.23 €'; // Claude 3 Haiku
    }
    
    return '2.76 €'; // Default to Sonnet pricing
  }

  private estimateClaudeCostOutput(modelId: string): string {
    const lowerName = modelId.toLowerCase();
    
    // Current Claude pricing (approximated in EUR)
    if (lowerName.includes('claude-4') || lowerName.includes('opus-4')) {
      return '69.00 €'; // Opus pricing tier
    } else if (lowerName.includes('sonnet-4') || (lowerName.includes('claude-4') && lowerName.includes('sonnet'))) {
      return '13.80 €'; // Sonnet 4 pricing
    } else if (lowerName.includes('haiku') && lowerName.includes('3.5')) {
      return '4.60 €'; // Claude 3.5 Haiku
    } else if (lowerName.includes('sonnet') && lowerName.includes('3.5')) {
      return '13.80 €'; // Claude 3.5 Sonnet
    } else if (lowerName.includes('opus') && lowerName.includes('3')) {
      return '69.00 €'; // Claude 3 Opus
    } else if (lowerName.includes('sonnet') && lowerName.includes('3')) {
      return '13.80 €'; // Claude 3 Sonnet
    } else if (lowerName.includes('haiku') && lowerName.includes('3')) {
      return '1.15 €'; // Claude 3 Haiku
    }
    
    return '13.80 €'; // Default to Sonnet pricing
  }

  private estimateClaudeContextLength(modelId: string): number {
    // Most Claude models support 200K tokens, with some supporting up to 1M
    const lowerName = modelId.toLowerCase();
    
    if (lowerName.includes('claude-4') && lowerName.includes('sonnet')) {
      return 1000000; // Claude 4 Sonnet can support 1M tokens with beta header
    }
    
    return 200000; // Default context length for Claude models
  }

  private generateOllamaModelDescription(model: { details?: { parameter_size?: string; quantization_level?: string }; size: number }): string {
    let description = `Local Ollama model`;
    
    if (model.details) {
      const details = model.details;
      if (details.parameter_size) {
        description += ` (${details.parameter_size})`;
      }
      if (details.quantization_level) {
        description += ` - ${details.quantization_level}`;
      }
    }
    
    // Convert size to human-readable format
    const sizeGB = (model.size / (1024 * 1024 * 1024)).toFixed(1);
    description += ` - ${sizeGB}GB`;
    
    return description;
  }

  private estimateOllamaContextLength(modelName: string): number {
    const lowerName = modelName.toLowerCase();
    
    // Context length estimates based on model families
    if (lowerName.includes('llama3') || lowerName.includes('llama-3')) {
      return 128000; // Llama 3 typically supports 128K
    } else if (lowerName.includes('llama2') || lowerName.includes('llama-2')) {
      return 4000; // Llama 2 typically 4K
    } else if (lowerName.includes('codellama')) {
      return 16000; // CodeLlama typically 16K
    } else if (lowerName.includes('mistral')) {
      return 32000; // Mistral typically 32K
    } else if (lowerName.includes('qwen')) {
      return 32000; // Qwen typically 32K
    } else if (lowerName.includes('gemma')) {
      return 8000; // Gemma typically 8K
    }
    
    // Default context length
    return 4000;
  }

  private formatCostInEur(costUsdPer1M: number): string {
    const costEurPer1M = costUsdPer1M * this.USD_TO_EUR_RATE;
    if (costEurPer1M < 0.01) {
      return '< 0.01 €';
    }
    return `${costEurPer1M.toFixed(2)} €`;
  }

  private estimateReplicateCost(modelName: string): number {
    // Rough estimates based on model size and typical Replicate pricing
    const lowerName = modelName.toLowerCase();
    
    if (lowerName.includes('70b') || lowerName.includes('65b')) {
      return 50; // ~50 USD per 1M tokens for large models
    } else if (lowerName.includes('13b') || lowerName.includes('7b')) {
      return 20; // ~20 USD per 1M tokens for medium models
    } else if (lowerName.includes('3b') || lowerName.includes('1b')) {
      return 5; // ~5 USD per 1M tokens for small models
    }
    
    return 25; // Default estimate
  }

  private estimateContextLength(modelName: string): number {
    const lowerName = modelName.toLowerCase();
    
    if (lowerName.includes('32k')) return 32000;
    if (lowerName.includes('16k')) return 16000;
    if (lowerName.includes('8k')) return 8000;
    if (lowerName.includes('4k')) return 4000;
    
    // Default context lengths based on model families
    if (lowerName.includes('llama-2')) return 4000;
    if (lowerName.includes('llama-3')) return 8000;
    if (lowerName.includes('mistral')) return 8000;
    if (lowerName.includes('code')) return 16000;
    
    return 4000; // Default
  }

  getCurrentOpenRouterModels(): ModelOption[] {
    return this.openRouterModelsSubject.value;
  }

  getCurrentReplicateModels(): ModelOption[] {
    return this.replicateModelsSubject.value;
  }

  getCurrentGeminiModels(): ModelOption[] {
    return this.geminiModelsSubject.value;
  }

  getCurrentOllamaModels(): ModelOption[] {
    return this.ollamaModelsSubject.value;
  }

  getCurrentOpenAICompatibleModels(): ModelOption[] {
    return this.openAICompatibleModelsSubject.value;
  }

  /**
   * Get available models based on the currently active API
   */
  getAvailableModels(): Observable<ModelOption[]> {
    const settings = this.settingsService.getSettings();
    
    if (settings.ollama.enabled && settings.ollama.baseUrl) {
      return this.loadOllamaModels();
    } else if (settings.googleGemini.enabled && settings.googleGemini.apiKey) {
      return this.loadGeminiModels();
    } else if (settings.openRouter.enabled && settings.openRouter.apiKey) {
      return this.loadOpenRouterModels();
    } else if (settings.replicate.enabled && settings.replicate.apiKey) {
      return this.loadReplicateModels();
    }
    
    return of([]);
  }

  /**
   * Get combined models from both OpenRouter and Gemini APIs
   */
  getCombinedModels(): Observable<ModelOption[]> {
    const settings = this.settingsService.getSettings();
    const modelsToLoad: Observable<ModelOption[]>[] = [];
    
    if (settings.openRouter.enabled && settings.openRouter.apiKey) {
      modelsToLoad.push(this.loadOpenRouterModels());
    }
    
    if (settings.googleGemini.enabled && settings.googleGemini.apiKey) {
      modelsToLoad.push(this.loadGeminiModels());
    }
    
    if (settings.replicate.enabled && settings.replicate.apiKey) {
      modelsToLoad.push(this.loadReplicateModels());
    }
    
    if (settings.ollama.enabled && settings.ollama.baseUrl) {
      modelsToLoad.push(this.loadOllamaModels());
    }
    
    if (settings.claude.enabled && settings.claude.apiKey) {
      modelsToLoad.push(this.loadClaudeModels());
    }

    if (settings.openAICompatible.enabled && settings.openAICompatible.baseUrl) {
      modelsToLoad.push(this.loadOpenAICompatibleModels());
    }

    if (modelsToLoad.length === 0) {
      return of([]);
    }

    return forkJoin(modelsToLoad).pipe(
      map(results => {
        // Flatten and combine all models
        const allModels = results.flat();
        
        // Add provider prefix to model IDs to ensure uniqueness
        return allModels.map(model => ({
          ...model,
          id: `${model.provider}:${model.id}`
        }));
      })
    );
  }

  /**
   * Get currently loaded models based on the active API
   */
  getCurrentAvailableModels(): ModelOption[] {
    const settings = this.settingsService.getSettings();
    
    if (settings.ollama.enabled && settings.ollama.baseUrl) {
      return this.getCurrentOllamaModels();
    } else if (settings.googleGemini.enabled && settings.googleGemini.apiKey) {
      return this.getCurrentGeminiModels();
    } else if (settings.openRouter.enabled && settings.openRouter.apiKey) {
      return this.getCurrentOpenRouterModels();
    } else if (settings.replicate.enabled && settings.replicate.apiKey) {
      return this.getCurrentReplicateModels();
    }
    
    return [];
  }

  /**
   * Get currently loaded combined models from both APIs
   */
  getCurrentCombinedModels(): ModelOption[] {
    const settings = this.settingsService.getSettings();
    const allModels: ModelOption[] = [];
    
    if (settings.openRouter.enabled && settings.openRouter.apiKey) {
      const openRouterModels = this.getCurrentOpenRouterModels().map(model => ({
        ...model,
        id: `openrouter:${model.id}`
      }));
      allModels.push(...openRouterModels);
    }
    
    if (settings.googleGemini.enabled && settings.googleGemini.apiKey) {
      const geminiModels = this.getCurrentGeminiModels().map(model => ({
        ...model,
        id: `gemini:${model.id}`
      }));
      allModels.push(...geminiModels);
    }
    
    if (settings.replicate.enabled && settings.replicate.apiKey) {
      const replicateModels = this.getCurrentReplicateModels().map(model => ({
        ...model,
        id: `replicate:${model.id}`
      }));
      allModels.push(...replicateModels);
    }
    
    if (settings.ollama.enabled && settings.ollama.baseUrl) {
      const ollamaModels = this.getCurrentOllamaModels().map(model => ({
        ...model,
        id: `ollama:${model.id}`
      }));
      allModels.push(...ollamaModels);
    }

    if (settings.openAICompatible.enabled && settings.openAICompatible.baseUrl) {
      const openAICompatibleModels = this.getCurrentOpenAICompatibleModels().map(model => ({
        ...model,
        id: `openaiCompatible:${model.id}`
      }));
      allModels.push(...openAICompatibleModels);
    }

    return allModels;
  }
}