import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  const USER_KEY = 'creative-writer-user';
  const LOCAL_ONLY_KEY = 'creative-writer-local-only';
  const CREDENTIALS_KEY = 'creative-writer-sync-credentials';

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('should enter local-only mode and use anonymous database', () => {
    const service = TestBed.inject(AuthService);

    service.loginLocalOnly();

    const user = service.getCurrentUser();
    expect(user).toBeTruthy();
    expect(user?.username).toBe('local');
    expect(service.getUserDatabaseName()).toBe('creative-writer-stories-anonymous');
    expect(service.getSyncCredentials()).toBeNull();
    expect(localStorage.getItem(LOCAL_ONLY_KEY)).toBe('true');
  });

  it('should clear legacy stored user without sync credentials', () => {
    localStorage.setItem(USER_KEY, JSON.stringify({
      username: 'legacy-user',
      displayName: 'Legacy User',
      lastLogin: new Date().toISOString()
    }));

    const service = TestBed.inject(AuthService);

    expect(service.getCurrentUser()).toBeNull();
    expect(localStorage.getItem(USER_KEY)).toBeNull();
  });

  it('should login via auth API and persist sync credentials', async () => {
    const service = TestBed.inject(AuthService);
    const fetchSpy = spyOn(window, 'fetch').and.resolveTo(new Response(
      JSON.stringify({
        username: 'test-user',
        displayName: 'Test User'
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    ));

    const user = await service.login('Test-User', 'password123', 'Display Name');

    expect(fetchSpy).toHaveBeenCalled();
    expect(user.username).toBe('test-user');
    expect(service.getCurrentUser()?.username).toBe('test-user');
    expect(service.getSyncCredentials()).toEqual({
      username: 'test-user',
      password: 'password123'
    });

    const storedUser = JSON.parse(localStorage.getItem(USER_KEY) || '{}') as { username?: string };
    const storedCredentials = JSON.parse(localStorage.getItem(CREDENTIALS_KEY) || '{}') as { username?: string };
    expect(storedUser.username).toBe('test-user');
    expect(storedCredentials.username).toBe('test-user');
  });

  it('should show account exists message when signup returns conflict', async () => {
    const service = TestBed.inject(AuthService);
    spyOn(window, 'fetch').and.resolveTo(new Response(
      JSON.stringify({ error: 'username_exists' }),
      {
        status: 409,
        headers: {
          'Content-Type': 'application/json'
        }
      }
    ));

    await expectAsync(service.signup('existing-user', 'password123')).toBeRejectedWithError(
      'Account already exists. Please sign in or choose another username.'
    );
  });
});
