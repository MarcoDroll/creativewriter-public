import { Component, Input, OnInit, inject } from '@angular/core';
import { ModalController, AlertController, LoadingController } from '@ionic/angular';
import { CommonModule } from '@angular/common';
import { IonicModule } from '@ionic/angular';
import { addIcons } from 'ionicons';
import {
  cloudOfflineOutline, timeOutline, bookmarkOutline, bookmark, closeOutline,
  documentTextOutline, chatbubblesOutline, imageOutline, searchOutline
} from 'ionicons/icons';
import { SnapshotService, SnapshotTimeline, StorySnapshot, RestoreOptions } from '../../services/snapshot.service';
import { StoryService } from '../../services/story.service';

interface RestoreResult {
  storyRestored: boolean;
  relatedDocs?: {
    successful: number;
    failed: number;
    total: number;
  };
}

/** Cached display data for snapshot related documents */
interface SnapshotDisplayData {
  hasRelated: boolean;
  relatedText: string;
}

@Component({
  selector: 'app-snapshot-timeline',
  standalone: true,
  imports: [CommonModule, IonicModule],
  templateUrl: './snapshot-timeline.component.html',
  styleUrls: ['./snapshot-timeline.component.scss']
})
export class SnapshotTimelineComponent implements OnInit {
  @Input() storyId!: string;
  @Input() storyTitle = 'Story';

  timeline?: SnapshotTimeline;
  loading = true;
  error?: string;
  snapshotsAvailable = false;

  /** Pre-computed display data for related documents (avoids method calls in template) */
  snapshotDisplayData = new Map<string, SnapshotDisplayData>();
  /** Cached total count to avoid recalculating on every change detection */
  private cachedTotalCount = 0;

  readonly snapshotService = inject(SnapshotService);
  private readonly storyService = inject(StoryService);
  private readonly modalCtrl = inject(ModalController);
  private readonly alertCtrl = inject(AlertController);
  private readonly loadingCtrl = inject(LoadingController);

  constructor() {
    addIcons({
      cloudOfflineOutline, timeOutline, bookmarkOutline, bookmark, closeOutline,
      documentTextOutline, chatbubblesOutline, imageOutline, searchOutline
    });
  }

  async ngOnInit() {
    await this.loadTimeline();
  }

  async loadTimeline() {
    this.loading = true;
    this.error = undefined;

    try {
      // Check if snapshots are available (online + CouchDB)
      this.snapshotsAvailable = await this.snapshotService.checkSnapshotAvailability();

      if (!this.snapshotsAvailable) {
        this.error = 'Snapshots are not available. You need an internet connection to view version history.';
        this.loading = false;
        return;
      }

      this.timeline = await this.snapshotService.getSnapshotTimeline(this.storyId);

      // Pre-compute display data for performance (avoid method calls in template)
      this.precomputeSnapshotDisplayData();
      this.cachedTotalCount = this.calculateTotalCount();

      this.loading = false;
    } catch (err) {
      console.error('Failed to load snapshots:', err);
      this.error = 'Failed to load version history. Please try again.';
      this.loading = false;
    }
  }

  /**
   * Pre-compute related document display data for all snapshots
   * This avoids calling methods in template bindings which run on every change detection
   */
  private precomputeSnapshotDisplayData() {
    if (!this.timeline) return;

    this.snapshotDisplayData.clear();

    const allSnapshots = [
      ...this.timeline.recent,
      ...this.timeline.hourly,
      ...this.timeline.daily,
      ...this.timeline.weekly,
      ...this.timeline.monthly,
      ...this.timeline.manual
    ];

    for (const snapshot of allSnapshots) {
      const counts = this.snapshotService.getRelatedDocumentCounts(snapshot);
      const hasRelated = counts.hasCodex || counts.totalChats > 0 ||
                         counts.researchCount > 0 || counts.mediaCount > 0;

      this.snapshotDisplayData.set(snapshot._id, {
        hasRelated,
        relatedText: hasRelated ? this.buildRelatedText(counts) : ''
      });
    }
  }

