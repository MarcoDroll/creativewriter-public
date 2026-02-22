import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { SceneAIGenerationService, SummaryGenerationOptions, TitleGenerationOptions, StagingNotesGenerationOptions } from './scene-ai-generation.service';
import { SettingsService } from '../../core/services/settings.service';
import { OpenRouterApiService, OpenRouterResponse } from '../../core/services/openrouter-api.service';
import { GoogleGeminiApiService, GoogleGeminiResponse } from '../../core/services/google-gemini-api.service';
import { AIProviderValidationService } from '../../core/services/ai-provider-validation.service';
import { PromptTemplateService } from './prompt-template.service';
import { PromptManagerService } from './prompt-manager.service';
import { CodexContextService } from './codex-context.service';
import { DEFAULT_SETTINGS, Settings } from '../../core/models/settings.interface';

// Helper to create mock OpenRouter responses
function createOpenRouterResponse(content: string, finishReason = 'stop'): OpenRouterResponse {
  return {
    id: 'test-id',
    object: 'chat.completion',
    created: Date.now(),
    model: 'test-model',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
  };
}

// Helper to create mock Gemini responses
function createGeminiResponse(text: string): GoogleGeminiResponse {
  return {
    candidates: [{
      content: { parts: [{ text }], role: 'model' },
      finishReason: 'STOP',
      index: 0,
      safetyRatings: []
    }]
  };
}

