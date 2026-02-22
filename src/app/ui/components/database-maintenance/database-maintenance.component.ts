import { Component, inject, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AlertController, ToastController,
  IonAccordion, IonAccordionGroup, IonItem, IonLabel, IonIcon, IonBadge,
  IonButton, IonSpinner, IonProgressBar, IonList,
  IonChip, IonText, IonNote
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  downloadOutline, cloudUploadOutline, informationCircleOutline,
  checkmarkCircleOutline, warningOutline, documentTextOutline, timeOutline,
  trashOutline, albumsOutline, buildOutline, syncOutline, refreshOutline,
  cloudOutline, cloudOfflineOutline, scanOutline,
  statsChartOutline, nuclearOutline, flaskOutline, imagesOutline
} from 'ionicons/icons';
import { DatabaseBackupService, ExportProgress, ImportProgress } from '../../../shared/services/database-backup.service';
import { BeatHistoryService } from '../../../shared/services/beat-history.service';
import { DatabaseService } from '../../../core/services/database.service';
import { StoryMetadataIndexService } from '../../../stories/services/story-metadata-index.service';
import { DbMaintenanceService, RemoteScanProgress, DatabaseStats, IntegrityIssue } from '../../../shared/services/db-maintenance.service';
import { TestStoryGeneratorService } from '../../../shared/services/test-story-generator.service';

@Component({
  selector: 'app-database-maintenance',
  standalone: true,
  imports: [
    CommonModule,
    IonAccordion, IonAccordionGroup, IonItem, IonLabel, IonIcon, IonBadge,
    IonButton, IonSpinner, IonProgressBar, IonList,
    IonChip, IonText, IonNote
  ],
  templateUrl: './database-maintenance.component.html',
  styleUrls: ['./database-maintenance.component.scss']
})
export class DatabaseMaintenanceComponent {
  @ViewChild('fileInput') fileInput!: ElementRef<HTMLInputElement>;

  private readonly backupService = inject(DatabaseBackupService);
  private readonly beatHistoryService = inject(BeatHistoryService);
  private readonly databaseService = inject(DatabaseService);
  private readonly metadataIndexService = inject(StoryMetadataIndexService);
  private readonly dbMaintenanceService = inject(DbMaintenanceService);
  private readonly testStoryGenerator = inject(TestStoryGeneratorService);
  private readonly alertController = inject(AlertController);
  private readonly toastController = inject(ToastController);

  // Shared state
  isRemoteAvailable = false;
  remoteDbInfo: { totalDocs: number; dbName: string } | null = null;

  // Backup/Restore state
  isExporting = false;
  isImporting = false;
  selectedFile: File | null = null;
  exportProgress: ExportProgress | null = null;
  importProgress: ImportProgress | null = null;

  // Beat History state
  beatHistoryStats: { totalHistories: number; totalVersions: number; totalSize: number } | null = null;
  isDeletingBeatHistories = false;

  // Metadata Index state
  isCheckingMetadataIndex = false;
  isRebuildingMetadataIndex = false;
  metadataIndexResult: { success: boolean; title: string; message: string; storiesCount?: number } | null = null;

  // Database Statistics state
  databaseStats: DatabaseStats | null = null;
  isLoadingStats = false;
  statsScanProgress: RemoteScanProgress | null = null;

  // Story Integrity state
  integrityIssues: IntegrityIssue[] = [];
  isCheckingIntegrity = false;
  integrityScanProgress: RemoteScanProgress | null = null;
  integrityCheckPerformed = false;

  // Database Operations state
  isCompacting = false;
  compactResult: { sizeBefore: number; sizeAfter: number; saved: number } | null = null;
  isDeepCleaning = false;
  deepCleanResult: { sizeBefore: number; sizeAfter: number; saved: number; deletedDatabases: number } | null = null;

  // Developer Tools state
  isCreatingTestStory = false;

  // Legacy Media Cleanup state
  // TODO: Remove legacy media cleanup feature after 2026-03-01 - migration cleanup no longer needed
  isCleaningLegacyMedia = false;
  legacyCleanupResult: {
    imagesDeleted: number;
    videosDeleted: number;
    associationsDeleted: number;
    totalDeleted: number;
    errors: string[];
  } | null = null;

  constructor() {
    addIcons({
      downloadOutline, cloudUploadOutline, informationCircleOutline,
      checkmarkCircleOutline, warningOutline, documentTextOutline, timeOutline,
      trashOutline, albumsOutline, buildOutline, syncOutline, refreshOutline,
      cloudOutline, cloudOfflineOutline, scanOutline,
      statsChartOutline, nuclearOutline, flaskOutline, imagesOutline
    });

    this.loadRemoteDatabaseInfo();
    this.loadBeatHistoryStats();
  }

