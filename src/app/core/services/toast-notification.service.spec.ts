import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { AlertController, ToastController } from '@ionic/angular/standalone';
import { ToastNotificationService } from './toast-notification.service';

describe('ToastNotificationService', () => {
  let service: ToastNotificationService;
  let mockToastController: jasmine.SpyObj<ToastController>;
  let mockAlertController: jasmine.SpyObj<AlertController>;
  let mockToastElement: jasmine.SpyObj<HTMLIonToastElement>;
  let mockAlertElement: jasmine.SpyObj<HTMLIonAlertElement>;

  beforeEach(() => {
    mockToastElement = jasmine.createSpyObj('HTMLIonToastElement', ['present', 'dismiss']);
    mockToastElement.present.and.returnValue(Promise.resolve());
    mockToastElement.dismiss.and.returnValue(Promise.resolve(true));

    mockAlertElement = jasmine.createSpyObj('HTMLIonAlertElement', ['present']);
    mockAlertElement.present.and.returnValue(Promise.resolve());

    mockToastController = jasmine.createSpyObj('ToastController', ['create']);
    mockToastController.create.and.returnValue(Promise.resolve(mockToastElement));

    mockAlertController = jasmine.createSpyObj('AlertController', ['create']);
    mockAlertController.create.and.returnValue(Promise.resolve(mockAlertElement));

    TestBed.configureTestingModule({
      providers: [
        ToastNotificationService,
        { provide: ToastController, useValue: mockToastController },
        { provide: AlertController, useValue: mockAlertController }
      ]
    });

    service = TestBed.inject(ToastNotificationService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('showAIError', () => {
    it('should create and present a toast for an error', async () => {
      await service.showAIError('Test error message', 'generic');

      expect(mockToastController.create).toHaveBeenCalled();
      expect(mockToastElement.present).toHaveBeenCalled();
    });

    it('should display user-friendly message for rate-limit errors', async () => {
      await service.showAIError('rate limit exceeded', 'rate-limit');

      expect(mockToastController.create).toHaveBeenCalledWith(
        jasmine.objectContaining({
          message: 'AI service rate limit reached. Please wait a moment.'
        })
      );
    });

    it('should display user-friendly message for auth errors', async () => {
      await service.showAIError('invalid api key', 'auth');

      expect(mockToastController.create).toHaveBeenCalledWith(
        jasmine.objectContaining({
          message: 'API key issue. Please check your settings.'
        })
      );
    });

    it('should display user-friendly message for content-filter errors', async () => {
      await service.showAIError('content blocked', 'content-filter');

      expect(mockToastController.create).toHaveBeenCalledWith(
        jasmine.objectContaining({
          message: 'Content blocked by safety filters. Try rephrasing.'
        })
      );
    });

    it('should display user-friendly message for timeout errors', async () => {
      await service.showAIError('request timed out', 'timeout');

      expect(mockToastController.create).toHaveBeenCalledWith(
        jasmine.objectContaining({
          message: 'Request timed out. The AI service may be busy.'
        })
      );
    });

    it('should display user-friendly message for server errors', async () => {
      await service.showAIError('internal server error', 'server');

      expect(mockToastController.create).toHaveBeenCalledWith(
        jasmine.objectContaining({
          message: 'AI service temporarily unavailable.'
        })
      );
    });

    it('should display user-friendly message for network errors', async () => {
      await service.showAIError('failed to fetch', 'network');

      expect(mockToastController.create).toHaveBeenCalledWith(
        jasmine.objectContaining({
          message: 'Network issue. Check your connection.'
        })
      );
    });

    it('should display user-friendly message for generic errors', async () => {
      await service.showAIError('unknown error', 'generic');

      expect(mockToastController.create).toHaveBeenCalledWith(
        jasmine.objectContaining({
          message: 'AI generation failed. Please try again.'
        })
      );
    });

    it('should use warning color for rate-limit errors', async () => {
      await service.showAIError('rate limit', 'rate-limit');

      expect(mockToastController.create).toHaveBeenCalledWith(
        jasmine.objectContaining({
          color: 'warning'
        })
      );
    });

    it('should use warning color for timeout errors', async () => {
      await service.showAIError('timeout', 'timeout');

      expect(mockToastController.create).toHaveBeenCalledWith(
        jasmine.objectContaining({
          color: 'warning'
        })
      );
    });

    it('should use danger color for auth errors', async () => {
      await service.showAIError('auth error', 'auth');

      expect(mockToastController.create).toHaveBeenCalledWith(
        jasmine.objectContaining({
          color: 'danger'
        })
      );
    });

    it('should use danger color for generic errors', async () => {
      await service.showAIError('error', 'generic');

      expect(mockToastController.create).toHaveBeenCalledWith(
        jasmine.objectContaining({
          color: 'danger'
        })
      );
    });

    it('should position toast at top', async () => {
      await service.showAIError('error', 'generic');

      expect(mockToastController.create).toHaveBeenCalledWith(
        jasmine.objectContaining({
          position: 'top'
        })
      );
    });

    it('should set duration to 4000ms', async () => {
      await service.showAIError('error', 'generic');

      expect(mockToastController.create).toHaveBeenCalledWith(
        jasmine.objectContaining({
          duration: 4000
        })
      );
    });
  });

  describe('details button', () => {
    it('should include a Details button on the toast', async () => {
      await service.showAIError('Some error message', 'generic');

      const createArgs = mockToastController.create.calls.mostRecent().args[0]!;
      const buttons = createArgs.buttons as { text: string; role?: string; handler?: () => boolean }[];
      const detailsButton = buttons.find(b => b.text === 'Details');
      expect(detailsButton).toBeTruthy();
    });

    it('should open an alert with full error message when Details is clicked', async () => {
      mockAlertElement.onDidDismiss = jasmine.createSpy('onDidDismiss')
        .and.returnValue(new Promise(_resolve => { /* never resolves */ }));

      await service.showAIError('No endpoints found matching your data policy', 'config');

      const createArgs = mockToastController.create.calls.mostRecent().args[0]!;
      const buttons = createArgs.buttons as { text: string; role?: string; handler?: () => boolean }[];
      const detailsButton = buttons.find(b => b.text === 'Details')!;

      // Simulate clicking the Details button
      detailsButton.handler!();

      // Wait for async alert creation
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockAlertController.create).toHaveBeenCalledWith(
        jasmine.objectContaining({
          header: 'Error Details',
          message: 'No endpoints found matching your data policy'
        })
      );
      expect(mockAlertElement.present).toHaveBeenCalled();
    });

    it('should HTML-escape error messages in the alert', async () => {
      mockAlertElement.onDidDismiss = jasmine.createSpy('onDidDismiss')
        .and.returnValue(new Promise(_resolve => { /* never resolves */ }));

      await service.showAIError('<script>alert("xss")</script>', 'generic');

      const createArgs = mockToastController.create.calls.mostRecent().args[0]!;
      const buttons = createArgs.buttons as { text: string; role?: string; handler?: () => boolean }[];
      const detailsButton = buttons.find(b => b.text === 'Details')!;

      detailsButton.handler!();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockAlertController.create).toHaveBeenCalledWith(
        jasmine.objectContaining({
          message: '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
        })
      );
    });

    it('should return false from Details handler to keep toast open', async () => {
      await service.showAIError('Some error', 'generic');

      const createArgs = mockToastController.create.calls.mostRecent().args[0]!;
      const buttons = createArgs.buttons as { text: string; role?: string; handler?: () => boolean }[];
      const detailsButton = buttons.find(b => b.text === 'Details')!;

      const result = detailsButton.handler!();
      expect(result).toBe(false);
    });

    it('should handle alert creation failure gracefully', async () => {
      mockAlertController.create.and.returnValue(Promise.reject(new Error('Overlay error')));

      await service.showAIError('Some error', 'generic');

      const createArgs = mockToastController.create.calls.mostRecent().args[0]!;
      const buttons = createArgs.buttons as { text: string; role?: string; handler?: () => boolean }[];
      const detailsButton = buttons.find(b => b.text === 'Details')!;

      // Should not throw
      detailsButton.handler!();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  });

  describe('deduplication', () => {
    it('should not show duplicate errors within 5 second window', async () => {
      await service.showAIError('same error', 'generic');
      await service.showAIError('same error', 'generic');
      await service.showAIError('same error', 'generic');

      expect(mockToastController.create).toHaveBeenCalledTimes(1);
    });

    it('should show same error after 5 second window', fakeAsync(async () => {
      await service.showAIError('same error', 'generic');
      expect(mockToastController.create).toHaveBeenCalledTimes(1);

      tick(5001);

      await service.showAIError('same error', 'generic');
      expect(mockToastController.create).toHaveBeenCalledTimes(2);
    }));

    it('should show different errors even within window', async () => {
      await service.showAIError('error one', 'generic');
      await service.showAIError('error two', 'generic');

      expect(mockToastController.create).toHaveBeenCalledTimes(2);
    });

    it('should deduplicate based on error type and message', async () => {
      await service.showAIError('same message', 'auth');
      await service.showAIError('same message', 'generic');

      expect(mockToastController.create).toHaveBeenCalledTimes(2);
    });

    it('should treat messages with same first 50 chars as duplicates', async () => {
      const longMessage1 = 'A'.repeat(50) + ' unique ending 1';
      const longMessage2 = 'A'.repeat(50) + ' unique ending 2';

      await service.showAIError(longMessage1, 'generic');
      await service.showAIError(longMessage2, 'generic');

      expect(mockToastController.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('toast lifecycle', () => {
    it('should dismiss previous toast before showing new one', async () => {
      await service.showAIError('first error', 'generic');
      await service.showAIError('second error', 'auth');

      expect(mockToastElement.dismiss).toHaveBeenCalledTimes(1);
      expect(mockToastController.create).toHaveBeenCalledTimes(2);
    });

    it('should handle dismiss errors gracefully', async () => {
      mockToastElement.dismiss.and.returnValue(Promise.reject(new Error('Already dismissed')));

      await service.showAIError('first error', 'generic');
      await service.showAIError('second error', 'auth');

      expect(mockToastController.create).toHaveBeenCalledTimes(2);
    });
  });
});
