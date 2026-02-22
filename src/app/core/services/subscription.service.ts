import { Injectable, inject } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { SettingsService } from './settings.service';
import { environment } from '../../../environments/environment';

export interface SubscriptionStatus {
  active: boolean;
  status: string;
  plan?: 'monthly' | 'yearly';
  expiresAt?: number;
  cancelAtPeriodEnd?: boolean;
  authToken?: string;
}

export interface PortalResponse {
  url: string;
}

@Injectable({
  providedIn: 'root'
})
export class SubscriptionService {
  private readonly API_URL = environment.premiumApiUrl;
  private readonly CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
  private readonly GRACE_PERIOD = 3 * 24 * 60 * 60 * 1000; // 3 days offline grace
  private readonly TOKEN_REFRESH_THRESHOLD = 7 * 24 * 60 * 60 * 1000; // 7 days

  private settingsService = inject(SettingsService);

  private isPremium$ = new BehaviorSubject<boolean>(false);
  private isVerifying$ = new BehaviorSubject<boolean>(false);

  /** Observable for premium status */
  get isPremiumObservable(): Observable<boolean> {
    return this.isPremium$.asObservable();
  }

  /** Current premium status (synchronous) */
  get isPremium(): boolean {
    return this.isPremium$.value;
  }

  /** Whether verification is in progress */
  get isVerifying(): Observable<boolean> {
    return this.isVerifying$.asObservable();
  }

  /**
   * Get the current auth token for premium API requests
   */
  getAuthToken(): string | undefined {
    const settings = this.settingsService.getSettings();
    return settings.premium?.authToken;
  }

  /**
   * Check if user has a valid auth token (required for premium features)
   */
  hasValidAuthToken(): boolean {
    const settings = this.settingsService.getSettings();
    return Boolean(settings.premium?.authToken && settings.premium?.cachedStatus?.active);
  }

  /**
   * Initialize subscription status from cache
   * Call this on app startup
   */
  initialize(): void {
    const settings = this.settingsService.getSettings();
    const premium = settings.premium;

    // No email configured - nothing to do
    if (!premium?.email) {
      console.log('[SubscriptionService] No premium email configured');
      return;
    }

    console.log('[SubscriptionService] Initializing with email:', premium.email);

    if (premium?.cachedStatus?.active) {
      // Check if cache is still valid or within grace period
      const now = Date.now();
      const expiresAt = premium.cachedStatus.expiresAt || 0;
      const lastVerified = premium.cachedStatus.lastVerified || 0;

      // Valid if: subscription not expired OR within grace period of last verification
      const isValid = expiresAt > now ||
        (lastVerified > 0 && (now - lastVerified) < this.GRACE_PERIOD);

      console.log('[SubscriptionService] Cache check:', { expiresAt, lastVerified, isValid, now });

      this.isPremium$.next(Boolean(isValid));

      // Trigger background verification if cache is stale
      if (lastVerified && (now - lastVerified) > this.CACHE_DURATION) {
        console.log('[SubscriptionService] Cache stale, verifying in background');
        this.verifySubscription().catch(console.error);
      }
    } else {
      // No valid cache, verify now
      console.log('[SubscriptionService] No cached status, verifying now');
      this.verifySubscription().catch(console.error);
    }
  }

  /**
   * Check subscription status
   * Uses cache first, verifies with server if stale
   */
  async checkSubscription(): Promise<boolean> {
    const settings = this.settingsService.getSettings();
    const premium = settings.premium;

    console.log('[SubscriptionService] checkSubscription called', {
      email: premium?.email,
      cachedActive: premium?.cachedStatus?.active,
      lastVerified: premium?.cachedStatus?.lastVerified
    });

    // No email configured
    if (!premium?.email) {
      console.log('[SubscriptionService] No email configured');
      this.isPremium$.next(false);
      return false;
    }

    // Check if cache is valid
    const now = Date.now();
    const lastVerified = premium.cachedStatus?.lastVerified || 0;
    const cacheValid = lastVerified && (now - lastVerified) < this.CACHE_DURATION;

    console.log('[SubscriptionService] Cache check', {
      cacheValid,
      cachedActive: premium.cachedStatus?.active,
      timeSinceVerify: lastVerified ? now - lastVerified : 'never'
    });

    if (cacheValid && premium.cachedStatus?.active) {
      console.log('[SubscriptionService] Using valid cache, isPremium=true');
      this.isPremium$.next(true);
      return true;
    }

    // Verify with server
    console.log('[SubscriptionService] Cache stale or inactive, verifying with server');
    return this.verifySubscription();
  }

