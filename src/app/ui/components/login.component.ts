import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="login-container" *ngIf="!isLoggedIn">
      <div class="login-card">
        <h2>Creative Writer</h2>
        <p class="login-subtitle">Sign in to sync your stories</p>
        
        <form (ngSubmit)="onLogin()" #loginForm="ngForm">
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
            [disabled]="loginForm.invalid || isLoading">
            <span *ngIf="!isLoading">Sign in</span>
            <span *ngIf="isLoading">Signing in...</span>
          </button>
          
          <div class="error-message" *ngIf="errorMessage">
            {{ errorMessage }}
          </div>
        </form>
        
        <div class="login-info">
          <h3>ℹ️ Sign in benefits:</h3>
          <ul>
            <li>No registration required - just enter username</li>
            <li>Your stories sync automatically across all your devices</li>
            <li>Access your stories from phone, tablet, and computer</li>
            <li>The username is used for the database (only a-z, 0-9, _, -)</li>
          </ul>
        </div>
        
        <div class="divider-with-text">
          <span>OR</span>
        </div>
        
        <div class="local-info">
          <h3>💾 Work locally instead:</h3>
          <ul>
            <li>Stories saved only on this device</li>
            <li>No sync between devices</li>
            <li>Data persists across browser sessions</li>
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
    }

    .login-card {
      background: var(--cw-bg-base);
      padding: var(--cw-space-2xl);
      border-radius: var(--cw-radius-md);
      box-shadow: var(--cw-shadow-xl);
      border: 1px solid var(--cw-border-subtle);
      width: 100%;
      max-width: 500px;
      max-height: 90vh;
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
      margin-bottom: var(--cw-space-2xl);
      font-size: var(--cw-font-size-sm);
    }

    .form-group {
      margin-bottom: var(--cw-space-xl);
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
      margin-top: var(--cw-space-lg);
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

    .login-info {
      margin: var(--cw-space-2xl) 0;
      padding: var(--cw-space-lg);
      background: var(--cw-bg-base);
      border-radius: var(--cw-radius-xs);
      border-left: 4px solid var(--cw-color-success);
      border: 1px solid var(--cw-border-success);
    }

    .login-info h3 {
      margin: 0 0 var(--cw-space-sm) 0;
      font-size: var(--cw-font-size-sm);
      color: var(--cw-text-secondary);
    }

    .login-info ul {
      margin: 0;
      padding-left: 1.2rem;
      font-size: var(--cw-font-size-xs);
      color: var(--cw-text-muted);
    }

    .login-info li {
      margin-bottom: var(--cw-space-xs);
    }

    .local-info {
      margin: var(--cw-space-lg) 0;
      padding: var(--cw-space-lg);
      background: var(--cw-bg-base);
      border-radius: var(--cw-radius-xs);
      border-left: 4px solid var(--cw-color-warning);
      border: 1px solid var(--cw-border-warning);
    }

    .local-info h3 {
      margin: 0 0 var(--cw-space-sm) 0;
      font-size: var(--cw-font-size-sm);
      color: var(--cw-text-secondary);
    }

    .local-info ul {
      margin: 0;
      padding-left: 1.2rem;
      font-size: var(--cw-font-size-xs);
      color: var(--cw-text-muted);
    }

    .local-info li {
      margin-bottom: var(--cw-space-xs);
    }

    .divider-with-text {
      display: flex;
      align-items: center;
      margin: var(--cw-space-xl) 0;
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
  private router = inject(Router);

  username = '';
  displayName = '';
  isLoading = false;
  errorMessage = '';
  isLoggedIn = false;

  ngOnInit() {
    this.authService.currentUser$.subscribe(user => {
      this.isLoggedIn = !!user;
    });
  }

  async onLogin() {
    if (this.isLoading) return;
    
    this.isLoading = true;
    this.errorMessage = '';
    
    try {
      await this.authService.login(this.username, this.displayName || undefined);
      // Login successful - component will hide automatically
    } catch (error: unknown) {
      this.errorMessage = error instanceof Error ? error.message : 'Sign in failed';
    } finally {
      this.isLoading = false;
    }
  }

  skipLogin() {
    // Login as local-only user
    this.authService.loginLocalOnly();
    // Component will hide automatically via subscription
  }
}
