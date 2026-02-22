import { Component, OnInit, OnDestroy, TemplateRef, ViewChild, inject, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer } from '@angular/platform-browser';
import {
  IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonChip, IonIcon, IonButton,
  IonContent, IonLabel, IonSpinner, ActionSheetController, ToastController
} from '@ionic/angular/standalone';
import { CdkDropList, CdkDrag, CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { addIcons } from 'ionicons';
import { add, download, settings, statsChart, trash, create, images, menu, close, reorderThree, swapVertical, move, appsOutline, checkmarkCircle, alertCircle, sync } from 'ionicons/icons';
import { StoryService } from '../../services/story.service';
import { StoryMetadata } from '../../models/story-metadata.interface';
import { StoryMetadataIndexService } from '../../services/story-metadata-index.service';
import { StoryLanguage } from '../../../ui/components/language-selection-dialog/language-selection-dialog.component';
import { NarrativePerspective, StoryTense } from '../../models/story.interface';
import { SyncStatusComponent } from '../../../ui/components/sync-status.component';
import { LoginComponent } from '../../../ui/components/login.component';
import { AuthService, User } from '../../../core/services/auth.service';
import { AppHeaderComponent, BurgerMenuItem, HeaderAction } from '../../../ui/components/app-header.component';
import { HeaderNavigationService } from '../../../shared/services/header-navigation.service';
import { VersionService } from '../../../core/services/version.service';
import { DatabaseService, SyncStatus } from '../../../core/services/database.service';
import { DialogService } from '../../../core/services/dialog.service';

/**
 * Unified loading state for story list
 * Replaces multiple boolean flags for clearer state management
 */
export enum LoadingState {
  INITIAL = 'initial',     // App just started, no data yet
  SYNCING = 'syncing',     // Syncing stories from cloud (first-time or bootstrap)
  LOADING = 'loading',     // Loading from local database
  READY = 'ready',         // Stories loaded and ready
  EMPTY = 'empty'          // No stories exist
}

@Component({
  selector: 'app-story-list',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonChip, IonIcon, IonButton,
    IonContent, IonLabel, IonSpinner,
    CdkDropList, CdkDrag,
    SyncStatusComponent, LoginComponent, AppHeaderComponent
  ],
  templateUrl: './story-list.component.html',
  styleUrls: ['./story-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StoryListComponent implements OnInit, OnDestroy {
  private storyService = inject(StoryService);
  private metadataIndexService = inject(StoryMetadataIndexService);
  private router = inject(Router);
  private authService = inject(AuthService);
  private headerNavService = inject(HeaderNavigationService);
  private sanitizer = inject(DomSanitizer);
  private cdr = inject(ChangeDetectorRef);
  private actionSheetCtrl = inject(ActionSheetController);
  private toastCtrl = inject(ToastController);
  private databaseService = inject(DatabaseService);
  private dialogService = inject(DialogService);
  private destroy$ = new Subject<void>();
  versionService = inject(VersionService);
  private lastSyncTime: Date | undefined;

  @ViewChild('burgerMenuFooter', { static: true }) burgerMenuFooter!: TemplateRef<unknown>;
  stories: StoryMetadata[] = [];
  currentUser: User | null = null;
  fabMenuOpen = false;
  burgerMenuItems: BurgerMenuItem[] = [];
  rightActions: HeaderAction[] = [];
  reorderingEnabled = false;
  private reorderDirty = false; // Track if order changes need saving

  // Unified loading state
  loadingState: LoadingState = LoadingState.INITIAL;

  // Backward-compatible getters for templates
  get isLoadingStories(): boolean {
    return this.loadingState === LoadingState.LOADING ||
           this.loadingState === LoadingState.INITIAL ||
           this.loadingState === LoadingState.SYNCING;
  }

  get isSyncingInitialData(): boolean {
    return this.loadingState === LoadingState.SYNCING;
  }

  // Sync status for loading indicator
  syncStatus: SyncStatus = {
    isOnline: navigator.onLine,
    isSync: false
  };

  // Pagination support
  pageSize = 50;  // Load 50 stories at a time
  currentPage = 0;
  totalStories = 0;
  hasMoreStories = false;
  isLoadingMore = false;

  // Guard to prevent loadStories re-entry (sync events can cause loops)
  private isLoadingInProgress = false;

  constructor() {
    // Register Ionic icons
    addIcons({ add, download, settings, statsChart, trash, create, images, menu, close, reorderThree, swapVertical, move, appsOutline, checkmarkCircle, alertCircle, sync });
  }

  ngOnInit(): void {
    // Clear active story for selective sync - when at story list, sync metadata-index
    // NOTE: Fire-and-forget with error logging (no need to await in ngOnInit)
    this.databaseService.setActiveStoryId(null).catch(err => {
      console.error('[StoryList] Failed to clear active story ID:', err);
    });

    // Subscribe to user changes FIRST (before initial load)
    // This prevents duplicate loads on initialization
    this.authService.currentUser$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => {
        this.currentUser = user;
        // Reload stories when user changes (different database)
        this.loadingState = LoadingState.LOADING;
        this.loadStories().then(() => {
          this.setupRightActions();
          // loadStories sets final state (READY or EMPTY)
          this.cdr.markForCheck();
        });
      });

    // Subscribe to version changes and setup right actions when version is available
    this.versionService.version$
      .pipe(takeUntil(this.destroy$))
      .subscribe(version => {
        if (version) {
          this.setupRightActions();
          this.cdr.markForCheck();
        }
      });

    // Subscribe to sync status changes to reload stories when sync completes
    this.databaseService.syncStatus$
      .pipe(takeUntil(this.destroy$))
      .subscribe(status => {
        this.syncStatus = status;

        // If we're in INITIAL state and sync is active, switch to SYNCING
        if (this.loadingState === LoadingState.INITIAL &&
            (status.isSync || status.isConnecting)) {
          this.loadingState = LoadingState.SYNCING;
        }

        // Check if sync just completed (has lastSync and it's different from our last known sync)
        if (status.lastSync && (!this.lastSyncTime || status.lastSync > this.lastSyncTime)) {
          this.lastSyncTime = status.lastSync;
          // Reload stories when sync brings in new changes
          this.loadStories().then(() => {
            // Explicitly trigger change detection since we use OnPush strategy
            this.cdr.markForCheck();
          });
        } else {
          // Trigger change detection for sync status updates
          this.cdr.markForCheck();
        }
      });

    // Setup burger menu items
    this.setupBurgerMenu();
  }
  
  private setupRightActions(): void {
    this.rightActions = [];
    
    // Add reorder toggle button if there are multiple stories
    if (this.stories.length > 1) {
      this.rightActions.push({
        icon: 'apps-outline',
        action: () => this.toggleReordering(),
        showOnMobile: true,
        showOnDesktop: true,
        cssClass: this.reorderingEnabled ? 'reorder-active' : '',
        tooltip: this.reorderingEnabled ? 'End sorting' : 'Sort stories'
      });
    }
    
    // Add version chip (version is guaranteed to be available when this is called)
    this.rightActions.push({
      icon: '',
      chipContent: this.versionService.getShortVersion(),
      chipColor: 'medium',
      action: () => { /* No action needed for version chip */ },
      showOnMobile: true,
      showOnDesktop: true,
      showVersionTooltip: true
    });
  }

  async logout(): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      header: 'Sign Out',
      message: 'Do you really want to sign out? Local changes will be preserved.',
      confirmText: 'Sign Out',
      cancelText: 'Cancel'
    });
    if (confirmed) {
      this.authService.logout();
    }
  }

  async loadStories(reset = true): Promise<void> {
    // Guard against re-entry to prevent sync loops
    // (getMetadataIndex saves to local DB which triggers sync events, which calls loadStories again)
    if (this.isLoadingInProgress) {
      console.debug('[StoryList] loadStories already in progress, skipping');
      return;
    }
    this.isLoadingInProgress = true;

    if (reset) {
      this.currentPage = 0;
      this.stories = [];
      // Only set LOADING if not already SYNCING (preserve sync state)
      if (this.loadingState !== LoadingState.SYNCING) {
        this.loadingState = LoadingState.LOADING;
      }
    } else {
      this.isLoadingMore = true;
    }

    try {
      // Note: We no longer wait for initial sync here. Instead:
      // - If sync is in progress and metadata index fails, we fall back to full story load
      // - If that also fails, we trigger bootstrap sync (which properly waits)
      // - When sync completes (paused event), syncStatus$ triggers a reload automatically

      // Load story metadata from index (lightweight)
      const index = await this.metadataIndexService.getMetadataIndex();

      // Sort stories by order field (ascending), then by updatedAt (descending)
      const sortedStories = [...index.stories].sort((a, b) => {
        // First sort by order if both have it
        if (a.order !== undefined && b.order !== undefined) {
          return a.order - b.order;
        }
        // Stories with order come before those without
        if (a.order !== undefined) return -1;
        if (b.order !== undefined) return 1;
        // Fall back to updatedAt (newest first)
        return b.updatedAt.getTime() - a.updatedAt.getTime();
      });

      // Implement pagination on metadata
      const startIndex = this.currentPage * this.pageSize;
      const endIndex = startIndex + this.pageSize;
      const newStories = sortedStories.slice(startIndex, endIndex);

      // Get total count
      if (reset) {
        this.totalStories = sortedStories.length;
      }

      // Append or replace stories
      if (reset) {
        this.stories = newStories;
      } else {
        this.stories = [...this.stories, ...newStories];
      }

      // Check if there are more stories to load
      const loadedCount = (this.currentPage + 1) * this.pageSize;
      this.hasMoreStories = loadedCount < this.totalStories && newStories.length === this.pageSize;

      // Set final loading state based on whether we have stories
      // Note: With metadata index architecture, if we get 0 stories here, it means:
      // - Remote metadata index was empty AND remote had no stories (rebuildIndexFromRemote handles stale index)
      // - OR we're offline and local has no stories
      if (this.stories.length > 0) {
        this.loadingState = LoadingState.READY;
      } else if (this.syncStatus.isSync || this.syncStatus.isConnecting) {
        // Sync is in progress - show syncing state
        this.loadingState = LoadingState.SYNCING;
      } else {
        // No stories found - show empty state
        this.loadingState = LoadingState.EMPTY;
      }

    } catch (error) {
      console.error('[StoryList] Failed to load metadata index, falling back to full stories:', error);
      // Fallback to loading full stories if metadata index fails
      try {
        const newStories = await this.storyService.getAllStories(
          this.pageSize,
          this.currentPage * this.pageSize
        );

        if (reset) {
          this.totalStories = await this.storyService.getTotalStoriesCount();
        }

        // Map Story to StoryMetadata for display
        const metadata: StoryMetadata[] = newStories.map(story => ({
          id: story.id,
          title: story.title,
          coverImageThumbnail: story.coverImage,
          previewText: this.storyService.getStoryPreview(story),
          chapterCount: story.chapters.length,
          sceneCount: story.chapters.reduce((sum, ch) => sum + ch.scenes.length, 0),
          wordCount: this.storyService.getWordCount(story),
          createdAt: story.createdAt,
          updatedAt: story.updatedAt,
          order: story.order
        }));

        if (reset) {
          this.stories = metadata;
        } else {
          this.stories = [...this.stories, ...metadata];
        }

        const loadedCount = (this.currentPage + 1) * this.pageSize;
        this.hasMoreStories = loadedCount < this.totalStories && newStories.length === this.pageSize;

      } catch (fallbackError) {
        console.error('[StoryList] Fallback loading also failed:', fallbackError);
        throw fallbackError;
      }
    } finally {
      // Set final state if not already set (e.g., by bootstrap sync early return)
      if (this.loadingState === LoadingState.LOADING ||
          this.loadingState === LoadingState.INITIAL) {
        this.loadingState = this.stories.length > 0 ? LoadingState.READY : LoadingState.EMPTY;
      }
      this.isLoadingMore = false;
      this.isLoadingInProgress = false;
      this.cdr.markForCheck();
    }
  }

  async loadMoreStories(): Promise<void> {
    if (this.isLoadingMore || !this.hasMoreStories) {
      return;
    }

    this.currentPage++;
    await this.loadStories(false);
  }

  drop(event: CdkDragDrop<StoryMetadata[]>): void {
    if (event.previousIndex !== event.currentIndex) {
      // Move item in local array
      moveItemInArray(this.stories, event.previousIndex, event.currentIndex);

      // Update the order field for each story based on new position
      this.stories = this.stories.map((story, index) => ({
        ...story,
        order: index
      }));

      // Mark as dirty - will be saved when exiting reorder mode
      this.reorderDirty = true;
      this.cdr.markForCheck();
    }
  }
  
  async toggleReordering(): Promise<void> {
    const wasReordering = this.reorderingEnabled;
    const hadChanges = this.reorderDirty;

    // Toggle UI immediately (optimistic update)
    this.reorderingEnabled = !this.reorderingEnabled;
    this.setupRightActions();
    this.cdr.markForCheck();

    // Save in background if exiting with changes
    if (wasReordering && hadChanges) {
      this.saveStoryOrder();  // No await - fire and forget
    }
  }

  /**
   * Save the current story order to the metadata index
   * This is more efficient than updating each story document (1 document vs N)
   */
  private async saveStoryOrder(): Promise<void> {
    try {
      // Single call to update order in metadata index
      const orderedIds = this.stories.map(s => s.id);
      await this.metadataIndexService.updateStoryOrder(orderedIds);
      this.reorderDirty = false;
    } catch (error) {
      console.error('Failed to save story order:', error);
      // Show error toast
      const toast = await this.toastCtrl.create({
        message: 'Failed to save story order. Please try again.',
        duration: 3000,
        color: 'danger'
      });
      await toast.present();
      // Reload stories to reset to previous state
      await this.loadStories();
    }
  }

  toggleFabMenu(): void {
    this.fabMenuOpen = !this.fabMenuOpen;
  }

  onBurgerMenuToggle(): void {
    // Handle burger menu state changes if needed
  }
  
  private setupBurgerMenu(): void {
    this.burgerMenuItems = [
      ...this.headerNavService.getStoryBurgerMenuItems()
    ];
  }

  async createNewStory(): Promise<void> {
    this.fabMenuOpen = false;
    
    // Show language selection action sheet
    const actionSheet = await this.actionSheetCtrl.create({
      header: 'Select Story Language',
      subHeader: 'Choose the language for your story. This will set the AI assistant\'s language for generating content.',
      cssClass: 'language-selection-action-sheet',
      buttons: [
        {
          text: 'English',
          data: { language: 'en' },
          handler: () => this.handleLanguageSelection('en')
        },
        {
          text: 'Deutsch',
          data: { language: 'de' },
          handler: () => this.handleLanguageSelection('de')
        },
        {
          text: 'Français', 
          data: { language: 'fr' },
          handler: () => this.handleLanguageSelection('fr')
        },
        {
          text: 'Español',
          data: { language: 'es' },
          handler: () => this.handleLanguageSelection('es')
        },
        {
          text: 'Custom Language',
          data: { language: 'custom' },
          handler: () => this.handleLanguageSelection('custom')
        },
        {
          text: 'Cancel',
          role: 'cancel'
        }
      ]
    });
    
    await actionSheet.present();
  }

  private async handleLanguageSelection(language: string): Promise<void> {
    // Show POV selection action sheet
    const povSheet = await this.actionSheetCtrl.create({
      header: 'Select Narrative Perspective',
      subHeader: 'Choose the point of view for your story. This can be changed later in story settings.',
      cssClass: 'pov-selection-action-sheet',
      buttons: [
        {
          text: 'Third Person Limited (Recommended)',
          data: { pov: 'third-person-limited' },
          handler: () => this.handlePovSelection(language as StoryLanguage, 'third-person-limited')
        },
        {
          text: 'First Person',
          data: { pov: 'first-person' },
          handler: () => this.handlePovSelection(language as StoryLanguage, 'first-person')
        },
        {
          text: 'Third Person Omniscient',
          data: { pov: 'third-person-omniscient' },
          handler: () => this.handlePovSelection(language as StoryLanguage, 'third-person-omniscient')
        },
        {
          text: 'Second Person',
          data: { pov: 'second-person' },
          handler: () => this.handlePovSelection(language as StoryLanguage, 'second-person')
        },
        {
          text: 'Cancel',
          role: 'cancel'
        }
      ]
    });

    await povSheet.present();
  }

  private async handlePovSelection(language: StoryLanguage, pov: NarrativePerspective): Promise<void> {
    // Show tense selection action sheet
    const tenseSheet = await this.actionSheetCtrl.create({
      header: 'Select Tense',
      subHeader: 'Choose the grammatical tense for your story. This can be changed later in story settings.',
      cssClass: 'tense-selection-action-sheet',
      buttons: [
        {
          text: 'Past Tense (Recommended)',
          data: { tense: 'past' },
          handler: () => this.createStoryWithSettings(language, pov, 'past')
        },
        {
          text: 'Present Tense',
          data: { tense: 'present' },
          handler: () => this.createStoryWithSettings(language, pov, 'present')
        },
        {
          text: 'Cancel',
          role: 'cancel'
        }
      ]
    });

    await tenseSheet.present();
  }

  private async createStoryWithSettings(language: StoryLanguage, pov: NarrativePerspective, tense: StoryTense): Promise<void> {
    const newStory = await this.storyService.createStory(language, pov, tense);
    this.router.navigate(['/stories/editor', newStory.id]);
  }

  openStory(storyId: string): void {
    this.router.navigate(['/stories/editor', storyId]);
  }

  goToSettings(): void {
    this.router.navigate(['/settings']);
  }

  goToAILogger(): void {
    this.router.navigate(['/logs']);
  }

  importNovelCrafter(): void {
    this.fabMenuOpen = false;
    this.router.navigate(['/stories/import/novelcrafter']);
  }

  goToImageGeneration(): void {
    this.fabMenuOpen = false;
    this.router.navigate(['/stories/image-generation']);
  }

  async deleteStory(event: Event, storyId: string): Promise<void> {
    event.stopPropagation();
    const confirmed = await this.dialogService.confirmDestructive({
      header: 'Delete Story',
      message: 'Do you really want to delete this story? This action cannot be undone.',
      confirmText: 'Delete'
    });
    if (confirmed) {
      await this.storyService.deleteStory(storyId);
      await this.loadStories();
      this.cdr.markForCheck();
    }
  }

  getStoryPreview(story: StoryMetadata): string {
    // Metadata already includes preview text
    return story.previewText;
  }

  getWordCount(story: StoryMetadata): number {
    // Metadata already includes word count
    return story.wordCount;
  }

  getCoverImageUrl(story: StoryMetadata): string | null {
    if (!story.coverImageThumbnail) return null;
    return `data:image/png;base64,${story.coverImageThumbnail}`;
  }

  trackByStoryId(index: number, story: StoryMetadata): string {
    return story.id;
  }

  /**
   * Get loading message based on current state
   */
  getLoadingMessage(): string {
    switch (this.loadingState) {
      case LoadingState.SYNCING:
        if (this.syncStatus.isConnecting) {
          return 'Connecting to cloud storage...';
        }
        if (this.syncStatus.syncProgress) {
          const progress = this.syncStatus.syncProgress;
          if (progress.docsProcessed > 0) {
            return `Syncing... (${progress.docsProcessed} items)`;
          }
          if (progress.pendingDocs !== undefined && progress.pendingDocs > 0) {
            return `Syncing ${progress.pendingDocs} ${progress.pendingDocs === 1 ? 'item' : 'items'}...`;
          }
        }
        return 'Syncing stories from cloud...';
      case LoadingState.LOADING:
        return 'Loading stories...';
      case LoadingState.INITIAL:
        return 'Preparing...';
      default:
        return 'Loading...';
    }
  }

  /**
   * Get loading subtext for additional context
   */
  getLoadingSubtext(): string | null {
    if (this.loadingState === LoadingState.SYNCING) {
      return 'First time loading may take a moment';
    }
    return null;
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
