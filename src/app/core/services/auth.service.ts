import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';

export interface User {
  username: string;
  displayName?: string;
  lastLogin: Date;
  localOnly?: boolean;
}

export interface SyncCredentials {
  username: string;
  password: string;
}

interface StoredUser {
  username: string;
  displayName?: string;
  lastLogin: string;
  localOnly?: boolean;
}

interface AuthApiResponse {
  username: string;
  displayName?: string;
  message?: string;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly USER_STORAGE_KEY = 'creative-writer-user';
  private readonly LOCAL_ONLY_STORAGE_KEY = 'creative-writer-local-only';
  private readonly SYNC_CREDENTIALS_STORAGE_KEY = 'creative-writer-sync-credentials';
  private readonly AUTH_API_BASE = '/api/auth';

  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$: Observable<User | null> = this.currentUserSubject.asObservable();

  constructor() {
    // Check for existing session on startup
    this.loadCurrentUser();
  }

  private loadCurrentUser(): void {
    // Check for local-only mode first
    const isLocalOnly = localStorage.getItem(this.LOCAL_ONLY_STORAGE_KEY);
    if (isLocalOnly === 'true') {
      // Auto-login as local user
      const localUser: User = {
        username: 'local',
        displayName: 'Local User',
        lastLogin: new Date(),
        localOnly: true
      };
      this.currentUserSubject.next(localUser);
      return;
    }

    // Check for regular user session
    const stored = localStorage.getItem(this.USER_STORAGE_KEY);
    if (stored) {
      try {
        const storedUser = JSON.parse(stored) as StoredUser;
        const credentials = this.getStoredSyncCredentials();

        // Legacy compatibility: old username-only sessions must re-authenticate for sync.
        if (!credentials || credentials.username !== storedUser.username) {
          localStorage.removeItem(this.USER_STORAGE_KEY);
          localStorage.removeItem(this.SYNC_CREDENTIALS_STORAGE_KEY);
          this.currentUserSubject.next(null);
          return;
        }

        const user: User = {
          username: storedUser.username,
          displayName: storedUser.displayName,
          lastLogin: new Date(storedUser.lastLogin),
          localOnly: storedUser.localOnly
        };

        this.currentUserSubject.next(user);
      } catch (error) {
        console.warn('Invalid stored user data:', error);
        this.logout();
      }
    }
  }

  private saveCurrentUser(user: User): void {
    const storedUser: StoredUser = {
      username: user.username,
      displayName: user.displayName,
      lastLogin: user.lastLogin.toISOString(),
      localOnly: user.localOnly
    };
    localStorage.setItem(this.USER_STORAGE_KEY, JSON.stringify(storedUser));
    this.currentUserSubject.next(user);
  }

  private sanitizeUsername(username: string): string {
    return username
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .substring(0, 20);
  }

  private validatePassword(password: string): boolean {
    return password.length >= 8 && password.length <= 128;
  }

  private getStoredSyncCredentials(): SyncCredentials | null {
    const stored = localStorage.getItem(this.SYNC_CREDENTIALS_STORAGE_KEY);
    if (!stored) return null;
    try {
      const parsed = JSON.parse(stored) as SyncCredentials;
      if (!parsed.username || !parsed.password) {
        return null;
      }
      return parsed;
    } catch {
      return null;
    }
  }

  private saveSyncCredentials(credentials: SyncCredentials): void {
    localStorage.setItem(this.SYNC_CREDENTIALS_STORAGE_KEY, JSON.stringify(credentials));
  }

  private clearSyncCredentials(): void {
    localStorage.removeItem(this.SYNC_CREDENTIALS_STORAGE_KEY);
  }

  private async parseApiError(response: Response, fallback: string): Promise<string> {
    try {
      const data = await response.json() as { message?: string; error?: string };
      if (data.message) {
        return data.message;
      }

      if (data.error === 'username_exists') {
        return 'Account already exists. Please sign in or choose another username.';
      }

      if (data.error === 'invalid_credentials') {
        return 'Invalid username or password.';
      }

      return data.error || fallback;
    } catch {
      return fallback;
    }
  }

