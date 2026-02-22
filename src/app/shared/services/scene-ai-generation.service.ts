import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { Subject, Subscription, of, timeout, catchError, map, takeUntil } from 'rxjs';

import { SettingsService } from '../../core/services/settings.service';
import { OpenRouterApiService } from '../../core/services/openrouter-api.service';
import { GoogleGeminiApiService } from '../../core/services/google-gemini-api.service';
import { AIProviderValidationService } from '../../core/services/ai-provider-validation.service';
import { PromptTemplateService } from './prompt-template.service';
import { PromptManagerService } from './prompt-manager.service';
import { CodexContextService } from './codex-context.service';

export interface SummaryGenerationOptions {
  storyId: string;
  sceneId: string;
  sceneTitle: string;
  sceneContent: string;
  sceneWordCount: number;
  storyLanguage: string;
  model?: string;
}

export interface TitleGenerationOptions {
  storyId: string;
  sceneId: string;
  sceneContent: string;
  model?: string;
}

export interface StagingNotesGenerationOptions {
  storyId: string;
  sceneId: string;
  sceneContent: string;
  storyLanguage: string;
  beatId?: string; // If provided, only use content before this beat
  model?: string;
  protagonistName?: string; // Name from Codex for protagonist/narrator
}

export interface GenerationResult {
  success: boolean;
  text?: string;
  error?: string;
  entriesDropped?: number;
  totalEntries?: number;
}

@Injectable({ providedIn: 'root' })
export class SceneAIGenerationService implements OnDestroy {
  private settingsService = inject(SettingsService);
  private openRouterApi = inject(OpenRouterApiService);
  private geminiApi = inject(GoogleGeminiApiService);
  private aiProviderValidation = inject(AIProviderValidationService);
  private promptTemplateService = inject(PromptTemplateService);
  private promptManager = inject(PromptManagerService);
  private codexContextService = inject(CodexContextService);

  private subscription = new Subscription();
  private cancelSubjects = new Map<string, Subject<void>>();

  // Generation state (per scene)
  private generatingSummary = signal<Set<string>>(new Set());
  private generatingTitle = signal<Set<string>>(new Set());
  private generatingStagingNotes = signal<Set<string>>(new Set());

  private static readonly GENERATION_TIMEOUT_MS = 90000;
  private static readonly MAX_CONTENT_LENGTH_SUMMARY = 200000;
  private static readonly MAX_CONTENT_LENGTH_TITLE = 50000;
  private static readonly MAX_CONTENT_LENGTH_STAGING_NOTES = 100000;

  ngOnDestroy(): void {
    this.subscription.unsubscribe();
    this.cancelSubjects.forEach(subject => subject.complete());
    this.cancelSubjects.clear();
  }

  isGeneratingSummary(sceneId: string): boolean {
    return this.generatingSummary().has(sceneId);
  }

  isGeneratingTitle(sceneId: string): boolean {
    return this.generatingTitle().has(sceneId);
  }

  isGeneratingStagingNotes(sceneId: string): boolean {
    return this.generatingStagingNotes().has(sceneId);
  }

  cancelGeneration(sceneId: string): void {
    const subject = this.cancelSubjects.get(sceneId);
    if (subject) {
      subject.next();
      subject.complete();
      this.cancelSubjects.delete(sceneId);
    }
    this.generatingSummary.update(set => {
      const newSet = new Set(set);
      newSet.delete(sceneId);
      return newSet;
    });
    this.generatingTitle.update(set => {
      const newSet = new Set(set);
      newSet.delete(sceneId);
      return newSet;
    });
    this.generatingStagingNotes.update(set => {
      const newSet = new Set(set);
      newSet.delete(sceneId);
      return newSet;
    });
  }

