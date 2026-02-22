import { Injectable, inject } from '@angular/core';
import { SettingsService } from '../../../core/services/settings.service';
import { buildOpenRouterProviderPrefs } from '../../../core/models/settings.interface';
import {
  IImageProvider,
  ImageProvider,
  ImageGenerationModel,
  ImageGenerationRequest,
  ImageGenerationResult,
  GeneratedImage,
  ImageModelCapabilities
} from './image-provider.interface';

@Injectable({
  providedIn: 'root'
})
export class OpenRouterImageProvider implements IImageProvider {
  private settingsService = inject(SettingsService);

  readonly providerId: ImageProvider = 'openrouter';
  readonly displayName = 'OpenRouter';

  private readonly API_URL = 'https://openrouter.ai/api/v1';

  // Cache for loaded models
  private modelsCache: ImageGenerationModel[] = [];
  private modelsCacheTime = 0;
  private readonly CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  // Fallback models if API is unavailable
  private readonly FALLBACK_MODELS: ImageGenerationModel[] = [
    {
      id: 'google/gemini-2.0-flash-exp:free',
      name: 'Gemini 2.0 Flash (Free)',
      description: 'Google Gemini with image generation, free tier',
      provider: 'openrouter',
      capabilities: {
        supportsAspectRatio: true,
        supportsNegativePrompt: false,
        supportsMultipleImages: true,
        supportsSeed: false,
        supportsGuidanceScale: false,
        supportsInferenceSteps: false,
        aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2'],
        imageSizes: ['small', 'medium', 'large']
      },
      pricing: { perImage: 0, currency: 'USD' }
    },
    {
      id: 'black-forest-labs/flux.2-flex',
      name: 'Flux 2 Flex',
      description: 'Black Forest Labs Flux image model',
      provider: 'openrouter',
      capabilities: {
        supportsAspectRatio: false,
        supportsNegativePrompt: false,
        supportsMultipleImages: false,
        supportsSeed: false,
        supportsGuidanceScale: false,
        supportsInferenceSteps: false
      }
    },
    {
      id: 'bytedance-seed/seedream-4.5',
      name: 'Seedream 4.5',
      description: 'ByteDance Seedream high-quality image generation',
      provider: 'openrouter',
      capabilities: {
        supportsAspectRatio: false,
        supportsNegativePrompt: false,
        supportsMultipleImages: false,
        supportsSeed: false,
        supportsGuidanceScale: false,
        supportsInferenceSteps: false
      }
    }
  ];

  isConfigured(): boolean {
    const settings = this.settingsService.getSettings();
    return Boolean(settings.openRouter?.enabled && settings.openRouter?.apiKey);
  }

  private getApiKey(): string {
    const settings = this.settingsService.getSettings();
    return settings.openRouter?.apiKey || '';
  }

  async generate(request: ImageGenerationRequest): Promise<ImageGenerationResult> {
    if (!this.isConfigured()) {
      throw new Error('OpenRouter is not configured. Please add your API key in settings.');
    }

    const model = this.getModel(request.modelId);
    if (!model) {
      throw new Error(`Model ${request.modelId} not found`);
    }

    const settings = this.settingsService.getSettings();

    const providerPrefs = buildOpenRouterProviderPrefs(settings.openRouter);

    // Build request body
    const body: Record<string, unknown> = {
      model: request.modelId,
      modalities: ['image', 'text'],
      messages: [{ role: 'user', content: request.prompt }],
      ...(providerPrefs && { provider: providerPrefs })
    };

    // Add image_config for models that support it (Gemini models)
    if (model.capabilities.supportsAspectRatio && request.aspectRatio) {
      body['image_config'] = {
        aspect_ratio: request.aspectRatio,
        ...(request.imageSize ? { image_size: request.imageSize } : {})
      };
    }

    try {
      const response = await fetch(`${this.API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.getApiKey()}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': window.location.origin,
          'X-Title': 'Creative Writer'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage = errorData.error?.message || errorData.message || `HTTP ${response.status}`;
        throw new Error(`OpenRouter API error: ${errorMessage}`);
      }

      const data = await response.json();
      const images = this.extractImagesFromResponse(data);

      if (images.length === 0) {
        throw new Error('No images were generated. The model may not support image generation.');
      }

      return {
        images,
        modelId: request.modelId,
        prompt: request.prompt,
        generatedAt: new Date()
      };
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to generate image: ${String(error)}`);
    }
  }

