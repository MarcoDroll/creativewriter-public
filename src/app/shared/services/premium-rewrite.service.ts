import { Injectable, inject } from '@angular/core';
import { ModalController } from '@ionic/angular/standalone';
import { firstValueFrom } from 'rxjs';
import { SubscriptionService } from '../../core/services/subscription.service';
import { PremiumAccessService } from '../../core/services/premium-access.service';
import {
  PremiumModuleService,
  BeatRewriteServiceInterface,
  RewriteContext
} from '../../core/services/premium-module.service';
import { SettingsService } from '../../core/services/settings.service';
import { OpenRouterApiService } from '../../core/services/openrouter-api.service';
import { GoogleGeminiApiService } from '../../core/services/google-gemini-api.service';
import { PremiumUpsellDialogComponent } from '../../ui/components/premium-upsell-dialog/premium-upsell-dialog.component';

@Injectable({
  providedIn: 'root'
})
export class PremiumRewriteService {
  private subscriptionService = inject(SubscriptionService);
  private premiumAccessService = inject(PremiumAccessService);
  private premiumModuleService = inject(PremiumModuleService);
  private settingsService = inject(SettingsService);
  private openRouterService = inject(OpenRouterApiService);
  private geminiService = inject(GoogleGeminiApiService);
  private modalController = inject(ModalController);

  private rewriteService: BeatRewriteServiceInterface | null = null;

  /** Check if user has premium subscription */
  get isPremium(): boolean {
    return this.subscriptionService.isPremium;
  }

  /**
   * Show the premium upsell dialog
   */
  async showUpsellDialog(): Promise<void> {
    const modal = await this.modalController.create({
      component: PremiumUpsellDialogComponent,
      componentProps: {
        featureName: 'AI Rewrite',
        description: 'Rewrite your text with AI assistance, maintaining story context and style consistency.',
        benefits: [
          'Context-aware text rewriting',
          'Style and tone adjustment',
          'Smart rewrite suggestions',
          'Story-consistent output'
        ]
      },
      cssClass: 'premium-upsell-modal'
    });
    await modal.present();
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
   * Check premium status and show upsell if not premium or verification dialog if auth token is missing
   * @returns true if user has access, false otherwise
   */
  async checkAndGateAccess(): Promise<boolean> {
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
   * Load the premium rewrite service module
   */
  async loadService(): Promise<BeatRewriteServiceInterface | null> {
    if (this.rewriteService) {
      return this.rewriteService;
    }

    if (!this.isPremium) {
      return null;
    }

    const module = await this.premiumModuleService.loadBeatRewriteModule();
    if (!module) {
      return null;
    }

    const aiAdapter = this.createAIAdapter();
    this.rewriteService = new module.BeatRewriteService(aiAdapter);
    return this.rewriteService;
  }

  /**
   * Execute a rewrite using the premium module
   */
  async rewrite(
    originalText: string,
    instruction: string,
    context: RewriteContext,
    modelId: string
  ): Promise<string | null> {
    const service = await this.loadService();
    if (!service) {
      return null;
    }
    return service.rewrite(originalText, instruction, context, modelId);
  }

  /**
   * Get suggested rewrite prompts
   */
  async getSuggestedPrompts(text: string, language?: string): Promise<string[]> {
    const service = await this.loadService();
    if (!service) {
      // Return fallback prompts for non-premium users (they'll see upsell anyway)
      return ['Make it shorter', 'Expand it', 'Make it more formal'];
    }
    return service.getSuggestedPrompts(text, language);
  }

  /**
   * Create an AI adapter that bridges to local AI services
   */
  private createAIAdapter() {
    return {
      generateChatResponse: async (
        messages: { role: string; content: string }[],
        modelId: string
      ): Promise<string> => {
        const settings = this.settingsService.getSettings();
        const isGemini = modelId.startsWith('gemini:') || modelId.includes('gemini');
        const formattedMessages = messages.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content
        }));
        const modelName = modelId.includes(':') ? modelId.split(':')[1] : modelId;

        if (isGemini && settings.googleGemini?.enabled) {
          const response = await firstValueFrom(
            this.geminiService.generateText('', {
              model: modelName,
              messages: formattedMessages,
              maxTokens: 4000
            })
          );
          return response.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else if (settings.openRouter?.enabled) {
          const response = await firstValueFrom(
            this.openRouterService.generateText('', {
              model: modelName,
              messages: formattedMessages,
              maxTokens: 4000
            })
          );
          return response.choices?.[0]?.message?.content || '';
        }

        throw new Error('No AI service configured');
      }
    };
  }

  /**
   * Clear the loaded service (e.g., on logout)
   */
  clearService(): void {
    this.rewriteService = null;
  }
}