  async generateSceneSummary(options: SummaryGenerationOptions): Promise<GenerationResult> {
    const { storyId, sceneId, sceneTitle, sceneContent, sceneWordCount, storyLanguage, model } = options;

    if (!sceneContent?.trim()) {
      return { success: false, error: 'Scene has no content to summarize.' };
    }

    const settings = this.settingsService.getSettings();
    const modelToUse = model || settings.sceneSummaryGeneration.selectedModel || settings.selectedModel;
    if (!modelToUse) {
      return { success: false, error: 'No AI model configured.' };
    }

    if (!this.aiProviderValidation.hasAnyProviderConfigured(settings)) {
      return { success: false, error: this.aiProviderValidation.getNoProviderConfiguredMessage() };
    }

    // Mark as generating
    this.generatingSummary.update(set => new Set(set).add(sceneId));

    // Create cancel subject for this generation
    const cancelSubject = new Subject<void>();
    this.cancelSubjects.set(sceneId, cancelSubject);

    try {
      // Clean content
      let cleanedContent = this.removeEmbeddedImages(sceneContent);
      cleanedContent = this.promptManager.extractPlainTextFromHtml(cleanedContent);

      let truncated = false;
      if (cleanedContent.length > SceneAIGenerationService.MAX_CONTENT_LENGTH_SUMMARY) {
        cleanedContent = cleanedContent.slice(0, SceneAIGenerationService.MAX_CONTENT_LENGTH_SUMMARY);
        truncated = true;
      }

      // Calculate minimum summary words based on scene length
      const minimumSummaryWords = this.calculateSummaryMinimumWords(sceneWordCount);
      const wordCountInstruction = `Aim for around ${minimumSummaryWords} words.`;

      // Get language instruction
      const languageInstruction = this.getLanguageInstruction(storyLanguage);

      // Build codex context
      let codexEntriesRaw = '';
      let entriesDropped: number | undefined;
      let totalEntries: number | undefined;

      try {
        const customInstructionRaw = settings.sceneSummaryGeneration.customInstruction ?? '';
        const codexPromptContext = [sceneTitle || '', customInstructionRaw.trim()].filter(Boolean).join('\n');
        const codexContext = await this.codexContextService.buildCodexXml(
          storyId,
          codexPromptContext,
          '',
          cleanedContent,
          1000,
          true // skipRelevanceFiltering - include ALL codex entries for summaries
        );
        codexEntriesRaw = codexContext.xml;
        entriesDropped = codexContext.entriesDropped;
        totalEntries = codexContext.totalEntries;
      } catch (error) {
        console.error('Failed to build codex context for scene summary', error);
      }

      // Build prompt
      const prompt = await this.buildSummaryPrompt({
        sceneTitle,
        sceneContent: cleanedContent,
        truncated,
        languageInstruction,
        wordCountInstruction,
        minimumSummaryWords,
        codexEntriesRaw,
        settings
      });

      // Get provider and model
      const { actualModelId, useGemini, useOpenRouter } = this.resolveProvider(modelToUse, settings);

      if (!useGemini && !useOpenRouter) {
        return { success: false, error: 'No available AI provider configured.' };
      }

      // Generate
      const temperature = settings.sceneSummaryGeneration.temperature;
      const result = await this.executeGeneration({
        prompt,
        provider: useGemini ? 'gemini' : 'openrouter',
        modelId: actualModelId,
        maxTokens: 3000,
        temperature,
        sceneId,
        cancelSubject
      });

      if (result.success && result.text) {
        // Ensure summary ends with punctuation
        let text = result.text.trim();
        if (text && !text.match(/[.!?]$/)) {
          text += '.';
        }
        return { success: true, text, entriesDropped, totalEntries };
      }

      return result;
    } finally {
      this.generatingSummary.update(set => {
        const newSet = new Set(set);
        newSet.delete(sceneId);
        return newSet;
      });
      this.cancelSubjects.delete(sceneId);
    }
  }

