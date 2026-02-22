import { Injectable, inject } from '@angular/core';
import { ModalController } from '@ionic/angular/standalone';
import { SubscriptionService } from '../../core/services/subscription.service';
import { PremiumAccessService } from '../../core/services/premium-access.service';
import { SettingsService } from '../../core/services/settings.service';
import { AIRequestLoggerService } from '../../core/services/ai-request-logger.service';
import { PremiumUpsellDialogComponent } from '../../ui/components/premium-upsell-dialog/premium-upsell-dialog.component';
import { environment } from '../../../environments/environment';

// KEEP IN SYNC with backend/src/index.ts PortraitStyle
export type PortraitStyle = 'photorealistic' | 'digital-illustration' | 'anime' | 'oil-painting' | 'watercolor' | 'comic-book';

export interface CharacterInfo {
  title: string;
  content: string;
  physicalAppearance?: string;
  backstory?: string;
  personality?: string;
  style?: PortraitStyle;
}

export interface GeneratePortraitResponse {
  imageBase64: string;
  generatedPrompt?: string;
  success: boolean;
  error?: string;
}

@Injectable({
  providedIn: 'root'
})
export class PortraitService {
  private subscriptionService = inject(SubscriptionService);
  private premiumAccessService = inject(PremiumAccessService);
  private settingsService = inject(SettingsService);
  private modalController = inject(ModalController);
  private aiLogger = inject(AIRequestLoggerService);

  private readonly API_URL = environment.premiumApiUrl;
  private readonly MAX_SIZE_KB = 50;

  /**
   * Check if OpenRouter is configured
   */
  isOpenRouterConfigured(): boolean {
    const settings = this.settingsService.getSettings();
    return Boolean(settings.openRouter?.enabled && settings.openRouter?.apiKey);
  }

  /**
   * Get current premium status (synchronous)
   */
  get isPremium(): boolean {
    return this.subscriptionService.isPremium;
  }

  /**
   * Check if user has premium access for portrait generation
   * Shows upsell dialog if not premium or verification dialog if auth token is missing
   */
  async checkPremiumAccess(): Promise<boolean> {
    const result = await this.premiumAccessService.checkAccess();

    if (result.hasAccess) {
      return true;
    }

    // Handle UI based on reason
    if (result.reason === 'verification_needed') {
      await this.showVerificationNeededDialog();
    } else {
      await this.showUpsellDialog();
    }
    return false;
  }

  /**
   * Show dialog explaining that email verification is needed
   * For users who are premium but haven't completed portal verification
   */
  async showVerificationNeededDialog(): Promise<void> {
    const modal = await this.modalController.create({
      component: PremiumUpsellDialogComponent,
      componentProps: {
        featureName: 'Email Verification Required',
        description: 'You have an active premium subscription, but need to verify your email to use premium features. Please complete the verification process in Settings.',
        benefits: [
          'Your subscription is active',
          'One-time email verification via Stripe',
          'Secure access to all premium features',
          'Go to Settings → Premium to verify'
        ]
      },
      cssClass: 'premium-upsell-modal'
    });
    await modal.present();
  }

  /**
   * Show premium upsell dialog for portrait generation
   */
  async showUpsellDialog(): Promise<void> {
    const modal = await this.modalController.create({
      component: PremiumUpsellDialogComponent,
      componentProps: {
        featureName: 'AI Portrait Generation',
        description: 'Generate beautiful character portraits using AI based on your character descriptions.',
        benefits: [
          'AI-powered portrait generation',
          'Based on your character details',
          'Multiple models: Flux & Seedream 4.5',
          'Automatic image optimization'
        ]
      },
      cssClass: 'premium-upsell-modal'
    });
    await modal.present();
  }

  /**
   * Generate portrait via backend
   */
  async generatePortrait(characterInfo: CharacterInfo): Promise<string> {
    const settings = this.settingsService.getSettings();
    const authToken = this.subscriptionService.getAuthToken();

    if (!authToken) {
      throw new Error('Authentication required. Please verify your subscription.');
    }

    if (!settings.openRouter?.apiKey) {
      throw new Error('OpenRouter API key is required for portrait generation.');
    }

    // Build character context for logging (same format as backend)
    const characterContext = this.buildCharacterContext(characterInfo);
    const startTime = Date.now();

    // Get selected portrait model
    const portraitModel = settings.portraitModel?.selectedModel || 'flux';
    const modelDisplayName = portraitModel === 'seedream' ? 'Seedream 4.5' : 'Flux';

    // Log the request to AI logs
    const logId = this.aiLogger.logRequest({
      endpoint: `${this.API_URL}/premium/generate-portrait`,
      model: `${modelDisplayName} via deepseek/deepseek-v3.2`,
      wordCount: characterContext.split(/\s+/).length,
      maxTokens: 300,
      prompt: characterContext,
      apiProvider: 'openrouter',
      streamingMode: false,
      requestDetails: {
        temperature: 0.7,
        messagesFormat: 'Portrait Generation',
        imageModel: portraitModel
      }
    });

    try {
      const response = await fetch(`${this.API_URL}/premium/generate-portrait`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          characterName: characterInfo.title,
          description: characterInfo.content,
          physicalAppearance: characterInfo.physicalAppearance,
          backstory: characterInfo.backstory,
          personality: characterInfo.personality,
          openRouterApiKey: settings.openRouter.apiKey,
          model: portraitModel,
          style: characterInfo.style
        })
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        const errorMessage = error.error || `Portrait generation failed: ${response.status}`;
        this.aiLogger.logError(logId, errorMessage, Date.now() - startTime, {
          httpStatus: response.status
        });
        throw new Error(errorMessage);
      }

