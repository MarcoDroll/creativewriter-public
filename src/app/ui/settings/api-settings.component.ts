import { Component, Input, Output, EventEmitter, inject, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonAccordion, IonAccordionGroup, IonBadge,
  IonInput, IonToggle, IonItem, IonLabel,
  IonSelect, IonSelectOption, IonButton, IonIcon
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { shieldOutline, imageOutline, listOutline, logoGoogle, checkmarkCircle, serverOutline, warningOutline } from 'ionicons/icons';
import { NgSelectModule } from '@ng-select/ng-select';
import { Settings } from '../../core/models/settings.interface';
import { ModelOption } from '../../core/models/model.interface';
import { OllamaApiService } from '../../core/services/ollama-api.service';
import { ClaudeApiService } from '../../core/services/claude-api.service';
import { OpenAICompatibleApiService } from '../../core/services/openai-compatible-api.service';
import { ModelService, OpenRouterProviderInfo } from '../../core/services/model.service';
import { ProviderIconComponent } from '../../shared/components/provider-icon/provider-icon.component';
import { getProviderIcon as getIcon, getProviderTooltip as getTooltip } from '../../core/provider-icons';

@Component({
  selector: 'app-api-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule, NgSelectModule,
    IonAccordion, IonAccordionGroup, IonBadge,
    IonInput, IonToggle, IonItem, IonLabel,
    IonSelect, IonSelectOption, IonButton, IonIcon,
    ProviderIconComponent
  ],
  templateUrl: './api-settings.component.html',
  styleUrls: ['./api-settings.component.scss']
})
export class ApiSettingsComponent implements OnDestroy {
  private ollamaApiService = inject(OllamaApiService);
  private claudeApiService = inject(ClaudeApiService);
  private openAICompatibleApiService = inject(OpenAICompatibleApiService);
  private modelService = inject(ModelService);
  private subscriptions = new Subscription();

  constructor() {
    addIcons({ shieldOutline, imageOutline, listOutline, logoGoogle, checkmarkCircle, serverOutline, warningOutline });
  }

  @Input() settings!: Settings;
  @Input() combinedModels: ModelOption[] = [];
  @Input() replicateModels: ModelOption[] = [];
  @Input() loadingModels = false;
  @Input() modelLoadError: string | null = null;

  @Output() settingsChange = new EventEmitter<void>();
  @Output() modelsLoaded = new EventEmitter<ModelOption[]>();

  testingOllamaConnection = false;
  ollamaConnectionStatus: 'success' | 'error' | null = null;
  testingClaudeConnection = false;
  claudeConnectionStatus: 'success' | 'error' | null = null;
  testingOpenAICompatibleConnection = false;
  openAICompatibleConnectionStatus: 'success' | 'error' | null = null;
  openRouterProviders: OpenRouterProviderInfo[] = [];
  loadingProviders = false;

  formatContextLength(length: number): string {
    if (length >= 1000000) {
      return `${(length / 1000000).toFixed(1)}M`;
    } else if (length >= 1000) {
      return `${(length / 1000).toFixed(0)}K`;
    }
    return length.toString();
  }

  loadCombinedModels(): void {
    this.subscriptions.add(
      this.modelService.getCombinedModels().subscribe({
        next: (models) => {
          this.modelsLoaded.emit(models);
        },
        error: (error) => {
          console.error('Failed to load combined models:', error);
        }
      })
    );
  }

  loadReplicateModels(): void {
    this.subscriptions.add(
      this.modelService.loadReplicateModels().subscribe()
    );
  }

  loadOpenRouterProviders(): void {
    this.loadingProviders = true;
    this.subscriptions.add(
      this.modelService.loadOpenRouterProviders().subscribe({
        next: (providers) => {
          this.openRouterProviders = providers;
          this.loadingProviders = false;
        },
        error: () => {
          this.loadingProviders = false;
        }
      })
    );
  }

  onGlobalModelChange(): void {
    // Update the individual API model settings based on the selected model
    if (this.settings.selectedModel) {
      const [provider, ...modelIdParts] = this.settings.selectedModel.split(':');
      const modelId = modelIdParts.join(':'); // Rejoin in case model ID contains colons

      if (provider === 'openrouter') {
        this.settings.openRouter.model = modelId;
      } else if (provider === 'gemini') {
        this.settings.googleGemini.model = modelId;
      } else if (provider === 'claude') {
        this.settings.claude.model = modelId;
      } else if (provider === 'ollama') {
        this.settings.ollama.model = modelId;
      } else if (provider === 'replicate') {
        this.settings.replicate.model = modelId;
      } else if (provider === 'openaiCompatible') {
        this.settings.openAICompatible.model = modelId;
      }
    }

    this.settingsChange.emit();
  }

  onApiKeyChange(provider: 'openRouter' | 'replicate' | 'googleGemini' | 'claude'): void {
    this.settingsChange.emit();

    // Auto-load models when API key is entered and provider is enabled
    if (provider === 'openRouter' && this.settings.openRouter.enabled && this.settings.openRouter.apiKey) {
      this.subscriptions.add(this.modelService.loadOpenRouterModels().subscribe());
    } else if (provider === 'replicate' && this.settings.replicate.enabled && this.settings.replicate.apiKey) {
      this.subscriptions.add(this.modelService.loadReplicateModels().subscribe());
    } else if (provider === 'googleGemini' && this.settings.googleGemini.enabled && this.settings.googleGemini.apiKey) {
      this.subscriptions.add(this.modelService.loadGeminiModels().subscribe());
    } else if (provider === 'claude' && this.settings.claude.enabled && this.settings.claude.apiKey) {
      this.subscriptions.add(this.modelService.loadClaudeModels().subscribe());
    }
  }