describe('SceneAIGenerationService', () => {
  let service: SceneAIGenerationService;
  let mockSettingsService: jasmine.SpyObj<SettingsService>;
  let mockOpenRouterApi: jasmine.SpyObj<OpenRouterApiService>;
  let mockGeminiApi: jasmine.SpyObj<GoogleGeminiApiService>;
  let mockAiProviderValidation: jasmine.SpyObj<AIProviderValidationService>;
  let mockPromptTemplateService: jasmine.SpyObj<PromptTemplateService>;
  let mockPromptManager: jasmine.SpyObj<PromptManagerService>;
  let mockCodexContextService: jasmine.SpyObj<CodexContextService>;

  const mockSettings: Settings = {
    ...DEFAULT_SETTINGS,
    openRouter: { ...DEFAULT_SETTINGS.openRouter, apiKey: 'test-key', enabled: true },
    googleGemini: { ...DEFAULT_SETTINGS.googleGemini, apiKey: 'gemini-key', enabled: true },
    selectedModel: 'openrouter:anthropic/claude-3-opus',
    sceneSummaryGeneration: {
      temperature: 0.7,
      customInstruction: '',
      customPrompt: '',
      useCustomPrompt: false,
      selectedModel: ''
    },
    sceneTitleGeneration: {
      maxWords: 5,
      style: 'concise',
      language: 'english',
      includeGenre: false,
      temperature: 0.3,
      customInstruction: '',
      customPrompt: '',
      useCustomPrompt: false,
      selectedModel: ''
    },
    stagingNotesGeneration: {
      temperature: 0.5,
      customInstruction: '',
      customPrompt: '',
      useCustomPrompt: false,
      selectedModel: ''
    }
  };

  const mockSummaryOptions: SummaryGenerationOptions = {
    storyId: 'story-123',
    sceneId: 'scene-456',
    sceneTitle: 'Test Scene',
    sceneContent: 'This is the scene content for testing.',
    sceneWordCount: 100,
    storyLanguage: 'en'
  };

  const mockTitleOptions: TitleGenerationOptions = {
    storyId: 'story-123',
    sceneId: 'scene-456',
    sceneContent: 'This is the scene content for testing.'
  };

  const mockStagingNotesOptions: StagingNotesGenerationOptions = {
    storyId: 'story-123',
    sceneId: 'scene-456',
    sceneContent: 'John sat at the wooden desk by the window. The morning light filtered through curtains.',
    storyLanguage: 'en'
  };

  beforeEach(() => {
    mockSettingsService = jasmine.createSpyObj('SettingsService', ['getSettings']);
    mockOpenRouterApi = jasmine.createSpyObj('OpenRouterApiService', ['generateText']);
    mockGeminiApi = jasmine.createSpyObj('GoogleGeminiApiService', ['generateText']);
    mockAiProviderValidation = jasmine.createSpyObj('AIProviderValidationService', [
      'hasAnyProviderConfigured',
      'isProviderAvailable',
      'getNoProviderConfiguredMessage'
    ]);
    mockPromptTemplateService = jasmine.createSpyObj('PromptTemplateService', ['getSceneSummaryTemplate', 'getStagingNotesTemplate']);
    mockPromptManager = jasmine.createSpyObj('PromptManagerService', ['extractPlainTextFromHtml']);
    mockCodexContextService = jasmine.createSpyObj('CodexContextService', ['buildCodexXml']);

    // Default mock returns
    mockSettingsService.getSettings.and.returnValue(mockSettings);
    mockAiProviderValidation.hasAnyProviderConfigured.and.returnValue(true);
    mockAiProviderValidation.isProviderAvailable.and.callFake((provider: string) => {
      return provider === 'openrouter';
    });
    mockAiProviderValidation.getNoProviderConfiguredMessage.and.returnValue('No provider configured');
    mockPromptTemplateService.getSceneSummaryTemplate.and.returnValue(
      Promise.resolve('Scene: {sceneTitle}\nContent: {sceneContent}\n{languageInstruction}{lengthRequirement}{additionalInstructions}{codexEntries}')
    );
    mockPromptTemplateService.getStagingNotesTemplate.and.returnValue(
      Promise.resolve('Extract staging notes from: {sceneContent}\n{languageInstruction}{customInstruction}')
    );
    mockPromptManager.extractPlainTextFromHtml.and.callFake((html: string) => html);
    mockCodexContextService.buildCodexXml.and.returnValue(
      Promise.resolve({ xml: '<codex />', categories: [] })
    );

    TestBed.configureTestingModule({
      providers: [
        SceneAIGenerationService,
        { provide: SettingsService, useValue: mockSettingsService },
        { provide: OpenRouterApiService, useValue: mockOpenRouterApi },
        { provide: GoogleGeminiApiService, useValue: mockGeminiApi },
        { provide: AIProviderValidationService, useValue: mockAiProviderValidation },
        { provide: PromptTemplateService, useValue: mockPromptTemplateService },
        { provide: PromptManagerService, useValue: mockPromptManager },
        { provide: CodexContextService, useValue: mockCodexContextService }
      ]
    });

    service = TestBed.inject(SceneAIGenerationService);
  });

  afterEach(() => {
    service.ngOnDestroy();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('generateSceneSummary', () => {
    it('should use OpenRouter when configured', async () => {
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('Generated summary text.')));

      const result = await service.generateSceneSummary(mockSummaryOptions);

      expect(result.success).toBeTrue();
      expect(result.text).toBe('Generated summary text.');
      expect(mockOpenRouterApi.generateText).toHaveBeenCalled();
      expect(mockGeminiApi.generateText).not.toHaveBeenCalled();
    });

    it('should fallback to Gemini when OpenRouter unavailable', async () => {
      mockAiProviderValidation.isProviderAvailable.and.callFake((provider: string) => {
        return provider === 'gemini';
      });
      mockGeminiApi.generateText.and.returnValue(of(createGeminiResponse('Gemini summary.')));

      const result = await service.generateSceneSummary({
        ...mockSummaryOptions,
        model: 'gemini:gemini-2.0-flash'
      });

      expect(result.success).toBeTrue();
      expect(result.text).toBe('Gemini summary.');
      expect(mockGeminiApi.generateText).toHaveBeenCalled();
    });

    it('should include codex context in prompt', async () => {
      mockCodexContextService.buildCodexXml.and.returnValue(
        Promise.resolve({
          xml: '<character name="John"><description>A character</description></character>',
          categories: [],
          entriesDropped: 2,
          totalEntries: 5
        })
      );
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('Summary with context.')));

      const result = await service.generateSceneSummary(mockSummaryOptions);

      expect(result.success).toBeTrue();
      expect(result.entriesDropped).toBe(2);
      expect(result.totalEntries).toBe(5);
      expect(mockCodexContextService.buildCodexXml).toHaveBeenCalledWith(
        'story-123',
        jasmine.any(String),
        '',
        jasmine.any(String),
        1000,
        true
      );
    });

    it('should respect language settings', async () => {
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('Deutsche Zusammenfassung.')));

      await service.generateSceneSummary({ ...mockSummaryOptions, storyLanguage: 'de' });

      const callArgs = mockOpenRouterApi.generateText.calls.mostRecent().args;
      expect(callArgs[0]).toContain('Antworte auf Deutsch');
    });

    it('should calculate summary word count based on scene length', async () => {
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('Long summary.')));

      // Scene with 3000 words should request more summary words
      await service.generateSceneSummary({ ...mockSummaryOptions, sceneWordCount: 3000 });

      const callArgs = mockOpenRouterApi.generateText.calls.mostRecent().args;
      // 3000 words = 120 base + ceil((3000-2000)/500) * 25 = 120 + 2*25 = 170
      expect(callArgs[0]).toContain('170 words');
    });

    it('should handle API errors gracefully', async () => {
      mockOpenRouterApi.generateText.and.returnValue(
        throwError(() => ({ status: 401, message: 'Unauthorized' }))
      );

      const result = await service.generateSceneSummary(mockSummaryOptions);

      expect(result.success).toBeFalse();
      expect(result.error).toContain('Invalid API key');
    });

    it('should return error when no model configured', async () => {
      mockSettingsService.getSettings.and.returnValue({
        ...mockSettings,
        selectedModel: '',
        sceneSummaryGeneration: { ...mockSettings.sceneSummaryGeneration, selectedModel: '' }
      });

      const result = await service.generateSceneSummary(mockSummaryOptions);

      expect(result.success).toBeFalse();
      expect(result.error).toBe('No AI model configured.');
    });

    it('should return error when scene has no content', async () => {
      const result = await service.generateSceneSummary({
        ...mockSummaryOptions,
        sceneContent: ''
      });

      expect(result.success).toBeFalse();
      expect(result.error).toBe('Scene has no content to summarize.');
    });

    it('should add punctuation if summary does not end with punctuation', async () => {
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('Summary without punctuation')));

      const result = await service.generateSceneSummary(mockSummaryOptions);

      expect(result.success).toBeTrue();
      expect(result.text).toBe('Summary without punctuation.');
    });
  });

  describe('generateSceneTitle', () => {
    it('should apply style instruction based on settings', async () => {
      const settingsWithStyle = {
        ...mockSettings,
        sceneTitleGeneration: { ...mockSettings.sceneTitleGeneration, style: 'descriptive' as const }
      };
      mockSettingsService.getSettings.and.returnValue(settingsWithStyle);
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('Descriptive Title')));

      await service.generateSceneTitle(mockTitleOptions);

      const callArgs = mockOpenRouterApi.generateText.calls.mostRecent().args;
      expect(callArgs[0]).toContain('descriptive and atmospheric');
    });

    it('should respect maxWords setting', async () => {
      const settingsWithMaxWords = {
        ...mockSettings,
        sceneTitleGeneration: { ...mockSettings.sceneTitleGeneration, maxWords: 10 }
      };
      mockSettingsService.getSettings.and.returnValue(settingsWithMaxWords);
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('A Longer Title')));

      await service.generateSceneTitle(mockTitleOptions);

      const callArgs = mockOpenRouterApi.generateText.calls.mostRecent().args;
      expect(callArgs[0]).toContain('up to 10 words');
    });

    it('should strip quotes from generated title', async () => {
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('"Quoted Title"')));

      const result = await service.generateSceneTitle(mockTitleOptions);

      expect(result.success).toBeTrue();
      expect(result.text).toBe('Quoted Title');
    });

    it('should return error when scene has no content', async () => {
      const result = await service.generateSceneTitle({
        ...mockTitleOptions,
        sceneContent: ''
      });

      expect(result.success).toBeFalse();
      expect(result.error).toBe('Scene has no content to generate title from.');
    });

    it('should use custom prompt when configured', async () => {
      const settingsWithCustomPrompt = {
        ...mockSettings,
        sceneTitleGeneration: {
          ...mockSettings.sceneTitleGeneration,
          useCustomPrompt: true,
          customPrompt: 'Generate a {maxWords} word title for: {sceneContent}'
        }
      };
      mockSettingsService.getSettings.and.returnValue(settingsWithCustomPrompt);
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('Custom Title')));

      await service.generateSceneTitle(mockTitleOptions);

      const callArgs = mockOpenRouterApi.generateText.calls.mostRecent().args;
      expect(callArgs[0]).toContain('Generate a 5 word title');
    });
  });

  describe('state management', () => {
    it('should track generating state per scene', async () => {
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('Summary.')));

      expect(service.isGeneratingSummary('scene-456')).toBeFalse();

      // Start generation but don't await
      const generationPromise = service.generateSceneSummary(mockSummaryOptions);

      // Wait for the promise to complete
      await generationPromise;

      // After completion, should not be generating
      expect(service.isGeneratingSummary('scene-456')).toBeFalse();
    });

    it('should allow cancellation', async () => {
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('Summary.')));

      const generationPromise = service.generateSceneSummary(mockSummaryOptions);
      service.cancelGeneration('scene-456');

      await generationPromise;

      expect(service.isGeneratingSummary('scene-456')).toBeFalse();
    });

    it('should cleanup on destroy', () => {
      service.ngOnDestroy();

      // Should not throw after destroy
      expect(() => service.isGeneratingSummary('any-id')).not.toThrow();
    });

    it('should track title generation state separately from summary', async () => {
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('Title')));

      expect(service.isGeneratingTitle('scene-456')).toBeFalse();
      expect(service.isGeneratingSummary('scene-456')).toBeFalse();

      await service.generateSceneTitle(mockTitleOptions);

      expect(service.isGeneratingTitle('scene-456')).toBeFalse();
      expect(service.isGeneratingSummary('scene-456')).toBeFalse();
    });
  });

  describe('error handling', () => {
    it('should handle rate limit errors', async () => {
      mockOpenRouterApi.generateText.and.returnValue(
        throwError(() => ({ status: 429 }))
      );

      const result = await service.generateSceneSummary(mockSummaryOptions);

      expect(result.success).toBeFalse();
      expect(result.error).toContain('Rate limit');
    });

    it('should handle server errors', async () => {
      mockOpenRouterApi.generateText.and.returnValue(
        throwError(() => ({ status: 500 }))
      );

      const result = await service.generateSceneSummary(mockSummaryOptions);

      expect(result.success).toBeFalse();
      expect(result.error).toContain('server error');
    });

    it('should return error when no provider configured', async () => {
      mockAiProviderValidation.hasAnyProviderConfigured.and.returnValue(false);

      const result = await service.generateSceneSummary(mockSummaryOptions);

      expect(result.success).toBeFalse();
      expect(result.error).toBe('No provider configured');
    });
  });

  describe('generateStagingNotes', () => {
    it('should generate staging notes successfully', async () => {
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('- John seated at desk\n- Window with morning light')));

      const result = await service.generateStagingNotes(mockStagingNotesOptions);

      expect(result.success).toBeTrue();
      expect(result.text).toBe('- John seated at desk\n- Window with morning light');
      expect(mockOpenRouterApi.generateText).toHaveBeenCalled();
    });

    it('should return error when scene has no content', async () => {
      const result = await service.generateStagingNotes({
        ...mockStagingNotesOptions,
        sceneContent: ''
      });

      expect(result.success).toBeFalse();
      expect(result.error).toBe('No content before this beat to generate staging notes from.');
    });

    it('should return error when scene has only whitespace', async () => {
      const result = await service.generateStagingNotes({
        ...mockStagingNotesOptions,
        sceneContent: '   \n\t  '
      });

      expect(result.success).toBeFalse();
      expect(result.error).toBe('No content before this beat to generate staging notes from.');
    });

    it('should return error when no model configured', async () => {
      mockSettingsService.getSettings.and.returnValue({
        ...mockSettings,
        selectedModel: '',
        stagingNotesGeneration: { ...mockSettings.stagingNotesGeneration, selectedModel: '' }
      });

      const result = await service.generateStagingNotes(mockStagingNotesOptions);

      expect(result.success).toBeFalse();
      expect(result.error).toBe('No AI model configured.');
    });

    it('should respect language settings', async () => {
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('- Johannes sitzt am Schreibtisch')));

      await service.generateStagingNotes({ ...mockStagingNotesOptions, storyLanguage: 'de' });

      const callArgs = mockOpenRouterApi.generateText.calls.mostRecent().args;
      expect(callArgs[0]).toContain('Antworte auf Deutsch');
    });

    it('should track generation state', async () => {
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('Staging notes.')));

      expect(service.isGeneratingStagingNotes('scene-456')).toBeFalse();

      const generationPromise = service.generateStagingNotes(mockStagingNotesOptions);
      await generationPromise;

      expect(service.isGeneratingStagingNotes('scene-456')).toBeFalse();
    });

    it('should handle API errors gracefully', async () => {
      mockOpenRouterApi.generateText.and.returnValue(
        throwError(() => ({ status: 401, message: 'Unauthorized' }))
      );

      const result = await service.generateStagingNotes(mockStagingNotesOptions);

      expect(result.success).toBeFalse();
      expect(result.error).toContain('Invalid API key');
    });

    it('should use feature-specific model when configured', async () => {
      const settingsWithModel = {
        ...mockSettings,
        stagingNotesGeneration: {
          ...mockSettings.stagingNotesGeneration,
          selectedModel: 'openrouter:anthropic/claude-3-haiku'
        }
      };
      mockSettingsService.getSettings.and.returnValue(settingsWithModel);
      mockOpenRouterApi.generateText.and.returnValue(of(createOpenRouterResponse('Staging notes')));

      await service.generateStagingNotes(mockStagingNotesOptions);

      expect(mockOpenRouterApi.generateText).toHaveBeenCalledWith(
        jasmine.any(String),
        jasmine.objectContaining({ model: 'anthropic/claude-3-haiku' })
      );
    });

    it('should use Gemini when configured', async () => {
      mockAiProviderValidation.isProviderAvailable.and.callFake((provider: string) => {
        return provider === 'gemini';
      });
      mockGeminiApi.generateText.and.returnValue(of(createGeminiResponse('Gemini staging notes.')));

      const result = await service.generateStagingNotes({
        ...mockStagingNotesOptions,
        model: 'gemini:gemini-2.0-flash'
      });

      expect(result.success).toBeTrue();
      expect(result.text).toBe('Gemini staging notes.');
      expect(mockGeminiApi.generateText).toHaveBeenCalled();
    });
  });
});