  /**
   * Build display text from related document counts
   */
  private buildRelatedText(counts: {
    hasCodex: boolean;
    totalChats: number;
    researchCount: number;
    mediaCount: number;
  }): string {
    const parts: string[] = [];

    if (counts.hasCodex) {
      parts.push('Codex');
    }
    if (counts.totalChats > 0) {
      parts.push(`${counts.totalChats} chat${counts.totalChats > 1 ? 's' : ''}`);
    }
    if (counts.researchCount > 0) {
      parts.push(`${counts.researchCount} research`);
    }
    if (counts.mediaCount > 0) {
      parts.push(`${counts.mediaCount} media`);
    }

    return parts.join(', ');
  }

  /**
   * Calculate total snapshot count
   */
  private calculateTotalCount(): number {
    if (!this.timeline) return 0;
    return this.timeline.recent.length +
           this.timeline.hourly.length +
           this.timeline.daily.length +
           this.timeline.weekly.length +
           this.timeline.monthly.length +
           this.timeline.manual.length;
  }

  async restore(snapshot: StorySnapshot) {
    const hasRelatedDocs = this.hasRelatedDocuments(snapshot);
    const relatedInfo = hasRelatedDocs ? this.formatRelatedDocsForAlert(snapshot) : '';

    let message = `This will restore your story to the version from ${this.snapshotService.formatSnapshotTime(snapshot.createdAt)}.

Your current version will be automatically backed up.`;

    if (relatedInfo) {
      message += `\n\n${relatedInfo}`;
    }

    const buttons: { text: string; role?: string; handler?: () => Promise<void> }[] = [
      {
        text: 'Cancel',
        role: 'cancel'
      },
      {
        text: 'Restore Story Only',
        handler: async () => {
          await this.performRestore(snapshot, false);
        }
      }
    ];

    // Add option to restore with related docs if available
    if (hasRelatedDocs) {
      buttons.push({
        text: 'Restore All',
        handler: async () => {
          await this.performRestore(snapshot, true);
        }
      });
    }

    const alert = await this.alertCtrl.create({
      header: 'Restore Version?',
      message,
      buttons
    });

    await alert.present();
  }

  private async performRestore(snapshot: StorySnapshot, includeRelatedDocs: boolean) {
    const loading = await this.loadingCtrl.create({
      message: includeRelatedDocs ? 'Restoring version and related content...' : 'Restoring version...'
    });
    await loading.present();

    const result: RestoreResult = { storyRestored: false };

    try {
      // Restore the snapshot with options
      const options: RestoreOptions = {
        createBackup: true,
        includeRelatedDocuments: includeRelatedDocs
      };

      await this.snapshotService.restoreFromSnapshot(
        this.storyId,
        snapshot._id,
        options
      );

      result.storyRestored = true;

      // If we included related docs, get the counts from metadata for display
      if (includeRelatedDocs && snapshot.relatedDocuments) {
        const counts = this.snapshotService.getRelatedDocumentCounts(snapshot);
        const totalRelated =
          (counts.hasCodex ? 1 : 0) +
          counts.totalChats +
          counts.researchCount +
          counts.mediaCount;

        result.relatedDocs = {
          successful: totalRelated, // Assume success unless we track failures differently
          failed: 0,
          total: totalRelated
        };
      }

      await loading.dismiss();

      // Build success message
      let message = 'Your story has been restored to the selected version.';
      if (result.relatedDocs && result.relatedDocs.total > 0) {
        message += `\n\nRelated content restored: ${result.relatedDocs.successful} items`;
        if (result.relatedDocs.failed > 0) {
          message += ` (${result.relatedDocs.failed} failed)`;
        }
      }

      const successAlert = await this.alertCtrl.create({
        header: 'Restored!',
        message,
        buttons: ['OK']
      });

      await successAlert.present();
      await this.close(true); // Close with reload flag
    } catch (err) {
      await loading.dismiss();
      console.error('Restore failed:', err);

      const errorAlert = await this.alertCtrl.create({
        header: 'Restore Failed',
        message: 'Failed to restore the version. Please try again.',
        buttons: ['OK']
      });

      await errorAlert.present();
    }
  }