  async generateSceneTitle(options: TitleGenerationOptions): Promise<GenerationResult> {
    const { sceneId, sceneContent, model } = options;

    if (!sceneContent?.trim()) {
      return { success: false, error: 'Scene has no content to generate title from.' };
    }

    const settings = this.settingsService.getSettings();
    const titleSettings = settings.sceneTitleGeneration;
    const modelToUse = model || titleSettings.selectedModel || settings.selectedModel;
    if (!modelToUse) {
      return { success: false, error: 'No AI model configured.' };
    }

    if (!this.aiProviderValidation.hasAnyProviderConfigured(settings)) {
      return { success: false, error: this.aiProviderValidation.getNoProviderConfiguredMessage() };
    }

    // Mark as generating
    this.generatingTitle.update(set => new Set(set).add(sceneId));

    // Create cancel subject for this generation
    const cancelSubject = new Subject<void>();
    this.cancelSubjects.set(sceneId, cancelSubject);

    try {
      // Clean content
      let cleanedContent = this.removeEmbeddedImages(sceneContent);
      cleanedContent = this.promptManager.extractPlainTextFromHtml(cleanedContent);

      if (cleanedContent.length > SceneAIGenerationService.MAX_CONTENT_LENGTH_TITLE) {
        cleanedContent = cleanedContent.slice(0, SceneAIGenerationService.MAX_CONTENT_LENGTH_TITLE);
      }

      // Build prompt
      const prompt = this.buildTitlePrompt(cleanedContent, titleSettings);

      // Get provider and model
      const { actualModelId, useGemini, useOpenRouter } = this.resolveProvider(modelToUse, settings);

      if (!useGemini && !useOpenRouter) {
        return { success: false, error: 'No available AI provider configured.' };
      }

      // Generate
      const result = await this.executeGeneration({
        prompt,
        provider: useGemini ? 'gemini' : 'openrouter',
        modelId: actualModelId,
        maxTokens: 200,
        temperature: titleSettings.temperature,
        sceneId,
        cancelSubject
      });

      if (result.success && result.text) {
        // Strip quotes from title
        const text = result.text.trim().replace(/^\s*"|"\s*$/g, '');
        return { success: true, text };
      }

      return result;
    } finally {
      this.generatingTitle.update(set => {
        const newSet = new Set(set);
        newSet.delete(sceneId);
        return newSet;
      });
      this.cancelSubjects.delete(sceneId);
    }
  }

  async generateStagingNotes(options: StagingNotesGenerationOptions): Promise<GenerationResult> {
    const { sceneId, storyLanguage, model, beatId, protagonistName } = options;
    let { sceneContent } = options;

    // If beatId is provided, get only content BEFORE the beat
    if (beatId) {
      const textBeforeBeat = await this.promptManager.getCurrentOrPreviousSceneText(sceneId, beatId);
      if (textBeforeBeat?.trim()) {
        sceneContent = textBeforeBeat;
      }
    }

    if (!sceneContent?.trim()) {
      return { success: false, error: 'No content before this beat to generate staging notes from.' };
    }

    const settings = this.settingsService.getSettings();
    const modelToUse = model || settings.stagingNotesGeneration.selectedModel || settings.selectedModel;
    if (!modelToUse) {
      return { success: false, error: 'No AI model configured.' };
    }

    if (!this.aiProviderValidation.hasAnyProviderConfigured(settings)) {
      return { success: false, error: this.aiProviderValidation.getNoProviderConfiguredMessage() };
    }

    // Mark as generating
    this.generatingStagingNotes.update(set => new Set(set).add(sceneId));

    // Create cancel subject for this generation
    const cancelSubject = new Subject<void>();
    this.cancelSubjects.set(sceneId, cancelSubject);

    try {
      // Clean content
      let cleanedContent = this.removeEmbeddedImages(sceneContent);
      cleanedContent = this.promptManager.extractPlainTextFromHtml(cleanedContent);

      if (cleanedContent.length > SceneAIGenerationService.MAX_CONTENT_LENGTH_STAGING_NOTES) {
        cleanedContent = cleanedContent.slice(0, SceneAIGenerationService.MAX_CONTENT_LENGTH_STAGING_NOTES);
      }

      // Get language instruction
      const languageInstruction = this.getLanguageInstruction(storyLanguage);

      // Build prompt
      const prompt = await this.buildStagingNotesPrompt({
        sceneContent: cleanedContent,
        languageInstruction,
        settings,
        protagonistName
      });

      // Get provider and model
      const { actualModelId, useGemini, useOpenRouter } = this.resolveProvider(modelToUse, settings);

      if (!useGemini && !useOpenRouter) {
        return { success: false, error: 'No available AI provider configured.' };
      }

      // Generate
      const temperature = settings.stagingNotesGeneration.temperature;
      const result = await this.executeGeneration({
        prompt,
        provider: useGemini ? 'gemini' : 'openrouter',
        modelId: actualModelId,
        maxTokens: 2000,
        temperature,
        sceneId,
        cancelSubject
      });

      return result;
    } finally {
      this.generatingStagingNotes.update(set => {
        const newSet = new Set(set);
        newSet.delete(sceneId);
        return newSet;
      });
      this.cancelSubjects.delete(sceneId);
    }
  }

