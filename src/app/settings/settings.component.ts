import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  IonContent, IonButton, IonIcon, IonBadge, IonLabel, IonItem,
  IonAccordion, IonAccordionGroup
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBack, statsChart, warning, checkmarkCircle, colorPaletteOutline,
  cloudOutline, archiveOutline, chatbubbleOutline, sparklesOutline, bug, star,
  starOutline, createOutline, documentTextOutline, syncOutline, chatbubblesOutline,
  warningOutline, checkmarkCircleOutline
} from 'ionicons/icons';
import { SettingsService } from '../core/services/settings.service';
import { ModelService } from '../core/services/model.service';
import { DialogService } from '../core/services/dialog.service';
import { Settings } from '../core/models/settings.interface';
import { ModelOption } from '../core/models/model.interface';
import { SettingsTabsComponent, TabItem } from '../ui/components/settings-tabs.component';
import { SettingsContentComponent } from '../ui/components/settings-content.component';
import { BackgroundService } from '../shared/services/background.service';
import { DatabaseMaintenanceComponent } from '../ui/components/database-maintenance/database-maintenance.component';
import { ApiSettingsComponent } from '../ui/settings/api-settings.component';
import { UiSettingsComponent } from '../ui/settings/ui-settings.component';
import { PromptsSettingsComponent } from '../ui/settings/prompts-settings.component';
import { SceneGenerationSettingsComponent } from '../ui/settings/scene-generation-settings.component';
import { PremiumSettingsComponent } from '../ui/settings/premium-settings.component';
import { ModelFavoritesSettingsComponent } from '../ui/settings/model-favorites-settings/model-favorites-settings.component';
import { AppHeaderComponent, HeaderAction } from '../ui/components/app-header.component';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonContent, IonButton, IonIcon, IonBadge, IonLabel, IonItem,
    IonAccordion, IonAccordionGroup,
    SettingsTabsComponent, SettingsContentComponent, DatabaseMaintenanceComponent,
    ApiSettingsComponent, UiSettingsComponent, PromptsSettingsComponent, SceneGenerationSettingsComponent,
    PremiumSettingsComponent, ModelFavoritesSettingsComponent, AppHeaderComponent
  ],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent implements OnInit, OnDestroy {
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private settingsService = inject(SettingsService);
  private modelService = inject(ModelService);
  private backgroundService = inject(BackgroundService);
  private dialogService = inject(DialogService);

  settings: Settings;
  private _hasUnsavedChanges = false;
  private originalSettings!: Settings;
  private subscription: Subscription = new Subscription();

  // Header actions
  private _headerActions: HeaderAction[] = [];

  get headerActions(): HeaderAction[] {
    return this._headerActions;
  }

  get hasUnsavedChanges(): boolean {
    return this._hasUnsavedChanges;
  }

  set hasUnsavedChanges(value: boolean) {
    if (this._hasUnsavedChanges !== value) {
      this._hasUnsavedChanges = value;
      this.updateHeaderActions();
    }
  }

  // Model loading state
  replicateModels: ModelOption[] = [];
  combinedModels: ModelOption[] = [];
  loadingModels = false;
  modelLoadError: string | null = null;

  // Tab control
  selectedTab = 'models';
  tabItems: TabItem[] = [
    { value: 'models', icon: 'cloud-outline', label: 'AI Models' },
    { value: 'favorites', icon: 'star-outline', label: 'AI Favorites' },
    { value: 'appearance', icon: 'color-palette-outline', label: 'Appearance' },
    { value: 'ai-prompts', icon: 'chatbubble-outline', label: 'AI Prompts' },
    { value: 'scene-generation', icon: 'sparkles-outline', label: 'Scene Generation' },
    { value: 'premium', icon: 'star', label: 'Premium' },
    { value: 'backup', icon: 'archive-outline', label: 'Backup & Restore' }
  ];

  constructor() {
    this.settings = this.settingsService.getSettings();
    // Register Ionic icons
    addIcons({
      arrowBack, statsChart, warning, checkmarkCircle, colorPaletteOutline,
      cloudOutline, archiveOutline, chatbubbleOutline, sparklesOutline, bug, star,
      starOutline, createOutline, documentTextOutline, syncOutline, chatbubblesOutline,
      warningOutline, checkmarkCircleOutline
    });
    // Initialize header actions
    this.updateHeaderActions();
  }

  ngOnInit(): void {
    // Check for tab query parameter (e.g., from premium upsell dialog)
    this.subscription.add(
      this.route.queryParams.subscribe(params => {
        if (params['tab'] && this.tabItems.some(t => t.value === params['tab'])) {
          this.selectedTab = params['tab'];
        }
      })
    );

    // Subscribe to settings changes
    this.subscription.add(
      this.settingsService.settings$.subscribe(settings => {
        this.settings = { ...settings };
        this.originalSettings = JSON.parse(JSON.stringify(settings));
        this._hasUnsavedChanges = false;
        this.updateHeaderActions();


        // Ensure appearance object exists
        if (!this.settings.appearance) {
          this.settings.appearance = {
            textColor: '#e0e0e0',
            backgroundImage: 'none',
            directSpeechColor: null,
            thinkingColor: null
          };
        }

        if (!this.settings.favoriteModelLists) {
          this.settings.favoriteModelLists = {
            beatInput: [...(this.settings.favoriteModels ?? [])],
            sceneSummary: [],
            rewrite: [],
            characterChat: []
          };
        }

        if (!Array.isArray(this.settings.favoriteModelLists.beatInput)) {
          this.settings.favoriteModelLists.beatInput = [...(this.settings.favoriteModels ?? [])];
        }

        if (!Array.isArray(this.settings.favoriteModelLists.sceneSummary)) {
          this.settings.favoriteModelLists.sceneSummary = [];
        }

        if (!Array.isArray(this.settings.favoriteModelLists.rewrite)) {
          this.settings.favoriteModelLists.rewrite = [];
        }

        if (!Array.isArray(this.settings.favoriteModelLists.characterChat)) {
          this.settings.favoriteModelLists.characterChat = [];
        }
      })
    );

    // Subscribe to model loading state
    this.subscription.add(
      this.modelService.loading$.subscribe(loading => {
        this.loadingModels = loading;
      })
    );

    // Subscribe to model updates
    this.subscription.add(
      this.modelService.replicateModels$.subscribe(models => {
        this.replicateModels = models;
      })
    );

    // Load combined models if any API is enabled
    if ((this.settings.openRouter.enabled && this.settings.openRouter.apiKey) ||
        (this.settings.googleGemini.enabled && this.settings.googleGemini.apiKey)) {
      this.loadCombinedModels();
    }
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
  }

  private updateHeaderActions(): void {
    this._headerActions = [
      {
        icon: 'stats-chart',
        label: 'AI Logs',
        action: () => this.goToAILogs(),
        showOnMobile: false,
        showOnDesktop: true
      },
      {
        icon: this._hasUnsavedChanges ? 'warning-outline' : 'checkmark-circle-outline',
        chipContent: this._hasUnsavedChanges ? 'Not saved' : 'Saved',
        chipColor: this._hasUnsavedChanges ? 'warning' : 'success',
        action: () => { /* Status chip - no action needed */ },
        showOnMobile: true,
        showOnDesktop: true
      }
    ];
  }

  onSettingsChange(): void {
    this.hasUnsavedChanges = JSON.stringify(this.settings) !== JSON.stringify(this.originalSettings);
  }

  onFavoriteModelsChange(list: keyof Settings['favoriteModelLists'], favoriteIds: string[]): void {
    const currentLists = this.settings.favoriteModelLists ?? {
      beatInput: [...(this.settings.favoriteModels ?? [])],
      sceneSummary: [],
      rewrite: [],
      characterChat: []
    };

    const normalizedLists: Settings['favoriteModelLists'] = {
      beatInput: Array.isArray(currentLists.beatInput) ? [...currentLists.beatInput] : [...(this.settings.favoriteModels ?? [])],
      sceneSummary: Array.isArray(currentLists.sceneSummary) ? [...currentLists.sceneSummary] : [],
      rewrite: Array.isArray(currentLists.rewrite) ? [...currentLists.rewrite] : [],
      characterChat: Array.isArray(currentLists.characterChat) ? [...currentLists.characterChat] : []
    };

    normalizedLists[list] = [...favoriteIds];

    this.settings.favoriteModelLists = normalizedLists;

    if (list === 'beatInput') {
      this.settings.favoriteModels = [...favoriteIds];
    }

    this.onSettingsChange();
  }

  saveSettings(): void {
    this.settingsService.updateSettings(this.settings);
    this.hasUnsavedChanges = false;

    // Clear preview background since settings are now saved
    this.backgroundService.clearPreviewBackground();
  }

  async resetSettings(): Promise<void> {
    const confirmed = await this.dialogService.confirmDestructive({
      header: 'Reset Settings',
      message: 'Are you sure you want to reset all settings to default values?',
      confirmText: 'Reset'
    });
    if (confirmed) {
      this.settingsService.clearSettings();
      // Clear preview background
      this.backgroundService.clearPreviewBackground();
    }
  }

  onModelsLoaded(models: ModelOption[]): void {
    this.combinedModels = models;
  }

  async goBack(): Promise<void> {
    if (this.hasUnsavedChanges) {
      const confirmed = await this.dialogService.confirmWarning({
        header: 'Unsaved Changes',
        message: 'You have unsaved changes. Do you really want to leave the page?',
        confirmText: 'Leave',
        cancelText: 'Stay'
      });
      if (confirmed) {
        // Clear preview background since we're discarding changes
        this.backgroundService.clearPreviewBackground();
        this.router.navigate(['/']);
      }
    } else {
      // Clear preview background
      this.backgroundService.clearPreviewBackground();
      this.router.navigate(['/']);
    }
  }

  async goToAILogs(): Promise<void> {
    if (this.hasUnsavedChanges) {
      const confirmed = await this.dialogService.confirmWarning({
        header: 'Unsaved Changes',
        message: 'You have unsaved changes. Do you really want to leave the page?',
        confirmText: 'Leave',
        cancelText: 'Stay'
      });
      if (confirmed) {
        // Clear preview background since we're discarding changes
        this.backgroundService.clearPreviewBackground();
        this.router.navigate(['/logs']);
      }
    } else {
      // Clear preview background
      this.backgroundService.clearPreviewBackground();
      this.router.navigate(['/logs']);
    }
  }

  async goToMobileDebug(): Promise<void> {
    if (this.hasUnsavedChanges) {
      const confirmed = await this.dialogService.confirmWarning({
        header: 'Unsaved Changes',
        message: 'You have unsaved changes. Do you really want to leave the page?',
        confirmText: 'Leave',
        cancelText: 'Stay'
      });
      if (confirmed) {
        // Clear preview background since we're discarding changes
        this.backgroundService.clearPreviewBackground();
        this.router.navigate(['/mobile-debug']);
      }
    } else {
      // Clear preview background
      this.backgroundService.clearPreviewBackground();
      this.router.navigate(['/mobile-debug']);
    }
  }

  loadCombinedModels(): void {
    this.modelLoadError = null;
    this.subscription.add(
      this.modelService.getCombinedModels().subscribe({
        next: (models) => {
          this.combinedModels = models;
        },
        error: (error) => {
          console.error('Failed to load combined models:', error);
          this.modelLoadError = 'Error loading models. Check your API keys and internet connection.';
        }
      })
    );
  }

}
