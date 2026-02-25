import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';

type AuthMode = 'signin' | 'signup';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-container" *ngIf="!isLoggedIn">
      <div class="login-card">
        <h2>Creative Writer</h2>
        <p class="login-subtitle">
          {{ mode === 'signin' ? 'Sign in to sync your stories securely' : 'Create an account to enable cloud sync' }}
        </p>

        <div class="mode-toggle" role="tablist" aria-label="Authentication mode">
          <button
            type="button"
            class="mode-btn"
            [class.active]="mode === 'signin'"
            (click)="setMode('signin')">
            Sign in
          </button>
          <button
            type="button"
            class="mode-btn"
            [class.active]="mode === 'signup'"
            (click)="setMode('signup')">
            Create account
          </button>
        </div>

        <div class="migration-hint">
          <h3>Upgrading from older versions?</h3>
          <p>
            If you used sync before passwords were introduced, choose
            <strong>Create account</strong> and use your previous username.
          </p>
        </div>

        <form (ngSubmit)="onSubmit()" #loginForm="ngForm">
          <div class="form-group">
            <label for="username">Username</label>
            <input
              type="text"
              id="username"
              name="username"
              [(ngModel)]="username"
              required
              minlength="2"
              maxlength="20"
              pattern="[a-zA-Z0-9_-]+"
              placeholder="your-username"
              #usernameField="ngModel">
            <div class="field-help" *ngIf="usernameField.invalid && usernameField.touched">
              <small *ngIf="usernameField.errors?.['required']">Username is required</small>
              <small *ngIf="usernameField.errors?.['minlength']">At least 2 characters</small>
              <small *ngIf="usernameField.errors?.['pattern']">Only letters, numbers, _ and - allowed</small>
            </div>
          </div>

          <div class="form-group">
            <label for="password">Password</label>
            <input
              type="password"
              id="password"
              name="password"
              [(ngModel)]="password"
              required
              minlength="8"
              maxlength="128"
              placeholder="At least 8 characters"
              #passwordField="ngModel">
            <div class="field-help" *ngIf="passwordField.invalid && passwordField.touched">
              <small *ngIf="passwordField.errors?.['required']">Password is required</small>
              <small *ngIf="passwordField.errors?.['minlength']">At least 8 characters</small>
            </div>
          </div>

          <div class="form-group" *ngIf="mode === 'signup'">
            <label for="confirmPassword">Confirm password</label>
            <input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              [(ngModel)]="confirmPassword"
              required
              minlength="8"
              maxlength="128"
              placeholder="Repeat password"
              #confirmPasswordField="ngModel">
            <div class="field-help" *ngIf="confirmPasswordField.invalid && confirmPasswordField.touched">
              <small *ngIf="confirmPasswordField.errors?.['required']">Please confirm your password</small>
            </div>
            <div class="field-help" *ngIf="confirmPasswordField.touched && password !== confirmPassword">
              <small>Passwords do not match</small>
            </div>
          </div>

          <div class="form-group">
            <label for="displayName">Display name (optional)</label>
            <input
              type="text"
              id="displayName"
              name="displayName"
              [(ngModel)]="displayName"
              maxlength="50"
              placeholder="Your Name">
          </div>

          <button
            type="submit"
            class="login-btn"
            [disabled]="loginForm.invalid || isLoading || (mode === 'signup' && password !== confirmPassword)">
            <span *ngIf="!isLoading">{{ mode === 'signin' ? 'Sign in' : 'Create account' }}</span>
            <span *ngIf="isLoading">{{ mode === 'signin' ? 'Signing in...' : 'Creating account...' }}</span>
          </button>

          <div class="error-message" *ngIf="errorMessage">
            {{ errorMessage }}
          </div>
        </form>

        <div class="login-info">
          <h3>Sync mode</h3>
          <ul>
            <li>Stories sync automatically across your devices</li>
            <li>Each username gets an isolated CouchDB database</li>
            <li>Use only letters, numbers, underscore (_), and hyphen (-) in usernames</li>
          </ul>
        </div>

        <div class="divider-with-text">
          <span>OR</span>
        </div>

        <div class="local-info">
          <h3>Local-only mode</h3>
          <ul>
            <li>Stories remain on this device only</li>
            <li>No cloud sync or account required</li>
            <li>You can sign in later to enable sync</li>
          </ul>
        </div>

        <button class="skip-btn" (click)="skipLogin()">
          Continue without signing in (local only)
        </button>
      </div>
    </div>
  `,
  styles: [`
    .login-container {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--cw-bg-modal-backdrop);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: var(--cw-z-modal);
      padding: var(--cw-space-lg);
      box-sizing: border-box;
    }

    .login-card {
      background: var(--cw-bg-base);
      padding: var(--cw-space-2xl);
      border-radius: var(--cw-radius-md);
      box-shadow: var(--cw-shadow-xl);
      border: 1px solid var(--cw-border-subtle);
      width: 100%;
      max-width: 540px;
      max-height: 92vh;
      overflow-y: auto;
    }

    h2 {
      margin: 0 0 var(--cw-space-sm) 0;
      color: var(--cw-text-primary);
      text-align: center;
    }

    .login-subtitle {
      text-align: center;
      color: var(--cw-text-muted);
      margin: 0 0 var(--cw-space-xl) 0;
      font-size: var(--cw-font-size-sm);
    }

    .mode-toggle {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--cw-space-sm);
      margin-bottom: var(--cw-space-xl);
      padding: var(--cw-space-xs);
      border: 1px solid var(--cw-border-input);
      border-radius: var(--cw-radius-xs);
      background: var(--cw-bg-hover);
    }

    .mode-btn {
      border: 0;
      border-radius: var(--cw-radius-xs);
      padding: var(--cw-space-sm) var(--cw-space-md);
      font-size: var(--cw-font-size-sm);
      background: transparent;
      color: var(--cw-text-muted);
      cursor: pointer;
      transition: all var(--cw-transition-normal);
    }

    .mode-btn.active {
      background: var(--cw-color-success);
      color: var(--cw-text-primary);
    }

    .form-group {
      margin-bottom: var(--cw-space-lg);
    }

    .migration-hint {
      margin: 0 0 var(--cw-space-lg) 0;
      padding: var(--cw-space-md);
      border-radius: var(--cw-radius-xs);
      border: 1px solid var(--cw-border-warning);
      background: var(--cw-bg-warning-subtle);
    }

    .migration-hint h3 {
      margin: 0 0 var(--cw-space-xs) 0;
      font-size: var(--cw-font-size-sm);
      color: var(--cw-text-secondary);
    }

    .migration-hint p {
      margin: 0;
      font-size: var(--cw-font-size-xs);
      color: var(--cw-text-muted);
      line-height: 1.4;
    }

    label {
      display: block;
      margin-bottom: var(--cw-space-sm);
      font-weight: var(--cw-font-weight-medium);
      color: var(--cw-text-secondary);
    }

    input {
      width: 100%;
      padding: var(--cw-space-md);
      background-color: var(--cw-bg-base);
      color: var(--cw-text-secondary);
      border: 1px solid var(--cw-border-input);
      border-radius: var(--cw-radius-xs);
      font-size: var(--cw-font-size-md);
      box-sizing: border-box;
      transition: all var(--cw-transition-normal);
    }

    input:focus {
      outline: none;
      border-color: var(--cw-color-success);
      box-shadow: 0 0 0 2px var(--cw-bg-success-subtle);
    }

    input.ng-invalid.ng-touched {
      border-color: var(--cw-color-danger-dark);
    }

    .field-help {
      margin-top: var(--cw-space-sm);
    }

    .field-help small {
      color: var(--cw-color-danger-dark);
      font-size: var(--cw-font-size-sm);
    }

    .login-btn {
      width: 100%;
      padding: var(--cw-space-md);
      background: var(--cw-color-success);
      color: var(--cw-text-primary);
      border: none;
      border-radius: var(--cw-radius-xs);
      font-size: var(--cw-font-size-md);
      cursor: pointer;
      transition: background-color var(--cw-transition-normal);
    }

    .login-btn:hover:not(:disabled) {
      background: var(--cw-color-success-dark);
    }

    .login-btn:disabled {
      background: var(--cw-text-disabled);
      cursor: not-allowed;
    }

    .skip-btn {
      width: 100%;
      padding: var(--cw-space-sm);
      background: transparent;
      color: var(--cw-text-muted);
      border: 1px solid var(--cw-border-input);
      border-radius: var(--cw-radius-xs);
      cursor: pointer;
      margin-top: var(--cw-space-md);
      font-size: var(--cw-font-size-sm);
      transition: all var(--cw-transition-normal);
    }

    .skip-btn:hover {
      background: var(--cw-bg-hover);
    }

    .error-message {
      color: var(--cw-color-danger);
      text-align: center;
      margin-top: var(--cw-space-lg);
      padding: var(--cw-space-sm);
      background: var(--cw-bg-danger-subtle);
      border: 1px solid var(--cw-border-danger);
      border-radius: var(--cw-radius-xs);
      font-size: var(--cw-font-size-sm);
    }

    .login-info,
    .local-info {
      margin: var(--cw-space-xl) 0;
      padding: var(--cw-space-lg);
      border-radius: var(--cw-radius-xs);
      border: 1px solid var(--cw-border-subtle);
      background: var(--cw-bg-base);
    }

    .login-info {
      border-left: 4px solid var(--cw-color-success);
      border-color: var(--cw-border-success);
    }

    .local-info {
      border-left: 4px solid var(--cw-color-warning);
      border-color: var(--cw-border-warning);
    }

    .login-info h3,
    .local-info h3 {
      margin: 0 0 var(--cw-space-sm) 0;
      font-size: var(--cw-font-size-sm);
      color: var(--cw-text-secondary);
    }

    .login-info ul,
    .local-info ul {
      margin: 0;
      padding-left: 1.2rem;
      font-size: var(--cw-font-size-xs);
      color: var(--cw-text-muted);
    }

    .login-info li,
    .local-info li {
      margin-bottom: var(--cw-space-xs);
    }

    .divider-with-text {
      display: flex;
      align-items: center;
      margin: var(--cw-space-lg) 0;
      color: var(--cw-text-disabled);
      font-size: var(--cw-font-size-sm);
    }

    .divider-with-text::before,
    .divider-with-text::after {
      content: '';
      flex: 1;
      height: 1px;
      background: var(--cw-border-input);
    }

    .divider-with-text span {
      padding: 0 var(--cw-space-lg);
      font-weight: var(--cw-font-weight-medium);
    }
  `]
})
export class LoginComponent implements OnInit {
  private authService = inject(AuthService);

  mode: AuthMode = 'signin';
  username = '';
  password = '';
  confirmPassword = '';
  displayName = '';
  isLoading = false;
  errorMessage = '';
  isLoggedIn = false;

  ngOnInit(): void {
    this.authService.currentUser$.subscribe(user => {
      this.isLoggedIn = !!user;
    });
  }

  setMode(mode: AuthMode): void {
    if (this.isLoading || this.mode === mode) return;
    this.mode = mode;
    this.errorMessage = '';
    this.password = '';
    this.confirmPassword = '';
  }

  async onSubmit(): Promise<void> {
    if (this.isLoading) return;

    if (this.mode === 'signup' && this.password !== this.confirmPassword) {
      this.errorMessage = 'Passwords do not match';
      return;
    }

    this.isLoading = true;
    this.errorMessage = '';

    try {
      if (this.mode === 'signup') {
        await this.authService.signup(this.username, this.password, this.displayName || undefined);
      } else {
        await this.authService.login(this.username, this.password, this.displayName || undefined);
      }
      // Success: component hides automatically via currentUser subscription.
    } catch (error: unknown) {
      this.errorMessage = error instanceof Error ? error.message : 'Authentication failed';
    } finally {
      this.isLoading = false;
    }
  }

  skipLogin(): void {
    this.authService.loginLocalOnly();
  }
}
