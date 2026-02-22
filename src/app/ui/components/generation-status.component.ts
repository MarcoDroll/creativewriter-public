import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subject, combineLatest, takeUntil, map } from 'rxjs';
import { SceneGenerationService } from '../../shared/services/scene-generation.service';
import { BeatAIService } from '../../shared/services/beat-ai.service';

interface GenerationStatus {
  isGenerating: boolean;
  hasError: boolean;
  source: 'scene' | 'beat' | 'none';
  error?: string;
}

@Component({
  selector: 'app-generation-status',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="generation-status"
      *ngIf="status.isGenerating || showError"
      [ngClass]="statusClass"
      (click)="dismissError()"
      (keydown.enter)="dismissError()"
      (keydown.space)="$event.preventDefault(); dismissError()"
      [class.clickable]="showError"
      [attr.tabindex]="showError ? 0 : null"
      [attr.role]="showError ? 'button' : null"
      [attr.aria-label]="showError ? 'Dismiss error' : null">
      <span class="generation-icon">{{ statusIcon }}</span>
      <span class="generation-text">{{ statusText }}</span>
    </div>
  `,
  styles: [`
    .generation-status {
      display: flex;
      align-items: center;
      gap: var(--cw-space-xs);
      padding: var(--cw-space-xs) var(--cw-space-sm);
      border-radius: var(--cw-radius-xs);
      font-size: var(--cw-font-size-xs);
      transition: all var(--cw-transition-normal);
      max-width: 180px;
      overflow: hidden;
      z-index: 1;
      position: relative;
    }

    .generation-status.clickable {
      cursor: pointer;
    }

    .generation-status.clickable:hover,
    .generation-status.clickable:focus {
      filter: brightness(1.1);
    }

    .generation-status.clickable:focus {
      outline: 2px solid currentColor;
      outline-offset: 2px;
    }

    .generation-status.generating {
      background-color: var(--cw-bg-processing-subtle);
      color: var(--cw-color-processing);
      border: 1px solid var(--cw-border-processing);
      animation: pulse 1.5s ease-in-out infinite;
    }

    .generation-status.error {
      background-color: var(--cw-bg-danger-subtle);
      color: var(--cw-color-danger-light);
      border: 1px solid var(--cw-border-danger);
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    .generation-icon {
      font-size: var(--cw-font-size-sm);
      flex-shrink: 0;
    }

    .generation-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: var(--cw-line-height-tight);
    }

    /* Responsive styles */
    @media (max-width: 768px) {
      .generation-status {
        padding: var(--cw-space-xs) var(--cw-space-sm);
        font-size: var(--cw-font-size-2xs);
        max-width: 140px;
      }
    }
  `]
})
export class GenerationStatusComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private errorDismissTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly sceneGenService = inject(SceneGenerationService);
  private readonly beatAIService = inject(BeatAIService);

  status: GenerationStatus = {
    isGenerating: false,
    hasError: false,
    source: 'none'
  };

  showError = false;
  private lastError: string | undefined;

  ngOnInit() {
    // Combine both generation sources
    combineLatest([
      this.sceneGenService.progress$,
      this.beatAIService.isStreaming$
    ]).pipe(
      takeUntil(this.destroy$),
      map(([sceneProgress, isBeatStreaming]) => {
        // Check for new error
        const hasNewError = !!sceneProgress.error && sceneProgress.error !== this.lastError;

        if (sceneProgress.isGenerating) {
          return {
            isGenerating: true,
            hasError: false,
            source: 'scene' as const,
            error: undefined
          };
        }
        if (isBeatStreaming) {
          return {
            isGenerating: true,
            hasError: false,
            source: 'beat' as const,
            error: undefined
          };
        }
        // Not generating - check for error
        if (hasNewError) {
          return {
            isGenerating: false,
            hasError: true,
            source: 'scene' as const,
            error: sceneProgress.error
          };
        }
        return {
          isGenerating: false,
          hasError: false,
          source: 'none' as const,
          error: undefined
        };
      })
    ).subscribe(status => {
      this.status = status;

      // Handle error display
      if (status.hasError && status.error) {
        this.lastError = status.error;
        this.showError = true;
        this.startErrorDismissTimer();
      } else if (status.isGenerating) {
        // Clear error when new generation starts
        this.showError = false;
        this.clearErrorDismissTimer();
      }
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.clearErrorDismissTimer();
  }

  get statusIcon(): string {
    if (this.showError) return '⚠️';
    return '✨';
  }

  get statusClass(): string {
    if (this.showError) return 'error';
    if (this.status.isGenerating) return 'generating';
    return '';
  }

  get statusText(): string {
    if (this.showError) {
      // Truncate error message
      const error = this.status.error || 'Generation failed';
      return error.length > 20 ? error.substring(0, 17) + '...' : error;
    }
    if (this.status.source === 'scene') {
      return 'Generating scene...';
    }
    if (this.status.source === 'beat') {
      return 'Generating...';
    }
    return '';
  }

  dismissError(): void {
    if (this.showError) {
      this.showError = false;
      this.clearErrorDismissTimer();
    }
  }

  private startErrorDismissTimer(): void {
    this.clearErrorDismissTimer();
    // Auto-dismiss error after 8 seconds
    this.errorDismissTimer = setTimeout(() => {
      this.showError = false;
    }, 8000);
  }

  private clearErrorDismissTimer(): void {
    if (this.errorDismissTimer) {
      clearTimeout(this.errorDismissTimer);
      this.errorDismissTimer = null;
    }
  }
}
