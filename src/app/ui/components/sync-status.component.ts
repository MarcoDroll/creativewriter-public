import { Component, OnInit, OnDestroy, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, ToastController } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { warningOutline, flashOutline, syncOutline, cloudOfflineOutline, cloudDoneOutline, cloudUploadOutline, cloudDownloadOutline } from 'ionicons/icons';
import { Subject, takeUntil } from 'rxjs';
import { DatabaseService, SyncStatus } from '../../core/services/database.service';


@Component({
  selector: 'app-sync-status',
  standalone: true,
  imports: [CommonModule, IonicModule],
  template: `
    <div class="sync-status" [ngClass]="syncStatusClass">
      <ion-icon [name]="syncIcon" class="sync-icon"></ion-icon>
      <div class="sync-content">
        <span class="sync-text">{{ syncText }}</span>
        <div class="sync-progress-bar" *ngIf="showProgressBar">
          <div class="sync-progress-fill" [style.width.%]="progressPercentage"></div>
        </div>
      </div>
      <div class="sync-actions" *ngIf="showActions">
        <button (click)="forcePush()" [disabled]="!canSync" title="Push local changes">
          <ion-icon name="cloud-upload-outline"></ion-icon> Push
        </button>
        <button (click)="forcePull()" [disabled]="!canSync" title="Pull remote changes">
          <ion-icon name="cloud-download-outline"></ion-icon> Pull
        </button>
      </div>
    </div>
  `,
  styles: [`
    .sync-status {
      display: flex;
      align-items: center;
      gap: var(--cw-space-sm);
      padding: var(--cw-space-sm);
      border-radius: var(--cw-radius-xs);
      font-size: var(--cw-font-size-sm);
      transition: all var(--cw-transition-normal);
      max-width: 100%;
      overflow: hidden;
      z-index: 1;
      position: relative;
    }

    .sync-status.online {
      background-color: var(--cw-bg-success-subtle);
      color: var(--cw-color-success-light);
      border: 1px solid var(--cw-border-success);
    }

    .sync-status.offline {
      background-color: var(--cw-bg-danger-subtle);
      color: var(--cw-color-danger-light);
      border: 1px solid var(--cw-border-danger);
    }

    .sync-status.connecting {
      background-color: var(--cw-bg-info-subtle);
      color: var(--cw-color-info-dark);
      border: 1px solid var(--cw-border-info);
      animation: pulse 2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.7; }
    }

    .sync-status.syncing {
      background-color: var(--cw-bg-warning-subtle);
      color: var(--cw-color-warning);
      border: 1px solid var(--cw-border-warning);
    }

    .sync-status.error {
      background-color: var(--cw-bg-danger-subtle);
      color: var(--cw-color-danger-light);
      border: 1px solid var(--cw-border-danger);
    }

    .sync-icon {
      font-size: var(--cw-font-size-md);
      flex-shrink: 0;
    }

    .sync-content {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
      gap: var(--cw-space-xs);
    }

    .sync-text {
      word-break: break-word;
      overflow-wrap: break-word;
      hyphens: auto;
      line-height: var(--cw-line-height-tight);
    }

    .sync-progress-bar {
      width: 100%;
      height: 4px;
      background-color: var(--cw-bg-hover);
      border-radius: var(--cw-radius-xs);
      overflow: hidden;
    }

    .sync-progress-fill {
      height: 100%;
      background-color: currentColor;
      transition: width var(--cw-transition-slow);
      border-radius: var(--cw-radius-xs);
    }

    .sync-actions {
      display: flex;
      gap: var(--cw-space-xs);
      margin-left: auto;
    }

    .sync-actions button {
      display: flex;
      align-items: center;
      gap: var(--cw-space-2xs);
      padding: var(--cw-space-xs) var(--cw-space-sm);
      border: 1px solid currentColor;
      background: transparent;
      color: inherit;
      border-radius: var(--cw-radius-xs);
      cursor: pointer;
      font-size: var(--cw-font-size-xs);
      transition: all var(--cw-transition-normal);
    }

    .sync-actions button ion-icon {
      font-size: var(--cw-font-size-sm);
    }

    .sync-actions button:hover:not(:disabled) {
      background: currentColor;
      color: var(--cw-text-primary);
    }

    .sync-actions button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* Responsive styles */
    @media (max-width: 768px) {
      .sync-status {
        padding: 0.4rem;
        font-size: var(--cw-font-size-xs);
        gap: 0.4rem;
      }

      .sync-actions {
        gap: var(--cw-space-2xs);
      }

      .sync-actions button {
        padding: var(--cw-space-2xs) var(--cw-space-xs);
        font-size: var(--cw-font-size-2xs);
      }
    }

    /* Compact mode - matches header badge styling */
    :host-context(.compact-sync-status) .sync-status {
      height: 28px;
      padding: var(--cw-space-xs) var(--cw-space-sm);
      gap: var(--cw-space-xs);
      font-size: var(--cw-font-size-xs);
      font-weight: var(--cw-font-weight-medium);
      border-radius: var(--cw-radius-sm);
      max-width: 140px;
      box-sizing: border-box;
    }

    :host-context(.compact-sync-status) .sync-icon {
      font-size: var(--cw-font-size-sm);
    }

    :host-context(.compact-sync-status) .sync-content {
      flex-direction: row;
      gap: 0;
    }

    :host-context(.compact-sync-status) .sync-text {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 80px;
    }

    :host-context(.compact-sync-status) .sync-progress-bar {
      display: none;
    }

    /* Full status in burger menu */
    :host-context(.full-sync-status) .sync-status {
      max-width: 100%;
      width: 100%;
    }
  `]
})
export class SyncStatusComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private hasShownInitialSyncToast = false;
  private wasConnecting = false;

  @Input() showActions = false;

  syncStatus: SyncStatus = {
    isOnline: navigator.onLine,
    isSync: false
  };

  private readonly databaseService = inject(DatabaseService);
  private readonly toastController = inject(ToastController);

  constructor() {
    addIcons({ warningOutline, flashOutline, syncOutline, cloudOfflineOutline, cloudDoneOutline, cloudUploadOutline, cloudDownloadOutline });
  }

  ngOnInit() {
    this.databaseService.syncStatus$
      .pipe(takeUntil(this.destroy$))
      .subscribe(status => {
        // Check if we just finished connecting successfully
        if (this.wasConnecting && !status.isConnecting && !status.error && status.isSync) {
          // Show toast only once when first connecting succeeds
          if (!this.hasShownInitialSyncToast) {
            this.showInitialSyncToast();
            this.hasShownInitialSyncToast = true;
          }
        }

        this.wasConnecting = status.isConnecting || false;
        this.syncStatus = status;
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  get syncStatusClass(): string {
    if (this.syncStatus.error) return 'error';
    if (this.syncStatus.isConnecting) return 'connecting';
    if (this.syncStatus.isSync) return 'syncing';
    if (!this.syncStatus.isOnline) return 'offline';
    return 'online';
  }

  get syncIcon(): string {
    if (this.syncStatus.error) return 'warning-outline';
    if (this.syncStatus.isConnecting) return 'flash-outline';
    if (this.syncStatus.isSync) return 'sync-outline';
    if (!this.syncStatus.isOnline) return 'cloud-offline-outline';
    return 'cloud-done-outline';
  }

  get syncText(): string {
    if (this.syncStatus.error) {
      // Truncate long error messages and provide meaningful short text
      const errorText = this.syncStatus.error;
      if (errorText.includes('not reachable') || errorText.includes('connection')) {
        return 'DB not reachable';
      }
      if (errorText.includes('timeout') || errorText.includes('timed out')) {
        return 'Sync timed out';
      }
      if (errorText.includes('auth')) {
        return 'Login failed';
      }
      // Generic truncation for other errors
      return errorText.length > 30 ? `Error: ${errorText.substring(0, 27)}...` : `Error: ${errorText}`;
    }
    if (this.syncStatus.isConnecting) {
      return 'Connecting to remote database...';
    }
    if (this.syncStatus.isSync) {
      // Show detailed progress if available
      if (this.syncStatus.syncProgress) {
        const progress = this.syncStatus.syncProgress;
        const op = progress.operation === 'push' ? 'Pushing' : 'Pulling';

        // If we have a current document, show it
        if (progress.currentDoc) {
          const docName = this.getDocumentDisplayName(progress.currentDoc);
          if (progress.totalDocs) {
            return `${op} ${progress.docsProcessed}/${progress.totalDocs}: ${docName}`;
          }
          return `${op} ${docName}`;
        }

        // Show pending count if available
        if (progress.pendingDocs !== undefined && progress.pendingDocs > 0) {
          return `${progress.pendingDocs} ${progress.pendingDocs === 1 ? 'doc' : 'docs'} pending...`;
        }

        // Show progress count
        if (progress.docsProcessed > 0) {
          if (progress.totalDocs) {
            return `${op} ${progress.docsProcessed}/${progress.totalDocs} docs`;
          }
          return `${op} ${progress.docsProcessed} ${progress.docsProcessed === 1 ? 'doc' : 'docs'}`;
        }
      }
      return 'Syncing...';
    }
    if (!this.syncStatus.isOnline) return 'Offline';

    const lastSync = this.syncStatus.lastSync;
    if (lastSync) {
      const timeAgo = this.getTimeAgo(lastSync);
      return `Synced (${timeAgo})`;
    }

    return 'Online';
  }

  private getDocumentDisplayName(doc: { id: string; type?: string; title?: string }): string {
    // Try to create a friendly name from the document
    if (doc.title) {
      // Truncate long titles
      return doc.title.length > 25 ? `${doc.title.substring(0, 22)}...` : doc.title;
    }

    // Use type if available
    if (doc.type) {
      return doc.type;
    }

    // Extract readable parts from ID
    const id = doc.id;
    // Handle common patterns like 'story_12345' or 'chapter-abc'
    const parts = id.split(/[-_]/);
    if (parts.length > 1) {
      return parts[0];
    }

    // Truncate long IDs
    return id.length > 15 ? `${id.substring(0, 12)}...` : id;
  }

  get canSync(): boolean {
    return this.syncStatus.isOnline && !this.syncStatus.isSync;
  }

  get showProgressBar(): boolean {
    return !!(
      this.syncStatus.syncProgress &&
      this.syncStatus.syncProgress.totalDocs &&
      this.syncStatus.syncProgress.totalDocs > 0
    );
  }

  get progressPercentage(): number {
    if (!this.syncStatus.syncProgress || !this.syncStatus.syncProgress.totalDocs) {
      return 0;
    }

    const progress = this.syncStatus.syncProgress;
    const totalDocs = progress.totalDocs;

    if (!totalDocs || totalDocs === 0) {
      return 0;
    }

    return Math.min(100, Math.round((progress.docsProcessed / totalDocs) * 100));
  }

  private getTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  async forcePush() {
    try {
      const result = await this.databaseService.forcePush();
      await this.showToast(
        `✓ Push completed (${result.docsProcessed} ${result.docsProcessed === 1 ? 'doc' : 'docs'})`,
        'success'
      );
    } catch (error) {
      console.error('Force push failed:', error);
      await this.showToast(
        `✗ Push failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'danger'
      );
    }
  }

  async forcePull() {
    try {
      const result = await this.databaseService.forcePull();
      await this.showToast(
        `✓ Pull completed (${result.docsProcessed} ${result.docsProcessed === 1 ? 'doc' : 'docs'})`,
        'success'
      );
    } catch (error) {
      console.error('Force pull failed:', error);
      await this.showToast(
        `✗ Pull failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'danger'
      );
    }
  }

  private async showInitialSyncToast() {
    const toast = await this.toastController.create({
      message: '☁️ Connected to remote database - Sync active',
      duration: 4000,
      position: 'bottom',
      color: 'success',
      buttons: [
        {
          text: 'Dismiss',
          role: 'cancel'
        }
      ]
    });
    await toast.present();
  }

  private async showToast(message: string, color: 'success' | 'danger') {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      position: 'bottom',
      color,
      buttons: [
        {
          text: 'Dismiss',
          role: 'cancel'
        }
      ]
    });
    await toast.present();
  }
}
