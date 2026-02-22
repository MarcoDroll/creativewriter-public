import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent, IonButton, IonIcon, IonFab, IonFabButton,
  IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonItem, IonLabel,
  IonTextarea, IonCheckbox, IonNote,
  IonText, IonGrid, IonRow, IonCol,
  IonBadge, IonSelect, IonSelectOption, IonAccordion, IonAccordionGroup,
  IonSegment, IonSegmentButton
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBack, saveOutline, refreshOutline, checkmarkCircleOutline,
  warningOutline, informationCircleOutline, codeSlashOutline,
  settingsOutline, chatboxOutline, documentTextOutline,
  imageOutline, starOutline, createOutline, syncOutline,
  chatbubblesOutline, cloudDownloadOutline, downloadOutline, cloudUploadOutline,
  documentOutline, alertCircleOutline, chevronForward, chevronDown, listOutline,
  eyeOutline, gitBranchOutline
} from 'ionicons/icons';
import { StoryService } from '../../services/story.service';
import {
  Story, StorySettings, DEFAULT_STORY_SETTINGS, NarrativePerspective, StoryTense,
  BeatTemplateSections, SceneBeatTemplateSections, SceneFromOutlineTemplateSections,
  DEFAULT_BEAT_TEMPLATE_SECTIONS, DEFAULT_SCENE_BEAT_TEMPLATE_SECTIONS, DEFAULT_ENVISION_BEAT_TEMPLATE_SECTIONS, DEFAULT_SCENE_FROM_OUTLINE_TEMPLATE_SECTIONS,
  StoryLanguage
} from '../../models/story.interface';
import { ModelOption } from '../../../core/models/model.interface';
import { ModelService } from '../../../core/services/model.service';
import { getSystemMessage, getBeatGenerationTemplate, getDefaultBeatRules } from '../../../shared/resources/system-messages';
import { migrateSettingsToSections, sectionsToTemplate, sceneBeatSectionsToTemplate, sceneFromOutlineSectionsToTemplate, mergeBeatSections, mergeSceneBeatSections, mergeSceneFromOutlineSections, mergeEnvisionBeatSections } from '../../../shared/utils/template-migration';
import { BeatTemplateSectionsComponent } from '../beat-template-sections/beat-template-sections.component';
import { BeatAIPreviewModalComponent } from '../beat-ai-preview-modal/beat-ai-preview-modal.component';
import { SettingsTabsComponent, TabItem } from '../../../ui/components/settings-tabs.component';
import { SettingsContentComponent } from '../../../ui/components/settings-content.component';
import { ImageUploadComponent, ImageUploadResult } from '../../../ui/components/image-upload.component';
import { ModelFavoritesSettingsComponent } from '../../../ui/settings/model-favorites-settings/model-favorites-settings.component';
import { AppHeaderComponent, HeaderAction } from '../../../ui/components/app-header.component';
import { StoryExportImportService, StoryExportData } from '../../services/story-export-import.service';
import { DialogService } from '../../../core/services/dialog.service';

@Component({
  selector: 'app-story-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonContent, IonButton, IonIcon, IonFab, IonFabButton,
    IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonItem, IonLabel,
    IonTextarea, IonCheckbox, IonNote,
    IonText, IonGrid, IonRow, IonCol,
    IonBadge, IonSelect, IonSelectOption, IonAccordion, IonAccordionGroup,
    IonSegment, IonSegmentButton,
    SettingsTabsComponent, SettingsContentComponent, ImageUploadComponent,
    ModelFavoritesSettingsComponent, AppHeaderComponent, BeatTemplateSectionsComponent,
    BeatAIPreviewModalComponent
  ],
  templateUrl: './story-settings.component.html',
  styleUrls: ['./story-settings.component.scss']
})
export class StorySettingsComponent implements OnInit {
  story: Story | null = null;
  private storyId: string | null = null;
  settings: StorySettings = { ...DEFAULT_STORY_SETTINGS };
  private _hasUnsavedChanges = false;
  private _headerActions: HeaderAction[] = [];