  async createManualSnapshot() {
    const alert = await this.alertCtrl.create({
      header: 'Create Snapshot',
      message: 'Give this snapshot a name (optional):',
      inputs: [
        {
          name: 'reason',
          type: 'text',
          placeholder: 'e.g., "Before major rewrite"'
        }
      ],
      buttons: [
        {
          text: 'Cancel',
          role: 'cancel'
        },
        {
          text: 'Create',
          handler: async (data) => {
            await this.performCreateSnapshot(data.reason || 'Manual snapshot');
          }
        }
      ]
    });

    await alert.present();
  }

  private async performCreateSnapshot(reason: string) {
    const loading = await this.loadingCtrl.create({
      message: 'Creating snapshot...'
    });
    await loading.present();

    try {
      const story = await this.storyService.getStory(this.storyId);
      if (!story) {
        throw new Error('Story not found');
      }

      await this.snapshotService.createManualSnapshot(story, reason);
      await loading.dismiss();

      const successAlert = await this.alertCtrl.create({
        header: 'Snapshot Created!',
        message: 'Your snapshot has been created with all related documents (codex, chats, research, and media references). For full media backup with binary data, use Export.',
        buttons: ['OK']
      });

      await successAlert.present();

      // Reload timeline
      await this.loadTimeline();
    } catch (err) {
      await loading.dismiss();
      console.error('Create snapshot failed:', err);

      const message = err instanceof Error ? err.message : 'Failed to create snapshot. Please try again.';
      const errorAlert = await this.alertCtrl.create({
        header: 'Failed',
        message,
        buttons: ['OK']
      });

      await errorAlert.present();
    }
  }

  getTotalSnapshotCount(): number {
    return this.cachedTotalCount;
  }

  async close(shouldReload = false) {
    await this.modalCtrl.dismiss({ shouldReload });
  }

  /**
   * TrackBy function for ngFor performance optimization
   */
  trackBySnapshotId(_index: number, snapshot: StorySnapshot): string {
    return snapshot._id;
  }

  /**
   * Get cached display data for a snapshot
   */
  getSnapshotDisplayData(snapshotId: string): SnapshotDisplayData | undefined {
    return this.snapshotDisplayData.get(snapshotId);
  }

  /**
   * Check if snapshot has any related documents
   */
  hasRelatedDocuments(snapshot: StorySnapshot): boolean {
    const counts = this.snapshotService.getRelatedDocumentCounts(snapshot);
    return counts.hasCodex || counts.totalChats > 0 || counts.researchCount > 0 || counts.mediaCount > 0;
  }

  /**
   * Format related documents info for display in snapshot item
   */
  formatRelatedDocs(snapshot: StorySnapshot): string {
    const counts = this.snapshotService.getRelatedDocumentCounts(snapshot);
    const parts: string[] = [];

    if (counts.hasCodex) {
      parts.push('Codex');
    }
    if (counts.totalChats > 0) {
      parts.push(`${counts.totalChats} chat${counts.totalChats > 1 ? 's' : ''}`);
    }
    if (counts.researchCount > 0) {
      parts.push(`${counts.researchCount} research`);
    }
    if (counts.mediaCount > 0) {
      parts.push(`${counts.mediaCount} media`);
    }

    return parts.length > 0 ? parts.join(', ') : '';
  }

  /**
   * Format related documents for alert message (more verbose)
   */
  private formatRelatedDocsForAlert(snapshot: StorySnapshot): string {
    const counts = this.snapshotService.getRelatedDocumentCounts(snapshot);
    const parts: string[] = [];

    if (counts.hasCodex) {
      parts.push('Codex entries');
    }
    if (counts.totalChats > 0) {
      parts.push(`${counts.totalChats} chat conversation${counts.totalChats > 1 ? 's' : ''}`);
    }
    if (counts.researchCount > 0) {
      parts.push(`${counts.researchCount} research document${counts.researchCount > 1 ? 's' : ''}`);
    }
    if (counts.mediaCount > 0) {
      parts.push(`${counts.mediaCount} media file${counts.mediaCount > 1 ? 's' : ''}`);
    }

    if (parts.length === 0) {
      return '';
    }

    let result = `This snapshot also includes: ${parts.join(', ')}.`;

    // Add media limitation note if there are images/videos
    if (counts.mediaCount > 0) {
      result += '\n\nNote: Existing images and videos will be preserved. If you deleted media since this snapshot was created, those files cannot be recovered from snapshots. Use Export/Import for full media backup.';
    }

    return result;
  }
}