  private async buildStagingNotesPrompt(options: {
    sceneContent: string;
    languageInstruction: string;
    settings: ReturnType<SettingsService['getSettings']>;
    protagonistName?: string;
  }): Promise<string> {
    const { sceneContent, languageInstruction, settings, protagonistName } = options;
    const stagingSettings = settings.stagingNotesGeneration;

    const customInstructionRaw = stagingSettings.customInstruction ?? '';
    const customInstructionXml = customInstructionRaw.trim()
      ? `    <customInstruction>${this.escapeXml(customInstructionRaw)}</customInstruction>`
      : '';

    const protagonistInstruction = protagonistName
      ? `The protagonist/narrator is named: ${protagonistName}`
      : '';

    if (stagingSettings.useCustomPrompt && stagingSettings.customPrompt) {
      return stagingSettings.customPrompt
        .replace(/{sceneContent}/g, sceneContent)
        .replace(/{languageInstruction}/g, languageInstruction)
        .replace(/{customInstruction}/g, customInstructionXml)
        .replace(/{protagonistName}/g, protagonistInstruction);
    }

    // Use default template
    const template = await this.promptTemplateService.getStagingNotesTemplate();
    return template
      .replace(/\{sceneContent\}/g, sceneContent)
      .replace(/\{languageInstruction\}/g, `<languageRequirement>${this.escapeXml(languageInstruction)}</languageRequirement>`)
      .replace(/\{customInstruction\}/g, customInstructionXml)
      .replace(/\{protagonistName\}/g, protagonistInstruction);
  }

  private async buildSummaryPrompt(options: {
    sceneTitle: string;
    sceneContent: string;
    truncated: boolean;
    languageInstruction: string;
    wordCountInstruction: string;
    minimumSummaryWords: number;
    codexEntriesRaw: string;
    settings: ReturnType<SettingsService['getSettings']>;
  }): Promise<string> {
    const {
      sceneTitle, sceneContent, truncated, languageInstruction,
      wordCountInstruction, minimumSummaryWords, codexEntriesRaw, settings
    } = options;

    const truncatedNote = truncated ? '\n\n[Note: Content was truncated as it was too long]' : '';
    const customInstructionRaw = settings.sceneSummaryGeneration.customInstruction ?? '';
    const customInstructionPresent = customInstructionRaw.trim().length > 0;
    const additionalInstructionsXml = customInstructionPresent
      ? `      <customInstruction>${this.escapeXml(customInstructionRaw)}</customInstruction>`
      : '';

    const codexEntriesForTemplate = codexEntriesRaw
      ? this.indentXmlBlock(codexEntriesRaw, '      ')
      : '';
    const codexEntriesForCustomPrompt = codexEntriesRaw || '';
    const languageInstructionXml = `<languageRequirement>${this.escapeXml(languageInstruction)}</languageRequirement>`;
    const lengthRequirementXml = `<lengthRequirement>${this.escapeXml(wordCountInstruction)}</lengthRequirement>`;
    const redundancyNote = 'Do not repeat information already captured in the codex context.';

    if (settings.sceneSummaryGeneration.useCustomPrompt) {
      let prompt = settings.sceneSummaryGeneration.customPrompt
        .replace(/{sceneTitle}/g, sceneTitle || 'Untitled')
        .replace(/{sceneContent}/g, sceneContent + truncatedNote)
        .replace(/{customInstruction}/g, customInstructionRaw)
        .replace(/{customInstructionXml}/g, additionalInstructionsXml.trim())
        .replace(/{languageInstructionXml}/g, languageInstructionXml)
        .replace(/{languageInstruction}/g, languageInstruction)
        .replace(/{summaryWordCount}/g, minimumSummaryWords.toString())
        .replace(/{lengthRequirement}/g, wordCountInstruction)
        .replace(/{codexEntries}/g, codexEntriesForCustomPrompt);

      if (!prompt.includes(languageInstruction)) prompt += `\n\n${languageInstruction}`;
      if (!prompt.includes(redundancyNote)) prompt += `\n\n${redundancyNote}`;
      if (!prompt.includes(wordCountInstruction)) prompt += `\n\n${wordCountInstruction}`;

      return prompt;
    }

    // Use default template
    const template = await this.promptTemplateService.getSceneSummaryTemplate();
    return template
      .replace(/\{sceneTitle\}/g, this.escapeXml(sceneTitle || 'Untitled'))
      .replace(/\{sceneContent\}/g, sceneContent)
      .replace(/\{truncatedNote\}/g, truncatedNote)
      .replace(/\{codexEntries\}/g, codexEntriesForTemplate)
      .replace(/\{languageInstruction\}/g, languageInstructionXml)
      .replace(/\{lengthRequirement\}/g, lengthRequirementXml)
      .replace(/\{additionalInstructions\}/g, additionalInstructionsXml)
      .replace(/\{summaryWordCount\}/g, minimumSummaryWords.toString());
  }

