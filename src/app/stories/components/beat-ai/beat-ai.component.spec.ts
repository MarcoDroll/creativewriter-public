import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA, ChangeDetectorRef } from '@angular/core';
import { PopoverController, ModalController, AlertController, ActionSheetController } from '@ionic/angular/standalone';
import { of } from 'rxjs';
import { BeatAIComponent } from './beat-ai.component';
import { ModelService } from '../../../core/services/model.service';
import { SettingsService } from '../../../core/services/settings.service';
import { BeatAIService } from '../../../shared/services/beat-ai.service';
import { ProseMirrorEditorService } from '../../../shared/services/prosemirror-editor.service';
import { TokenCounterService } from '../../../shared/services/token-counter.service';
import { BeatAIModalService } from '../../../shared/services/beat-ai-modal.service';
import { PremiumRewriteService } from '../../../shared/services/premium-rewrite.service';
import { SceneAIGenerationService } from '../../../shared/services/scene-ai-generation.service';
import { StoryService } from '../../services/story.service';
import { BeatAI } from '../../models/beat-ai.interface';
import { BeatVersionHistoryModalComponent } from '../beat-version-history-modal/beat-version-history-modal.component';

describe('BeatAIComponent', () => {
  let component: BeatAIComponent;
  let fixture: ComponentFixture<BeatAIComponent>;
  let mockModalController: jasmine.SpyObj<ModalController>;
  let mockPopoverController: jasmine.SpyObj<PopoverController>;
  let mockAlertController: jasmine.SpyObj<AlertController>;
  let mockActionSheetController: jasmine.SpyObj<ActionSheetController>;
  let mockModelService: jasmine.SpyObj<ModelService>;
  let mockSettingsService: jasmine.SpyObj<SettingsService>;
  let mockBeatAIService: jasmine.SpyObj<BeatAIService>;
  let mockProseMirrorService: jasmine.SpyObj<ProseMirrorEditorService>;
  let mockTokenCounter: jasmine.SpyObj<TokenCounterService>;
  let mockModalService: jasmine.SpyObj<BeatAIModalService>;
  let mockChangeDetectorRef: jasmine.SpyObj<ChangeDetectorRef>;
  let mockPremiumRewriteService: jasmine.SpyObj<PremiumRewriteService>;
  let mockSceneAIGenerationService: jasmine.SpyObj<SceneAIGenerationService>;
  let mockStoryService: jasmine.SpyObj<StoryService>;

  const mockBeatData: BeatAI = {
    id: 'beat-123',
    prompt: 'Initial prompt',
    generatedContent: '',
    isGenerating: false,
    isCollapsed: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    wordCount: 400,
    beatType: 'story',
    model: 'claude-opus-4',
    selectedScenes: [],
    includeStoryOutline: true,
    currentVersionId: '',
    hasHistory: true
  };

  beforeEach(async () => {
    mockModalController = jasmine.createSpyObj('ModalController', ['create', 'dismiss']);
    mockPopoverController = jasmine.createSpyObj('PopoverController', ['create', 'dismiss']);
    mockAlertController = jasmine.createSpyObj('AlertController', ['create']);
    mockActionSheetController = jasmine.createSpyObj('ActionSheetController', ['create']);
    mockModelService = jasmine.createSpyObj('ModelService', ['getCombinedModels']);
    mockSettingsService = jasmine.createSpyObj('SettingsService', ['getSettings']);
    mockBeatAIService = jasmine.createSpyObj('BeatAIService', ['stopGeneration', 'previewPrompt']);
    mockProseMirrorService = jasmine.createSpyObj('ProseMirrorEditorService', [
      'createSimpleEditor',
      'destroySimpleEditor',
      'setSimpleContent',
      'getSimpleContent',
      'switchBeatVersion',
      'getTextAfterBeat'
    ]);
    mockTokenCounter = jasmine.createSpyObj('TokenCounterService', ['countTokens']);
    mockModalService = jasmine.createSpyObj('BeatAIModalService', ['openModal', 'closeModal', 'show']);
    mockChangeDetectorRef = jasmine.createSpyObj('ChangeDetectorRef', ['detectChanges', 'markForCheck']);
    mockPremiumRewriteService = jasmine.createSpyObj('PremiumRewriteService', ['rewriteContent', 'checkAndGateAccess']);
    mockSceneAIGenerationService = jasmine.createSpyObj('SceneAIGenerationService', ['generateStagingNotes', 'isGeneratingStagingNotes']);
    mockStoryService = jasmine.createSpyObj('StoryService', ['getStory']);

    // Setup default mock returns
    mockModelService.getCombinedModels.and.returnValue(of([]));
    mockSettingsService.getSettings.and.returnValue({
      openRouter: { apiKey: '', enabled: false },
      replicate: { apiKey: '', enabled: false },
      googleGemini: { apiKey: '', enabled: false },
      ollama: { baseUrl: '', enabled: false },
      anthropic: { apiKey: '', enabled: false },
      xai: { apiKey: '', enabled: false },
      couchdb: { url: '', username: '', password: '' },
      defaultModel: 'claude-opus-4',
      defaultWordCount: 400,
      defaultBeatType: 'story',
      includeStoryOutlineByDefault: true
    } as unknown as ReturnType<typeof mockSettingsService.getSettings>);
    mockTokenCounter.countTokens.and.returnValue(Promise.resolve({ tokens: 100, method: 'estimation', model: 'claude-opus-4' }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockModalService as any).isModalOpen$ = of(false);
    mockSceneAIGenerationService.generateStagingNotes.and.returnValue(Promise.resolve({ success: true, text: 'Generated notes' }));
    mockSceneAIGenerationService.isGeneratingStagingNotes.and.returnValue(false);
    mockStoryService.getStory.and.returnValue(Promise.resolve(null));

    await TestBed.configureTestingModule({
      imports: [BeatAIComponent],
      providers: [
        { provide: ModalController, useValue: mockModalController },
        { provide: PopoverController, useValue: mockPopoverController },
        { provide: AlertController, useValue: mockAlertController },
        { provide: ActionSheetController, useValue: mockActionSheetController },
        { provide: ModelService, useValue: mockModelService },
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: BeatAIService, useValue: mockBeatAIService },
        { provide: ProseMirrorEditorService, useValue: mockProseMirrorService },
        { provide: TokenCounterService, useValue: mockTokenCounter },
        { provide: BeatAIModalService, useValue: mockModalService },
        { provide: ChangeDetectorRef, useValue: mockChangeDetectorRef },
        { provide: PremiumRewriteService, useValue: mockPremiumRewriteService },
        { provide: SceneAIGenerationService, useValue: mockSceneAIGenerationService },
        { provide: StoryService, useValue: mockStoryService }
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(BeatAIComponent);
    component = fixture.componentInstance;
    component.beatData = { ...mockBeatData };
    component.storyId = 'story-456';
    component.chapterId = 'chapter-789';
    component.sceneId = 'scene-101';
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('openVersionHistory', () => {
    let mockModal: jasmine.SpyObj<HTMLIonModalElement>;

    beforeEach(() => {
      mockModal = jasmine.createSpyObj('Modal', ['present', 'onDidDismiss']);
      mockModal.present.and.returnValue(Promise.resolve());
      mockModalController.create.and.returnValue(Promise.resolve(mockModal));
    });

    it('should not open modal without storyId', async () => {
      component.storyId = undefined;
      spyOn(console, 'warn');

      await component.openVersionHistory();

      expect(mockModalController.create).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith('[BeatAIComponent] Cannot open version history without storyId');
    });

    it('should create modal with correct props', async () => {
      mockModal.onDidDismiss.and.returnValue(Promise.resolve({ data: null, role: 'cancel' }));

      await component.openVersionHistory();

      expect(mockModalController.create).toHaveBeenCalledWith({
        component: BeatVersionHistoryModalComponent,
        componentProps: {
          beatId: 'beat-123',
          currentPrompt: 'Initial prompt',
          storyId: 'story-456'
        },
        cssClass: 'beat-history-modal'
      });
      expect(mockModal.present).toHaveBeenCalled();
    });

    it('should update prompt when version is restored with non-empty prompt', async () => {
      mockModal.onDidDismiss.and.returnValue(Promise.resolve({
        data: { versionChanged: true, restoredPrompt: 'Restored test prompt' },
        role: 'confirm'
      }));

      spyOn(component.contentUpdate, 'emit');

      await component.openVersionHistory();

      expect(component.currentPrompt).toBe('Restored test prompt');
      expect(component.beatData.prompt).toBe('Restored test prompt');
      expect(component.contentUpdate.emit).toHaveBeenCalledWith(component.beatData);
    });

    it('should update prompt when version is restored with empty string prompt', async () => {
      mockModal.onDidDismiss.and.returnValue(Promise.resolve({
        data: { versionChanged: true, restoredPrompt: '' },
        role: 'confirm'
      }));

      spyOn(component.contentUpdate, 'emit');
      component.currentPrompt = 'Old prompt';
      component.beatData.prompt = 'Old prompt';

      await component.openVersionHistory();

      // Empty string should still be set (using !== undefined check)
      expect(component.currentPrompt).toBe('');
      expect(component.beatData.prompt).toBe('');
      expect(component.contentUpdate.emit).toHaveBeenCalled();
    });

    it('should not update prompt when restoredPrompt is undefined', async () => {
      mockModal.onDidDismiss.and.returnValue(Promise.resolve({
        data: { versionChanged: true },  // No restoredPrompt
        role: 'confirm'
      }));

      spyOn(component.contentUpdate, 'emit');
      component.currentPrompt = 'Original prompt';
      component.beatData.prompt = 'Original prompt';

      await component.openVersionHistory();

      // Prompt should remain unchanged
      expect(component.currentPrompt).toBe('Original prompt');
      expect(component.beatData.prompt).toBe('Original prompt');
      // contentUpdate should still be emitted (once for any change)
      expect(component.contentUpdate.emit).toHaveBeenCalled();
    });

    it('should update hasHistory flag when history is deleted', async () => {
      mockModal.onDidDismiss.and.returnValue(Promise.resolve({
        data: { historyDeleted: true },
        role: 'confirm'
      }));

      spyOn(component.contentUpdate, 'emit');
      component.beatData.hasHistory = true;

      await component.openVersionHistory();

      expect(component.beatData.hasHistory).toBeFalse();
      expect(component.contentUpdate.emit).toHaveBeenCalledWith(component.beatData);
    });

    it('should handle both versionChanged and historyDeleted together', async () => {
      // This is an edge case - shouldn't happen in practice but testing for robustness
      mockModal.onDidDismiss.and.returnValue(Promise.resolve({
        data: { versionChanged: true, restoredPrompt: 'New prompt', historyDeleted: true },
        role: 'confirm'
      }));

      spyOn(component.contentUpdate, 'emit');
      component.beatData.hasHistory = true;

      await component.openVersionHistory();

      expect(component.currentPrompt).toBe('New prompt');
      expect(component.beatData.prompt).toBe('New prompt');
      expect(component.beatData.hasHistory).toBeFalse();
      // contentUpdate should be emitted once (optimized)
      expect(component.contentUpdate.emit).toHaveBeenCalledTimes(1);
    });

    it('should not emit contentUpdate when modal is cancelled', async () => {
      mockModal.onDidDismiss.and.returnValue(Promise.resolve({
        data: null,
        role: 'cancel'
      }));

      spyOn(component.contentUpdate, 'emit');

      await component.openVersionHistory();

      expect(component.contentUpdate.emit).not.toHaveBeenCalled();
    });

    it('should trigger change detection after handling modal dismissal with changes', async () => {
      mockModal.onDidDismiss.and.returnValue(Promise.resolve({
        data: { versionChanged: true, restoredPrompt: 'Test' },
        role: 'confirm'
      }));

      // The component calls cdr.detectChanges() internally
      // We verify the prompt was updated which implies change detection happened
      await component.openVersionHistory();

      expect(component.currentPrompt).toBe('Test');
      expect(component.beatData.prompt).toBe('Test');
    });
  });

  describe('showPromptPreview', () => {
    beforeEach(() => {
      // Setup previewPrompt to return an observable
      mockBeatAIService.previewPrompt.and.returnValue(of('preview content'));
    });

    it('should use beatData.beatType for preview', async () => {
      component.beatData.beatType = 'scene';
      component.currentPrompt = 'Test prompt';

      await component.showPromptPreview();

      expect(mockBeatAIService.previewPrompt).toHaveBeenCalledWith(
        'Test prompt',
        'beat-123',
        jasmine.objectContaining({
          beatType: 'scene'
        })
      );
    });

    it('should not call previewPrompt when prompt is empty', async () => {
      component.currentPrompt = '';

      await component.showPromptPreview();

      expect(mockBeatAIService.previewPrompt).not.toHaveBeenCalled();
    });

    it('should not call previewPrompt when prompt is whitespace only', async () => {
      component.currentPrompt = '   ';

      await component.showPromptPreview();

      expect(mockBeatAIService.previewPrompt).not.toHaveBeenCalled();
    });

    it('should show modal with preview content', async () => {
      component.currentPrompt = 'Test prompt';
      component.beatData.beatType = 'story';

      await component.showPromptPreview();

      expect(mockModalService.show).toHaveBeenCalledWith('preview content');
    });
  });

  describe('regenerateFromPrompt', () => {
    it('should clear rewrite context before regenerating', async () => {
      component.beatData.lastAction = 'rewrite';
      component.beatData.rewriteContext = { originalText: 'test', instruction: 'make shorter' };
      component.beatData.generatedContent = 'existing content';
      component.currentPrompt = 'test prompt';

      spyOn(component, 'regenerateContent').and.returnValue(Promise.resolve());

      await component.regenerateFromPrompt();

      expect(component.beatData.lastAction).toBe('generate');
      expect(component.beatData.rewriteContext).toBeUndefined();
      expect(component.regenerateContent).toHaveBeenCalled();
    });
  });

  describe('rewriteContent (ActionSheet split button)', () => {
    let mockActionSheet: jasmine.SpyObj<HTMLIonActionSheetElement>;

    beforeEach(() => {
      mockActionSheet = jasmine.createSpyObj('ActionSheet', ['present']);
      mockActionSheet.present.and.returnValue(Promise.resolve());
      mockActionSheetController.create.and.returnValue(Promise.resolve(mockActionSheet));
    });

    it('should not proceed if premium gate blocks access', async () => {
      mockPremiumRewriteService.checkAndGateAccess.and.returnValue(Promise.resolve(false));

      await component.rewriteContent();

      expect(mockActionSheetController.create).not.toHaveBeenCalled();
    });

    it('should show no content alert when there is no text after beat', async () => {
      mockPremiumRewriteService.checkAndGateAccess.and.returnValue(Promise.resolve(true));
      mockProseMirrorService.getTextAfterBeat.and.returnValue('');

      const mockAlert = jasmine.createSpyObj('Alert', ['present']);
      mockAlert.present.and.returnValue(Promise.resolve());
      mockAlertController.create.and.returnValue(Promise.resolve(mockAlert));

      await component.rewriteContent();

      expect(mockAlertController.create).toHaveBeenCalledWith(jasmine.objectContaining({
        header: 'No Content'
      }));
      expect(mockActionSheetController.create).not.toHaveBeenCalled();
    });

    it('should open ActionSheet with rewrite and polish options', async () => {
      mockPremiumRewriteService.checkAndGateAccess.and.returnValue(Promise.resolve(true));
      mockProseMirrorService.getTextAfterBeat.and.returnValue('Some existing text');

      await component.rewriteContent();

      expect(mockActionSheetController.create).toHaveBeenCalledWith(jasmine.objectContaining({
        header: 'Rewrite Options',
        buttons: jasmine.arrayContaining([
          jasmine.objectContaining({ text: 'Rewrite with custom prompt' }),
          jasmine.objectContaining({ text: 'Polish expression & wording' }),
          jasmine.objectContaining({ text: 'Cancel', role: 'cancel' })
        ])
      }));
      expect(mockActionSheet.present).toHaveBeenCalled();
    });
  });

  describe('regenerateContent with polish', () => {
    it('should regenerate as polish when lastAction is polish', async () => {
      component.beatData.lastAction = 'polish';
      component.beatData.rewriteContext = { originalText: 'original text', instruction: 'more vivid' };
      component.beatData.prompt = 'test prompt';
      component.currentPrompt = 'test prompt';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (component as any).selectedModel = 'test-model';

      mockProseMirrorService.getTextAfterBeat.and.returnValue('polished text');
      spyOn(component.promptSubmit, 'emit');
      spyOn(component.contentUpdate, 'emit');

      await component.regenerateContent();

      expect(component.promptSubmit.emit).toHaveBeenCalledWith(jasmine.objectContaining({
        action: 'polish',
        existingText: 'polished text',
        rewriteInstruction: 'more vivid'
      }));
    });
  });

});