  // Shared utility
  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  async showToast(message: string, color: 'success' | 'warning' | 'danger' = 'success'): Promise<void> {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  // Remote DB info
  async loadRemoteDatabaseInfo(): Promise<void> {
    this.isRemoteAvailable = this.backupService.isRemoteAvailable();
    if (this.isRemoteAvailable) {
      try {
        this.remoteDbInfo = await this.backupService.getRemoteDatabaseInfo();
      } catch (error: unknown) {
        console.error('Failed to load remote database info:', error);
        this.remoteDbInfo = null;
      }
    } else {
      this.remoteDbInfo = null;
    }
  }

  // ===== Backup/Restore methods =====
  async exportDatabase(): Promise<void> {
    if (!this.isRemoteAvailable) {
      this.showToast('Remote database not connected. Please enable sync in Settings.', 'warning');
      return;
    }

    this.isExporting = true;
    this.exportProgress = null;

    try {
      const backupData = await this.backupService.exportFromRemote((progress) => {
        this.exportProgress = progress;
      });
      const filename = this.backupService.generateFilename();
      this.backupService.downloadFile(backupData, filename);
      this.showToast('Database exported successfully from remote!', 'success');
      await this.loadRemoteDatabaseInfo();
    } catch (error) {
      console.error('Export failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to export database. Please try again.';
      this.showToast(errorMessage, 'danger');
    } finally {
      this.isExporting = false;
      this.exportProgress = null;
    }
  }

  onFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    const maxSizeMB = 500;
    const maxSizeBytes = maxSizeMB * 1024 * 1024;

    if (!file) {
      this.selectedFile = null;
      return;
    }

    if (file.type !== 'application/json') {
      this.showToast('Please select a valid JSON backup file', 'warning');
      this.selectedFile = null;
      return;
    }

    if (file.size > maxSizeBytes) {
      this.showToast(`File too large. Maximum size is ${maxSizeMB}MB`, 'warning');
      this.selectedFile = null;
      return;
    }

    this.selectedFile = file;
  }

  async showImportConfirmation(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'FULL DATABASE RESTORE',
      message: `This will COMPLETELY REPLACE both your REMOTE and LOCAL databases with the backup data.

Remote CouchDB will be CLEARED first
Local database will be CLEARED
Backup data will be imported
Data will be synced to remote

This action CANNOT be undone! Make sure you have a backup of any data you want to keep.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Restore Database', role: 'destructive', handler: () => this.importDatabase() }
      ]
    });
    await alert.present();
  }

  async importDatabase(): Promise<void> {
    if (!this.selectedFile) return;

    if (!this.isRemoteAvailable) {
      this.showToast('Remote database not connected. Please enable sync in Settings before importing.', 'warning');
      return;
    }

    this.isImporting = true;
    this.importProgress = null;

    try {
      const fileContent = await this.readFileContent(this.selectedFile);
      await this.backupService.importDatabase(fileContent, (progress) => {
        this.importProgress = progress;
      });
      this.showToast('Database imported and synced successfully!', 'success');
      this.selectedFile = null;
      // Reset file input to allow re-selecting same file
      if (this.fileInput?.nativeElement) {
        this.fileInput.nativeElement.value = '';
      }
      await this.loadRemoteDatabaseInfo();
    } catch (error: unknown) {
      console.error('Import failed:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to import database. Please check the file and try again.';
      this.showToast(errorMessage, 'danger');
    } finally {
      this.isImporting = false;
      this.importProgress = null;
    }
  }

  private readFileContent(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  }

  // ===== Beat History methods =====
  async loadBeatHistoryStats(): Promise<void> {
    try {
      this.beatHistoryStats = await this.beatHistoryService.getHistoryStats();
    } catch (error: unknown) {
      console.error('Failed to load beat history stats:', error);
      this.showToast('Failed to load beat history statistics', 'danger');
    }
  }

  async refreshBeatHistoryStats(): Promise<void> {
    try {
      this.beatHistoryStats = await this.beatHistoryService.getHistoryStats();
      this.showToast('Beat history stats refreshed', 'success');
    } catch (error: unknown) {
      console.error('Failed to refresh beat history stats:', error);
      this.showToast('Failed to refresh beat history statistics', 'danger');
    }
  }

  async showDeleteBeatHistoriesConfirmation(): Promise<void> {
    if (!this.beatHistoryStats || this.beatHistoryStats.totalHistories === 0) return;

    const alert = await this.alertController.create({
      header: 'DELETE ALL BEAT HISTORIES',
      message: `This will permanently delete ALL beat version history data:

${this.beatHistoryStats.totalHistories} beat${this.beatHistoryStats.totalHistories !== 1 ? 's' : ''} with ${this.beatHistoryStats.totalVersions} version${this.beatHistoryStats.totalVersions !== 1 ? 's' : ''}
~${this.formatFileSize(this.beatHistoryStats.totalSize)} of storage will be freed
Current beat content in stories will remain unchanged

This action CANNOT be undone! All previous versions will be lost forever.`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete All Histories', role: 'destructive', handler: () => this.deleteAllBeatHistories() }
      ]
    });
    await alert.present();
  }

  async deleteAllBeatHistories(): Promise<void> {
    this.isDeletingBeatHistories = true;
    try {
      const deletedCount = await this.beatHistoryService.deleteAllHistories();
      this.showToast(`Successfully deleted ${deletedCount} beat histor${deletedCount !== 1 ? 'ies' : 'y'}!`, 'success');
      await this.loadBeatHistoryStats();
    } catch (error: unknown) {
      console.error('Failed to delete beat histories:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to delete beat histories. Please try again.';
      this.showToast(errorMessage, 'danger');
    } finally {
      this.isDeletingBeatHistories = false;
    }
  }

  // ===== Metadata Index methods =====
  async checkMetadataIndex(): Promise<void> {
    this.isCheckingMetadataIndex = true;
    this.metadataIndexResult = null;

    try {
      const db = await this.databaseService.getDatabase();
      try {
        const indexDoc = await db.get('story-metadata-index');
        const storiesCount = (indexDoc as { stories?: unknown[] }).stories?.length || 0;
        this.metadataIndexResult = {
          success: true,
          title: 'Index Found',
          message: 'Metadata index exists in local database',
          storiesCount
        };
        this.showToast(`Metadata index found with ${storiesCount} stor${storiesCount !== 1 ? 'ies' : 'y'}!`, 'success');
      } catch (error) {
        if ((error as { status?: number }).status === 404) {
          this.metadataIndexResult = {
            success: false,
            title: 'Index Not Found',
            message: 'Metadata index not found locally. It may still be syncing from remote, or try rebuilding it.'
          };
          this.showToast('Metadata index not found. Try rebuilding or wait for sync to complete.', 'warning');
        } else {
          throw error;
        }
      }
    } catch (error: unknown) {
      console.error('[DatabaseMaintenance] Failed to check metadata index:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to check metadata index';
      this.metadataIndexResult = { success: false, title: 'Check Failed', message: errorMessage };
      this.showToast('Failed to check metadata index. Please try again.', 'danger');
    } finally {
      this.isCheckingMetadataIndex = false;
    }
  }

  async rebuildMetadataIndex(): Promise<void> {
    this.isRebuildingMetadataIndex = true;
    this.metadataIndexResult = null;

    try {
      const index = await this.metadataIndexService.rebuildIndex(true);
      const storiesCount = index.stories.length;
      this.metadataIndexResult = {
        success: true,
        title: 'Rebuild Successful',
        message: 'Metadata index rebuilt from local stories',
        storiesCount
      };
      this.showToast(`Metadata index rebuilt successfully with ${storiesCount} stor${storiesCount !== 1 ? 'ies' : 'y'}!`, 'success');
    } catch (error: unknown) {
      console.error('[DatabaseMaintenance] Failed to rebuild metadata index:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to rebuild metadata index';
      this.metadataIndexResult = { success: false, title: 'Rebuild Failed', message: errorMessage };
      this.showToast('Failed to rebuild metadata index. Please try again.', 'danger');
    } finally {
      this.isRebuildingMetadataIndex = false;
    }
  }

  // ===== Database Statistics methods =====
  async loadDatabaseStats(): Promise<void> {
    if (!this.isRemoteAvailable) {
      this.showToast('Remote database not connected', 'warning');
      return;
    }

    this.isLoadingStats = true;
    this.databaseStats = null;
    this.statsScanProgress = null;

    try {
      this.databaseStats = await this.dbMaintenanceService.getDatabaseStatsFromRemote(
        (progress) => { this.statsScanProgress = progress; }
      );
      this.showToast('Database statistics loaded', 'success');
    } catch (error: unknown) {
      console.error('Failed to load database stats:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to load database statistics';
      this.showToast(errorMessage, 'danger');
    } finally {
      this.isLoadingStats = false;
      this.statsScanProgress = null;
    }
  }

  // ===== Story Integrity methods =====
  async checkIntegrity(): Promise<void> {
    if (!this.isRemoteAvailable) {
      this.showToast('Remote database not connected', 'warning');
      return;
    }

    this.isCheckingIntegrity = true;
    this.integrityIssues = [];
    this.integrityScanProgress = null;
    this.integrityCheckPerformed = false;

    try {
      this.integrityIssues = await this.dbMaintenanceService.checkStoryIntegrityFromRemote(
        (progress) => { this.integrityScanProgress = progress; }
      );
      this.integrityCheckPerformed = true;
      if (this.integrityIssues.length === 0) {
        this.showToast('All stories passed integrity check!', 'success');
      } else {
        this.showToast(
          `Found ${this.integrityIssues.length} integrity issue${this.integrityIssues.length !== 1 ? 's' : ''}`,
          'warning'
        );
      }
    } catch (error: unknown) {
      console.error('Failed to check story integrity:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to check story integrity';
      this.showToast(errorMessage, 'danger');
    } finally {
      this.isCheckingIntegrity = false;
      this.integrityScanProgress = null;
    }
  }

  // ===== Database Operations methods =====
  async compactDatabase(): Promise<void> {
    this.isCompacting = true;
    this.compactResult = null;

    try {
      const result = await this.dbMaintenanceService.compactDatabase();
      this.compactResult = result;
      const message = result.saved > 0
        ? `Freed ${this.formatFileSize(result.saved)} (${this.formatFileSize(result.sizeBefore)} → ${this.formatFileSize(result.sizeAfter)})`
        : `Storage unchanged at ${this.formatFileSize(result.sizeAfter)}`;
      this.showToast(message, 'success');
    } catch (error: unknown) {
      console.error('Failed to compact database:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to compact database';
      this.showToast(errorMessage, 'danger');
    } finally {
      this.isCompacting = false;
    }
  }

  async deepCleanDatabase(): Promise<void> {
    this.isDeepCleaning = true;
    this.deepCleanResult = null;

    try {
      const result = await this.dbMaintenanceService.deepClean();
      this.deepCleanResult = result;
      const message = result.saved > 0
        ? `Freed ${this.formatFileSize(result.saved)} (${this.formatFileSize(result.sizeBefore)} → ${this.formatFileSize(result.sizeAfter)})`
        : `Deleted ${result.deletedDatabases} index databases`;
      this.showToast(message, 'success');
    } catch (error: unknown) {
      console.error('Failed to deep clean database:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to deep clean database';
      this.showToast(errorMessage, 'danger');
    } finally {
      this.isDeepCleaning = false;
    }
  }

  // ===== TrackBy functions for ngFor performance =====
  trackByIntegrityIssue(_index: number, issue: IntegrityIssue): string {
    return issue.storyId;
  }

  // ===== Developer Tools methods =====
  async createTestStory(): Promise<void> {
    this.isCreatingTestStory = true;
    try {
      const result = await this.testStoryGenerator.createTestStory();
      this.showToast(`Created test story: "${result.title}"`, 'success');
    } catch (error) {
      console.error('Failed to create test story:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to create test story. Please try again.';
      this.showToast(errorMessage, 'danger');
    } finally {
      this.isCreatingTestStory = false;
    }
  }

  // ===== Legacy Media Cleanup methods =====
  // TODO: Remove legacy media cleanup methods after 2026-03-01 - migration cleanup no longer needed
  async showLegacyMediaCleanupConfirmation(): Promise<void> {
    const alert = await this.alertController.create({
      header: 'CLEANUP LEGACY MEDIA',
      message: `This will permanently delete all legacy image and video data from the old storage format:

• Old global images (image_*)
• Old global videos (video_*)
• Old image-video associations

This is a one-time cleanup after migrating to per-story image storage.

New per-story images will NOT be affected.

This action CANNOT be undone!`,
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Delete Legacy Data', role: 'destructive', handler: () => this.cleanupLegacyMedia() }
      ]
    });
    await alert.present();
  }

  async cleanupLegacyMedia(): Promise<void> {
    this.isCleaningLegacyMedia = true;
    this.legacyCleanupResult = null;

    try {
      const result = await this.dbMaintenanceService.cleanupLegacyMediaData();
      this.legacyCleanupResult = result;

      if (result.totalDeleted === 0) {
        this.showToast('No legacy media documents found - database is already clean!', 'success');
      } else if (result.errors.length > 0) {
        this.showToast(
          `Cleanup completed with ${result.errors.length} error(s). Deleted ${result.totalDeleted} documents.`,
          'warning'
        );
      } else {
        this.showToast(
          `Successfully deleted ${result.imagesDeleted} images, ${result.videosDeleted} videos, ${result.associationsDeleted} associations`,
          'success'
        );
      }
    } catch (error: unknown) {
      console.error('Failed to cleanup legacy media:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to cleanup legacy media data';
      this.showToast(errorMessage, 'danger');
    } finally {
      this.isCleaningLegacyMedia = false;
    }
  }
}