  private buildTitlePrompt(
    sceneContent: string,
    titleSettings: ReturnType<SettingsService['getSettings']>['sceneTitleGeneration']
  ): string {
    let styleInstruction = '';
    switch (titleSettings.style) {
      case 'descriptive': styleInstruction = 'The title should be descriptive and atmospheric.'; break;
      case 'action': styleInstruction = 'The title should be action-packed and dynamic.'; break;
      case 'emotional': styleInstruction = 'The title should reflect the emotional mood of the scene.'; break;
      case 'concise': default: styleInstruction = 'The title should be concise and impactful.'; break;
    }

    const languageInstruction = titleSettings.language === 'english' ? 'Respond in English.' : 'Respond in German.';
    const genreInstruction = titleSettings.includeGenre ? 'Consider the genre of the story when choosing the title.' : '';
    const customInstruction = titleSettings.customInstruction ? `\n${titleSettings.customInstruction}` : '';

    if (titleSettings.useCustomPrompt && titleSettings.customPrompt) {
      return titleSettings.customPrompt
        .replace('{maxWords}', titleSettings.maxWords.toString())
        .replace('{styleInstruction}', styleInstruction)
        .replace('{genreInstruction}', genreInstruction)
        .replace('{languageInstruction}', languageInstruction)
        .replace('{customInstruction}', customInstruction)
        .replace('{sceneContent}', sceneContent);
    }

    return `Create a title for the following scene. The title should be up to ${titleSettings.maxWords} words \n` +
      `${styleInstruction}\n${genreInstruction}\n${languageInstruction}${customInstruction}\n\n` +
      `Scene content (only this one scene):\n${sceneContent}\n\n` +
      `Respond only with the title, without further explanations or quotation marks.`;
  }

  private async executeGeneration(options: {
    prompt: string;
    provider: 'openrouter' | 'gemini';
    modelId: string;
    maxTokens: number;
    temperature: number;
    sceneId: string;
    cancelSubject: Subject<void>;
  }): Promise<GenerationResult> {
    const { prompt, provider, modelId, maxTokens, temperature, cancelSubject } = options;

    return new Promise<GenerationResult>((resolve) => {
      if (provider === 'gemini') {
        const subscription = this.geminiApi.generateText(prompt, {
          model: modelId,
          maxTokens,
          temperature
        }).pipe(
          timeout({ first: SceneAIGenerationService.GENERATION_TIMEOUT_MS }),
          takeUntil(cancelSubject),
          map(response => {
            const text = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
            return { success: true as const, text };
          }),
          catchError((error: unknown) => {
            const err = error as { name?: string };
            const errorMessage = err?.name === 'TimeoutError'
              ? 'Generation is taking too long. Please try again.'
              : this.describeGeminiError(error);
            return of({ success: false as const, error: errorMessage });
          })
        ).subscribe({
          next: (result) => resolve(result),
          error: (error: unknown) => {
            resolve({ success: false, error: this.describeGeminiError(error) });
          }
        });
        this.subscription.add(subscription);
      } else {
        const subscription = this.openRouterApi.generateText(prompt, {
          model: modelId,
          maxTokens,
          temperature
        }).pipe(
          timeout({ first: SceneAIGenerationService.GENERATION_TIMEOUT_MS }),
          takeUntil(cancelSubject),
          map(response => {
            let text = response.choices?.[0]?.message?.content?.trim() || '';
            if (response.choices?.[0]?.finish_reason === 'length') {
              text += ' [Text was truncated due to token limit]';
            }
            return { success: true as const, text };
          }),
          catchError((error: unknown) => {
            const err = error as { name?: string };
            const errorMessage = err?.name === 'TimeoutError'
              ? 'Generation is taking too long. Please try again.'
              : this.describeOpenRouterError(error);
            return of({ success: false as const, error: errorMessage });
          })
        ).subscribe({
          next: (result) => resolve(result),
          error: (error: unknown) => {
            resolve({ success: false, error: this.describeOpenRouterError(error) });
          }
        });
        this.subscription.add(subscription);
      }
    });
  }

