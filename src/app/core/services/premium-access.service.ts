import { Injectable, inject } from '@angular/core';
import { SubscriptionService } from './subscription.service';

/**
 * Reason for premium access result
 */
export type PremiumAccessReason = 'granted' | 'not_premium' | 'verification_needed' | 'network_error';

/**
 * Result of premium access check
 */
export interface PremiumAccessResult {
  hasAccess: boolean;
  reason: PremiumAccessReason;
}

/**
 * Centralized service for checking premium feature access.
 *
 * This service provides business logic only - no UI.
 * Callers are responsible for handling UI (dialogs, inline messages, etc.)
 * based on the PremiumAccessResult.
 *
 * Usage:
 * ```typescript
 * const result = await this.premiumAccessService.checkAccess();
 * if (result.hasAccess) {
 *   // Proceed with premium feature
 * } else if (result.reason === 'verification_needed') {
 *   // Show verification dialog
 * } else {
 *   // Show upsell dialog
 * }
 * ```
 */
@Injectable({
  providedIn: 'root'
})
export class PremiumAccessService {
  private subscriptionService = inject(SubscriptionService);

  /**
   * Sync check - whether user has an active premium subscription
   */
  get isPremium(): boolean {
    return this.subscriptionService.isPremium;
  }

  /**
   * Sync check - whether user has a valid auth token
   * (required for making premium API calls)
   */
  get hasValidToken(): boolean {
    return this.subscriptionService.hasValidAuthToken();
  }

  /**
   * Full async check for premium feature access.
   *
   * Premium API calls require both:
   * 1. Active subscription status
   * 2. Valid auth token (obtained via Stripe portal verification)
   *
   * @returns PremiumAccessResult with hasAccess boolean and reason
   */
  async checkAccess(): Promise<PremiumAccessResult> {
    // First check if we have a valid auth token (required for premium API calls)
    // This checks both token existence AND cached subscription active status
    if (this.subscriptionService.hasValidAuthToken()) {
      return { hasAccess: true, reason: 'granted' };
    }

    // No valid token - check subscription status to determine appropriate reason
    try {
      const isPremium = await this.subscriptionService.checkSubscription();

      if (isPremium) {
        // User is premium but needs to complete verification
        return { hasAccess: false, reason: 'verification_needed' };
      } else {
        // User is not premium
        return { hasAccess: false, reason: 'not_premium' };
      }
    } catch (error) {
      console.warn('[PremiumAccessService] Failed to check subscription:', error);
      // On network error, return not_premium as safe fallback
      return { hasAccess: false, reason: 'network_error' };
    }
  }
}
