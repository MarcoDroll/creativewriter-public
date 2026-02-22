import { Component, OnInit, OnDestroy, inject, ChangeDetectionStrategy, signal, computed } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonContent, IonCard, IonCardHeader, IonCardTitle, IonCardContent,
  IonList, IonItem, IonLabel, IonChip, IonIcon, IonButton,
  IonSegment, IonSegmentButton, IonSelect, IonSelectOption,
  IonSpinner, IonBadge, IonText, IonNote, IonSearchbar,
  ActionSheetController, ToastController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBack, cloudUpload, cloudDownload, warning, alertCircle, informationCircle,
  checkmarkCircle, close, funnel, trash, refresh, laptop, desktop
} from 'ionicons/icons';
import { SyncLoggerService, SyncLog } from '../../../core/services/sync-logger.service';
import { DeviceService } from '../../../core/services/device.service';
import { StoryService } from '../../services/story.service';
import { Story } from '../../models/story.interface';
import { AppHeaderComponent } from '../../../ui/components/app-header.component';
import { toDate, formatRelativeDate, formatDateTime } from '../../../shared/utils/date-utils';

type ViewMode = 'logs' | 'stories';
type FilterType = 'all' | 'upload' | 'download' | 'conflict' | 'error' | 'info';

interface StoryModification {
  storyId: string;
  storyTitle: string;
  updatedAt: Date | string;
  lastModifiedBy?: {
    deviceId: string;
    deviceName: string;
    timestamp: Date | string;
  };
  modifications: SyncLog[];
}