  get hasUnsavedChanges(): boolean {
    return this._hasUnsavedChanges;
  }
  set hasUnsavedChanges(value: boolean) {
    if (this._hasUnsavedChanges !== value) {
      this._hasUnsavedChanges = value;
      this.updateHeaderActions();
    }
  }
  private originalSettings!: StorySettings;
  selectedTab = 'general';
  tabItems: TabItem[] = [
    { value: 'general', icon: 'information-circle-outline', label: 'General' },
    { value: 'cover-image', icon: 'image-outline', label: 'Cover Image' },
    { value: 'ai-system', icon: 'chatbox-outline', label: 'AI System' },
    { value: 'beat-config', icon: 'settings-outline', label: 'Beat Config' },
    { value: 'favorites', icon: 'star-outline', label: 'AI Favorites' },
    { value: 'export-import', icon: 'cloud-download-outline', label: 'Export/Import' }
  ];

  narrativePerspectiveOptions: { value: NarrativePerspective; label: string }[] = [
    { value: 'first-person', label: 'First Person' },
    { value: 'third-person-limited', label: 'Third Person Limited' },
    { value: 'third-person-omniscient', label: 'Third Person Omniscient' },
    { value: 'second-person', label: 'Second Person' }
  ];

  tenseOptions: { value: StoryTense; label: string }[] = [
    { value: 'past', label: 'Past Tense' },
    { value: 'present', label: 'Present Tense' }
  ];

  combinedModels: ModelOption[] = [];
  loadingModels = false;
  modelLoadError: string | null = null;

  // Export/Import properties
  isExporting = false;
  isImporting = false;
  importPreview: StoryExportData | null = null;
  importError: string | null = null;
  private importFile: File | null = null;
  private isArchiveImport = false;

  // Beat Template section editing state
  activeBeatType: 'story' | 'scene' | 'envision' | 'sceneFromOutline' = 'story';
  beatTemplateSections: BeatTemplateSections = { ...DEFAULT_BEAT_TEMPLATE_SECTIONS };
  sceneBeatTemplateSections: SceneBeatTemplateSections = { ...DEFAULT_SCENE_BEAT_TEMPLATE_SECTIONS };
  envisionBeatTemplateSections: BeatTemplateSections = { ...DEFAULT_ENVISION_BEAT_TEMPLATE_SECTIONS };
  sceneFromOutlineTemplateSections: SceneFromOutlineTemplateSections = { ...DEFAULT_SCENE_FROM_OUTLINE_TEMPLATE_SECTIONS };

  // Template preview state
  showTemplatePreview = false;
  templatePreviewContent = '';

  get headerActions(): HeaderAction[] {
    return this._headerActions;
  }

  private updateHeaderActions(): void {
    this._headerActions = [
      {
        icon: this._hasUnsavedChanges ? 'warning-outline' : 'checkmark-circle-outline',
        chipContent: this._hasUnsavedChanges ? 'Not saved' : 'Saved',
        chipColor: this._hasUnsavedChanges ? 'warning' : 'success',
        action: () => { /* Status indicator - no action */ },
        showOnMobile: true,
        showOnDesktop: true
      }
    ];
  }

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly storyService = inject(StoryService);
  private readonly modelService = inject(ModelService);
  private readonly exportImportService = inject(StoryExportImportService);
  private readonly dialogService = inject(DialogService);

  constructor() {
    addIcons({
      arrowBack, saveOutline, refreshOutline, checkmarkCircleOutline,
      warningOutline, informationCircleOutline, codeSlashOutline,
      settingsOutline, chatboxOutline, documentTextOutline,
      imageOutline, starOutline, createOutline, syncOutline,
      chatbubblesOutline, cloudDownloadOutline, downloadOutline, cloudUploadOutline,
      documentOutline, alertCircleOutline, chevronForward, chevronDown, listOutline,
      eyeOutline, gitBranchOutline
    });
  }

