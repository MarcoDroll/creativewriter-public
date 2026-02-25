import { Component, inject, OnInit, OnDestroy, CUSTOM_ELEMENTS_SCHEMA, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonAccordion, IonAccordionGroup,
  IonItem, IonLabel, IonInput, IonButton, IonIcon,
  IonSpinner, IonBadge, IonNote, IonSelect, IonSelectOption
} from '@ionic/angular/standalone';
import { PortraitModel } from '../../core/models/settings.interface';
import { addIcons } from 'ionicons';
import {
  star, checkmarkCircle, closeCircle, refresh,
  sparklesOutline, imageOutline, cardOutline, lockClosed, timeOutline
} from 'ionicons/icons';
import { Subscription } from 'rxjs';
import { SubscriptionService } from '../../core/services/subscription.service';
import { SettingsService } from '../../core/services/settings.service';
import { environment } from '../../../environments/environment';

@Component({
  selector: 'app-premium-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonAccordion, IonAccordionGroup,
    IonItem, IonLabel, IonInput, IonButton, IonIcon,
    IonSpinner, IonBadge, IonNote, IonSelect, IonSelectOption
  ],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: './premium-settings.component.html',
  styleUrls: ['./premium-settings.component.scss']
})
export class PremiumSettingsComponent implements OnInit, OnDestroy {
  private subscriptionService = inject(SubscriptionService);
  private settingsService = inject(SettingsService);

  email = '';
  isPremium = false;
  isVerifying = false;
  verificationPending = false;
  plan?: 'monthly' | 'yearly';
  expiresAt?: Date;
  message = '';
  messageType: 'success' | 'error' | '' = '';
  portraitModel: PortraitModel = 'flux';
  hasAuthToken = false;

  @Output() settingsChange = new EventEmitter<void>();

  // Stripe configuration from environment
  stripePublishableKey = environment.stripe.publishableKey;
  stripePricingTableId = environment.stripe.pricingTableId;

  private subscriptions = new Subscription();

  constructor() {
    addIcons({
      star, checkmarkCircle, closeCircle, refresh,
      sparklesOutline, imageOutline, cardOutline, lockClosed, timeOutline
    });
  }

  ngOnInit(): void {
    // Load current settings
    const settings = this.settingsService.getSettings();
    this.email = settings.premium?.email || '';
    this.portraitModel = settings.portraitModel?.selectedModel || 'flux';
    this.hasAuthToken = this.subscriptionService.hasValidAuthToken();

    // Subscribe to premium status
    this.subscriptions.add(
      this.subscriptionService.isPremiumObservable.subscribe(isPremium => {
        this.isPremium = isPremium;
        this.hasAuthToken = this.subscriptionService.hasValidAuthToken();
        this.updateStatusFromCache();
      })
    );

    this.subscriptions.add(
      this.subscriptionService.isVerifying.subscribe(isVerifying => {
        this.isVerifying = isVerifying;
      })
    );

    // Initialize status
    this.subscriptionService.initialize();
    this.updateStatusFromCache();

    // Check for portal return or legacy verification code in URL
    this.checkPortalReturn();
  }

  /**
   * Check if user is returning from Stripe portal and attempt to claim verification
   *
   * Flow 1 (Legacy - direct code): URL contains ?verify=<code>
   * Flow 2 (login_page): URL contains ?portal_return=1, email set, no auth token - poll for verification
   * Flow 3 (direct session): URL contains ?tab=premium, has auth token - just refresh status
   *
   * The login_page flow works like this:
   * 1. User goes to Stripe login_page, enters email, receives OTP
   * 2. User enters OTP (proves email ownership via Stripe)
   * 3. User exits portal → Stripe redirects to /api/portal/return
   * 4. Worker stores portal_verified in KV, redirects to app with ?portal_return=1
   * 5. App polls for verification (should succeed on first attempt)
   */
  private async checkPortalReturn(): Promise<void> {
    const urlParams = new URLSearchParams(window.location.search);
    const verifyCode = urlParams.get('verify');
    const tab = urlParams.get('tab');
    const portalReturn = urlParams.get('portal_return');

    // Flow 1: Legacy verification code in URL
    if (verifyCode) {
      const url = new URL(window.location.href);
      url.searchParams.delete('verify');
      window.history.replaceState({}, '', url.toString());

      this.verificationPending = true;
      try {
        const isActive = await this.subscriptionService.exchangeVerificationCode(verifyCode);
        this.updateStatusFromCache();
        this.hasAuthToken = this.subscriptionService.hasValidAuthToken();

        if (isActive) {
          this.message = 'Subscription verified successfully!';
          this.messageType = 'success';
        } else {
          this.message = 'No active subscription found';
          this.messageType = 'error';
        }
      } catch (error) {
        this.message = error instanceof Error
          ? error.message
          : 'Verification failed. Please try again.';
        this.messageType = 'error';
      } finally {
        this.verificationPending = false;
      }
      return;
    }

    // Flow 2: Genuine portal return (portal_return=1 set by /api/portal/return)
    if (portalReturn === '1') {
      // Clean portal_return param from URL immediately
      const url = new URL(window.location.href);
      url.searchParams.delete('portal_return');
      window.history.replaceState({}, '', url.toString());

      if (this.subscriptionService.hasValidAuthToken()) {
        // Already authenticated - just refresh status
        await this.subscriptionService.verifySubscription();
        this.updateStatusFromCache();
        this.hasAuthToken = this.subscriptionService.hasValidAuthToken();
      } else if (this.email) {
        // Login_page return - claim verification
        await this.attemptClaimVerification();
      }
      return;
    }

    // Flow 3: Direct session return or page load with ?tab=premium
    if (tab === 'premium' && this.subscriptionService.hasValidAuthToken()) {
      await this.subscriptionService.verifySubscription();
      this.updateStatusFromCache();
      this.hasAuthToken = this.subscriptionService.hasValidAuthToken();
    }
  }