@Component({
  selector: 'app-sync-history',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonContent, IonCard, IonCardHeader, IonCardTitle, IonCardContent,
    IonList, IonItem, IonLabel, IonChip, IonIcon, IonButton,
    IonSegment, IonSegmentButton, IonSelect, IonSelectOption,
    IonSpinner, IonBadge, IonText, IonNote, IonSearchbar,
    AppHeaderComponent
  ],
  templateUrl: './sync-history.component.html',
  styleUrls: ['./sync-history.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SyncHistoryComponent implements OnInit, OnDestroy {
  private syncLogger = inject(SyncLoggerService);
  private deviceService = inject(DeviceService);
  private storyService = inject(StoryService);
  private router = inject(Router);
  private actionSheetCtrl = inject(ActionSheetController);
  private toastCtrl = inject(ToastController);
  private destroy$ = new Subject<void>();

  // Signals for reactive state
  viewMode = signal<ViewMode>('logs');
  filterType = signal<FilterType>('all');
  searchText = signal('');
  allLogs = signal<SyncLog[]>([]);
  stories = signal<Story[]>([]);
  currentDeviceId = signal('');
  loading = signal(true);

  // Computed signal for filtered logs
  filteredLogs = computed(() => {
    const logs = this.allLogs();
    const filter = this.filterType();
    const search = this.searchText().toLowerCase().trim();

    let result = logs;

    // Apply type filter
    if (filter !== 'all') {
      result = result.filter(log => log.type === filter);
    }

    // Apply search filter
    if (search) {
      result = result.filter(log =>
        log.action.toLowerCase().includes(search) ||
        log.details?.toLowerCase().includes(search) ||
        log.deviceName?.toLowerCase().includes(search)
      );
    }

    return result;
  });

  // Computed signal for story modifications
  storyModifications = computed(() => {
    const storiesArray = this.stories();
    const logs = this.allLogs();

    const storyMap = new Map<string, StoryModification>();

    // First, add all stories with their device modification info
    storiesArray.forEach(story => {
      storyMap.set(story.id, {
        storyId: story.id,
        storyTitle: story.title || 'Untitled Story',
        updatedAt: story.updatedAt,
        lastModifiedBy: story.lastModifiedBy,
        modifications: []
      });
    });

    // Then, add sync logs that reference stories
    logs.forEach(log => {
      if (log.storyIds && log.storyIds.length > 0) {
        log.storyIds.forEach(storyId => {
          const modification = storyMap.get(storyId);
          if (modification) {
            modification.modifications.push(log);
          }
        });
      }
    });

    // Show ALL stories, sorted by lastModifiedBy timestamp or updatedAt
    return Array.from(storyMap.values())
      .sort((a, b) => {
        // Use lastModifiedBy timestamp if available, otherwise fall back to updatedAt
        const aTime = toDate(a.lastModifiedBy?.timestamp)?.getTime() || toDate(a.updatedAt)?.getTime() || 0;
        const bTime = toDate(b.lastModifiedBy?.timestamp)?.getTime() || toDate(b.updatedAt)?.getTime() || 0;
        return bTime - aTime;
      });
  });

  // Use built-in back button instead of leftActions for proper visibility
  backAction = () => this.goBack();

  constructor() {
    addIcons({
      arrowBack, cloudUpload, cloudDownload, warning, alertCircle, informationCircle,
      checkmarkCircle, close, funnel, trash, refresh, laptop, desktop
    });
  }

  async ngOnInit(): Promise<void> {
    this.currentDeviceId.set(this.deviceService.getDeviceId());

    // Subscribe to sync logs
    this.syncLogger.logs$
      .pipe(takeUntil(this.destroy$))
      .subscribe(logs => {
        this.allLogs.set(logs);
      });

    // Load stories
    await this.loadStories();
    this.loading.set(false);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  async loadStories(): Promise<void> {
    try {
      const stories = await this.storyService.getAllStories();
      this.stories.set(stories);
    } catch (error) {
      console.error('Error loading stories:', error);
      await this.showToast('Error loading stories', 'danger');
    }
  }

  onViewModeChange(event: CustomEvent): void {
    this.viewMode.set(event.detail.value as ViewMode);
  }

  onFilterChange(event: CustomEvent): void {
    this.filterType.set(event.detail.value as FilterType);
  }

  onSearchChange(event: CustomEvent): void {
    this.searchText.set(event.detail.value || '');
  }

  async clearLogs(): Promise<void> {
    const actionSheet = await this.actionSheetCtrl.create({
      header: 'Clear All Sync Logs?',
      subHeader: 'This will remove all sync history. Story device information will be preserved.',
      buttons: [
        {
          text: 'Clear All Logs',
          role: 'destructive',
          icon: 'trash',
          handler: () => {
            this.syncLogger.clearLogs();
            this.showToast('Sync logs cleared', 'success');
          }
        },
        {
          text: 'Cancel',
          role: 'cancel',
          icon: 'close'
        }
      ]
    });

    await actionSheet.present();
  }

  async refreshData(): Promise<void> {
    try {
      this.loading.set(true);
      await this.loadStories();
      await this.showToast('Data refreshed', 'success');
    } finally {
      this.loading.set(false);
    }
  }

  goBack(): void {
    this.router.navigate(['/']);
  }

  getTypeIcon(type: SyncLog['type']): string {
    switch (type) {
      case 'upload': return 'cloud-upload';
      case 'download': return 'cloud-download';
      case 'conflict': return 'warning';
      case 'error': return 'alert-circle';
      case 'info': return 'information-circle';
      default: return 'information-circle';
    }
  }

  getTypeColor(type: SyncLog['type']): string {
    switch (type) {
      case 'upload': return 'primary';
      case 'download': return 'secondary';
      case 'conflict': return 'warning';
      case 'error': return 'danger';
      case 'info': return 'medium';
      default: return 'medium';
    }
  }

  getStatusColor(status: SyncLog['status']): string {
    switch (status) {
      case 'success': return 'success';
      case 'error': return 'danger';
      case 'warning': return 'warning';
      case 'info': return 'medium';
      default: return 'medium';
    }
  }

  isCurrentDevice(deviceId?: string): boolean {
    return deviceId === this.currentDeviceId();
  }

  // Use imported utility functions for date formatting
  formatDate(date: Date | string | unknown): string {
    return formatRelativeDate(date);
  }

  formatDateTimeStr(date: Date | string | unknown): string {
    return formatDateTime(date);
  }

  private async showToast(message: string, color: 'success' | 'danger' | 'warning' | 'medium'): Promise<void> {
    const toast = await this.toastCtrl.create({
      message,
      duration: 2000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  trackByLogId(index: number, log: SyncLog): string {
    return log.id;
  }

  trackByStoryId(index: number, mod: StoryModification): string {
    return mod.storyId;
  }
}