  async ngOnInit(): Promise<void> {
    // Initialize header actions with default state
    this.updateHeaderActions();

    this.storyId = this.route.snapshot.paramMap.get('id');
    if (this.storyId) {
      this.story = await this.storyService.getStory(this.storyId);
      if (this.story) {
        // Load existing settings or use defaults
        this.settings = this.story.settings
          ? { ...this.story.settings }
          : { ...DEFAULT_STORY_SETTINGS };

        this.ensureFavoriteStructure();
        this.initializeSectionTemplates();

        this.originalSettings = { ...this.settings };
      } else {
        this.router.navigate(['/']);
      }
    }

    this.loadCombinedModels();
  }

  /**
   * Initialize section templates from settings or defaults
   */
  private initializeSectionTemplates(): void {
    // Initialize beat template sections - use smart merge that prefers non-empty values
    if (this.settings.beatTemplateSections) {
      this.beatTemplateSections = mergeBeatSections(
        DEFAULT_BEAT_TEMPLATE_SECTIONS,
        this.settings.beatTemplateSections
      );
    } else {
      // TODO: Remove migration code after 31.10.2026 - all users should have migrated by then
      // Migrate from legacy template if possible
      const migrated = migrateSettingsToSections(this.settings);
      this.beatTemplateSections = migrated.beatTemplateSections || { ...DEFAULT_BEAT_TEMPLATE_SECTIONS };
    }

    // Initialize scene beat template sections - use smart merge that prefers non-empty values
    if (this.settings.sceneBeatTemplateSections) {
      this.sceneBeatTemplateSections = mergeSceneBeatSections(
        DEFAULT_SCENE_BEAT_TEMPLATE_SECTIONS,
        this.settings.sceneBeatTemplateSections
      );
    } else {
      this.sceneBeatTemplateSections = { ...DEFAULT_SCENE_BEAT_TEMPLATE_SECTIONS };
    }

    // Initialize envision beat template sections - use smart merge that prefers non-empty values
    if (this.settings.envisionBeatTemplateSections) {
      this.envisionBeatTemplateSections = mergeEnvisionBeatSections(
        this.settings.envisionBeatTemplateSections
      );
    } else {
      this.envisionBeatTemplateSections = { ...DEFAULT_ENVISION_BEAT_TEMPLATE_SECTIONS };
    }

    // Initialize scene from outline template sections - use smart merge that prefers non-empty values
    if (this.settings.sceneFromOutlineTemplateSections) {
      this.sceneFromOutlineTemplateSections = mergeSceneFromOutlineSections(
        DEFAULT_SCENE_FROM_OUTLINE_TEMPLATE_SECTIONS,
        this.settings.sceneFromOutlineTemplateSections
      );
    } else {
      this.sceneFromOutlineTemplateSections = { ...DEFAULT_SCENE_FROM_OUTLINE_TEMPLATE_SECTIONS };
    }

    // Always ensure sections mode is set
    this.settings.templateMode = 'sections';
  }

  onSettingsChange(): void {
    this.hasUnsavedChanges =
      JSON.stringify(this.settings) !== JSON.stringify(this.originalSettings);
  }

  async saveSettings(): Promise<void> {
    if (!this.story) return;

    // Update story with new settings
    this.story.settings = { ...this.settings };
    await this.storyService.updateStory(this.story);
    
    this.originalSettings = { ...this.settings };
    this.hasUnsavedChanges = false;
  }

  async resetToDefaults(): Promise<void> {
    const confirmed = await this.dialogService.confirmDestructive({
      header: 'Reset Settings',
      message: 'Do you really want to reset the settings to default values?',
      confirmText: 'Reset'
    });
    if (confirmed) {
      this.settings = { ...DEFAULT_STORY_SETTINGS };
      this.ensureFavoriteStructure();
      this.onSettingsChange();
    }
  }

