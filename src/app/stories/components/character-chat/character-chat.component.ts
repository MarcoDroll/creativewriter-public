/**
 * Character Chat Component - Public Version
 *
 * This version checks subscription status and loads the premium module
 * from the backend for premium subscribers.
 *
 * During public sync, this file replaces character-chat.component.ts
 */
import { Component, OnInit, OnDestroy, ViewChild, ElementRef, TemplateRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { Subscription, firstValueFrom } from 'rxjs';
import {
  IonContent, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon,
  IonFooter, IonTextarea, IonAvatar, IonChip, IonLabel, IonSpinner,
  IonModal, IonList, IonItem
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  arrowBack, send, personCircle, chatbubbles, copy, refresh,
  close, helpCircle, timeOutline, chevronForward,
  createOutline, refreshOutline, checkmarkOutline, closeOutline, personOutline, copyOutline,
  lockClosed, sparkles, stopCircle, shieldCheckmark
} from 'ionicons/icons';
import { ModelSelectorComponent } from '../../../shared/components/model-selector/model-selector.component';

import { StoryService } from '../../services/story.service';
import { CodexService } from '../../services/codex.service';
import { SubscriptionService } from '../../../core/services/subscription.service';
import { PremiumAccessService } from '../../../core/services/premium-access.service';
import { CharacterChatHistoryService } from '../../services/character-chat-history.service';
import { CharacterChatHistoryDoc } from '../../models/chat-history.interface';
import {
  PremiumModuleService,
  CharacterInfo,
  KnowledgeCutoff,
  StoryContext,
  CharacterChatServiceInterface
} from '../../../core/services/premium-module.service';
import { OpenRouterApiService } from '../../../core/services/openrouter-api.service';
import { GoogleGeminiApiService } from '../../../core/services/google-gemini-api.service';
import { SettingsService } from '../../../core/services/settings.service';
import { Story } from '../../models/story.interface';
import { CodexEntry, Codex } from '../../models/codex.interface';
import { AppHeaderComponent, HeaderAction } from '../../../ui/components/app-header.component';
import { DialogService } from '../../../core/services/dialog.service';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

/**
 * AI Service Adapter - bridges the remote module with local AI services
 * This adapter wraps OpenRouter/Gemini services for use by the premium module
 */
interface AIServiceAdapter {
  generateChatResponse(
    messages: { role: string; content: string }[],
    modelId: string
  ): Promise<string>;
}

@Component({
  selector: 'app-character-chat',
  standalone: true,
  imports: [
    CommonModule, FormsModule, RouterModule,
    IonContent, IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, IonIcon,
    IonFooter, IonTextarea, IonAvatar, IonChip, IonLabel, IonSpinner,
    IonModal, IonList, IonItem,
    AppHeaderComponent,
    ModelSelectorComponent
  ],
  templateUrl: './character-chat.component.html',
  styleUrls: ['./character-chat.component.scss']
})
export class CharacterChatComponent implements OnInit, OnDestroy {
  @ViewChild('scrollContainer') scrollContainer!: ElementRef;
  @ViewChild('messageInput') messageInput!: ElementRef;
  @ViewChild('modelToolbar', { read: TemplateRef }) modelToolbar!: TemplateRef<unknown>;

  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private storyService = inject(StoryService);
  private codexService = inject(CodexService);
  private subscriptionService = inject(SubscriptionService);
  private premiumAccessService = inject(PremiumAccessService);
  private premiumModuleService = inject(PremiumModuleService);
  private openRouterService = inject(OpenRouterApiService);
  private geminiService = inject(GoogleGeminiApiService);
  private settingsService = inject(SettingsService);
  private characterChatHistoryService = inject(CharacterChatHistoryService);
  private dialogService = inject(DialogService);

  // State
  story: Story | null = null;
  private storyId: string | null = null;
  codex: Codex | null = null;
  characters: CodexEntry[] = [];
  selectedCharacter: CodexEntry | null = null;
  messages: ConversationMessage[] = [];
  currentMessage = '';
  isGenerating = false;
  isPremium = false;
  isPremiumChecking = true; // Start with loading state
  needsVerification = false; // Premium but needs auth token verification
  isModuleLoading = false;
  moduleError: string | null = null;

  // Premium module service instance
  private chatService: CharacterChatServiceInterface | null = null;

  // Knowledge cutoff
  knowledgeCutoff: KnowledgeCutoff | null = null;
  showKnowledgeModal = false;

  // Model selection
  selectedModel = '';

  // Quick picks from story settings
  get quickPickIds(): string[] {
    return this.story?.settings?.favoriteModelLists?.characterChat || [];
  }

  // Suggested starters
  suggestedStarters: string[] = [];

  // Persistence state
  private activeHistoryId: string | null = null;
  showHistoryList = false;
  histories: CharacterChatHistoryDoc[] = [];

  // Edit message state
  editingMessageIndex: number | null = null;
  editingContent = '';

  // Header actions - initialized in constructor
  headerActions: HeaderAction[] = [];

  private subscriptions = new Subscription();

  // Streaming state (minimal for template compatibility - public version doesn't use streaming)
  streamingContent = '';

  constructor() {
    addIcons({
      arrowBack, send, personCircle, chatbubbles, copy, refresh,
      close, helpCircle, timeOutline, chevronForward,
      createOutline, refreshOutline, checkmarkOutline, closeOutline, personOutline, copyOutline,
      lockClosed, sparkles, stopCircle, shieldCheckmark
    });
    this.initializeHeaderActions();
  }

  private initializeHeaderActions(): void {
    this.headerActions = [
      { icon: 'time-outline', action: () => this.openHistoryList(), tooltip: 'Chat History', showOnDesktop: true, showOnMobile: true },
      { icon: 'refresh', action: () => this.startNewChat(), tooltip: 'New Chat', showOnDesktop: true, showOnMobile: true },
      { icon: 'help-circle', action: () => this.showHelp(), tooltip: 'Help', showOnDesktop: true, showOnMobile: true }
    ];
  }

  async ngOnInit(): Promise<void> {
    // FIRST: Actively verify premium access (including auth token) and WAIT for result
    // This ensures premium users see the chat immediately without race conditions
    this.isPremiumChecking = true;
    const accessResult = await this.premiumAccessService.checkAccess();
    console.log('[CharacterChat] Initial premium access check:', accessResult);
    this.isPremium = accessResult.hasAccess;
    this.needsVerification = accessResult.reason === 'verification_needed';
    this.isPremiumChecking = false; // Done checking
    if (accessResult.hasAccess) {
      this.loadPremiumModule();
    }

    // THEN subscribe for any future changes (after initial value is set)
    this.subscriptions.add(
      this.subscriptionService.isPremiumObservable.subscribe(async newPremiumStatus => {
        console.log('[CharacterChat] isPremium observable changed:', newPremiumStatus);
        // Re-check access when subscription status changes
        const result = await this.premiumAccessService.checkAccess();
        const newHasAccess = result.hasAccess;
        if (this.isPremium !== newHasAccess) {
          this.isPremium = newHasAccess;
          this.needsVerification = result.reason === 'verification_needed';
          if (newHasAccess) {
            this.loadPremiumModule();
          }
        }
      })
    );

    // Load module status
    this.subscriptions.add(
      this.premiumModuleService.isLoading.subscribe(loading => {
        this.isModuleLoading = loading;
      })
    );

    this.subscriptions.add(
      this.premiumModuleService.loadError.subscribe(error => {
        this.moduleError = error;
      })
    );

    // Load story and codex
    this.loadStoryData();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  private async loadStoryData(): Promise<void> {
    this.storyId = this.route.snapshot.paramMap.get('storyId');
    if (!this.storyId) {
      this.router.navigate(['/']);
      return;
    }

    try {
      this.story = await this.storyService.getStory(this.storyId);
      if (!this.story) {
        this.router.navigate(['/']);
        return;
      }

      // Load codex and extract characters
      this.codex = await this.codexService.getOrCreateCodex(this.storyId);
      if (this.codex) {
        const charactersCategory = this.codex.categories.find(
          c => c.title.toLowerCase() === 'characters'
        );
        if (charactersCategory) {
          this.characters = charactersCategory.entries;
        }
      }

      // Check for character ID in route
      const characterId = this.route.snapshot.paramMap.get('characterId');
      if (characterId) {
        this.selectedCharacter = this.characters.find(c => c.id === characterId) || null;
        if (this.selectedCharacter) {
          this.updateSuggestedStarters();
        }
      }
    } catch (error) {
      console.error('Failed to load story data:', error);
    }
  }

  async loadPremiumModule(): Promise<void> {
    // Always try to load/get the module - it returns cached version if already loaded
    const module = await this.premiumModuleService.loadCharacterChatModule();
    if (module && !this.chatService) {
      // Create AI adapter that bridges to local AI services
      const aiAdapter = this.createAIAdapter();
      // Instantiate the CharacterChatService from the loaded module
      this.chatService = new module.CharacterChatService(aiAdapter);
    }
  }

  /**
   * Creates an AI service adapter that bridges the remote module
   * to the local OpenRouter/Gemini services
   */
  private createAIAdapter(): AIServiceAdapter {
    return {
      generateChatResponse: async (
        messages: { role: string; content: string }[],
        modelId: string
      ): Promise<string> => {
        const settings = this.settingsService.getSettings();

        // Determine which AI service to use based on model ID
        const isGemini = modelId.startsWith('gemini:') || modelId.includes('gemini');

        // Convert messages to the format expected by the services
        const formattedMessages = messages.map(m => ({
          role: m.role as 'system' | 'user' | 'assistant',
          content: m.content
        }));

        // Extract model name from ID (format: "provider:model")
        const modelName = modelId.includes(':') ? modelId.split(':')[1] : modelId;

        // AI services handle their own logging - just call the appropriate service
        if (isGemini && settings.googleGemini?.enabled) {
          const response = await firstValueFrom(
            this.geminiService.generateText('', {
              model: modelName,
              messages: formattedMessages,
              maxTokens: 2000
            })
          );
          return response.candidates?.[0]?.content?.parts?.[0]?.text || '';
        } else if (settings.openRouter?.enabled) {
          const response = await firstValueFrom(
            this.openRouterService.generateText('', {
              model: modelName,
              messages: formattedMessages,
              maxTokens: 2000
            })
          );
          return response.choices?.[0]?.message?.content || '';
        } else {
          throw new Error('No AI service configured. Please enable OpenRouter or Gemini in settings.');
        }
      }
    };
  }

  selectCharacter(character: CodexEntry): void {
    this.selectedCharacter = character;
    this.messages = [];
    this.activeHistoryId = null;
    this.updateSuggestedStarters();

    // Restore latest history for this character
    if (this.storyId && character.id) {
      this.restoreLatestHistory(this.storyId, character.id).catch(() => void 0);
    }
  }

  private updateSuggestedStarters(): void {
    if (!this.selectedCharacter) {
      this.suggestedStarters = [];
      return;
    }

    const language = this.story?.settings?.language || 'en';

    // Use the premium module for suggested starters if available
    if (this.chatService) {
      const characterInfo = this.buildCharacterInfo(this.selectedCharacter);
      this.suggestedStarters = this.chatService.getSuggestedStarters(characterInfo, language);
    } else {
      // Fallback: simple starters (no secret logic exposed) - language-aware
      const name = this.selectedCharacter.title;
      const fallbackStarters: Record<string, string[]> = {
        en: [`Hello, ${name}.`, "What's on your mind?"],
        de: [`Hallo, ${name}.`, 'Was beschäftigt dich?'],
        fr: [`Bonjour, ${name}.`, "Qu'as-tu en tête?"],
        es: [`Hola, ${name}.`, '¿Qué tienes en mente?']
      };
      this.suggestedStarters = fallbackStarters[language] || fallbackStarters['en'];
    }
  }

  useStarter(starter: string): void {
    this.currentMessage = starter;
    this.sendMessage();
  }

  async sendMessage(): Promise<void> {
    if (!this.currentMessage.trim() || !this.selectedCharacter || this.isGenerating) {
      return;
    }

    if (!this.isPremium) {
      this.moduleError = 'Premium subscription required for Character Chat';
      return;
    }

    if (!this.chatService) {
      this.moduleError = 'Premium module not loaded. Please try again.';
      return;
    }

    const userMessage = this.currentMessage.trim();
    this.currentMessage = '';

    // Add user message
    this.messages.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date()
    });

    this.scrollToBottom();
    this.isGenerating = true;

    try {
      // Build inputs for the premium module
      const characterInfo = this.buildCharacterInfo(this.selectedCharacter);
      const storyContext = this.buildStoryContext();
      const conversationHistory = this.messages.slice(0, -1).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }));

      // Use the premium module's chat method
      const response = await this.chatService.chat(
        characterInfo,
        userMessage,
        conversationHistory,
        storyContext,
        this.knowledgeCutoff || undefined,
        this.selectedModel
      );

      // Add assistant response
      this.messages.push({
        role: 'assistant',
        content: response,
        timestamp: new Date()
      });

      this.scrollToBottom();

      // Persist snapshot of conversation
      this.saveHistorySnapshot().catch(() => void 0);

    } catch (error) {
      console.error('Chat error:', error);
      this.messages.push({
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date()
      });
    } finally {
      this.isGenerating = false;
    }
  }

  /**
   * Build character info from codex entry
   * Note: This only extracts data - the actual prompt construction
   * happens in the premium module on the server
   */
  private buildCharacterInfo(entry: CodexEntry): CharacterInfo {
    return {
      name: entry.title,
      description: entry.content || undefined,
      notes: entry.tags?.join(', ')
    };
  }

  /**
   * Build story context from current story
   * Includes all scene summaries for comprehensive character knowledge
   * Note: This only extracts data - the actual context processing
   * happens in the premium module on the server
   */
  private buildStoryContext(): StoryContext {
    if (!this.story) return {};

    // Build a comprehensive summary from all scene summaries
    const summaryParts: string[] = [];

    const chapters = this.story.chapters?.map(ch => {
      // Collect all scene summaries for this chapter
      const sceneSummaries = ch.scenes?.map(s => ({
        title: s.title,
        summary: s.summary,
        order: s.order
      })) || [];

      // Build chapter summary from scene summaries
      const chapterSummary = sceneSummaries
        .filter(s => s.summary)
        .map(s => s.summary)
        .join(' ');

      if (chapterSummary) {
        summaryParts.push(`Chapter ${ch.chapterNumber || ch.order}: ${ch.title}\n${chapterSummary}`);
      }

      return {
        title: ch.title,
        summary: chapterSummary,
        order: ch.order,
        scenes: sceneSummaries
      };
    });

    return {
      summary: summaryParts.join('\n\n'),
      chapters
    };
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      if (this.scrollContainer?.nativeElement) {
        this.scrollContainer.nativeElement.scrollTop =
          this.scrollContainer.nativeElement.scrollHeight;
      }
    }, 100);
  }

  // Knowledge cutoff settings
  openKnowledgeSettings(): void {
    this.showKnowledgeModal = true;
  }

  setKnowledgeCutoff(chapterOrder: number, sceneOrder?: number): void {
    this.knowledgeCutoff = { chapterOrder, sceneOrder };
    this.showKnowledgeModal = false;
  }

  clearKnowledgeCutoff(): void {
    this.knowledgeCutoff = null;
    this.showKnowledgeModal = false;
  }

  // Utility methods
  goBack(): void {
    // Use storyId from route as fallback to ensure correct navigation
    const targetId = this.story?.id || this.storyId;
    if (targetId) {
      this.router.navigate(['/stories/editor', targetId]);
    } else {
      this.router.navigate(['/']);
    }
  }

  showHelp(): void {
    this.dialogService.showInfo({ header: 'Character Chat Help', message: 'Character Chat lets you have conversations with characters from your story. Select a character to begin chatting. You can set a knowledge cutoff to limit what the character knows about the story.' });
  }

  copyMessage(content: string): void {
    navigator.clipboard.writeText(content);
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  onEnterKey(event: KeyboardEvent): void {
    if (!event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  // History management methods
  private async restoreLatestHistory(storyId: string, characterId: string): Promise<void> {
    const latest = await this.characterChatHistoryService.getLatestForCharacter(storyId, characterId);
    if (!latest) return;
    this.applyHistory(latest);
  }

  private async saveHistorySnapshot(): Promise<void> {
    if (!this.storyId || !this.selectedCharacter) return;

    // Skip if only empty or no real messages
    const hasRealMessages = this.messages.some(m => m.role === 'user');
    if (!hasRealMessages) return;

    const saved = await this.characterChatHistoryService.saveSnapshot({
      storyId: this.storyId,
      characterId: this.selectedCharacter.id,
      characterName: this.selectedCharacter.title,
      messages: this.messages,
      selectedModel: this.selectedModel || undefined,
      knowledgeCutoff: this.knowledgeCutoff || undefined,
      historyId: this.activeHistoryId
    });
    this.activeHistoryId = saved.historyId;
  }

  async openHistoryList(): Promise<void> {
    if (!this.storyId || !this.selectedCharacter) return;
    try {
      this.histories = await this.characterChatHistoryService.listHistoriesForCharacter(
        this.storyId,
        this.selectedCharacter.id
      );
      this.showHistoryList = true;
    } catch (e) {
      console.error('Failed to load histories', e);
    }
  }

  async selectHistory(history: CharacterChatHistoryDoc): Promise<void> {
    this.applyHistory(history);
    this.showHistoryList = false;
  }

  private applyHistory(history: CharacterChatHistoryDoc): void {
    // Replace current chat with stored one
    this.messages = (history.messages || []).map(m => ({
      ...m,
      timestamp: new Date(m.timestamp)
    }));
    if (history.selectedModel) {
      this.selectedModel = history.selectedModel;
    }
    if (history.knowledgeCutoff) {
      this.knowledgeCutoff = history.knowledgeCutoff;
    }
    this.activeHistoryId = history.historyId;
    this.scrollToBottom();
  }

  startNewChat(): void {
    if (!this.selectedCharacter) return;

    // Clear messages and reset state
    this.messages = [];
    this.activeHistoryId = null;
    this.updateSuggestedStarters();
    this.scrollToBottom();
  }

  getHistoryTitle(h: CharacterChatHistoryDoc): string {
    if (h.title && h.title.trim()) return h.title;
    const firstUser = (h.messages || []).find(m => m.role === 'user');
    const base = firstUser ? firstUser.content.trim().slice(0, 60) : '';
    return base ? `${base}${(firstUser!.content.length > 60 ? '…' : '')}` : `Chat ${new Date(h.updatedAt).toLocaleString()}`;
  }

  getHistoryMeta(h: CharacterChatHistoryDoc): string {
    const count = (h.messages || []).length;
    const when = new Date(h.updatedAt).toLocaleString();
    return `${count} messages · ${when}`;
  }

  closeHistoryList(): void {
    this.showHistoryList = false;
  }

  // Edit and Retry functionality

  /**
   * Check if the message at the given index is the last assistant message
   */
  isLastAssistantMessage(index: number): boolean {
    if (this.messages[index]?.role !== 'assistant') return false;
    // Find the last assistant message index
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant') {
        return i === index;
      }
    }
    return false;
  }

  /**
   * Retry the last assistant message by removing it and regenerating
   */
  async retryLastMessage(): Promise<void> {
    if (this.isGenerating || this.messages.length === 0) return;

    // Find the last assistant message
    let lastAssistantIndex = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'assistant') {
        lastAssistantIndex = i;
        break;
      }
    }

    if (lastAssistantIndex === -1) return;

    // Find the user message that triggered this response
    let userMessageIndex = -1;
    for (let i = lastAssistantIndex - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        userMessageIndex = i;
        break;
      }
    }

    if (userMessageIndex === -1) return;

    // Remove the assistant message
    this.messages.splice(lastAssistantIndex, 1);

    // Get the user message content and regenerate
    const userMessage = this.messages[userMessageIndex].content;

    this.scrollToBottom();
    this.isGenerating = true;

    try {
      if (!this.chatService || !this.selectedCharacter) {
        throw new Error('Chat service not available');
      }

      const characterInfo = this.buildCharacterInfo(this.selectedCharacter);
      const storyContext = this.buildStoryContext();
      const conversationHistory = this.messages.slice(0, userMessageIndex).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }));

      const response = await this.chatService.chat(
        characterInfo,
        userMessage,
        conversationHistory,
        storyContext,
        this.knowledgeCutoff || undefined,
        this.selectedModel
      );

      this.messages.push({
        role: 'assistant',
        content: response,
        timestamp: new Date()
      });

      this.scrollToBottom();
      this.saveHistorySnapshot().catch(() => void 0);

    } catch (error) {
      console.error('Retry error:', error);
      this.messages.push({
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date()
      });
    } finally {
      this.isGenerating = false;
    }
  }

  /**
   * Start editing a user message
   */
  startEditMessage(index: number): void {
    if (this.messages[index]?.role !== 'user' || this.isGenerating) return;
    this.editingMessageIndex = index;
    this.editingContent = this.messages[index].content;
  }

  /**
   * Cancel editing
   */
  cancelEditMessage(): void {
    this.editingMessageIndex = null;
    this.editingContent = '';
  }

  /**
   * Submit the edited message - removes all messages after this one and resends
   */
  async submitEditedMessage(): Promise<void> {
    if (this.editingMessageIndex === null || !this.editingContent.trim() || this.isGenerating) {
      return;
    }

    const editIndex = this.editingMessageIndex;
    const newContent = this.editingContent.trim();

    // Reset edit state
    this.editingMessageIndex = null;
    this.editingContent = '';

    // Update the message content
    this.messages[editIndex].content = newContent;
    this.messages[editIndex].timestamp = new Date();

    // Remove all messages after this one (reset chat to this point)
    this.messages.splice(editIndex + 1);

    this.scrollToBottom();
    this.isGenerating = true;

    try {
      if (!this.chatService || !this.selectedCharacter) {
        throw new Error('Chat service not available');
      }

      const characterInfo = this.buildCharacterInfo(this.selectedCharacter);
      const storyContext = this.buildStoryContext();
      const conversationHistory = this.messages.slice(0, editIndex).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }));

      const response = await this.chatService.chat(
        characterInfo,
        newContent,
        conversationHistory,
        storyContext,
        this.knowledgeCutoff || undefined,
        this.selectedModel
      );

      this.messages.push({
        role: 'assistant',
        content: response,
        timestamp: new Date()
      });

      this.scrollToBottom();
      this.saveHistorySnapshot().catch(() => void 0);

    } catch (error) {
      console.error('Edit message error:', error);
      this.messages.push({
        role: 'assistant',
        content: 'Sorry, I encountered an error. Please try again.',
        timestamp: new Date()
      });
    } finally {
      this.isGenerating = false;
    }
  }

  /**
   * Stop generation - stub for template compatibility (public version doesn't use streaming)
   */
  stopGeneration(): void {
    this.isGenerating = false;
  }

  // ============================================
  // trackBy functions for mobile performance
  // ============================================
  trackByCharacterId(index: number, character: CodexEntry): string {
    return character.id;
  }

  trackByStarterText(index: number, starter: string): string {
    return starter;
  }

  trackByMessageIndex(index: number, _message: ConversationMessage): number {
    return index;
  }

  trackByChapterId(index: number, chapter: { id: string }): string {
    return chapter.id;
  }

  trackByHistoryId(index: number, history: CharacterChatHistoryDoc): string {
    return history._id;
  }
}