  private resolveProvider(modelToUse: string, settings: ReturnType<SettingsService['getSettings']>): {
    provider: string;
    actualModelId: string;
    useGemini: boolean;
    useOpenRouter: boolean;
  } {
    const openRouterAvailable = this.aiProviderValidation.isProviderAvailable('openrouter', settings);
    const geminiAvailable = this.aiProviderValidation.isProviderAvailable('gemini', settings);

    const [provider, ...parts] = modelToUse.split(':');
    let actualModelId = parts.join(':');

    const useGemini = (provider === 'gemini' && geminiAvailable) ||
      (provider !== 'gemini' && provider !== 'openrouter' && geminiAvailable && !openRouterAvailable);
    const useOpenRouter = (provider === 'openrouter' && openRouterAvailable) ||
      (provider !== 'gemini' && provider !== 'openrouter' && openRouterAvailable);

    if (provider !== 'gemini' && provider !== 'openrouter') {
      actualModelId = modelToUse;
    }

    return { provider, actualModelId, useGemini, useOpenRouter };
  }

  private getLanguageInstruction(storyLanguage: string): string {
    switch (storyLanguage) {
      case 'de': return 'Antworte auf Deutsch.';
      case 'fr': return 'Réponds en français.';
      case 'es': return 'Responde en español.';
      case 'en': return 'Respond in English.';
      default: return 'Write the summary in the same language as the scene content.';
    }
  }

  private calculateSummaryMinimumWords(sceneWordCount: number): number {
    const baseMinimum = 120;
    if (sceneWordCount <= 2000) return baseMinimum;
    const extraWords = sceneWordCount - 2000;
    const increments = Math.ceil(extraWords / 500);
    return baseMinimum + increments * 25;
  }

  private removeEmbeddedImages(content: string): string {
    let cleaned = content.replace(/<img[^>]*src="data:image\/[^"]*"[^>]*>/gi, '[Image removed]');
    cleaned = cleaned.replace(/!\[[^\]]*\]\(data:image\/[^)]*\)/gi, '[Image removed]');
    cleaned = cleaned.replace(/data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/]{1000,}={0,2}/g, '[Image data removed]');
    return cleaned;
  }

  private indentXmlBlock(xml: string, indentation = '    '): string {
    if (!xml) return '';
    return xml
      .split('\n')
      .map(line => line ? `${indentation}${line}` : line)
      .join('\n');
  }

  private escapeXml(value: string | unknown): string {
    const str = String(value ?? '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private describeOpenRouterError(error: unknown): string {
    const err = (error || {}) as { status?: number; message?: string };
    if (!error) return 'Error generating text.';
    if (err.status === 400) return 'Invalid request. Please check your API settings.';
    if (err.status === 401) return 'Invalid API key. Please check your OpenRouter API key in settings.';
    if (err.status === 403) return 'Access denied. Your API key may not have the required permissions.';
    if (err.status === 429) return 'Rate limit reached. Please wait a moment and try again.';
    if (err.status === 500) return 'OpenRouter server error. Please try again later.';
    if (err.message?.includes('nicht aktiviert')) return err.message;
    return 'Error generating text.';
  }

  private describeGeminiError(error: unknown): string {
    const err = (error || {}) as { status?: number; message?: string };
    if (!error) return 'Error generating text.';
    if (err.status === 400) return 'Invalid request. Please check your API settings.';
    if (err.status === 401) return 'Invalid API key. Please check your Google Gemini API key in settings.';
    if (err.status === 403) return 'Access denied. Your API key may not have the required permissions.';
    if (err.status === 429) return 'Rate limit reached. Please wait a moment and try again.';
    if (err.status === 500) return 'Gemini server error. Please try again later.';
    if (err.message?.includes('nicht aktiviert')) return err.message;
    return 'Error generating text.';
  }
}