  /**
   * Attempt to claim portal verification with polling.
   * Verification is stored synchronously by /api/portal/return before the redirect,
   * so the first attempt should usually succeed. A few retries handle edge cases.
   */
  private async attemptClaimVerification(): Promise<void> {
    if (!this.email) return;

    this.verificationPending = true;

    // Verification is stored before redirect, so 6 attempts over ~11s is plenty
    const maxAttempts = 6;
    const delays = [500, 1500, 2500, 3000, 3500]; // ~11s between attempts

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.message = `Verifying with Stripe... (${attempt}/${maxAttempts})`;
      this.messageType = '';

      try {
        const claimed = await this.subscriptionService.claimPortalVerification(this.email);

        if (claimed) {
          this.updateStatusFromCache();
          this.hasAuthToken = this.subscriptionService.hasValidAuthToken();
          this.message = 'Subscription verified successfully!';
          this.messageType = 'success';
          this.verificationPending = false;
          return;
        }

        // Not yet verified - wait and try again
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, delays[attempt - 1] || 3000));
        }
      } catch (error) {
        // On error (not 401), stop polling
        this.message = error instanceof Error
          ? error.message
          : 'Verification failed. Please try again.';
        this.messageType = 'error';
        this.verificationPending = false;
        return;
      }
    }

    // All attempts exhausted
    this.message = 'Verification timed out. Please click "Verify via Stripe Portal" to try again.';
    this.messageType = 'error';
    this.verificationPending = false;
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private updateStatusFromCache(): void {
    const settings = this.settingsService.getSettings();
    const cached = settings.premium?.cachedStatus;
    if (cached) {
      this.plan = cached.plan;
      this.expiresAt = cached.expiresAt ? new Date(cached.expiresAt) : undefined;
    }
  }

  onEmailBlur(): void {
    const settings = this.settingsService.getSettings();
    if (this.email !== settings.premium?.email) {
      this.settingsService.updateSettings({
        premium: {
          ...settings.premium,
          email: this.email.trim().toLowerCase()
        }
      });
    }
  }

  onPortraitModelChange(): void {
    // Emit change event first so parent shows "Not Saved" briefly
    this.settingsChange.emit();
    // Then save immediately - parent will update to "Saved" via settings$ subscription
    this.settingsService.updateSettings({
      portraitModel: {
        selectedModel: this.portraitModel
      }
    });
  }

  /**
   * Get the default expanded accordion values
   * For non-premium users, also expand the subscribe accordion
   */
  getDefaultExpandedAccordions(): string[] {
    const expanded = ['status', 'features'];
    if (!this.isPremium) {
      expanded.push('subscribe');
    }
    return expanded;
  }

  async verifySubscription(): Promise<void> {
    this.message = '';
    this.messageType = '';

    if (!this.email) {
      this.message = 'Please enter your subscription email';
      this.messageType = 'error';
      return;
    }

    try {
      let portalUrl: string | null = null;

      // Try direct session first if we have valid auth token
      // This provides better UX (no "Abmelden" button, just "Back to Creative Writer")
      if (this.subscriptionService.hasValidAuthToken()) {
        portalUrl = await this.subscriptionService.createDirectPortalSession();
      }

      // Fallback to login_page flow (first-time or direct session failed)
      if (!portalUrl) {
        // Save email before redirecting to login_page flow
        await this.subscriptionService.setEmail(this.email);
        portalUrl = await this.subscriptionService.initiatePortalVerification(this.email);
      }

      window.location.href = portalUrl;
    } catch (error) {
      this.message = error instanceof Error
        ? error.message
        : 'Failed to open subscription portal. Please try again.';
      this.messageType = 'error';
    }
  }
}
