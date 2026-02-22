import { TestBed } from '@angular/core/testing';
import { PremiumAccessService, PremiumAccessResult } from './premium-access.service';
import { SubscriptionService } from './subscription.service';

describe('PremiumAccessService', () => {
  let service: PremiumAccessService;
  let mockSubscriptionService: jasmine.SpyObj<SubscriptionService>;

  beforeEach(() => {
    mockSubscriptionService = jasmine.createSpyObj('SubscriptionService', [
      'hasValidAuthToken',
      'checkSubscription'
    ], {
      isPremium: false
    });

    TestBed.configureTestingModule({
      providers: [
        PremiumAccessService,
        { provide: SubscriptionService, useValue: mockSubscriptionService }
      ]
    });

    service = TestBed.inject(PremiumAccessService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('isPremium getter', () => {
    it('should return false when subscription is not premium', () => {
      Object.defineProperty(mockSubscriptionService, 'isPremium', { get: () => false });
      expect(service.isPremium).toBe(false);
    });

    it('should return true when subscription is premium', () => {
      Object.defineProperty(mockSubscriptionService, 'isPremium', { get: () => true });
      expect(service.isPremium).toBe(true);
    });
  });

  describe('hasValidToken getter', () => {
    it('should return false when no valid auth token', () => {
      mockSubscriptionService.hasValidAuthToken.and.returnValue(false);
      expect(service.hasValidToken).toBe(false);
    });

    it('should return true when valid auth token exists', () => {
      mockSubscriptionService.hasValidAuthToken.and.returnValue(true);
      expect(service.hasValidToken).toBe(true);
    });
  });

  describe('checkAccess', () => {
    it('should return granted when user has valid auth token', async () => {
      mockSubscriptionService.hasValidAuthToken.and.returnValue(true);

      const result: PremiumAccessResult = await service.checkAccess();

      expect(result.hasAccess).toBe(true);
      expect(result.reason).toBe('granted');
      expect(mockSubscriptionService.checkSubscription).not.toHaveBeenCalled();
    });

    it('should return verification_needed when premium but no auth token', async () => {
      mockSubscriptionService.hasValidAuthToken.and.returnValue(false);
      mockSubscriptionService.checkSubscription.and.returnValue(Promise.resolve(true));

      const result: PremiumAccessResult = await service.checkAccess();

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('verification_needed');
    });

    it('should return not_premium when not subscribed', async () => {
      mockSubscriptionService.hasValidAuthToken.and.returnValue(false);
      mockSubscriptionService.checkSubscription.and.returnValue(Promise.resolve(false));

      const result: PremiumAccessResult = await service.checkAccess();

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('not_premium');
    });

    it('should return network_error on subscription check failure', async () => {
      mockSubscriptionService.hasValidAuthToken.and.returnValue(false);
      mockSubscriptionService.checkSubscription.and.returnValue(
        Promise.reject(new Error('Network error'))
      );

      const result: PremiumAccessResult = await service.checkAccess();

      expect(result.hasAccess).toBe(false);
      expect(result.reason).toBe('network_error');
    });

    it('should not call checkSubscription when auth token is valid', async () => {
      mockSubscriptionService.hasValidAuthToken.and.returnValue(true);

      await service.checkAccess();

      expect(mockSubscriptionService.checkSubscription).not.toHaveBeenCalled();
    });

    it('should call checkSubscription when auth token is invalid', async () => {
      mockSubscriptionService.hasValidAuthToken.and.returnValue(false);
      mockSubscriptionService.checkSubscription.and.returnValue(Promise.resolve(false));

      await service.checkAccess();

      expect(mockSubscriptionService.checkSubscription).toHaveBeenCalled();
    });
  });
});