      const data: GeneratePortraitResponse = await response.json();

      if (!data.success || !data.imageBase64) {
        const errorMessage = data.error || 'Failed to generate portrait';
        this.aiLogger.logError(logId, errorMessage, Date.now() - startTime);
        throw new Error(errorMessage);
      }

      // Log success with the generated prompt as the response
      this.aiLogger.logSuccess(
        logId,
        data.generatedPrompt || 'Portrait generated successfully',
        Date.now() - startTime,
        { httpStatus: 200 }
      );

      // Compress if needed (backend should already compress, but ensure max size)
      const sizeKb = this.getBase64SizeKb(data.imageBase64);
      if (sizeKb > this.MAX_SIZE_KB) {
        return await this.compressImage(`data:image/jpeg;base64,${data.imageBase64}`, this.MAX_SIZE_KB);
      }

      return data.imageBase64;
    } catch (error) {
      // Log network errors or other unexpected failures
      // (API errors are already logged above before re-throwing)
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const log = this.aiLogger.getLogs().find(l => l.id === logId);
      if (log?.status === 'pending') {
        this.aiLogger.logError(logId, errorMessage, Date.now() - startTime);
      }
      throw error;
    }
  }

  /**
   * Build character context string for logging
   */
  private buildCharacterContext(info: CharacterInfo): string {
    let context = `Character Name: ${info.title}\n`;
    if (info.content) context += `Description: ${info.content}\n`;
    if (info.physicalAppearance) context += `Physical Appearance: ${info.physicalAppearance}\n`;
    if (info.backstory) context += `Backstory: ${info.backstory}\n`;
    if (info.personality) context += `Personality: ${info.personality}\n`;
    return context;
  }

  /**
   * Compress uploaded image to max size in KB
   * Uses Canvas API for resizing and JPEG compression
   */
  async compressImage(base64Data: string, maxSizeKb: number = this.MAX_SIZE_KB): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(new Error('Failed to create canvas context'));
          return;
        }

        // Calculate target dimensions (maintain aspect ratio)
        let width = img.width;
        let height = img.height;
        const maxDimension = 256; // Start with reasonable max dimension for thumbnails

        if (width > height && width > maxDimension) {
          height = Math.round((height / width) * maxDimension);
          width = maxDimension;
        } else if (height > maxDimension) {
          width = Math.round((width / height) * maxDimension);
          height = maxDimension;
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        // Start with high quality and reduce if needed
        let quality = 0.9;
        let result = canvas.toDataURL('image/jpeg', quality);

        // Iteratively reduce quality until size is acceptable
        while (this.getBase64SizeKb(result) > maxSizeKb && quality > 0.1) {
          quality -= 0.1;
          result = canvas.toDataURL('image/jpeg', quality);
        }

        // If still too large, reduce dimensions
        while (this.getBase64SizeKb(result) > maxSizeKb && width > 64) {
          width = Math.floor(width * 0.8);
          height = Math.floor(height * 0.8);
          canvas.width = width;
          canvas.height = height;
          ctx.drawImage(img, 0, 0, width, height);
          result = canvas.toDataURL('image/jpeg', 0.8);
        }

        // Final size check
        if (this.getBase64SizeKb(result) > maxSizeKb) {
          reject(new Error('Unable to compress image to target size. Please use a smaller image.'));
          return;
        }

        // Return just the base64 data without the data URL prefix
        const base64Only = result.split(',')[1];

        // Cleanup to help garbage collection
        img.src = '';

        resolve(base64Only);
      };

      img.onerror = () => {
        reject(new Error('Failed to load image'));
      };

      // Ensure proper data URL format
      if (base64Data.startsWith('data:')) {
        img.src = base64Data;
      } else {
        img.src = `data:image/jpeg;base64,${base64Data}`;
      }
    });
  }

  /**
   * Calculate approximate size in KB of base64 string
   */
  private getBase64SizeKb(base64: string): number {
    // Remove data URL prefix if present
    const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;
    // Base64 encoding increases size by ~33%, so actual size is ~75% of string length
    return (base64Data.length * 3) / 4 / 1024;
  }
}