  onOllamaUrlChange(): void {
    this.settingsChange.emit();
    this.ollamaConnectionStatus = null; // Reset connection status when URL changes

    // Auto-load models when URL is entered and provider is enabled
    if (this.settings.ollama.enabled && this.settings.ollama.baseUrl) {
      this.subscriptions.add(this.modelService.loadOllamaModels().subscribe());
    }
  }

  onProviderToggle(provider: 'openRouter' | 'replicate' | 'googleGemini' | 'ollama' | 'claude' | 'openAICompatible' | 'falAi'): void {
    this.settingsChange.emit();

    // Load models when provider is enabled and has credentials
    if (provider === 'openRouter' && this.settings.openRouter.enabled && this.settings.openRouter.apiKey) {
      this.subscriptions.add(this.modelService.loadOpenRouterModels().subscribe());
    } else if (provider === 'replicate' && this.settings.replicate.enabled && this.settings.replicate.apiKey) {
      this.subscriptions.add(this.modelService.loadReplicateModels().subscribe());
    } else if (provider === 'googleGemini' && this.settings.googleGemini.enabled && this.settings.googleGemini.apiKey) {
      this.subscriptions.add(this.modelService.loadGeminiModels().subscribe());
    } else if (provider === 'ollama' && this.settings.ollama.enabled && this.settings.ollama.baseUrl) {
      this.subscriptions.add(this.modelService.loadOllamaModels().subscribe());
      this.ollamaConnectionStatus = null; // Reset connection status
    } else if (provider === 'claude' && this.settings.claude.enabled && this.settings.claude.apiKey) {
      this.subscriptions.add(this.modelService.loadClaudeModels().subscribe());
      this.claudeConnectionStatus = null; // Reset connection status
    } else if (provider === 'openAICompatible' && this.settings.openAICompatible.enabled && this.settings.openAICompatible.baseUrl) {
      this.subscriptions.add(this.modelService.loadOpenAICompatibleModels().subscribe());
      this.openAICompatibleConnectionStatus = null; // Reset connection status
    }
    // fal.ai doesn't need to load text models - it's for image generation only
  }

  onFalAiApiKeyChange(): void {
    this.settingsChange.emit();
    // fal.ai models are loaded by the ImageGenerationService, not here
  }

  testOllamaConnection(): void {
    if (!this.settings.ollama.baseUrl) return;

    this.testingOllamaConnection = true;
    this.ollamaConnectionStatus = null;

    this.subscriptions.add(
      this.ollamaApiService.testConnection().subscribe({
        next: () => {
          this.testingOllamaConnection = false;
          this.ollamaConnectionStatus = 'success';
          // Auto-load models on successful connection
          if (this.settings.ollama.enabled) {
            this.subscriptions.add(this.modelService.loadOllamaModels().subscribe());
          }
        },
        error: (error) => {
          this.testingOllamaConnection = false;
          this.ollamaConnectionStatus = 'error';
          console.error('Ollama connection test failed:', error);
        }
      })
    );
  }

  testClaudeConnection(): void {
    if (!this.settings.claude.apiKey) return;

    this.testingClaudeConnection = true;
    this.claudeConnectionStatus = null;

    this.subscriptions.add(
      this.claudeApiService.testConnection().subscribe({
        next: (success) => {
          this.testingClaudeConnection = false;
          this.claudeConnectionStatus = success ? 'success' : 'error';
          // Auto-load models on successful connection
          if (success && this.settings.claude.enabled) {
            this.subscriptions.add(this.modelService.loadClaudeModels().subscribe());
          }
        },
        error: (error) => {
          this.testingClaudeConnection = false;
          this.claudeConnectionStatus = 'error';
          console.error('Claude connection test failed:', error);
        }
      })
    );
  }

  onOpenAICompatibleUrlChange(): void {
    this.settingsChange.emit();
    this.openAICompatibleConnectionStatus = null; // Reset connection status when URL changes

    // Auto-load models when URL is entered and provider is enabled
    if (this.settings.openAICompatible.enabled && this.settings.openAICompatible.baseUrl) {
      this.subscriptions.add(this.modelService.loadOpenAICompatibleModels().subscribe());
    }
  }

  onOpenAICompatibleApiKeyChange(): void {
    this.settingsChange.emit();
    this.openAICompatibleConnectionStatus = null; // Reset connection status when API key changes

    // Auto-reload models if enabled and base URL is set
    if (this.settings.openAICompatible.enabled && this.settings.openAICompatible.baseUrl) {
      this.subscriptions.add(this.modelService.loadOpenAICompatibleModels().subscribe());
    }
  }

  testOpenAICompatibleConnection(): void {
    if (!this.settings.openAICompatible.baseUrl) return;

    this.testingOpenAICompatibleConnection = true;
    this.openAICompatibleConnectionStatus = null;

    this.subscriptions.add(
      this.openAICompatibleApiService.testConnection().subscribe({
        next: () => {
          this.testingOpenAICompatibleConnection = false;
          this.openAICompatibleConnectionStatus = 'success';
          // Auto-load models on successful connection
          if (this.settings.openAICompatible.enabled) {
            this.subscriptions.add(this.modelService.loadOpenAICompatibleModels().subscribe());
          }
        },
        error: (error) => {
          this.testingOpenAICompatibleConnection = false;
          this.openAICompatibleConnectionStatus = 'error';
          console.error('OpenAI-Compatible connection test failed:', error);
        }
      })
    );
  }

  getProviderIcon(provider: string): string {
    return getIcon(provider);
  }

  getProviderTooltip(provider: string): string {
    return getTooltip(provider);
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }
}
