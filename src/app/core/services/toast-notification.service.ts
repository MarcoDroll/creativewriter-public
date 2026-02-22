import { Injectable, inject } from '@angular/core';
import { AlertController, ToastController } from '@ionic/angular/standalone';

/**
 * Error types for AI generation failures
 */
export type AIErrorType =
  | 'rate-limit'
  | 'auth'
  | 'content-filter'
  | 'timeout'
  | 'server'
  | 'network'
  | 'config'
  | 'generic';

/**
 * User-friendly error messages for each error type
 */
const ERROR_MESSAGES: Record<AIErrorType, string> = {
  'rate-limit': 'AI service rate limit reached. Please wait a moment.',
  'auth': 'API key issue. Please check your settings.',
  'content-filter': 'Content blocked by safety filters. Try rephrasing.',
  'timeout': 'Request timed out. The AI service may be busy.',
  'server': 'AI service temporarily unavailable.',
  'network': 'Network issue. Check your connection.',
  'config': 'AI service configuration issue. Check OpenRouter privacy settings.',
  'generic': 'AI generation failed. Please try again.'
};

/**
 * Centralized service for displaying toast notifications for AI errors.
 * Features:
 * - Deduplication within a 5-second window
 * - Toast lifecycle management (dismiss previous before showing new)
 * - User-friendly message mapping by error type
 */
@Injectable({
  providedIn: 'root'
})
export class ToastNotificationService {
  private toastController = inject(ToastController);
  private alertController = inject(AlertController);
  private activeToast: HTMLIonToastElement | null = null;
  private activeAlert: HTMLIonAlertElement | null = null;

  // Deduplication: hash -> timestamp
  private recentErrors = new Map<string, number>();
  private readonly DEDUP_WINDOW_MS = 5000;

  /**
   * Show a toast notification for an AI error
   * @param message The original error message (for deduplication)
   * @param errorType The classified error type
   */
  async showAIError(message: string, errorType: AIErrorType): Promise<void> {
    // Create a hash for deduplication based on error type and message
    const errorHash = this.hashError(errorType, message);

    // Check if we've shown this error recently
    if (this.isDuplicate(errorHash)) {
      return;
    }

    // Mark this error as shown
    this.recentErrors.set(errorHash, Date.now());
    this.cleanupOldErrors();

    // Dismiss any active toast before showing a new one
    await this.dismissActiveToast();

    // Get user-friendly message
    const displayMessage = ERROR_MESSAGES[errorType];

    // Create and show the toast
    this.activeToast = await this.toastController.create({
      message: displayMessage,
      duration: 4000,
      position: 'top',
      color: this.getToastColor(errorType),
      buttons: [
        {
          text: 'Details',
          handler: () => {
            this.showErrorDetails(message);
            return false; // Keep toast open
          }
        },
        {
          text: 'Dismiss',
          role: 'cancel'
        }
      ]
    });

    await this.activeToast.present();
  }

  /**
   * Dismiss the currently active toast if any
   */
  private async dismissActiveToast(): Promise<void> {
    if (this.activeToast) {
      try {
        await this.activeToast.dismiss();
      } catch {
        // Toast may already be dismissed
      }
      this.activeToast = null;
    }
  }

  /**
   * Show an alert with full error details
   */
  private async showErrorDetails(message: string): Promise<void> {
    try {
      // Dismiss any existing alert first
      if (this.activeAlert) {
        try { await this.activeAlert.dismiss(); } catch { /* already dismissed */ }
        this.activeAlert = null;
      }

      const alert = await this.alertController.create({
        header: 'Error Details',
        message: this.escapeHtml(message),
        buttons: ['OK']
      });
      this.activeAlert = alert;
      alert.onDidDismiss().then(() => {
        if (this.activeAlert === alert) {
          this.activeAlert = null;
        }
      });
      await alert.present();
    } catch {
      // Alert could not be shown
    }
  }

  /**
   * Escape HTML entities to prevent XSS in ion-alert message
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Create a simple hash for error deduplication
   */
  private hashError(errorType: AIErrorType, message: string): string {
    // Use error type + first 50 chars of message for dedup key
    const truncatedMessage = message.substring(0, 50);
    return `${errorType}:${truncatedMessage}`;
  }

  /**
   * Check if this error was shown within the deduplication window
   */
  private isDuplicate(errorHash: string): boolean {
    const lastShown = this.recentErrors.get(errorHash);
    if (!lastShown) {
      return false;
    }
    return (Date.now() - lastShown) < this.DEDUP_WINDOW_MS;
  }

  /**
   * Clean up old error entries from the deduplication map
   */
  private cleanupOldErrors(): void {
    const now = Date.now();
    for (const [hash, timestamp] of this.recentErrors.entries()) {
      if (now - timestamp > this.DEDUP_WINDOW_MS) {
        this.recentErrors.delete(hash);
      }
    }
  }

  /**
   * Get the toast color based on error type
   */
  private getToastColor(errorType: AIErrorType): string {
    switch (errorType) {
      case 'rate-limit':
      case 'timeout':
        return 'warning';
      case 'config':
        return 'warning';
      case 'auth':
      case 'content-filter':
      case 'server':
      case 'network':
        return 'danger';
      case 'generic':
      default:
        return 'danger';
    }
  }
}