  async refreshTemplates(): Promise<void> {
    const language = (this.settings.language as StoryLanguage) || 'en';

    try {
      const [systemMessage, beatTemplate, defaultBeatRules] = await Promise.all([
        getSystemMessage(language),
        getBeatGenerationTemplate(language),
        getDefaultBeatRules(language)
      ]);

      this.settings.systemMessage = systemMessage;
      this.settings.beatGenerationTemplate = beatTemplate;
      this.settings.beatRules = defaultBeatRules;

      // Also reset section templates to defaults when refreshing
      this.beatTemplateSections = { ...DEFAULT_BEAT_TEMPLATE_SECTIONS };
      this.sceneBeatTemplateSections = { ...DEFAULT_SCENE_BEAT_TEMPLATE_SECTIONS };
      this.envisionBeatTemplateSections = { ...DEFAULT_ENVISION_BEAT_TEMPLATE_SECTIONS };
      this.sceneFromOutlineTemplateSections = { ...DEFAULT_SCENE_FROM_OUTLINE_TEMPLATE_SECTIONS };
      this.syncSectionsToSettings();

      // Ensure language is set
      if (!this.settings.language) {
        this.settings.language = 'en';
      }

      this.onSettingsChange();
    } catch (error) {
      console.error('Error loading language-specific templates:', error);
    }
  }

  /**
   * Handle template type tab change (story, scene, envision, or sceneFromOutline)
   */
  onBeatTypeChange(beatType: 'story' | 'scene' | 'envision' | 'sceneFromOutline'): void {
    this.activeBeatType = beatType;
  }

  /**
   * Get human-readable name for the active template type
   */
  getTemplateTypeName(): string {
    const names: Record<string, string> = {
      'story': 'Story Beat',
      'scene': 'Scene Beat',
      'envision': 'Envision Beat',
      'sceneFromOutline': 'Scene from Outline'
    };
    return names[this.activeBeatType] || 'Story Beat';
  }

  /**
   * Handle story beat sections change from child component
   */
  onBeatSectionsChange(sections: BeatTemplateSections): void {
    this.beatTemplateSections = sections;
    this.syncSectionsToSettings();
    this.onSettingsChange();
  }

  /**
   * Handle scene beat sections change from child component
   */
  onSceneBeatSectionsChange(sections: SceneBeatTemplateSections): void {
    this.sceneBeatTemplateSections = sections;
    this.syncSectionsToSettings();
    this.onSettingsChange();
  }

  /**
   * Handle envision beat sections change from child component
   */
  onEnvisionBeatSectionsChange(sections: BeatTemplateSections): void {
    this.envisionBeatTemplateSections = sections;
    this.syncSectionsToSettings();
    this.onSettingsChange();
  }

  /**
   * Handle scene from outline sections change from child component
   */
  onSceneFromOutlineSectionsChange(sections: SceneFromOutlineTemplateSections): void {
    this.sceneFromOutlineTemplateSections = sections;
    this.syncSectionsToSettings();
    this.onSettingsChange();
  }

  /**
   * Sync section templates to settings object
   */
  private syncSectionsToSettings(): void {
    this.settings.beatTemplateSections = { ...this.beatTemplateSections };
    this.settings.sceneBeatTemplateSections = { ...this.sceneBeatTemplateSections };
    this.settings.envisionBeatTemplateSections = { ...this.envisionBeatTemplateSections };
    this.settings.sceneFromOutlineTemplateSections = { ...this.sceneFromOutlineTemplateSections };
    this.settings.templateMode = 'sections';
  }

  onFavoriteModelsChange(list: keyof StorySettings['favoriteModelLists'], favoriteIds: string[]): void {
    // Structure is already ensured in ngOnInit() - no need to call ensureFavoriteStructure() here
    const nextFavorites = [...favoriteIds];

    const nextFavoriteLists = {
      ...this.settings.favoriteModelLists,
      [list]: nextFavorites
    };

    const nextSettings: StorySettings = {
      ...this.settings,
      favoriteModelLists: nextFavoriteLists,
      favoriteModels: list === 'beatInput' ? [...nextFavorites] : [...(this.settings.favoriteModels ?? [])]
    };

    this.settings = nextSettings;
    this.onSettingsChange();
  }