  /**
   * Verify subscription status with the API
   */
  async verifySubscription(): Promise<boolean> {
    const settings = this.settingsService.getSettings();
    const premium = settings.premium;

    console.log('[SubscriptionService] verifySubscription called for:', premium?.email);

    if (!premium?.email) {
      this.isPremium$.next(false);
      return false;
    }

    this.isVerifying$.next(true);

    try {
      const status = await this.fetchSubscriptionStatus(premium.email);
      console.log('[SubscriptionService] API response:', status);

      // Update cache
      this.settingsService.updateSettings({
        premium: {
          ...premium,
          cachedStatus: {
            active: status.active,
            plan: status.plan,
            expiresAt: status.expiresAt,
            lastVerified: Date.now()
          }
        }
      });

      console.log('[SubscriptionService] Setting isPremium to:', status.active);
      this.isPremium$.next(status.active);
      return status.active;

    } catch (error) {
      console.warn('[SubscriptionService] Verification failed:', error);

      // Offline fallback: use grace period
      if (premium.cachedStatus?.active && premium.cachedStatus.expiresAt) {
        const graceEnd = premium.cachedStatus.expiresAt + this.GRACE_PERIOD;
        const isInGrace = Date.now() < graceEnd;
        this.isPremium$.next(isInGrace);
        return isInGrace;
      }

      this.isPremium$.next(false);
      return false;

    } finally {
      this.isVerifying$.next(false);
    }
  }

