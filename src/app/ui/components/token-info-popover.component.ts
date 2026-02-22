import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonContent, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon, IonList, IonItem, IonLabel, IonNote, IonProgressBar, IonGrid, IonRow, IonCol } from '@ionic/angular/standalone';
import { PopoverController } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, informationCircleOutline } from 'ionicons/icons';
import { TokenCounterService, SupportedModel, TokenCountResult } from '../../shared/services/token-counter.service';

@Component({
  selector: 'app-token-info-popover',
  standalone: true,
  imports: [
    CommonModule,
    IonContent,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonList,
    IonItem,
    IonLabel,
    IonNote,
    IonProgressBar,
    IonGrid,
    IonRow,
    IonCol
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Token Analysis</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">
            <ion-icon name="close-outline"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <!-- Loading Indicator -->
      <div *ngIf="loading" class="loading-container">
        <ion-item lines="none">
          <ion-label>
            <div class="loading-content">
              <div class="spinner"></div>
              <p>Determining exact token count...</p>
            </div>
          </ion-label>
        </ion-item>
      </div>

      <ion-list *ngIf="!loading">
        <!-- Model Info -->
        <ion-item lines="none">
          <ion-label>
            <h2>{{ displayModelName }}</h2>
            <p>{{ displayModelProvider }}</p>
          </ion-label>
        </ion-item>

        <!-- Token Count -->
        <ion-item>
          <ion-label>
            <h3>Token Count</h3>
            <p>{{ tokenResult.tokens }} Tokens</p>
          </ion-label>
          <ion-note slot="end" color="medium">
            ~{{ Math.round(tokenResult.tokens * 0.75) }} words
          </ion-note>
        </ion-item>

        <!-- Context Window Usage -->
        <ion-item>
          <ion-label>
            <h3>Context Window</h3>
            <p>{{ formatNumber(modelInfo.contextWindow) }} Tokens</p>
          </ion-label>
        </ion-item>

        <ion-item lines="none">
          <div class="usage-container">
            <ion-progress-bar 
              [value]="usagePercentage / 100" 
              [color]="getProgressColor(usagePercentage)">
            </ion-progress-bar>
            <div class="usage-text">
              <span>{{ usagePercentage.toFixed(2) }}% used</span>
              <span>{{ formatNumber(modelInfo.contextWindow - tokenResult.tokens) }} tokens available</span>
            </div>
          </div>
        </ion-item>

        <!-- Output Limit -->
        <ion-item>
          <ion-label>
            <h3>Output-Limit</h3>
            <p>{{ formatNumber(modelInfo.outputLimit) }} Tokens</p>
          </ion-label>
          <ion-note slot="end" color="medium">
            ~{{ formatNumber(Math.round(modelInfo.outputLimit * 0.75)) }} words
          </ion-note>
        </ion-item>

        <!-- Additional Info -->
        <ion-item lines="none">
          <ion-icon name="information-circle-outline" slot="start" color="medium"></ion-icon>
          <ion-label class="ion-text-wrap">
            <p class="info-text">
              This estimate is based on average token-to-character ratios.
              The actual token count may vary slightly.
            </p>
          </ion-label>
        </ion-item>

        <!-- Model Comparison -->
        <ion-item lines="none" *ngIf="showComparison">
          <ion-label>
            <h3>Comparison with other models</h3>
          </ion-label>
        </ion-item>
        
        <ion-grid *ngIf="showComparison" class="comparison-grid">
          <ion-row>
            <ion-col size="6" *ngFor="let compModel of comparisonModels">
              <div class="model-card" [class.current]="compModel.id === model">
                <h4>{{ compModel.name }}</h4>
                <p class="tokens">{{ getTokenCountForModel(compModel.id).tokens }} Tokens</p>
                <p class="percentage">{{ getUsagePercentageForModel(compModel.id).toFixed(1) }}%</p>
              </div>
            </ion-col>
          </ion-row>
        </ion-grid>
      </ion-list>
    </ion-content>
  `,
  styles: [`
    :host {
      --backdrop-opacity: 0.6;
      --box-shadow: var(--cw-shadow-xl);
      --width: 350px;
      --max-width: 90vw;
    }

    ion-content {
      --background: transparent;
      --color: var(--cw-text-primary);
    }

    ion-header {
      padding: 1rem 1.25rem 0.75rem 1.25rem;
      border-bottom: 1px solid var(--cw-border-accent);
      background: var(--cw-bg-glass);
      backdrop-filter: blur(var(--cw-blur-xl));
      -webkit-backdrop-filter: blur(var(--cw-blur-xl));
      position: relative;
    }

    ion-header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--cw-gradient-primary-subtle);
      z-index: -1;
    }

    ion-toolbar {
      --background: transparent;
      --color: var(--cw-text-primary);
      --border-width: 0;
      --padding-start: 0;
      --padding-end: 0;
    }

    ion-title {
      --color: var(--cw-text-primary);
      font-size: var(--cw-font-size-md);
      font-weight: var(--cw-font-weight-semibold);
      letter-spacing: 0.3px;
      background: var(--cw-gradient-text-accent);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    ion-list {
      background: transparent;
      padding: 0.5rem 0;
    }

    ion-item {
      --background: var(--cw-bg-hover);
      --background-hover: var(--cw-bg-primary-hover);
      --background-activated: var(--cw-bg-primary-hover);
      --color: var(--cw-text-primary);
      --ripple-color: var(--cw-border-accent);
      margin: 0 0.75rem 0.5rem 0.75rem;
      --border-radius: var(--cw-radius-md);
      border: 1px solid var(--cw-border-accent);
      transition: all var(--cw-transition-spring);
      position: relative;
      overflow: hidden;
    }

    ion-item::before {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, var(--cw-bg-primary-hover), transparent);
      transition: left 0.5s ease;
      z-index: 1;
    }

    ion-item:hover {
      --background: var(--cw-bg-primary-hover);
      border-color: var(--cw-border-accent);
      transform: translateX(4px) scale(1.02);
      box-shadow: var(--cw-shadow-primary-glow);
    }

    ion-item:hover::before {
      left: 100%;
    }

    ion-item h2, ion-item h3 {
      color: var(--cw-color-primary-light);
      margin: 0 0 4px 0;
      position: relative;
      z-index: 2;
      font-weight: var(--cw-font-weight-semibold);
    }

    ion-item p {
      color: var(--cw-text-secondary);
      margin: 0;
      position: relative;
      z-index: 2;
    }

    ion-note {
      --color: var(--cw-text-muted);
      position: relative;
      z-index: 2;
    }

    ion-icon {
      position: relative;
      z-index: 2;
      color: var(--cw-text-primary);
    }

    ion-button {
      --color: var(--cw-text-primary);
      position: relative;
      z-index: 2;
    }

    .usage-container {
      width: 100%;
      position: relative;
      z-index: 2;
    }

    .usage-text {
      display: flex;
      justify-content: space-between;
      margin-top: var(--cw-space-sm);
      font-size: var(--cw-font-size-xs);
      color: var(--cw-text-muted);
    }

    ion-progress-bar {
      height: 8px;
      border-radius: var(--cw-radius-xs);
      --background: var(--cw-bg-hover);
      margin: var(--cw-space-sm) 0;
    }

    .info-text {
      font-size: var(--cw-font-size-xs);
      color: var(--cw-text-muted);
      margin: 0;
    }

    .comparison-grid {
      padding: 0;
      margin: 0 0.75rem;
    }

    .model-card {
      background: var(--cw-bg-hover);
      border-radius: var(--cw-radius-md);
      padding: var(--cw-space-md);
      text-align: center;
      border: 1px solid var(--cw-border-accent);
      transition: all var(--cw-transition-spring);
      position: relative;
      overflow: hidden;
    }

    .model-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: -100%;
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, transparent, var(--cw-bg-primary-hover), transparent);
      transition: left 0.5s ease;
      z-index: 1;
    }

    .model-card:hover::before {
      left: 100%;
    }

    .model-card:hover {
      border-color: var(--cw-border-accent);
      transform: translateY(-2px) scale(1.02);
      box-shadow: var(--cw-shadow-primary-glow);
    }

    .model-card.current {
      border-color: var(--cw-border-primary);
      background: var(--cw-bg-primary-hover);
      box-shadow: var(--cw-shadow-primary-glow);
    }

    .model-card h4 {
      font-size: var(--cw-font-size-xs);
      margin: 0 0 4px 0;
      font-weight: var(--cw-font-weight-semibold);
      color: var(--cw-color-primary-light);
      position: relative;
      z-index: 2;
    }

    .model-card p {
      margin: 2px 0;
      font-size: var(--cw-font-size-2xs);
      color: var(--cw-text-secondary);
      position: relative;
      z-index: 2;
    }

    .model-card .tokens {
      color: var(--cw-text-primary);
      font-weight: var(--cw-font-weight-medium);
    }

    .model-card .percentage {
      color: var(--cw-text-muted);
    }

    ion-badge {
      font-size: var(--cw-font-size-2xs);
      padding: var(--cw-space-xs) var(--cw-space-sm);
      --background: var(--cw-gradient-primary);
      --color: white;
      position: relative;
      z-index: 2;
    }

    .loading-container {
      padding: 20px 0;
      text-align: center;
    }

    .loading-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--cw-space-md);
    }

    .loading-content p {
      margin: 0;
      color: var(--cw-text-muted);
      font-size: var(--cw-font-size-sm);
    }

    .spinner {
      width: 24px;
      height: 24px;
      border: 2px solid var(--cw-bg-hover);
      border-top: 2px solid var(--cw-color-primary-light);
      border-radius: var(--cw-radius-full);
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `]
})
export class TokenInfoPopoverComponent implements OnInit {
  @Input() prompt = '';
  @Input() model: SupportedModel = 'claude-3.7-sonnet';
  @Input() showComparison = false;
  @Input() customModelName?: string;
  @Input() customModelProvider?: string;
  @Input() customContextLength?: number;
  @Input() customOutputLimit?: number;

  tokenResult!: TokenCountResult;
  modelInfo!: ReturnType<TokenCounterService['getModelInfo']>;
  usagePercentage = 0;
  loading = true;
  Math = Math;

  // Computed display values that use custom names when available
  get displayModelName(): string {
    if (this.model === 'custom' && this.customModelName) {
      return this.customModelName;
    }
    return this.modelInfo?.name || 'Unknown Model';
  }

  get displayModelProvider(): string {
    if (this.model === 'custom' && this.customModelProvider) {
      return this.customModelProvider;
    }
    return this.modelInfo?.provider || 'Unknown';
  }

  comparisonModels: { id: SupportedModel; name: string }[] = [
    { id: 'claude-sonnet-4-5', name: 'Claude 4.5' },
    { id: 'claude-sonnet-4', name: 'Claude 4' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'grok-3', name: 'Grok-3' }
  ];

  private popoverController = inject(PopoverController);
  private tokenCounter = inject(TokenCounterService);

  constructor() {
    addIcons({ closeOutline, informationCircleOutline });
  }

  ngOnInit() {
    this.calculateTokens();
  }

  async calculateTokens() {
    this.loading = true;

    try {
      // Try async tokenization first for Claude models
      this.tokenResult = await this.tokenCounter.countTokens(this.prompt, this.model);
    } catch (error) {
      // Fallback to synchronous method
      console.warn('Failed to use async tokenization, falling back to sync:', error);
      this.tokenResult = this.tokenCounter.countTokensSync(this.prompt, this.model);
    }

    // Pass custom values for custom models to get accurate context/output limits
    this.modelInfo = this.tokenCounter.getModelInfo(this.model, {
      customContextLength: this.customContextLength,
      customOutputLimit: this.customOutputLimit,
      customModelName: this.customModelName,
      customModelProvider: this.customModelProvider
    });
    this.usagePercentage = (this.tokenResult.tokens / this.modelInfo.contextWindow) * 100;
    this.loading = false;
  }

  getTokenCountForModel(modelId: SupportedModel): TokenCountResult {
    return this.tokenCounter.countTokensSync(this.prompt, modelId);
  }

  getUsagePercentageForModel(modelId: SupportedModel): number {
    const result = this.tokenCounter.countTokensSync(this.prompt, modelId);
    const modelInfo = this.tokenCounter.getModelInfo(modelId);
    return (result.tokens / modelInfo.contextWindow) * 100;
  }

  formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(0) + 'K';
    }
    return num.toString();
  }

  getProgressColor(percentage: number): string {
    if (percentage < 50) return 'success';
    if (percentage < 80) return 'warning';
    return 'danger';
  }

  dismiss() {
    this.popoverController.dismiss();
  }
}