  private ensureFavoriteStructure(): void {
    if (!Array.isArray(this.settings.favoriteModels)) {
      this.settings.favoriteModels = [];
    }
    if (!this.settings.favoriteModelLists) {
      this.settings.favoriteModelLists = {
        beatInput: [...this.settings.favoriteModels],
        sceneSummary: [],
        rewrite: [],
        characterChat: []
      };
    }

    // Validate individual lists - only initialize if missing or invalid
    if (!Array.isArray(this.settings.favoriteModelLists.beatInput)) {
      this.settings.favoriteModelLists.beatInput = [...this.settings.favoriteModels];
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

    // Ensure beatRules is initialized as string
    if (this.settings.beatRules === undefined || this.settings.beatRules === null) {
      this.settings.beatRules = '';
    }
  }

  private loadCombinedModels(): void {
    this.loadingModels = true;
    this.modelLoadError = null;

    this.modelService.getCombinedModels().subscribe({
      next: models => {
        this.combinedModels = models;
        this.loadingModels = false;
      },
      error: error => {
        console.error('Failed to load models for story settings:', error);
        this.modelLoadError = 'Error loading models. Check API configuration.';
        this.loadingModels = false;
      }
    });
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
        this.navigateBack();
      }
    } else {
      this.navigateBack();
    }
  }

  private navigateBack(): void {
    // Use storyId from route as fallback to ensure correct navigation
    const targetId = this.story?.id || this.storyId;
    if (targetId) {
      this.router.navigate(['/stories/editor', targetId]);
    } else {
      this.router.navigate(['/']);
    }
  }

  // Cover Image methods
  getCoverImageDataUrl(): string | null {
    if (!this.story?.coverImage) return null;
    return `data:image/png;base64,${this.story.coverImage}`;
  }

  getCoverImageFileName(): string | null {
    if (!this.story?.coverImage) return null;
    return 'cover-image.png'; // Default filename since we don't store original filename
  }

  getCoverImageFileSize(): number {
    if (!this.story?.coverImage) return 0;
    // Rough estimation: base64 is ~33% larger than binary
    return Math.floor((this.story.coverImage.length * 3) / 4);
  }

  onCoverImageSelected(result: ImageUploadResult): void {
    if (!this.story) return;
    
    this.story.coverImage = result.base64Data;
    this.hasUnsavedChanges = true;
  }

  onCoverImageRemoved(): void {
    if (!this.story) return;

    this.story.coverImage = undefined;
    this.hasUnsavedChanges = true;
  }

  // Export/Import methods
  async exportStory(): Promise<void> {
    if (!this.story) return;

    this.isExporting = true;
    try {
      const blob = await this.exportImportService.exportStory(this.story.id);
      this.exportImportService.downloadExport(blob, this.story.title || 'story');
    } catch (error) {
      console.error('Export failed:', error);
      this.dialogService.showError({ header: 'Export Failed', message: 'Export failed. Please try again.' });
    } finally {
      this.isExporting = false;
    }
  }

  async onImportFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (!input.files?.length) return;

    const file = input.files[0];
    this.importError = null;
    this.importPreview = null;
    this.importFile = null;
    this.isArchiveImport = false;

    // Check file size
    const maxSize = this.exportImportService.getMaxImportFileSize();
    if (file.size > maxSize) {
      this.importError = `File too large. Maximum size is ${Math.round(maxSize / (1024 * 1024))}MB.`;
      input.value = '';
      return;
    }

    try {
      // Check if this is an archive (.cwx) or legacy JSON file
      if (this.exportImportService.isArchiveFile(file)) {
        // Parse archive for preview
        this.importPreview = await this.exportImportService.parseArchiveForPreview(file);
        this.importFile = file;
        this.isArchiveImport = true;
      } else {
        // Legacy JSON import
        const jsonData = await file.text();

        // Validate the import data
        const validation = this.exportImportService.validateImportData(jsonData);
        if (!validation.valid) {
          this.importError = `Invalid file: ${validation.errors.join(', ')}`;
          return;
        }

        // Parse for preview
        this.importPreview = this.exportImportService.parseImportData(jsonData);
        this.importFile = file;
        this.isArchiveImport = false;
      }
    } catch (error) {
      console.error('Error reading import file:', error);
      this.importError = `Failed to read file: ${(error as Error).message}`;
    }

    // Reset the input so the same file can be selected again
    input.value = '';
  }

  async confirmImport(): Promise<void> {
    if (!this.importFile) return;

    this.isImporting = true;
    this.importError = null;

    try {
      let result;

      if (this.isArchiveImport) {
        // Import from archive
        result = await this.exportImportService.importStoryFromArchive(this.importFile);
      } else {
        // Legacy JSON import
        const jsonData = await this.importFile.text();
        result = await this.exportImportService.importStory(jsonData);
      }

      // Show success message
      const titleChanged = result.finalTitle !== this.importPreview?.story.title;
      let message = titleChanged
        ? `Story imported successfully as "${result.finalTitle}"!`
        : 'Story imported successfully!';

      // Add media import info if applicable
      if (this.isArchiveImport && this.importPreview?.metadata?.mediaStats) {
        const stats = this.importPreview.metadata.mediaStats;
        if (stats.imageCount > 0 || stats.videoCount > 0) {
          const parts: string[] = [];
          if (stats.imageCount > 0) parts.push(`${stats.imageCount} image${stats.imageCount !== 1 ? 's' : ''}`);
          if (stats.videoCount > 0) parts.push(`${stats.videoCount} video${stats.videoCount !== 1 ? 's' : ''}`);
          message += ` (${parts.join(', ')} included)`;
        }
      }

      this.dialogService.showSuccess({ header: 'Import Complete', message });

      // Clear the preview
      this.cancelImport();

      // Navigate to the imported story
      this.router.navigate(['/stories/editor', result.storyId]);
    } catch (error) {
      console.error('Import failed:', error);
      this.importError = `Import failed: ${(error as Error).message}`;
    } finally {
      this.isImporting = false;
    }
  }

  cancelImport(): void {
    this.importPreview = null;
    this.importFile = null;
    this.importError = null;
    this.isArchiveImport = false;
  }

  getImportChapterCount(): number {
    return this.importPreview?.story.chapters?.length || 0;
  }

  getImportSceneCount(): number {
    if (!this.importPreview?.story.chapters) return 0;
    return this.importPreview.story.chapters.reduce(
      (total, chapter) => total + (chapter.scenes?.length || 0),
      0
    );
  }

  getImportCodexEntryCount(): number {
    if (!this.importPreview?.codex?.categories) return 0;
    return this.importPreview.codex.categories.reduce(
      (total, category) => total + (category.entries?.length || 0),
      0
    );
  }

  getImportImageCount(): number {
    return this.importPreview?.metadata?.mediaStats?.imageCount || 0;
  }

  getImportVideoCount(): number {
    return this.importPreview?.metadata?.mediaStats?.videoCount || 0;
  }

  getImportMediaSizeFormatted(): string {
    const bytes = this.importPreview?.metadata?.mediaStats?.totalMediaSize || 0;
    if (bytes === 0) return '';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  getStorySceneCount(): number {
    if (!this.story?.chapters) return 0;
    return this.story.chapters.reduce(
      (total, chapter) => total + (chapter.scenes?.length || 0),
      0
    );
  }

  /**
   * Open template preview modal with sample data
   */
  openTemplatePreview(): void {
    this.templatePreviewContent = this.generateTemplatePreview();
    this.showTemplatePreview = true;
  }

  /**
   * Generate a preview of the full template with sample data
   */
  private generateTemplatePreview(): string {
    // Ensure we have valid sections - fallback to defaults if somehow empty
    const beatSections = this.beatTemplateSections?.objective?.trim()
      ? this.beatTemplateSections
      : { ...DEFAULT_BEAT_TEMPLATE_SECTIONS };

    const sceneSections = this.sceneBeatTemplateSections?.objective?.trim()
      ? this.sceneBeatTemplateSections
      : { ...DEFAULT_SCENE_BEAT_TEMPLATE_SECTIONS };

    const envisionSections = this.envisionBeatTemplateSections?.objective?.trim()
      ? this.envisionBeatTemplateSections
      : { ...DEFAULT_ENVISION_BEAT_TEMPLATE_SECTIONS };

    const sceneFromOutlineSections = this.sceneFromOutlineTemplateSections?.objective?.trim()
      ? this.sceneFromOutlineTemplateSections
      : { ...DEFAULT_SCENE_FROM_OUTLINE_TEMPLATE_SECTIONS };

    const sampleData = {
      storyTitle: 'The Dragon\'s Awakening',
      codexEntries: '**Elena** - A young mage seeking ancient knowledge. She wields fire magic and carries a staff of oak.\n\n**Thornwood Forest** - An ancient forest where magical creatures dwell. Known for its towering trees and mysterious mists.',
      storySoFar: '[Previous chapter content would appear here - typically several paragraphs summarizing the story so far, including key plot points and character developments...]',
      sceneFullText: '[Current scene text would appear here - the scene currently being written, providing immediate context for the beat generation...]',
      sceneOutline: 'Elena discovers the dragon\'s lair behind the waterfall. She must earn its trust by sharing her own fire magic, leading to a tense negotiation where both reveal their vulnerabilities. The scene ends with an uneasy alliance formed.',
      prompt: 'The hero discovers a hidden door behind the waterfall, revealing an entrance to the dragon\'s lair.',
      rules: this.settings.beatRules || '(No custom rules defined)',
      pointOfView: this.settings.narrativePerspective || 'third-person-limited',
      wordCount: '500',
      stagingNotes: 'Elena stands at the edge of the pool, her staff raised. The dragon is coiled on a ledge above, watching her with half-closed eyes. Water droplets glisten on her cloak.'
    };

    let template: string;
    if (this.activeBeatType === 'sceneFromOutline') {
      template = sceneFromOutlineSectionsToTemplate(
        sceneFromOutlineSections,
        this.settings.systemMessage
      );
    } else if (this.activeBeatType === 'scene') {
      template = sceneBeatSectionsToTemplate(
        sceneSections,
        this.settings.systemMessage,
        '[Text after beat would appear here - content that follows the beat position, used for bridging context...]'
      );
    } else if (this.activeBeatType === 'envision') {
      template = sectionsToTemplate(envisionSections, this.settings.systemMessage);
    } else {
      template = sectionsToTemplate(beatSections, this.settings.systemMessage);
    }

    // Build POV string in same format as scene-generation.service
    const povMap: Record<string, string> = {
      'first-person': 'First Person',
      'third-person-limited': 'Third Person Limited',
      'third-person-omniscient': 'Third Person Omniscient',
      'second-person': 'Second Person'
    };
    const povLabel = povMap[this.settings.narrativePerspective || 'third-person-limited'] || 'Third Person Limited';
    const pointOfViewTag = `<point_of_view>${povLabel} perspective</point_of_view>`;
    const tenseTag = `<tense>Write in ${this.settings.tense || 'past'} tense</tense>`;

    // Replace placeholders with sample data
    const result = template
      .replace('{storyTitle}', sampleData.storyTitle)
      .replace('{codexEntries}', sampleData.codexEntries)
      .replace('{storySoFar}', sampleData.storySoFar)
      .replace('{sceneFullText}', sampleData.sceneFullText)
      .replace('{sceneOutline}', sampleData.sceneOutline)
      .replace('{prompt}', sampleData.prompt)
      .replace('{rules}', sampleData.rules)
      .replace('{pointOfView}', pointOfViewTag)
      .replace('{wordCount}', sampleData.wordCount)
      .replace('{stagingNotes}', sampleData.stagingNotes)
      .replace('{tense}', tenseTag)
      .replace('{languageInstruction}', '')
      .replace('{customInstruction}', '');

    // Clean up excessive blank lines (more than 2 consecutive newlines -> 2)
    return result.replace(/\n{3,}/g, '\n\n').trim();
  }
}
