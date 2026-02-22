import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { AIErrorInterceptorService } from './ai-error-interceptor.service';
import { AIRequestLoggerService, AIRequestLog } from './ai-request-logger.service';
import { ToastNotificationService } from './toast-notification.service';

describe('AIErrorInterceptorService', () => {
  let service: AIErrorInterceptorService;
  let mockToastService: jasmine.SpyObj<ToastNotificationService>;
  let logsSubject: BehaviorSubject<AIRequestLog[]>;
  let mockAILogger: Partial<AIRequestLoggerService>;

  const createErrorLog = (overrides: Partial<AIRequestLog> = {}): AIRequestLog => ({
    id: 'log-' + Math.random().toString(36).substr(2, 9),
    timestamp: new Date(),
    endpoint: 'https://api.test.com',
    model: 'test-model',
    wordCount: 100,
    maxTokens: 500,
    prompt: 'Test prompt',
    status: 'error',
    error: 'Test error',
    ...overrides
  });

  beforeEach(() => {
    logsSubject = new BehaviorSubject<AIRequestLog[]>([]);

    mockAILogger = {
      logs$: logsSubject.asObservable()
    };

    mockToastService = jasmine.createSpyObj('ToastNotificationService', ['showAIError']);
    mockToastService.showAIError.and.returnValue(Promise.resolve());

    TestBed.configureTestingModule({
      providers: [
        AIErrorInterceptorService,
        { provide: AIRequestLoggerService, useValue: mockAILogger },
        { provide: ToastNotificationService, useValue: mockToastService }
      ]
    });

    service = TestBed.inject(AIErrorInterceptorService);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('error interception', () => {
    it('should show toast when error log is added', () => {
      const errorLog = createErrorLog();
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalled();
    });

    it('should not show toast for success logs', () => {
      const successLog = createErrorLog({ status: 'success', error: undefined });
      logsSubject.next([successLog]);

      expect(mockToastService.showAIError).not.toHaveBeenCalled();
    });

    it('should not show toast for pending logs', () => {
      const pendingLog = createErrorLog({ status: 'pending', error: undefined });
      logsSubject.next([pendingLog]);

      expect(mockToastService.showAIError).not.toHaveBeenCalled();
    });

    it('should not show toast for aborted logs', () => {
      const abortedLog = createErrorLog({ status: 'aborted' });
      logsSubject.next([abortedLog]);

      expect(mockToastService.showAIError).not.toHaveBeenCalled();
    });

    it('should not show duplicate toasts for same error ID', () => {
      const errorLog = createErrorLog();
      logsSubject.next([errorLog]);
      logsSubject.next([errorLog]);
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledTimes(1);
    });

    it('should show toasts for different error IDs', () => {
      const errorLog1 = createErrorLog({ id: 'log-1' });
      const errorLog2 = createErrorLog({ id: 'log-2' });

      logsSubject.next([errorLog1]);
      logsSubject.next([errorLog1, errorLog2]);

      expect(mockToastService.showAIError).toHaveBeenCalledTimes(2);
    });
  });

  describe('old error skipping', () => {
    it('should skip errors older than 30 seconds', () => {
      const oldError = createErrorLog({
        timestamp: new Date(Date.now() - 31000)
      });
      logsSubject.next([oldError]);

      expect(mockToastService.showAIError).not.toHaveBeenCalled();
    });

    it('should show errors within 30 second window', () => {
      const recentError = createErrorLog({
        timestamp: new Date(Date.now() - 5000)
      });
      logsSubject.next([recentError]);

      expect(mockToastService.showAIError).toHaveBeenCalled();
    });

    it('should show errors that occurred after service init', () => {
      const newError = createErrorLog({
        timestamp: new Date()
      });
      logsSubject.next([newError]);

      expect(mockToastService.showAIError).toHaveBeenCalled();
    });
  });

  describe('error classification', () => {
    it('should classify HTTP 429 as rate-limit', () => {
      const errorLog = createErrorLog({ httpStatus: 429 });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'rate-limit'
      );
    });

    it('should classify "rate limit" in message as rate-limit', () => {
      const errorLog = createErrorLog({ error: 'You have exceeded the rate limit' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'rate-limit'
      );
    });

    it('should classify "too many requests" as rate-limit', () => {
      const errorLog = createErrorLog({ error: 'Too many requests, please slow down' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'rate-limit'
      );
    });

    it('should classify HTTP 401 as auth', () => {
      const errorLog = createErrorLog({ httpStatus: 401 });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'auth'
      );
    });

    it('should classify HTTP 403 as auth', () => {
      const errorLog = createErrorLog({ httpStatus: 403 });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'auth'
      );
    });

    it('should classify "api key" in message as auth', () => {
      const errorLog = createErrorLog({ error: 'Invalid API key provided' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'auth'
      );
    });

    it('should classify "unauthorized" as auth', () => {
      const errorLog = createErrorLog({ error: 'Unauthorized access' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'auth'
      );
    });

    it('should classify "blocked" as content-filter', () => {
      const errorLog = createErrorLog({ error: 'Content was blocked by safety system' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'content-filter'
      );
    });

    it('should classify "safety" as content-filter', () => {
      const errorLog = createErrorLog({ error: 'Safety filter triggered' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'content-filter'
      );
    });

    it('should classify safetyRatings blockReason as content-filter', () => {
      const errorLog = createErrorLog({
        error: 'Request failed',
        safetyRatings: {
          promptFeedback: {
            blockReason: 'SAFETY'
          }
        }
      });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'content-filter'
      );
    });

    it('should classify "timeout" as timeout', () => {
      const errorLog = createErrorLog({ error: 'Request timeout' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'timeout'
      );
    });

    it('should classify "timed out" as timeout', () => {
      const errorLog = createErrorLog({ error: 'The request timed out' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'timeout'
      );
    });

    it('should classify "deadline" as timeout', () => {
      const errorLog = createErrorLog({ error: 'Deadline exceeded' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'timeout'
      );
    });

    it('should classify "failed to fetch" as network', () => {
      const errorLog = createErrorLog({ error: 'Failed to fetch' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'network'
      );
    });

    it('should classify "connection" errors as network', () => {
      const errorLog = createErrorLog({ error: 'Connection refused' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'network'
      );
    });

    it('should classify "offline" as network', () => {
      const errorLog = createErrorLog({ error: 'You appear to be offline' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'network'
      );
    });

    it('should classify HTTP 500 as server', () => {
      const errorLog = createErrorLog({ httpStatus: 500 });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'server'
      );
    });

    it('should classify HTTP 502 as server', () => {
      const errorLog = createErrorLog({ httpStatus: 502 });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'server'
      );
    });

    it('should classify HTTP 503 as server', () => {
      const errorLog = createErrorLog({ httpStatus: 503 });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'server'
      );
    });

    it('should classify "internal error" as server', () => {
      const errorLog = createErrorLog({ error: 'Internal server error occurred' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'server'
      );
    });

    it('should classify unknown errors as generic', () => {
      const errorLog = createErrorLog({ error: 'Something went wrong' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'generic'
      );
    });

    it('should check errorDetails for classification', () => {
      const errorLog = createErrorLog({
        error: 'Request failed',
        errorDetails: { message: 'rate limit exceeded' }
      });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'rate-limit'
      );
    });
  });

  describe('message sanitization', () => {
    it('should redact OpenAI-style API keys', () => {
      const errorLog = createErrorLog({
        error: 'Invalid key: sk-abc123def456ghi789jkl012mno345pqr678'
      });
      logsSubject.next([errorLog]);

      const calledMessage = mockToastService.showAIError.calls.mostRecent().args[0];
      expect(calledMessage).not.toContain('sk-abc');
      expect(calledMessage).toContain('[API_KEY]');
    });

    it('should redact generic key patterns', () => {
      const errorLog = createErrorLog({
        error: 'Error with key=abc123def456ghi789jkl012mno'
      });
      logsSubject.next([errorLog]);

      const calledMessage = mockToastService.showAIError.calls.mostRecent().args[0];
      expect(calledMessage).toContain('[REDACTED]');
    });

    it('should truncate very long messages', () => {
      const longMessage = 'A'.repeat(300);
      const errorLog = createErrorLog({ error: longMessage });
      logsSubject.next([errorLog]);

      const calledMessage = mockToastService.showAIError.calls.mostRecent().args[0];
      expect(calledMessage.length).toBeLessThanOrEqual(203); // 200 + '...'
      expect(calledMessage).toContain('...');
    });

    it('should handle undefined error message', () => {
      const errorLog = createErrorLog({ error: undefined });
      logsSubject.next([errorLog]);

      const calledMessage = mockToastService.showAIError.calls.mostRecent().args[0];
      expect(calledMessage).toBe('Unknown error');
    });
  });

  describe('cleanup', () => {
    it('should clean up processed IDs when logs are removed', () => {
      const errorLog1 = createErrorLog({ id: 'log-1' });
      const errorLog2 = createErrorLog({ id: 'log-2' });

      logsSubject.next([errorLog1]);
      logsSubject.next([errorLog1, errorLog2]);
      logsSubject.next([errorLog2]); // Remove log-1

      // Adding log-1 back should trigger a new toast since it was cleaned up
      const errorLog1Again = createErrorLog({ id: 'log-1' });
      logsSubject.next([errorLog2, errorLog1Again]);

      expect(mockToastService.showAIError).toHaveBeenCalledTimes(3);
    });

    it('should unsubscribe on destroy', () => {
      service.ngOnDestroy();

      const errorLog = createErrorLog();
      logsSubject.next([errorLog]);

      // After initial subscription, we got 0 calls, then destroy, then emit - should still be 0
      // (Initial empty array doesn't trigger anything)
      expect(mockToastService.showAIError).not.toHaveBeenCalled();
    });
  });

  describe('case insensitivity', () => {
    it('should classify uppercase error messages correctly', () => {
      const errorLog = createErrorLog({ error: 'RATE LIMIT EXCEEDED' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'rate-limit'
      );
    });

    it('should classify mixed case error messages correctly', () => {
      const errorLog = createErrorLog({ error: 'API Key Invalid' });
      logsSubject.next([errorLog]);

      expect(mockToastService.showAIError).toHaveBeenCalledWith(
        jasmine.any(String),
        'auth'
      );
    });
  });
});