  private async authenticate(
    endpoint: '/login' | '/signup',
    username: string,
    password: string,
    displayName?: string
  ): Promise<User> {
    const trimmedUsername = username.trim();
    if (!trimmedUsername || trimmedUsername.length < 2) {
      throw new Error('Username must be at least 2 characters');
    }

    if (!this.validatePassword(password)) {
      throw new Error('Password must be between 8 and 128 characters');
    }

    const sanitizedUsername = this.sanitizeUsername(trimmedUsername);
    if (!sanitizedUsername || sanitizedUsername.length < 2) {
      throw new Error('Invalid username');
    }

    const response = await fetch(`${this.AUTH_API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      credentials: 'include',
      body: JSON.stringify({
        username: sanitizedUsername,
        password,
        displayName
      })
    });

    if (!response.ok) {
      if (endpoint === '/signup' && response.status === 409) {
        throw new Error('Account already exists. Please sign in or choose another username.');
      }

      const defaultMessage = endpoint === '/signup' ? 'Account creation failed' : 'Sign in failed';
      const message = await this.parseApiError(response, defaultMessage);
      throw new Error(message);
    }

    const data = await response.json() as AuthApiResponse;
    const resolvedUsername = this.sanitizeUsername(data.username || sanitizedUsername);
    const user: User = {
      username: resolvedUsername,
      displayName: data.displayName || displayName || trimmedUsername,
      lastLogin: new Date(),
      localOnly: false
    };

    // Clear local-only mode when using synced account
    localStorage.removeItem(this.LOCAL_ONLY_STORAGE_KEY);
    this.saveSyncCredentials({
      username: resolvedUsername,
      password
    });
    this.saveCurrentUser(user);
    return user;
  }

  async login(username: string, password: string, displayName?: string): Promise<User> {
    return this.authenticate('/login', username, password, displayName);
  }

  async signup(username: string, password: string, displayName?: string): Promise<User> {
    return this.authenticate('/signup', username, password, displayName);
  }

  loginLocalOnly(): void {
    // Set local-only flag
    localStorage.setItem(this.LOCAL_ONLY_STORAGE_KEY, 'true');
    localStorage.removeItem(this.USER_STORAGE_KEY);
    this.clearSyncCredentials();
    
    // Create local user
    const localUser: User = {
      username: 'local',
      displayName: 'Local User',
      lastLogin: new Date(),
      localOnly: true
    };
    
    // Don't save to regular user storage, just update current user
    this.currentUserSubject.next(localUser);
  }

  logout(): void {
    // Fire-and-forget remote logout (best effort)
    if (!this.isLocalOnlyMode()) {
      fetch(`${this.AUTH_API_BASE}/logout`, {
        method: 'POST',
        credentials: 'include'
      }).catch(err => {
        console.warn('Remote logout failed:', err);
      });
    }

    localStorage.removeItem(this.USER_STORAGE_KEY);
    localStorage.removeItem(this.LOCAL_ONLY_STORAGE_KEY);
    this.clearSyncCredentials();
    this.currentUserSubject.next(null);
  }

  getCurrentUser(): User | null {
    return this.currentUserSubject.value;
  }

  isLoggedIn(): boolean {
    return this.getCurrentUser() !== null;
  }

  private isLocalOnlyMode(): boolean {
    return localStorage.getItem(this.LOCAL_ONLY_STORAGE_KEY) === 'true';
  }

  getSyncCredentials(): SyncCredentials | null {
    if (this.isLocalOnlyMode()) {
      return null;
    }

    const currentUser = this.getCurrentUser();
    if (!currentUser || currentUser.username === 'local') {
      return null;
    }

    const credentials = this.getStoredSyncCredentials();
    if (!credentials) {
      return null;
    }

    return credentials.username === currentUser.username ? credentials : null;
  }

  getBasicAuthHeader(): string | null {
    const credentials = this.getSyncCredentials();
    if (!credentials) {
      return null;
    }
    return `Basic ${btoa(`${credentials.username}:${credentials.password}`)}`;
  }

  getUserDatabaseName(): string | null {
    const user = this.getCurrentUser();
    if (!user) return null;
    
    // For local-only mode, use the anonymous database
    if (user.username === 'local' || user.localOnly) {
      return 'creative-writer-stories-anonymous';
    }
    
    return `creative-writer-stories-${user.username}`;
  }
}