  private extractImagesFromResponse(data: Record<string, unknown>): GeneratedImage[] {
    const images: GeneratedImage[] = [];
    let imageIndex = 0;

    // Handle OpenAI-style images/generations format
    const dataArray = data['data'];
    if (dataArray && Array.isArray(dataArray)) {
      for (const item of dataArray as Record<string, unknown>[]) {
        const b64Json = item['b64_json'] as string | undefined;
        const itemUrl = item['url'] as string | undefined;
        if (b64Json) {
          images.push({
            url: `data:image/png;base64,${b64Json}`,
            mimeType: 'image/png',
            index: imageIndex++
          });
        } else if (itemUrl) {
          images.push({
            url: itemUrl,
            mimeType: 'image/png',
            index: imageIndex++
          });
        }
      }
    }

    // Handle chat completion format with images in message
    const choices = data['choices'] as Record<string, unknown>[] | undefined;
    if (choices && choices.length > 0) {
      const message = choices[0]['message'] as Record<string, unknown> | undefined;
      if (message) {
        // Check message.images array (OpenRouter format)
        const messageImages = message['images'] as Record<string, unknown>[] | undefined;
        if (messageImages && Array.isArray(messageImages)) {
          for (const img of messageImages) {
            if (img['type'] === 'image_url') {
              const imageUrl = img['image_url'] as Record<string, string> | undefined;
              const urlValue = imageUrl?.['url'];
              if (urlValue) {
                if (urlValue.startsWith('data:image')) {
                  const parts = urlValue.split(',');
                  if (parts.length >= 2) {
                    const header = parts[0];
                    const mimeType = header.match(/data:([^;]+)/)?.[1] || 'image/png';
                    images.push({
                      url: urlValue,
                      mimeType,
                      index: imageIndex++
                    });
                  }
                } else {
                  images.push({
                    url: urlValue,
                    mimeType: 'image/png',
                    index: imageIndex++
                  });
                }
              }
            }
          }
        }

        // Check message.content array format
        const content = message['content'];
        if (Array.isArray(content)) {
          for (const part of content as Record<string, unknown>[]) {
            if (part['type'] === 'image_url') {
              const imageUrl = part['image_url'] as Record<string, string> | undefined;
              const urlValue = imageUrl?.['url'];
              if (urlValue) {
                if (urlValue.startsWith('data:image')) {
                  const parts = urlValue.split(',');
                  if (parts.length >= 2) {
                    const header = parts[0];
                    const mimeType = header.match(/data:([^;]+)/)?.[1] || 'image/png';
                    images.push({
                      url: urlValue,
                      mimeType,
                      index: imageIndex++
                    });
                  }
                } else {
                  images.push({
                    url: urlValue,
                    mimeType: 'image/png',
                    index: imageIndex++
                  });
                }
              }
            }
          }
        }
      }
    }

    return images;
  }

  async getAvailableModels(): Promise<ImageGenerationModel[]> {
    // Return cached models if still valid
    if (this.modelsCache.length > 0 && Date.now() - this.modelsCacheTime < this.CACHE_TTL_MS) {
      return this.modelsCache;
    }

    if (!this.isConfigured()) {
      return this.FALLBACK_MODELS;
    }

    try {
      const response = await fetch(`${this.API_URL}/models`, {
        headers: {
          'Authorization': `Bearer ${this.getApiKey()}`
        }
      });

      if (!response.ok) {
        console.warn('Failed to fetch OpenRouter models, using fallback');
        return this.FALLBACK_MODELS;
      }

      const data = await response.json();
      const models: ImageGenerationModel[] = [];

      // Filter models that support image output
      for (const model of data.data || []) {
        const outputModalities = model.architecture?.output_modalities || [];
        if (outputModalities.includes('image')) {
          const isGemini = model.id.includes('gemini');

          const capabilities: ImageModelCapabilities = {
            supportsAspectRatio: isGemini,
            supportsNegativePrompt: false,
            supportsMultipleImages: isGemini,
            supportsSeed: false,
            supportsGuidanceScale: false,
            supportsInferenceSteps: false,
            ...(isGemini ? {
              aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2'],
              imageSizes: ['small', 'medium', 'large']
            } : {})
          };

          models.push({
            id: model.id,
            name: model.name || model.id,
            description: model.description || '',
            provider: 'openrouter',
            capabilities,
            pricing: model.pricing ? {
              perImage: model.pricing.image || model.pricing.completion,
              currency: 'USD'
            } : undefined
          });
        }
      }

      // Combine with fallback models (fallback first for priority)
      const allModels = [...this.FALLBACK_MODELS];
      for (const model of models) {
        if (!allModels.find(m => m.id === model.id)) {
          allModels.push(model);
        }
      }

      this.modelsCache = allModels;
      this.modelsCacheTime = Date.now();

      return allModels;
    } catch (error) {
      console.error('Error fetching OpenRouter models:', error);
      return this.FALLBACK_MODELS;
    }
  }

  getModel(modelId: string): ImageGenerationModel | undefined {
    // Check cache first
    const cached = this.modelsCache.find(m => m.id === modelId);
    if (cached) return cached;

    // Check fallback models
    return this.FALLBACK_MODELS.find(m => m.id === modelId);
  }

  // Force refresh of models cache
  clearModelsCache(): void {
    this.modelsCache = [];
    this.modelsCacheTime = 0;
  }
}