  /**
   * Fetch subscription status from API
   */
  private async fetchSubscriptionStatus(email: string): Promise<SubscriptionStatus> {
    const url = `${this.API_URL}/verify?email=${encodeURIComponent(email)}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Verification failed: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Clear subscription data (for logout/reset)
   */
  clearSubscription(): void {
    const settings = this.settingsService.getSettings();

    this.settingsService.updateSettings({
      premium: {
        ...settings.premium,
        email: '',
        authToken: undefined,
        authTokenCreatedAt: undefined,
        cachedStatus: {
          active: false
        }
      }
    });

    this.isPremium$.next(false);
  }

  /**
   * Update subscription email (stores email but doesn't verify - use portal flow)
   */
  async setEmail(email: string): Promise<void> {
    const settings = this.settingsService.getSettings();

    this.settingsService.updateSettings({
      premium: {
        ...settings.premium,
        email: email.trim().toLowerCase(),
        // Clear auth token when email changes
        authToken: undefined,
        authTokenCreatedAt: undefined,
        cachedStatus: {
          active: false
        }
      }
    });

    this.isPremium$.next(false);
  }

  /**
   * Initiate portal verification flow
   * Returns the Stripe Customer Portal login_page URL
   *
   * SECURITY: The login_page requires users to verify their email via Stripe's OTP.
   * After verification, the billing_portal.session.created webhook fires,
   * and we can claim the verification via /api/auth/claim-verification.
   */
  async initiatePortalVerification(email: string): Promise<string> {
    const currentUrl = window.location.origin + '/settings?tab=premium';
    const url = `${this.API_URL}/portal?email=${encodeURIComponent(email)}&returnUrl=${encodeURIComponent(currentUrl)}`;

    const response = await fetch(url);
    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create portal session');
    }

    const data: PortalResponse = await response.json();
    return data.url;
  }

  /**
   * Create a direct portal session for authenticated users
   * Requires valid auth token - skips Stripe's login_page for better UX
   *
   * Benefits:
   * - Users see "Back to Creative Writer" instead of confusing "Abmelden" (logout)
   * - Faster portal access without OTP re-verification
   *
   * Falls back to null if token is invalid (caller should use login_page flow)
   */
  async createDirectPortalSession(): Promise<string | null> {
    const token = this.getAuthToken();
    if (!token) {
      return null;
    }

    const returnUrl = window.location.origin + '/settings?tab=premium';

    try {
      const response = await fetch(
        `${this.API_URL}/portal/session?returnUrl=${encodeURIComponent(returnUrl)}`,
        {
          headers: { 'Authorization': `Bearer ${token}` }
        }
      );

      if (!response.ok) {
        // Token invalid or subscription expired - clear token but keep email
        if (response.status === 401 || response.status === 403) {
          console.warn('[SubscriptionService] Auth token rejected, clearing token');
          const settings = this.settingsService.getSettings();
          this.settingsService.updateSettings({
            premium: {
              ...settings.premium,
              authToken: undefined,
              authTokenCreatedAt: undefined
            }
          });
        }
        return null;
      }

      const data: PortalResponse = await response.json();
      return data.url;
    } catch (error) {
      console.warn('[SubscriptionService] Direct portal session failed:', error);
      return null;
    }
  }

  /**
   * Claim portal verification after returning from Stripe
   *
   * Called after user returns from Stripe portal. Checks if they completed
   * Stripe's email OTP verification and claims the auth token if they did.
   *
   * @returns true if verification was successfully claimed, false if not yet verified
   */
  async claimPortalVerification(email: string): Promise<boolean> {
    const url = `${this.API_URL}/auth/claim-verification?email=${encodeURIComponent(email.trim().toLowerCase())}`;

    this.isVerifying$.next(true);

    try {
      const response = await fetch(url);

      if (response.status === 401) {
        // Not yet verified - this is expected if webhook hasn't fired yet
        return false;
      }

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Verification claim failed');
      }

      const data: SubscriptionStatus = await response.json();
      const settings = this.settingsService.getSettings();

      this.settingsService.updateSettings({
        premium: {
          ...settings.premium,
          email: email.trim().toLowerCase(),
          authToken: data.authToken,
          authTokenCreatedAt: Date.now(),
          cachedStatus: {
            active: data.active,
            plan: data.plan,
            expiresAt: data.expiresAt,
            lastVerified: Date.now()
          }
        }
      });

      this.isPremium$.next(data.active);
      return true;

    } finally {
      this.isVerifying$.next(false);
    }
  }

  /**
   * Exchange verification code for auth token
   * Called after user returns from Stripe Customer Portal
   *
   * SECURITY: The email parameter is required for the new secure flow.
   * The user must have verified their email via Stripe's login page
   * before the exchange will succeed.
   */
  async exchangeVerificationCode(code: string, email?: string): Promise<boolean> {
    const settings = this.settingsService.getSettings();
    const verificationEmail = (email || settings.premium?.email)?.trim().toLowerCase();

    if (!verificationEmail) {
      throw new Error('Email is required for verification');
    }

    const url = `${this.API_URL}/auth/exchange?code=${encodeURIComponent(code)}&email=${encodeURIComponent(verificationEmail)}`;

    this.isVerifying$.next(true);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Verification failed');
      }

      const data: SubscriptionStatus = await response.json();

      this.settingsService.updateSettings({
        premium: {
          ...settings.premium,
          email: verificationEmail,
          authToken: data.authToken,
          authTokenCreatedAt: Date.now(),
          cachedStatus: {
            active: data.active,
            plan: data.plan,
            expiresAt: data.expiresAt,
            lastVerified: Date.now()
          }
        }
      });

      this.isPremium$.next(data.active);
      return data.active;

    } catch (error) {
      console.error('[SubscriptionService] Token exchange failed:', error);
      throw error;
    } finally {
      this.isVerifying$.next(false);
    }
  }

  /**
   * Refresh auth token if it's getting old
   * Should be called periodically (e.g., on app init, every few days)
   */
  async refreshTokenIfNeeded(): Promise<void> {
    const settings = this.settingsService.getSettings();
    const token = settings.premium?.authToken;
    const createdAt = settings.premium?.authTokenCreatedAt || 0;

    // No token to refresh
    if (!token) {
      console.log('[SubscriptionService] No token to refresh');
      return;
    }

    // Token is still fresh
    if (Date.now() - createdAt < this.TOKEN_REFRESH_THRESHOLD) {
      console.log('[SubscriptionService] Token still fresh, skipping refresh');
      return;
    }

    console.log('[SubscriptionService] Token is old, refreshing...');

    try {
      const response = await fetch(`${this.API_URL}/auth/refresh`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        // Token invalid or subscription expired - clear it
        console.warn('[SubscriptionService] Token refresh failed, clearing subscription');
        this.clearSubscription();
        return;
      }

      const data: SubscriptionStatus = await response.json();

      this.settingsService.updateSettings({
        premium: {
          ...settings.premium,
          authToken: data.authToken,
          authTokenCreatedAt: Date.now(),
          cachedStatus: {
            active: data.active,
            plan: data.plan,
            expiresAt: data.expiresAt,
            lastVerified: Date.now()
          }
        }
      });

      this.isPremium$.next(data.active);
      console.log('[SubscriptionService] Token refreshed successfully');

    } catch (error) {
      console.warn('[SubscriptionService] Token refresh error:', error);
      // Don't clear subscription on network error - keep using existing token
    }
  }
}
