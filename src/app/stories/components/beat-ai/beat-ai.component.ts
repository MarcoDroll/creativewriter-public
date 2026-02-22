import { Component, Input, Output, EventEmitter, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, ViewEncapsulation, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import {
  IonIcon, PopoverController, ModalController, AlertController, ActionSheetController, IonModal, IonChip, IonLabel, IonSearchbar, IonCheckbox, IonItemDivider,
  IonButton, IonButtons, IonToolbar, IonTitle, IonHeader, IonContent, IonList, IonItem
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { logoGoogle, globeOutline, libraryOutline, hardwareChip, chatbubbleOutline, gitNetworkOutline, cloudUploadOutline, refreshOutline, trashOutline, analyticsOutline, colorWandOutline, addOutline, closeOutline, readerOutline, copyOutline, sparklesOutline, eyeOutline, chevronDown, chevronUp, chevronBackOutline, chevronForwardOutline, closeCircleOutline, starOutline, timeOutline, createOutline, stopOutline, informationCircleOutline, syncOutline, colorPaletteOutline } from 'ionicons/icons';
import { BeatAIModalService } from '../../../shared/services/beat-ai-modal.service';
import { BeatVersionHistoryModalComponent } from '../beat-version-history-modal/beat-version-history-modal.component';
import { TokenInfoPopoverComponent } from '../../../ui/components/token-info-popover.component';
import { TokenCounterService, SupportedModel } from '../../../shared/services/token-counter.service';
import { BeatAI, BeatAIPromptEvent } from '../../models/beat-ai.interface';
import { Subscription, take } from 'rxjs';
import { ModelOption } from '../../../core/models/model.interface';
import { ModelService } from '../../../core/services/model.service';
import { SettingsService } from '../../../core/services/settings.service';
import { BeatAIService } from '../../../shared/services/beat-ai.service';
import { PendingJobsService } from '../../../core/services/pending-jobs.service';
import { ProseMirrorEditorService, SimpleEditorConfig } from '../../../shared/services/prosemirror-editor.service';
import { EditorView } from 'prosemirror-view';
import { StoryService } from '../../services/story.service';
import { CodexService } from '../../services/codex.service';
import { Story, Scene, Chapter, StorySettings, DEFAULT_STORY_SETTINGS } from '../../models/story.interface';
import { ProviderIconComponent } from '../../../shared/components/provider-icon/provider-icon.component';
import { getProviderIcon as getIcon, getProviderTooltip as getTooltip } from '../../../core/provider-icons';
import { PremiumRewriteService } from '../../../shared/services/premium-rewrite.service';
import { DialogService } from '../../../core/services/dialog.service';
import { SceneAIGenerationService } from '../../../shared/services/scene-ai-generation.service';
import { BeatRewriteModalComponent } from '../beat-rewrite-modal/beat-rewrite-modal.component';

interface SceneContext {
  chapterId: string;
  sceneId: string;
  chapterTitle: string;
  sceneTitle: string;
  content: string;
  selected: boolean;
  isTruncated?: boolean; // Indicates if content is truncated at current beat position
}

@Component({
  selector: 'app-beat-ai',
  standalone: true,
  imports: [
    CommonModule, FormsModule, NgSelectModule, IonIcon, IonModal, IonChip, IonLabel,
    IonSearchbar, IonCheckbox, IonItemDivider, IonButton, IonButtons, IonToolbar,
    IonTitle, IonHeader, IonContent, IonList, IonItem, ProviderIconComponent
  ],
  templateUrl: './beat-ai.component.html',
  styleUrls: ['./beat-ai.component.scss'],
  encapsulation: ViewEncapsulation.None,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BeatAIComponent implements OnInit, OnDestroy, AfterViewInit {
  private modelService = inject(ModelService);
  private settingsService = inject(SettingsService);
  private beatAIService = inject(BeatAIService);
  private proseMirrorService = inject(ProseMirrorEditorService);
  private elementRef = inject(ElementRef);
  private popoverController = inject(PopoverController);
  private modalController = inject(ModalController);
  private alertController = inject(AlertController);
  private actionSheetController = inject(ActionSheetController);
  private tokenCounter = inject(TokenCounterService);
  private modalService = inject(BeatAIModalService);
  private cdr = inject(ChangeDetectorRef);
  private premiumRewriteService = inject(PremiumRewriteService);
  private dialogService = inject(DialogService);
  private sceneAIGenerationService = inject(SceneAIGenerationService);
  private codexService = inject(CodexService);
  private pendingJobsService = inject(PendingJobsService);

  // Use getter/setter for beatData to sync currentPrompt when it changes
  // This fixes the scene-switch bug where the NodeView directly sets beatData
  private _beatData!: BeatAI;

  @Input()
  set beatData(value: BeatAI) {
    const oldId = this._beatData?.id;
    const oldPrompt = this._beatData?.prompt;
    const oldStagingNotes = this._beatData?.stagingNotes;
    this._beatData = value;

    // Invalidate content cache when beat changes (different beat or content could have changed)
    if (value?.id !== oldId) {
      this._cachedHasContent = null;
    }

    // Sync currentPrompt when beatData changes (fixes scene-switch prompt bug)
    // This handles both initial set and updates from NodeView.update()
    if (value && value.prompt !== oldPrompt && value.prompt !== this.currentPrompt) {
      this.currentPrompt = value.prompt;
      // Update the simple editor content if it exists
      if (this.editorView) {
        this.proseMirrorService.setSimpleContent(this.editorView, this.currentPrompt);
      }
      this.cdr.markForCheck();
    }

    // Sync stagingNotes when beatData changes (e.g., version restoration)
    if (value && value.stagingNotes !== oldStagingNotes) {
      this.currentStagingNotes = value.stagingNotes || '';
      this.cdr.markForCheck();
    }
  }

  get beatData(): BeatAI {
    return this._beatData;
  }

  // Cached content check to avoid redundant document traversals (performance optimization)
  private _cachedHasContent: boolean | null = null;

  /**
   * Check if there is actual content after this beat in the editor.
   * This is the source of truth - works regardless of how content was added
   * (AI generation, version restore, paste, typing).
   *
   * Result is cached until invalidated by content-changing operations.
   */
  get hasContentAfterBeat(): boolean {
    if (!this._beatData?.id) return false;
    if (this._cachedHasContent !== null) return this._cachedHasContent;
    const text = this.proseMirrorService.getTextAfterBeat(this._beatData.id);
    this._cachedHasContent = !!text?.trim();
    return this._cachedHasContent;
  }

  /** Invalidate the cached content check - call when content might have changed */
  invalidateContentCache(): void {
    this._cachedHasContent = null;
  }
  @Input() storyId?: string;
  @Input() chapterId?: string;
  @Input() sceneId?: string;
  @Input() isSaving = false;
  @Output() promptSubmit = new EventEmitter<BeatAIPromptEvent>();
  currentTextColor = '#e0e0e0';
  @Output() contentUpdate = new EventEmitter<BeatAI>();
  @Output() delete = new EventEmitter<string>();
  @Output() beatFocus = new EventEmitter<void>();
  
  @ViewChild('promptInput') promptInput!: ElementRef<HTMLDivElement>;
  @ViewChild('favoriteButtonsContainer') favoriteButtonsContainer?: ElementRef<HTMLDivElement>;

  currentPrompt = '';
  canScrollLeft = false;
  canScrollRight = false;
  selectedWordCount: number | string = 400;
  customWordCount = 400;
  showCustomWordCount = false;
  selectedModel = '';
  availableModels: ModelOption[] = [];
  favoriteModels: ModelOption[] = [];
  private saveTimeout?: ReturnType<typeof setTimeout>;
  private scrollCheckTimeout?: ReturnType<typeof setTimeout>;
  beatTypeOptions = [
    { value: 'story', label: 'Story Beat', description: 'Continue the narrative forward' },
    { value: 'scene', label: 'Scene Beat', description: 'Expand this moment with depth and detail' },
    { value: 'envision', label: 'Envision Beat', description: 'Fill word count creatively from prompt direction' }
  ];
  wordCountOptions = [
    { value: 20, label: '~20 words' },
    { value: 50, label: '~50 words' },
    { value: 100, label: '~100 words' },
    { value: 200, label: '~200 words' },
    { value: 400, label: '~400 words' },
    { value: 600, label: '~600 words' },
    { value: 800, label: '~800 words' },
    { value: 1000, label: '~1,000 words' },
    { value: 1500, label: '~1,500 words' },
    { value: 2000, label: '~2,000 words' },
    { value: 3000, label: '~3,000 words' },
    { value: 5000, label: '~5,000 words' },
    { value: 8000, label: '~8,000 words' },
    { value: 10000, label: '~10,000 words' },
    { value: 12000, label: '~12,000 words' },
    { value: 'custom', label: 'Custom amount...' }
  ];

  // Context selection properties
  story: Story | null = null;
  selectedScenes: SceneContext[] = [];
  showSceneSelector = false;
  sceneSearchTerm = '';
  includeStoryOutline = true; // Default to including story outline

  // Staging notes properties
  currentStagingNotes = '';
  isStagingNotesExpanded = false;
  isGeneratingStagingNotes = false;

  private subscription = new Subscription();
  private modelSubscription: Subscription | null = null; // Track model subscription separately to prevent leaks
  private editorView: EditorView | null = null;
  private storyService = inject(StoryService);
  
  constructor() {
    // Register icons
    addIcons({ logoGoogle, globeOutline, libraryOutline, hardwareChip, chatbubbleOutline, gitNetworkOutline, cloudUploadOutline, refreshOutline, trashOutline, analyticsOutline, colorWandOutline, addOutline, closeOutline, readerOutline, copyOutline, sparklesOutline, eyeOutline, chevronDown, chevronUp, chevronBackOutline, chevronForwardOutline, closeCircleOutline, starOutline, timeOutline, createOutline, stopOutline, informationCircleOutline, syncOutline, colorPaletteOutline });
  }
  
  ngOnInit(): void {
    // Set initial text color from settings immediately
    const settings = this.settingsService.getSettings();
    this.currentTextColor = settings.appearance?.textColor || '#e0e0e0';
    
    this.currentPrompt = this.beatData.prompt;

    // Subscribe to modal events
    this.subscription.add(this.modalService.close$.subscribe(() => this.hidePromptPreview()));
    
    // Ensure beat type has a default value
    if (!this.beatData.beatType) {
      this.beatData.beatType = 'story';
    }
    
    // Load saved word count or use default
    if (this.beatData.wordCount) {
      // Check if it's a custom value
      const isPresetValue = this.wordCountOptions.some(option => 
        typeof option.value === 'number' && option.value === this.beatData.wordCount
      );
      
      if (isPresetValue) {
        this.selectedWordCount = this.beatData.wordCount;
      } else {
        // It's a custom value
        this.selectedWordCount = 'custom';
        this.customWordCount = this.beatData.wordCount;
        this.showCustomWordCount = true;
      }
    }
    
    // Load saved scene selection and story outline setting
    if (this.beatData.includeStoryOutline !== undefined) {
      this.includeStoryOutline = this.beatData.includeStoryOutline;
    }

    // Load saved staging notes
    if (this.beatData.stagingNotes) {
      this.currentStagingNotes = this.beatData.stagingNotes;
    }

    // Ensure collapsed state is defined (legacy beats might rely on isEditing)
    if (this.beatData.isCollapsed === undefined || this.beatData.isCollapsed === null) {
      this.beatData.isCollapsed = false;
    }

    // Load available models and set default
    this.loadAvailableModels();
    this.setDefaultModel();

    // Load story and setup default context
    this.loadStoryAndSetupContext();

    // Auto-focus prompt input if it's a new beat
    if (!this.beatData.prompt) {
      this.beatData.isCollapsed = false;
      // Wait for DOM to update with expanded state, then initialize editor
      setTimeout(() => {
        this.ensureEditorInitialized();
      }, 100);
    }
    
    // Subscribe to generation events for this beat
    this.subscription.add(
      this.beatAIService.generation$.subscribe(generationEvent => {
        if (generationEvent.beatId === this.beatData.id) {
          if (generationEvent.isComplete) {
            // Generation completed
            this.beatData.isGenerating = false;
            this.invalidateContentCache(); // Content has changed, refresh cached state
            this.contentUpdate.emit(this.beatData);
            // Only trigger change detection on completion - streaming text is handled
            // directly by ProseMirror, not Angular templates
            this.cdr.markForCheck();
          } else if (!this.beatData.isGenerating) {
            // Non-complete event received, ensure isGenerating is true
            // This handles resumed server-side generations after page refresh
            this.beatData.isGenerating = true;
            this.cdr.markForCheck();
          }
        }
      })
    );

    // Check if there's an active server-side generation for this beat (handles page refresh)
    this.pendingJobsService.getJobsForBeat(this.beatData.id).pipe(take(1)).subscribe(jobs => {
      const activeJob = jobs.find(j => j.status === 'pending' || j.status === 'processing');
      if (activeJob && !this.beatData.isGenerating) {
        console.log('[BeatAI] Detected active server job for beat on init:', this.beatData.id);
        this.beatData.isGenerating = true;
        this.cdr.markForCheck();
      }
    });
  }

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    // Clean up model subscription separately to prevent leaks
    if (this.modelSubscription) {
      this.modelSubscription.unsubscribe();
      this.modelSubscription = null;
    }
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    if (this.scrollCheckTimeout) {
      clearTimeout(this.scrollCheckTimeout);
    }
    if (this.editorView) {
      this.proseMirrorService.destroySimpleEditor(this.editorView);
      this.editorView = null;
    }
  }

  ngAfterViewInit(): void {
    // Initialize ProseMirror editor if expanded
    if (!this.beatData.isCollapsed && this.promptInput && !this.editorView) {
      this.initializeProseMirrorEditor();
    }

    // Apply text color to this specific component
    this.applyTextColorDirectly();

    // Check scroll state after view is ready
    setTimeout(() => this.checkFavoritesScroll(), 100);
  }

  private initializeProseMirrorEditor(): void {
    if (!this.promptInput || this.editorView) return;

    const config: SimpleEditorConfig = {
      placeholder: 'Describe the beat that the AI should generate...',
      onUpdate: (content: string) => {
        this.currentPrompt = content;
        this.cdr.markForCheck(); // Trigger change detection for OnPush strategy
        this.onPromptChange();
      },
      storyContext: {
        storyId: this.storyId,
        chapterId: this.chapterId,
        sceneId: this.sceneId
      }
    };

    this.editorView = this.proseMirrorService.createSimpleTextEditor(
      this.promptInput.nativeElement,
      config
    );

    // Set initial content if available
    if (this.currentPrompt) {
      // Use setSimpleContent to ensure codex highlighting is processed
      this.proseMirrorService.setSimpleContent(this.editorView, this.currentPrompt);
      // Ensure currentPrompt stays synchronized after setting content
      // (setSimpleContent doesn't trigger the onUpdate callback)
    }
    this.applyTextColorDirectly();
  }

  private ensureEditorInitialized(): void {
    if (this.beatData.isCollapsed) {
      return;
    }

    if (this.promptInput && !this.editorView) {
      this.initializeProseMirrorEditor();
    }

    if (this.editorView) {
      setTimeout(() => {
        this.focusPromptInput();
      }, 50);
    }
  }

  private insertTextDirectly(text: string): void {
    if (!this.editorView || !text) return;

    // Insert text at position 1 (after the paragraph start)
    const { state } = this.editorView;
    const tr = state.tr.insertText(text, 1);
    this.editorView.dispatch(tr);
  }
  
  async toggleCollapsed(event?: Event): Promise<void> {
    event?.stopPropagation();
    if (this.beatData.isCollapsed) {
      await this.expandPrompt();
    } else {
      this.collapsePrompt();
    }
    this.contentUpdate.emit(this.beatData);
    this.cdr.markForCheck();
  }

  private async expandPrompt(): Promise<void> {
    if (!this.beatData.isCollapsed) {
      this.ensureEditorInitialized();
      return;
    }

    this.beatData.isCollapsed = false;
    this.currentPrompt = this.beatData.prompt;
    this.beatFocus.emit();

    await this.restorePersistedSettings();

    if (this.editorView) {
      this.proseMirrorService.destroySimpleEditor(this.editorView);
      this.editorView = null;
    }

    setTimeout(() => {
      this.ensureEditorInitialized();
    }, 100);
  }

  private collapsePrompt(): void {
    if (this.beatData.isCollapsed) {
      return;
    }

    this.beatData.isCollapsed = true;
    if (this.editorView) {
      this.proseMirrorService.destroySimpleEditor(this.editorView);
      this.editorView = null;
    }
  }
  
  async generateContent(): Promise<void> {
    if (!this.currentPrompt.trim() || !this.selectedModel) return;

    this.beatData.prompt = this.currentPrompt.trim();
    this.beatData.isGenerating = true;
    this.beatData.updatedAt = new Date();
    this.beatData.wordCount = this.getActualWordCount();
    this.beatData.model = this.selectedModel;
    this.beatData.stagingNotes = this.currentStagingNotes.trim();

    // Mark this as a generate action (not rewrite)
    this.beatData.lastAction = 'generate';
    this.beatData.rewriteContext = undefined; // Clear any previous rewrite context

    // Persist the selected scenes and story outline setting
    this.beatData.selectedScenes = this.selectedScenes.map(scene => ({
      sceneId: scene.sceneId,
      chapterId: scene.chapterId
    }));
    this.beatData.includeStoryOutline = this.includeStoryOutline;

    // Build custom context from selected scenes
    const customContext = await this.buildCustomContext();
    const textAfterBeat = this.getTextAfterBeatIfSceneBeat();

    this.promptSubmit.emit({
      beatId: this.beatData.id,
      prompt: this.beatData.prompt,
      action: 'generate',
      wordCount: this.getActualWordCount(),
      model: this.selectedModel,
      storyId: this.storyId,
      chapterId: this.chapterId,
      sceneId: this.sceneId,
      beatType: this.beatData.beatType,
      customContext: customContext,
      textAfterBeat: textAfterBeat,
      stagingNotes: this.beatData.stagingNotes
    });

    this.contentUpdate.emit(this.beatData);
  }

  async regenerateContent(): Promise<void> {
    if (!this.beatData.prompt) {
      return;
    }

    this.beatData.isGenerating = true;
    this.beatData.wordCount = this.getActualWordCount();
    this.beatData.model = this.selectedModel;

    // Persist the selected scenes and story outline setting
    this.beatData.selectedScenes = this.selectedScenes.map(scene => ({
      sceneId: scene.sceneId,
      chapterId: scene.chapterId
    }));
    this.beatData.includeStoryOutline = this.includeStoryOutline;

    // Build custom context from selected scenes
    const customContext = await this.buildCustomContext();
    const textAfterBeat = this.getTextAfterBeatIfSceneBeat();

    // Determine the action and get existing text if needed
    let action: 'generate' | 'regenerate' | 'rewrite' | 'polish';
    let existingText: string | undefined;
    let rewriteInstruction: string | undefined;

    if (this.beatData.lastAction === 'rewrite' && this.beatData.rewriteContext) {
      // This was a rewrite - regenerate as a rewrite
      action = 'rewrite';
      // Try to get current text after beat, fallback to original stored text
      existingText = this.proseMirrorService.getTextAfterBeat(this.beatData.id)
                     || this.beatData.rewriteContext.originalText;
      // Pass the rewrite instruction separately
      rewriteInstruction = this.beatData.rewriteContext.instruction;
    } else if (this.beatData.lastAction === 'polish' && this.beatData.rewriteContext) {
      // This was a polish - regenerate as a polish
      action = 'polish';
      existingText = this.proseMirrorService.getTextAfterBeat(this.beatData.id)
                     || this.beatData.rewriteContext.originalText;
      rewriteInstruction = this.beatData.rewriteContext.instruction;
    } else {
      // Regular regeneration - use original prompt
      action = 'regenerate';
    }

    this.promptSubmit.emit({
      beatId: this.beatData.id,
      prompt: this.beatData.prompt,  // Always the original prompt
      rewriteInstruction: rewriteInstruction,  // Only set for rewrite actions
      action: action,
      wordCount: this.getActualWordCount(),
      model: this.selectedModel,
      storyId: this.storyId,
      chapterId: this.chapterId,
      sceneId: this.sceneId,
      beatType: this.beatData.beatType,
      customContext: customContext,
      existingText: existingText,
      textAfterBeat: textAfterBeat,
      stagingNotes: this.beatData.stagingNotes
    });

    this.contentUpdate.emit(this.beatData);
  }

  /**
   * Regenerate from beat prompt (clears rewrite context, returns to standard generation)
   */
  async regenerateFromPrompt(): Promise<void> {
    // Clear rewrite context - we're going back to standard generation
    this.beatData.lastAction = 'generate';
    this.beatData.rewriteContext = undefined;

    // Use existing regenerateContent logic
    await this.regenerateContent();
  }

  /**
   * Execute rewrite or polish — unified handler for both modes.
   * Rewrite uses scene/story context; polish skips the expensive DB fetch.
   */
  private async executeRewriteOrPolish(
    mode: 'rewrite' | 'polish',
    action: 'rewrite-current' | 'rewrite-original',
    instruction: string,
    currentText: string
  ): Promise<void> {
    const textToProcess = action === 'rewrite-original' && this.beatData.rewriteContext?.originalText
      ? this.beatData.rewriteContext.originalText
      : currentText;

    this.beatData.lastAction = mode;
    this.beatData.rewriteContext = {
      originalText: this.beatData.rewriteContext?.originalText || currentText,
      instruction: instruction
    };

    this.beatData.isGenerating = true;
    this.cdr.markForCheck();
    this.beatData.wordCount = this.getActualWordCount();
    this.beatData.model = this.selectedModel;

    // Rewrite uses scene/story context; polish skips the expensive DB fetch
    let customContext: Awaited<ReturnType<typeof this.buildCustomContext>> | undefined;
    if (mode === 'rewrite') {
      this.beatData.selectedScenes = this.selectedScenes.map(scene => ({
        sceneId: scene.sceneId,
        chapterId: scene.chapterId
      }));
      this.beatData.includeStoryOutline = this.includeStoryOutline;
      customContext = await this.buildCustomContext();
    }

    this.promptSubmit.emit({
      beatId: this.beatData.id,
      prompt: this.beatData.prompt,
      rewriteInstruction: instruction || undefined,
      action: mode,
      existingText: textToProcess,
      wordCount: this.getActualWordCount(),
      model: this.selectedModel,
      storyId: this.storyId,
      chapterId: this.chapterId,
      sceneId: this.sceneId,
      beatType: this.beatData.beatType,
      customContext: customContext,
      stagingNotes: this.beatData.stagingNotes
    });

    this.contentUpdate.emit(this.beatData);
  }

  // Staging notes methods
  toggleStagingNotes(): void {
    this.isStagingNotesExpanded = !this.isStagingNotesExpanded;
    this.cdr.markForCheck();
  }

  onStagingNotesChange(): void {
    // Keep empty string (don't convert to undefined) so updateNodeAttrs can distinguish
    // between "explicitly cleared" (empty string) and "not touched" (undefined)
    this.beatData.stagingNotes = this.currentStagingNotes.trim();
    this.beatData.updatedAt = new Date();
    this.contentUpdate.emit(this.beatData);
  }

  /**
   * Generate staging notes from the current scene's content using AI
   */
  async generateStagingNotes(): Promise<void> {
    if (this.isGeneratingStagingNotes || !this.sceneId || !this.storyId) return;

    this.isGeneratingStagingNotes = true;
    this.cdr.markForCheck();

    try {
      // Get story and scene from database
      const story = await this.storyService.getStory(this.storyId);
      if (!story) {
        this.isGeneratingStagingNotes = false;
        this.cdr.markForCheck();
        return;
      }

      const chapter = story.chapters.find(c => c.id === this.chapterId);
      const scene = chapter?.scenes.find(s => s.id === this.sceneId);

      if (!scene?.content) {
        const alert = await this.alertController.create({
          header: 'No Content',
          message: 'This scene has no content to generate staging notes from.',
          buttons: ['OK']
        });
        await alert.present();
        this.isGeneratingStagingNotes = false;
        this.cdr.markForCheck();
        return;
      }

      // Extract protagonist name from Codex
      let protagonistName: string | undefined;
      const codex = this.codexService.getCodex(this.storyId);
      if (codex) {
        for (const category of codex.categories) {
          const protagonist = category.entries.find(e => e.metadata?.['storyRole'] === 'Protagonist');
          if (protagonist?.title?.trim()) {
            protagonistName = protagonist.title;
            break;
          }
        }
      }

      const result = await this.sceneAIGenerationService.generateStagingNotes({
        storyId: this.storyId,
        sceneId: this.sceneId,
        sceneContent: scene.content,
        storyLanguage: story.settings?.language || 'en',
        beatId: this.beatData.id, // Only use content BEFORE this beat
        protagonistName
      });

      if (result.success && result.text) {
        this.currentStagingNotes = result.text;
        this.beatData.stagingNotes = result.text;
        this.isStagingNotesExpanded = true;
        this.beatData.updatedAt = new Date();
        this.contentUpdate.emit(this.beatData);
      } else if (result.error) {
        const alert = await this.alertController.create({
          header: 'Generation Failed',
          message: result.error,
          buttons: ['OK']
        });
        await alert.present();
      }
    } catch (error) {
      console.error('Error generating staging notes:', error);
      const alert = await this.alertController.create({
        header: 'Error',
        message: 'An unexpected error occurred while generating staging notes.',
        buttons: ['OK']
      });
      await alert.present();
    } finally {
      this.isGeneratingStagingNotes = false;
      this.cdr.markForCheck();
    }
  }

  /**
   * Cancel the ongoing staging notes generation
   */
  cancelStagingNotesGeneration(): void {
    if (!this.isGeneratingStagingNotes || !this.sceneId) return;

    this.sceneAIGenerationService.cancelGeneration(this.sceneId);
    this.isGeneratingStagingNotes = false;
    this.cdr.markForCheck();
  }

  /**
   * Rewrite or polish the generated content
   * Opens ActionSheet with rewrite and polish options
   */
  async rewriteContent(): Promise<void> {
    // Premium gate check
    const hasAccess = await this.premiumRewriteService.checkAndGateAccess();
    if (!hasAccess) {
      return;
    }

    // First, get the text after this beat
    const existingText = this.proseMirrorService.getTextAfterBeat(this.beatData.id);

    if (!existingText || !existingText.trim()) {
      const alert = await this.alertController.create({
        header: 'No Content',
        message: 'There is no generated text after this beat to rewrite.',
        buttons: ['OK']
      });
      await alert.present();
      return;
    }

    const actionSheet = await this.actionSheetController.create({
      header: 'Rewrite Options',
      buttons: [
        {
          text: 'Rewrite with custom prompt',
          icon: 'create-outline',
          handler: () => { this.openRewriteModal(existingText, 'rewrite'); }
        },
        {
          text: 'Polish expression & wording',
          icon: 'color-palette-outline',
          handler: () => { this.openRewriteModal(existingText, 'polish'); }
        },
        { text: 'Cancel', role: 'cancel' }
      ]
    });
    await actionSheet.present();
  }

  /**
   * Open rewrite/polish modal with the specified mode
   */
  private async openRewriteModal(existingText: string, mode: 'rewrite' | 'polish'): Promise<void> {
    const modal = await this.modalController.create({
      component: BeatRewriteModalComponent,
      componentProps: {
        beatId: this.beatData.id,
        currentInstruction: this.beatData.rewriteContext?.instruction || '',
        hasOriginalText: !!this.beatData.rewriteContext?.originalText,
        mode: mode
      },
      cssClass: 'beat-rewrite-modal'
    });
    await modal.present();
    const { data } = await modal.onDidDismiss();
    if (data?.action) {
      if (mode === 'polish') {
        await this.executeRewriteOrPolish('polish', data.action, data.instruction || '', existingText);
      } else if (data.instruction) {
        await this.executeRewriteOrPolish('rewrite', data.action, data.instruction, existingText);
      }
    }
  }

  /**
   * Open version history modal
   */
  async openVersionHistory(): Promise<void> {
    if (!this.storyId) {
      console.warn('[BeatAIComponent] Cannot open version history without storyId');
      return;
    }

    const modal = await this.modalController.create({
      component: BeatVersionHistoryModalComponent,
      componentProps: {
        beatId: this.beatData.id,
        currentPrompt: this.beatData.prompt,
        storyId: this.storyId
      },
      cssClass: 'beat-history-modal'
    });

    await modal.present();

    // Handle modal dismissal
    const { data } = await modal.onDidDismiss();
    if (data?.versionChanged || data?.historyDeleted) {
      // Update the prompt if a version was restored (use !== undefined to handle empty string prompts)
      if (data?.versionChanged && data?.restoredPrompt !== undefined) {
        this.currentPrompt = data.restoredPrompt;
        this.beatData.prompt = data.restoredPrompt;
        this.invalidateContentCache(); // Version restore changes content after beat
      }

      // Update hasHistory flag if history was deleted
      if (data?.historyDeleted) {
        this.beatData.hasHistory = false;
      }

      // Emit content update once for any changes
      this.contentUpdate.emit(this.beatData);

      // Trigger change detection to update UI
      this.cdr.detectChanges();
    }
  }

  async deleteContentAfterBeat(): Promise<void> {
    const confirmed = await this.dialogService.confirmDestructive({
      header: 'Delete Generated Content',
      message: 'Delete the generated content for this beat? Content you wrote after the generation will be preserved. This cannot be undone.',
      confirmText: 'Delete'
    });
    if (confirmed) {
      this.promptSubmit.emit({
        beatId: this.beatData.id,
        action: 'deleteAfter',
        storyId: this.storyId,
        chapterId: this.chapterId,
        sceneId: this.sceneId,
        beatType: this.beatData.beatType
      });
    }
  }

  async removeBeat(event?: Event): Promise<void> {
    event?.stopPropagation();
    const confirmed = await this.dialogService.confirm({
      header: 'Remove Beat',
      message: 'Remove this beat input? This will only remove the beat control, not the generated content.',
      confirmText: 'Remove',
      cancelText: 'Cancel'
    });
    if (confirmed) {
      this.delete.emit(this.beatData.id);
    }
  }
  
  onPromptKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      this.generateContent();
    }
  }
  
  onPromptChange(): void {
    // Debounce the save to prevent re-renders while typing
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }

    this.saveTimeout = setTimeout(() => {
      // Update beatData with the current prompt to ensure it's persisted
      if (this.beatData.prompt !== this.currentPrompt) {
        this.beatData.prompt = this.currentPrompt;
        this.beatData.updatedAt = new Date();
        this.contentUpdate.emit(this.beatData);
      }
    }, 500); // Wait 500ms after user stops typing
  }

  onWordCountChange(): void {
    if (this.selectedWordCount === 'custom') {
      this.showCustomWordCount = true;
      // Focus the custom input after Angular updates the view
      setTimeout(() => {
        const customInput = document.querySelector('.custom-word-count') as HTMLInputElement;
        if (customInput) {
          customInput.focus();
          customInput.select();
        }
      }, 0);
    } else {
      this.showCustomWordCount = false;
      this.customWordCount = this.selectedWordCount as number;
    }
  }

  validateCustomWordCount(): void {
    if (this.customWordCount < 10) {
      this.customWordCount = 10;
    } else if (this.customWordCount > 50000) {
      this.customWordCount = 50000;
    }
  }

  onBeatTypeChange(): void {
    // Beat type is bound directly to beatData.beatType via ngModel
    this.beatData.updatedAt = new Date();
    this.contentUpdate.emit(this.beatData);
  }

  private getActualWordCount(): number {
    if (this.selectedWordCount === 'custom') {
      return this.customWordCount;
    }
    return this.selectedWordCount as number;
  }

  private loadAvailableModels(): void {
    // Subscribe to settings changes to reload models when API switches
    this.subscription.add(
      this.settingsService.settings$.subscribe(settings => {
        this.reloadModels();
        // Update text color
        this.currentTextColor = settings.appearance?.textColor || '#e0e0e0';
        
        // Apply the new color to this component
        this.applyTextColorDirectly();
        
        // Update favorite models
        this.updateFavoriteModels();
        this.cdr.markForCheck();
      })
    );
    
    // Initial load
    this.reloadModels();
  }
  
  private reloadModels(): void {
    // Unsubscribe from previous model subscription to prevent memory leak
    if (this.modelSubscription) {
      this.modelSubscription.unsubscribe();
    }

    // Load combined models from all active APIs
    this.modelSubscription = this.modelService.getCombinedModels().subscribe(models => {
      this.availableModels = models;
      if (models.length > 0 && !this.selectedModel) {
        this.setDefaultModel();
      }
      // Update favorite models after loading
      this.updateFavoriteModels();
      this.cdr.markForCheck();
    });
  }
  
  private setDefaultModel(): void {
    const settings = this.settingsService.getSettings();
    
    // First priority: use the model stored with this beat
    if (this.beatData.model && this.availableModels.some(m => m.id === this.beatData.model)) {
      this.selectedModel = this.beatData.model;
    }
    // Second priority: use the global selected model if available
    else if (settings.selectedModel) {
      this.selectedModel = settings.selectedModel;
    } 
    // Fallback: use first available model
    else if (this.availableModels.length > 0) {
      this.selectedModel = this.availableModels[0].id;
    }
  }

  private async restorePersistedSettings(): Promise<void> {
    // Restore the persisted model
    this.setDefaultModel();
    
    // Restore the persisted word count
    if (this.beatData.wordCount) {
      // Check if it's a custom value
      const isPresetValue = this.wordCountOptions.some(option => 
        typeof option.value === 'number' && option.value === this.beatData.wordCount
      );
      
      if (isPresetValue) {
        this.selectedWordCount = this.beatData.wordCount;
        this.showCustomWordCount = false;
      } else {
        // It's a custom value
        this.selectedWordCount = 'custom';
        this.customWordCount = this.beatData.wordCount;
        this.showCustomWordCount = true;
      }
    }

    // Restore the persisted story outline setting
    if (this.beatData.includeStoryOutline !== undefined) {
      this.includeStoryOutline = this.beatData.includeStoryOutline;
    }
    
    // Restore the persisted selected scenes
    if (this.beatData.selectedScenes && this.beatData.selectedScenes.length > 0 && this.story) {
      // Clear current selection
      this.selectedScenes = [];
      
      // Restore each persisted scene
      for (const persistedScene of this.beatData.selectedScenes) {
        const chapter = this.story.chapters.find(c => c.id === persistedScene.chapterId);
        const scene = chapter?.scenes.find(s => s.id === persistedScene.sceneId);

        if (chapter && scene) {
          const isCurrentScene = scene.id === this.sceneId;

          this.selectedScenes.push({
            chapterId: chapter.id,
            sceneId: scene.id,
            chapterTitle: `C${chapter.chapterNumber || chapter.order}:${chapter.title}`,
            sceneTitle: `S${scene.sceneNumber || scene.order}:${scene.title}`,
            content: isCurrentScene
              ? this.extractFullTextFromScene(scene, this.beatData.id) // Truncate current scene at beat
              : this.extractFullTextFromScene(scene), // Other scenes: full text
            selected: true,
            isTruncated: isCurrentScene
          });
        }
      }
    }
  }

  private focusPromptInput(): void {
    if (this.editorView) {
      this.editorView.focus();
    }
  }

  async showPromptPreview(): Promise<void> {
    if (!this.currentPrompt.trim()) {
      return;
    }

    // Build custom context from selected scenes
    const customContext = await this.buildCustomContext();
    const textAfterBeat = this.getTextAfterBeatIfSceneBeat();

    // Use the context provided via Input properties
    // These will be set by the BeatAINodeView from the story editor context
    this.subscription.add(
      this.beatAIService.previewPrompt(this.currentPrompt, this.beatData.id, {
        storyId: this.storyId,
        chapterId: this.chapterId,
        sceneId: this.sceneId,
        wordCount: this.getActualWordCount(),
        beatType: this.beatData.beatType,
        customContext: customContext,
        textAfterBeat: textAfterBeat,
        stagingNotes: this.beatData.stagingNotes
      }).subscribe(content => {
        this.modalService.show(content);
      })
    );
  }

  hidePromptPreview(): void {
    this.modalService.close();
  }

  async showTokenInfo(): Promise<void> {
    if (!this.currentPrompt.trim() || !this.selectedModel) {
      return;
    }

    // Build custom context from selected scenes
    const customContext = await this.buildCustomContext();
    const textAfterBeat = this.getTextAfterBeatIfSceneBeat();

    // Get the full prompt that would be sent to the model
    const fullPrompt = await this.beatAIService.previewPrompt(this.currentPrompt, this.beatData.id, {
      storyId: this.storyId,
      chapterId: this.chapterId,
      sceneId: this.sceneId,
      wordCount: this.getActualWordCount(),
      beatType: this.beatData.beatType,
      customContext: customContext,
      textAfterBeat: textAfterBeat,
      stagingNotes: this.beatData.stagingNotes
    }).toPromise();

    // Find the selected model in our available models to get its metadata
    const selectedModelOption = this.availableModels.find(model => model.id === this.selectedModel);

    // Always use the actual model info from the selected model option
    // Extract provider from the model ID (format: provider:model-id)
    const providerMatch = selectedModelOption?.id.match(/^([^:]+):/);
    const customModelProvider = providerMatch ? this.formatProviderName(providerMatch[1]) :
      (selectedModelOption?.provider ? this.formatProviderName(selectedModelOption.provider) : undefined);

    const popover = await this.popoverController.create({
      component: TokenInfoPopoverComponent,
      componentProps: {
        prompt: fullPrompt || this.currentPrompt,
        model: 'custom' as SupportedModel, // Always use 'custom' to leverage actual model data
        showComparison: false, // Disable comparison since we're using actual model data
        customModelName: selectedModelOption?.label,
        customModelProvider,
        customContextLength: selectedModelOption?.contextLength
      },
      cssClass: 'token-info-popover',
      translucent: true,
      mode: 'ios',
      showBackdrop: true,
      backdropDismiss: true
    });

    await popover.present();
  }

  private formatProviderName(provider: string): string {
    const providerNames: Record<string, string> = {
      'openrouter': 'OpenRouter',
      'ollama': 'Ollama (Local)',
      'claude': 'Anthropic',
      'gemini': 'Google',
      'replicate': 'Replicate',
      'openaicompatible': 'OpenAI-Compatible'
    };
    return providerNames[provider.toLowerCase()] || provider;
  }

  stopGeneration(): void {
    this.beatAIService.stopGeneration(this.beatData.id);
    this.beatData.isGenerating = false;
    this.invalidateContentCache(); // Content may have changed during partial generation
    this.contentUpdate.emit(this.beatData);
  }

  onModelChange(): void {
    // Save the selected model to the beat data
    if (this.selectedModel) {
      this.beatData.model = this.selectedModel;
      this.beatData.updatedAt = new Date();
      this.contentUpdate.emit(this.beatData);
    }
  }

  getProviderIcon(provider: string): string {
    return getIcon(provider);
  }

  getProviderTooltip(provider: string): string {
    return getTooltip(provider);
  }

  getModelDisplayName(modelId: string): string {
    if (!modelId) return '';
    
    // Find the model in available models to get its display name
    const model = this.availableModels.find(m => m.id === modelId);
    if (model) {
      return model.label;
    }
    
    // If not found in available models, try to extract a readable name from the ID
    // Handle format like "gemini:gemini-1.5-pro" or "openrouter:anthropic/claude-3-haiku"
    if (modelId.includes(':')) {
      const parts = modelId.split(':');
      const modelName = parts[1] || modelId;
      return modelName.split('/').pop() || modelName; // Handle provider/model format
    }
    
    return modelId;
  }

  private applyTextColorDirectly(): void {
    // The story editor's MutationObserver will handle this automatically,
    // but we still apply it directly for immediate feedback
    setTimeout(() => {
      const hostElement = this.elementRef.nativeElement;
      
      if (hostElement) {
        const container = hostElement.querySelector?.('.beat-ai-container') || hostElement;
        if (container) {
          (container as HTMLElement).style.setProperty('--beat-ai-text-color', this.currentTextColor);
        }
      }
    }, 50);
  }
  
  private updateFavoriteModels(): void {
    const favoriteIds = this.resolveFavoriteIds();

    this.favoriteModels = favoriteIds
      .map(id => this.availableModels.find(model => model.id === id))
      .filter((model): model is ModelOption => !!model);

    // Cancel any pending scroll check to prevent multiple executions
    if (this.scrollCheckTimeout) {
      clearTimeout(this.scrollCheckTimeout);
    }
    // Recheck scroll state after favorite models are updated
    this.scrollCheckTimeout = setTimeout(() => this.checkFavoritesScroll(), 50);
  }
  
  selectFavoriteModel(model: ModelOption): void {
    this.selectedModel = model.id;
    this.onModelChange();
  }

  scrollFavorites(direction: 'left' | 'right'): void {
    const container = this.favoriteButtonsContainer?.nativeElement;
    if (!container) return;

    const scrollAmount = 150;
    const targetScroll = direction === 'left'
      ? container.scrollLeft - scrollAmount
      : container.scrollLeft + scrollAmount;

    container.scrollTo({
      left: targetScroll,
      behavior: 'smooth'
    });
  }

  onFavoritesScroll(): void {
    this.checkFavoritesScroll();
  }

  checkFavoritesScroll(): void {
    const container = this.favoriteButtonsContainer?.nativeElement;
    if (!container) {
      this.canScrollLeft = false;
      this.canScrollRight = false;
      return;
    }

    this.canScrollLeft = container.scrollLeft > 0;
    this.canScrollRight = container.scrollLeft < (container.scrollWidth - container.clientWidth - 1);
    this.cdr.markForCheck();
  }

  async toggleFavorite(event: Event, model: ModelOption): Promise<void> {
    event.stopPropagation();
    event.preventDefault();
    
    const favoriteIds = this.resolveFavoriteIds();

    const index = favoriteIds.indexOf(model.id);
    if (index > -1) {
      // Remove from favorites
      favoriteIds.splice(index, 1);
    } else {
      // Add to favorites (max 6 favorites)
      if (favoriteIds.length < 6) {
        favoriteIds.push(model.id);
      } else {
        // Replace the oldest favorite
        favoriteIds.shift();
        favoriteIds.push(model.id);
      }
    }
    
    // Save updated favorites
    if (this.story) {
      const storySettings = this.ensureStoryFavoriteStructure();
      if (storySettings) {
        storySettings.favoriteModelLists.beatInput = [...favoriteIds];
        storySettings.favoriteModels = [...favoriteIds];
        try {
          await this.storyService.updateStory(this.story);
        } catch (error) {
          console.error('Failed to persist story favorites:', error);
        }
      }
    } else {
      const globalSettings = this.settingsService.getSettings();
      this.settingsService.updateSettings({
        favoriteModels: favoriteIds,
        favoriteModelLists: {
          ...globalSettings.favoriteModelLists,
          beatInput: favoriteIds
        }
      });
    }

    this.updateFavoriteModels();
    this.cdr.markForCheck();
  }
  
  isFavorite(modelId: string): boolean {
    return this.resolveFavoriteIds().includes(modelId);
  }

  private resolveFavoriteIds(): string[] {
    const storySettings = this.ensureStoryFavoriteStructure();
    if (storySettings) {
      return [...storySettings.favoriteModelLists.beatInput];
    }

    const settings = this.settingsService.getSettings();
    const favorites = settings.favoriteModelLists?.beatInput ?? settings.favoriteModels ?? [];
    return [...favorites];
  }

  private ensureStoryFavoriteStructure(): StorySettings | null {
    if (!this.story) {
      return null;
    }

    if (!this.story.settings) {
      this.story.settings = { ...DEFAULT_STORY_SETTINGS };
    }

    if (!Array.isArray(this.story.settings.favoriteModels)) {
      this.story.settings.favoriteModels = [];
    }

    if (!this.story.settings.favoriteModelLists) {
      this.story.settings.favoriteModelLists = {
        beatInput: [...this.story.settings.favoriteModels],
        sceneSummary: [],
        rewrite: [],
        characterChat: []
      };
    }

    if (!Array.isArray(this.story.settings.favoriteModelLists.beatInput)) {
      this.story.settings.favoriteModelLists.beatInput = [...this.story.settings.favoriteModels];
    } else {
      this.story.settings.favoriteModelLists.beatInput = [...this.story.settings.favoriteModelLists.beatInput];
    }

    if (!Array.isArray(this.story.settings.favoriteModelLists.sceneSummary)) {
      this.story.settings.favoriteModelLists.sceneSummary = [];
    } else {
      this.story.settings.favoriteModelLists.sceneSummary = [...this.story.settings.favoriteModelLists.sceneSummary];
    }

    if (!Array.isArray(this.story.settings.favoriteModelLists.rewrite)) {
      this.story.settings.favoriteModelLists.rewrite = [];
    } else {
      this.story.settings.favoriteModelLists.rewrite = [...this.story.settings.favoriteModelLists.rewrite];
    }

    return this.story.settings;
  }

  // Context selection methods
  private async loadStoryAndSetupContext(): Promise<void> {
    if (!this.storyId) return;
    
    try {
      this.story = await this.storyService.getStory(this.storyId);
      if (this.story) {
        this.ensureStoryFavoriteStructure();
        this.updateFavoriteModels();
        this.cdr.markForCheck();
        await this.setupDefaultContext();
      }
    } catch (error) {
      console.error('Error loading story for beat context:', error);
    }
  }

  private async setupDefaultContext(): Promise<void> {
    if (!this.storyId || !this.chapterId || !this.sceneId) return;

    // Always get fresh data from database to ensure we have the latest content
    const freshStory = await this.storyService.getStory(this.storyId);
    if (!freshStory) return;

    // Check if there are persisted selected scenes to restore
    if (this.beatData.selectedScenes && this.beatData.selectedScenes.length > 0) {
      // Restore persisted selected scenes
      for (const persistedScene of this.beatData.selectedScenes) {
        const chapter = freshStory.chapters.find(c => c.id === persistedScene.chapterId);
        const scene = chapter?.scenes.find(s => s.id === persistedScene.sceneId);

        if (chapter && scene) {
          const isCurrentScene = scene.id === this.sceneId;

          this.selectedScenes.push({
            chapterId: chapter.id,
            sceneId: scene.id,
            chapterTitle: `C${chapter.chapterNumber || chapter.order}:${chapter.title}`,
            sceneTitle: `S${scene.sceneNumber || scene.order}:${scene.title}`,
            content: isCurrentScene
              ? this.extractFullTextFromScene(scene, this.beatData.id) // Truncate current scene at beat
              : this.extractFullTextFromScene(scene), // Other scenes: full text
            selected: true,
            isTruncated: isCurrentScene // Mark as truncated if it's the current scene
          });
        }
      }
    } else {
      // Set up default context if no persisted scenes
      const chapter = freshStory.chapters.find(c => c.id === this.chapterId);
      const scene = chapter?.scenes.find(s => s.id === this.sceneId);

      if (chapter && scene) {
        // Add current scene as default context, truncated at beat position
        const currentSceneContent = this.extractFullTextFromScene(scene, this.beatData.id);

        // If current scene has no content, try to find the previous scene with content
        let contentToUse = currentSceneContent;
        if (!contentToUse.trim()) {
          const previousScene = this.findPreviousSceneWithContent(chapter, scene);
          if (previousScene.scene) {
            contentToUse = this.extractFullTextFromScene(previousScene.scene);
          }
        }

        this.selectedScenes.push({
          chapterId: chapter.id,
          sceneId: scene.id,
          chapterTitle: `C${chapter.chapterNumber || chapter.order}:${chapter.title}`,
          sceneTitle: `S${scene.sceneNumber || scene.order}:${scene.title}`,
          content: contentToUse,
          selected: true,
          isTruncated: true // Current scene is always truncated
        });
      }
    }
  }

  private findPreviousSceneWithContent(currentChapter: Chapter, currentScene: Scene): { chapter: Chapter; scene: Scene } | { chapter: null; scene: null } {
    if (!this.story) return { chapter: null, scene: null };
    
    // First, try to find previous scene in current chapter
    const currentSceneIndex = currentChapter.scenes.findIndex(s => s.id === currentScene.id);
    if (currentSceneIndex > 0) {
      for (let i = currentSceneIndex - 1; i >= 0; i--) {
        const scene = currentChapter.scenes[i];
        const content = this.extractFullTextFromScene(scene);
        if (content.trim()) {
          return { chapter: currentChapter, scene };
        }
      }
    }
    
    // If no previous scene found in current chapter, try previous chapters
    const currentChapterIndex = this.story.chapters.findIndex(c => c.id === currentChapter.id);
    if (currentChapterIndex > 0) {
      for (let i = currentChapterIndex - 1; i >= 0; i--) {
        const chapter = this.story.chapters[i];
        // Start from last scene in previous chapter
        for (let j = chapter.scenes.length - 1; j >= 0; j--) {
          const scene = chapter.scenes[j];
          const content = this.extractFullTextFromScene(scene);
          if (content.trim()) {
            return { chapter, scene };
          }
        }
      }
    }
    
    return { chapter: null, scene: null };
  }

  async toggleSceneSelection(chapterId: string, sceneId: string): Promise<void> {
    const index = this.selectedScenes.findIndex(s => s.sceneId === sceneId);

    if (index > -1) {
      this.selectedScenes.splice(index, 1);
    } else {
      // Get fresh data from database to ensure latest content
      const freshStory = await this.storyService.getStory(this.storyId!);
      if (!freshStory) return;

      const chapter = freshStory.chapters.find(c => c.id === chapterId);
      const scene = chapter?.scenes.find(s => s.id === sceneId);

      if (chapter && scene) {
        // Check if this is the current scene - if so, truncate at beat position
        const isCurrentScene = sceneId === this.sceneId;

        this.selectedScenes.push({
          chapterId: chapter.id,
          sceneId: scene.id,
          chapterTitle: `C${chapter.chapterNumber || chapter.order}:${chapter.title}`,
          sceneTitle: `S${scene.sceneNumber || scene.order}:${scene.title}`,
          content: isCurrentScene
            ? this.extractFullTextFromScene(scene, this.beatData.id) // Truncate current scene at beat
            : this.extractFullTextFromScene(scene), // Other scenes: full text
          selected: true,
          isTruncated: isCurrentScene // Mark as truncated if it's the current scene
        });
      }
    }

    // Persist the selected scenes
    this.persistContextSettings();
  }

  isSceneSelected(sceneId: string): boolean {
    return this.selectedScenes.some(s => s.sceneId === sceneId);
  }

  removeSceneContext(scene: SceneContext): void {
    const index = this.selectedScenes.findIndex(s => s.sceneId === scene.sceneId);
    if (index > -1) {
      this.selectedScenes.splice(index, 1);
    }
    
    // Persist the updated selected scenes
    this.persistContextSettings();
  }

  getFilteredScenes(chapter: Chapter): Scene[] {
    if (!this.sceneSearchTerm) return chapter.scenes;
    
    const searchLower = this.sceneSearchTerm.toLowerCase();
    return chapter.scenes.filter(scene => 
      scene.title.toLowerCase().includes(searchLower) ||
      scene.content.toLowerCase().includes(searchLower)
    );
  }

  getScenePreview(scene: Scene): string {
    const cleanText = this.extractFullTextFromScene(scene);
    return cleanText.substring(0, 100) + (cleanText.length > 100 ? '...' : '');
  }

  private extractFullTextFromScene(scene: Scene, truncateAtBeatId?: string): string {
    if (!scene.content) return '';

    // Use DOM parser for more reliable HTML parsing
    const parser = new DOMParser();
    const doc = parser.parseFromString(scene.content, 'text/html');

    // If we need to truncate at a specific beat, find that beat and remove everything after it
    if (truncateAtBeatId) {
      const targetBeat = doc.querySelector(`.beat-ai-node[data-beat-id="${truncateAtBeatId}"]`);
      if (targetBeat) {
        // Save parent reference BEFORE removing the beat node
        const parentParagraph = targetBeat.parentElement;

        // Remove the beat itself and all following siblings
        let currentNode: Node | null = targetBeat;
        while (currentNode) {
          const nextNode: Node | null = currentNode.nextSibling;
          currentNode.parentNode?.removeChild(currentNode);
          currentNode = nextNode;
        }

        // Also check if beat was within a paragraph and remove content after it
        if (parentParagraph?.tagName === 'P') {
          let sibling: Node | null = parentParagraph.nextSibling;
          while (sibling) {
            const nextSibling: Node | null = sibling.nextSibling;
            sibling.parentNode?.removeChild(sibling);
            sibling = nextSibling;
          }
        }
      }
    }

    // Remove all remaining beat AI wrapper elements and their contents
    const beatWrappers = doc.querySelectorAll('.beat-ai-wrapper, .beat-ai-node');
    beatWrappers.forEach(element => element.remove());

    // Remove beat markers and comments
    const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let node;
    while ((node = walker.nextNode())) {
      textNodes.push(node as Text);
    }

    textNodes.forEach(textNode => {
      // Remove beat markers like [Beat: description]
      textNode.textContent = textNode.textContent?.replace(/\[Beat:[^\]]*\]/g, '') || '';
    });

    // Convert to text while preserving paragraph structure
    let cleanText = '';
    const paragraphs = doc.querySelectorAll('p');

    for (const p of paragraphs) {
      const text = p.textContent?.trim() || '';
      if (text) {
        cleanText += text + '\n\n';
      } else {
        // Empty paragraph becomes single newline
        cleanText += '\n';
      }
    }

    // If no paragraphs found, fall back to body text
    if (!paragraphs.length) {
      cleanText = doc.body.textContent || '';
    }

    // Clean up extra whitespace
    cleanText = cleanText.replace(/\n\s*\n\s*\n/g, '\n\n');
    cleanText = cleanText.trim();

    return cleanText;
  }

  private async buildCustomContext(): Promise<{
    selectedScenes: string[];
    includeStoryOutline: boolean;
    selectedSceneContexts: { sceneId: string; chapterId: string; content: string; }[];
  }> {
    // For the current scene, get fresh content from database
    const freshSelectedScenes = [];

    for (const scene of this.selectedScenes) {
      let content = scene.content;

      // If this is the current scene being edited, get fresh content from database
      if (scene.sceneId === this.sceneId && this.storyId) {
        try {
          const freshStory = await this.storyService.getStory(this.storyId);
          if (freshStory) {
            const freshChapter = freshStory.chapters.find(c => c.id === scene.chapterId);
            const freshScene = freshChapter?.scenes.find(s => s.id === scene.sceneId);
            if (freshScene) {
              // For the current scene, truncate at the current beat position
              content = this.extractFullTextFromScene(freshScene, this.beatData.id);
            }
          }
        } catch (error) {
          console.error('Error getting fresh scene content:', error);
          // Fall back to cached content
        }
      }

      freshSelectedScenes.push({
        sceneId: scene.sceneId,
        chapterId: scene.chapterId,
        content: content
      });
    }

    return {
      selectedScenes: freshSelectedScenes.map(scene => scene.content),
      includeStoryOutline: this.includeStoryOutline,
      selectedSceneContexts: freshSelectedScenes
    };
  }

  toggleStoryOutline(): void {
    this.includeStoryOutline = !this.includeStoryOutline;
    this.persistContextSettings();
  }

  removeStoryOutline(): void {
    this.includeStoryOutline = false;
    this.persistContextSettings();
  }

  private persistContextSettings(): void {
    // Update the beat data with current settings
    this.beatData.selectedScenes = this.selectedScenes.map(scene => ({
      sceneId: scene.sceneId,
      chapterId: scene.chapterId
    }));
    this.beatData.includeStoryOutline = this.includeStoryOutline;
    this.beatData.updatedAt = new Date();

    // Emit the change to trigger saving
    this.contentUpdate.emit(this.beatData);
  }

  /**
   * Extract text after beat for scene beat bridging context.
   * Returns undefined if not a scene beat or if no text exists after the beat.
   */
  private getTextAfterBeatIfSceneBeat(): string | undefined {
    if (this.beatData.beatType !== 'scene') {
      return undefined;
    }
    const afterText = this.proseMirrorService.getTextAfterBeat(this.beatData.id);
    return afterText && afterText.trim().length > 0 ? afterText : undefined;
  }
}
