import { Injectable, inject, OnDestroy } from '@angular/core';
import { Subscription } from 'rxjs';
import { AIRequestLoggerService, AIRequestLog } from './ai-request-logger.service';
import { ToastNotificationService, AIErrorType } from './toast-notification.service';

/**
 * Service that intercepts AI generation errors and displays toast notifications.
 * Subscribes to AIRequestLoggerService.logs$ and shows user-friendly toasts when errors occur.
 */
@Injectable({
  providedIn: 'root'
})
export class AIErrorInterceptorService implements OnDestroy {
  private aiLogger = inject(AIRequestLoggerService);
  private toastService = inject(ToastNotificationService);

  // Track which error IDs we've already processed
  private processedErrorIds = new Set<string>();
  private subscription: Subscription | null = null;

  // Track service initialization time to skip old errors
  private readonly initTime = Date.now();
  // Max age for errors to be shown (30 seconds) - prevents toasts for old errors on app restart
  private readonly MAX_ERROR_AGE_MS = 30000;

  constructor() {
    this.startIntercepting();
  }

  /**
   * Start listening for AI errors
   */
  private startIntercepting(): void {
    this.subscription = this.aiLogger.logs$.subscribe(logs => {
      // Find new errors we haven't processed yet
      const errorLogs = logs.filter(log => log.status === 'error');

      for (const log of errorLogs) {
        if (!this.processedErrorIds.has(log.id)) {
          this.processedErrorIds.add(log.id);
          this.showErrorToast(log);
        }
      }

      // Clean up processed IDs that are no longer in logs
      this.cleanupProcessedIds(logs);
    });
  }

  /**
   * Display a toast for the given error log
   */
  private showErrorToast(log: AIRequestLog): void {
    // Skip old errors - prevents showing toasts for errors from previous sessions
    const logAge = this.initTime - log.timestamp.getTime();
    if (logAge > this.MAX_ERROR_AGE_MS) {
      return;
    }

    const errorType = this.classifyError(log);
    const message = this.sanitizeMessage(log.error || 'Unknown error');
    this.toastService.showAIError(message, errorType);
  }

  /**
   * Classify the error type based on log data
   */
  private classifyError(log: AIRequestLog): AIErrorType {
    const httpStatus = log.httpStatus;
    const errorMsg = (log.error || '').toLowerCase();
    const errorDetails = log.errorDetails || {};
    const errorDetailsStr = JSON.stringify(errorDetails).toLowerCase();

    // Check for rate limit errors
    if (httpStatus === 429 ||
        errorMsg.includes('rate limit') ||
        errorMsg.includes('rate_limit') ||
        errorMsg.includes('too many requests') ||
        errorDetailsStr.includes('rate limit')) {
      return 'rate-limit';
    }

    // Check for auth errors
    if (httpStatus === 401 || httpStatus === 403 ||
        errorMsg.includes('api key') ||
        errorMsg.includes('api_key') ||
        errorMsg.includes('unauthorized') ||
        errorMsg.includes('invalid key') ||
        errorMsg.includes('authentication') ||
        errorDetailsStr.includes('api key')) {
      return 'auth';
    }

    // Check for content filter / safety blocks
    if (errorMsg.includes('blocked') ||
        errorMsg.includes('safety') ||
        errorMsg.includes('content filter') ||
        errorMsg.includes('content_filter') ||
        errorMsg.includes('moderation') ||
        log.safetyRatings?.promptFeedback?.blockReason ||
        errorDetailsStr.includes('blocked') ||
        errorDetailsStr.includes('safety')) {
      return 'content-filter';
    }

    // Check for timeout errors
    if (errorMsg.includes('timeout') ||
        errorMsg.includes('timed out') ||
        errorMsg.includes('deadline') ||
        errorMsg.includes('aborted') ||
        errorDetailsStr.includes('timeout')) {
      return 'timeout';
    }

    // Check for network errors
    if (errorMsg.includes('network') ||
        errorMsg.includes('fetch') ||
        errorMsg.includes('failed to fetch') ||
        errorMsg.includes('connection') ||
        errorMsg.includes('offline') ||
        errorMsg.includes('dns') ||
        errorMsg.includes('econnrefused') ||
        errorMsg.includes('enotfound')) {
      return 'network';
    }

    // Check for server errors
    if ((httpStatus && httpStatus >= 500) ||
        errorMsg.includes('server error') ||
        errorMsg.includes('internal error') ||
        errorMsg.includes('502') ||
        errorMsg.includes('503') ||
        errorMsg.includes('504')) {
      return 'server';
    }

    // Check for configuration/policy errors (OpenRouter data policy, model availability)
    if (errorMsg.includes('data policy') ||
        errorMsg.includes('privacy') ||
        errorMsg.includes('no endpoints') ||
        errorMsg.includes('data retention') ||
        errorMsg.includes('model not available') ||
        errorDetailsStr.includes('data policy') ||
        errorDetailsStr.includes('no endpoints')) {
      return 'config';
    }

    // Default to generic error
    return 'generic';
  }

  /**
   * Sanitize the error message for display (remove sensitive data, truncate)
   */
  private sanitizeMessage(message: string): string {
    // Remove potential API keys from messages
    let sanitized = message.replace(/sk-[a-zA-Z0-9]{20,}/g, '[API_KEY]');
    sanitized = sanitized.replace(/key[=:]\s*['""]?[a-zA-Z0-9_-]{20,}['""]?/gi, 'key=[REDACTED]');

    // Truncate very long messages
    if (sanitized.length > 200) {
      sanitized = sanitized.substring(0, 200) + '...';
    }

    return sanitized;
  }

  /**
   * Clean up processed IDs for logs that no longer exist
   */
  private cleanupProcessedIds(currentLogs: AIRequestLog[]): void {
    const currentIds = new Set(currentLogs.map(l => l.id));
    for (const id of this.processedErrorIds) {
      if (!currentIds.has(id)) {
        this.processedErrorIds.delete(id);
      }
    }
  }

  ngOnDestroy(): void {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
  }
}
