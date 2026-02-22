import { Component, OnInit, ViewChild, ElementRef, OnDestroy, TemplateRef, inject, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { 
  IonContent, IonFooter, IonItem, IonLabel, IonTextarea, IonList,
  IonChip, IonAvatar, IonSearchbar, IonModal, IonCheckbox, IonItemDivider,
  IonButton, IonIcon, IonButtons, IonToolbar, IonTitle, IonHeader, IonSpinner
} from '@ionic/angular/standalone';
import { AlertController } from '@ionic/angular';
import { AppHeaderComponent, HeaderAction } from '../../../ui/components/app-header.component';
import { addIcons } from 'ionicons';
import {
  arrowBack, sendOutline, peopleOutline, documentTextOutline,
  addOutline, checkmarkOutline, closeOutline, sparklesOutline,
  personOutline, locationOutline, cubeOutline, readerOutline, libraryOutline,
  copyOutline, logoGoogle, globeOutline, chatbubbleOutline, gitNetworkOutline, cloudUploadOutline, hardwareChip,
  refreshOutline, createOutline, timeOutline, stopCircle
} from 'ionicons/icons';
import { StoryService } from '../../services/story.service';
import { SettingsService } from '../../../core/services/settings.service';
import { BeatAIService } from '../../../shared/services/beat-ai.service';
import { PromptManagerService } from '../../../shared/services/prompt-manager.service';
import { CodexService } from '../../services/codex.service';
import { AIRequestLoggerService } from '../../../core/services/ai-request-logger.service';
import { ModelService } from '../../../core/services/model.service';
import { ChatHistoryService } from '../../services/chat-history.service';
import { AIProviderValidationService } from '../../../core/services/ai-provider-validation.service';
import { CodexContextService } from '../../../shared/services/codex-context.service';
import { ProviderIconComponent } from '../../../shared/components/provider-icon/provider-icon.component';
import { getProviderIcon as getIcon } from '../../../core/provider-icons';
import { Story, Scene, Chapter } from '../../models/story.interface';
import { ModelOption } from '../../../core/models/model.interface';
import { buildOpenRouterProviderPrefs } from '../../../core/models/settings.interface';
import { StoryRole } from '../../models/codex.interface';
import { Subscription, Observable, of, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { KeyboardService } from '../../../core/services/keyboard.service';
import { NgSelectModule } from '@ng-select/ng-select';
import { ChatHistoryDoc } from '../../models/chat-history.interface';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isPresetPrompt?: boolean;
  extractionType?: 'characters' | 'locations' | 'objects';
}

interface SceneContext {
  chapterId: string;
  sceneId: string;
  chapterTitle: string;
  sceneTitle: string;
  content: string;
  selected: boolean;
}

interface PresetPrompt {
  id: string;
  title: string;
  description: string;
  prompt: string;
  extractionType: 'characters' | 'locations' | 'objects';
  icon: string;
}

interface CodexEntryPreview {
  name: string;
  description: string;
  role?: StoryRole;
  tags: string[];
  fields: Record<string, string>;
  selected: boolean;
}

const CHARACTER_FIELD_ORDER: string[] = [
  'Description',
  'Physical Appearance',
  'Personality',
  'Backstory',
  'Relationships',
  'History with Protagonist',
  'Motivations & Goals',
  'Skills & Abilities',
  'Current Status',
  'Plot Hooks'
];

const LOCATION_FIELD_ORDER: string[] = [
  'Description',
  'Overview',
  'Sensory Details',
  'Key Features',
  'History & Lore',
  'Story Significance',
  'Mood & Atmosphere',
  'Notable Characters',
  'Plot Hooks'
];

const OBJECT_FIELD_ORDER: string[] = [
  'Description',
  'Physical Description',
  'Origin & Backstory',
  'Owner or Custodian',
  'Abilities & Properties',
  'Story Significance',
  'Current Status or Location',
  'Plot Hooks'
];

interface ParsedExtractionEntry {
  name: string;
  tags: string[];
  role?: StoryRole;
  fields: Record<string, string>;
  rawBlock: string;
}

@Component({
  selector: 'app-scene-chat',
  standalone: true,
  imports: [
    CommonModule, FormsModule, NgSelectModule, AppHeaderComponent,
    IonContent, IonFooter, IonItem, IonLabel, IonTextarea, IonList,
    IonChip, IonAvatar, IonSearchbar, IonModal, IonCheckbox, IonItemDivider,
    IonButton, IonIcon, IonButtons, IonToolbar, IonTitle, IonHeader, IonSpinner,
    ProviderIconComponent
  ],
  templateUrl: './scene-chat.component.html',
  styleUrls: ['./scene-chat.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SceneChatComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private storyService = inject(StoryService);
  private settingsService = inject(SettingsService);
  private beatAIService = inject(BeatAIService);
  private promptManager = inject(PromptManagerService);
  private codexService = inject(CodexService);
  private aiLogger = inject(AIRequestLoggerService);
  private modelService = inject(ModelService);
  private sanitizer = inject(DomSanitizer);
  private cdr = inject(ChangeDetectorRef);
  private readonly alertController = inject(AlertController);
  private chatHistoryService = inject(ChatHistoryService);
  private aiProviderValidation = inject(AIProviderValidationService);
  private keyboardService = inject(KeyboardService);
  private codexContextService = inject(CodexContextService);

  @ViewChild('scrollContainer') scrollContainer!: ElementRef;
  @ViewChild('messageInput') messageInput!: ElementRef;
  @ViewChild('modelToolbar', { read: TemplateRef }) modelToolbar!: TemplateRef<unknown>;

  story: Story | null = null;
  activeChapterId = '';
  activeSceneId = '';
  messages: ChatMessage[] = [];
  currentMessage = '';
  isGenerating = false;
  streamingContent = '';

  selectedScenes: SceneContext[] = [];
  showSceneSelector = false;
  sceneSearchTerm = '';
  
  showPresetPrompts = false;
  presetPrompts: PresetPrompt[] = [];
  
  includeStoryOutline = false;
  includeCodexContext = false;

  selectedModel = '';
  availableModels: ModelOption[] = [];
  
  headerActions: HeaderAction[] = [];
  
  private subscriptions = new Subscription();
  private abortController: AbortController | null = null;
  private chatSessionId = Date.now();
  
  // Editing state
  isEditing = false;
  private editingIndex = -1;
  private editingExtractionType?: 'characters' | 'locations' | 'objects';
  
  // Persistence state
  private activeHistoryId: string | null = null;
  showHistoryList = false;
  histories: ChatHistoryDoc[] = [];

  // Codex review modal state
  showCodexReviewModal = false;
  codexReviewEntries: CodexEntryPreview[] = [];
  codexReviewExtractionType: 'characters' | 'locations' | 'objects' | null = null;
  isSavingCodexEntries = false;
  codexReviewError = '';
  private customFieldIdCounter = 0;

  constructor() {
    addIcons({
      arrowBack, sendOutline, peopleOutline, documentTextOutline,
      addOutline, checkmarkOutline, closeOutline, sparklesOutline,
      personOutline, locationOutline, cubeOutline, readerOutline, libraryOutline,
      copyOutline, logoGoogle, globeOutline, chatbubbleOutline, gitNetworkOutline, cloudUploadOutline, hardwareChip,
      refreshOutline, createOutline, timeOutline, stopCircle
    });
    
    this.initializePresetPrompts();
    this.initializeHeaderActions();
  }

  editMessage(message: ChatMessage): void {
    if (this.isGenerating) return;
    const index = this.messages.indexOf(message);
    if (index === -1) return;

    this.isEditing = true;
    this.editingIndex = index;
    this.editingExtractionType = message.extractionType;
    this.currentMessage = message.content;
    this.scrollToBottom();
    setTimeout(() => {
      try {
        // IonTextarea exposes setFocus
        (this.messageInput as unknown as { setFocus?: () => void })?.setFocus?.();
      } catch {
        void 0;
      }
    }, 50);
    this.cdr.markForCheck();
  }

  cancelEdit(): void {
    if (this.isGenerating) return;
    this.isEditing = false;
    this.editingIndex = -1;
    this.editingExtractionType = undefined;
    this.currentMessage = '';

    // Trigger blur to close keyboard
    if (this.messageInput) {
      try {
        const ionTextarea = this.messageInput as unknown as {
          getInputElement?: () => Promise<HTMLTextAreaElement>
        };
        ionTextarea.getInputElement?.().then(el => el?.blur()).catch(() => void 0);
      } catch {
        void 0;
      }
    }

    this.cdr.markForCheck();
  }

  async resendMessage(message: ChatMessage): Promise<void> {
    if (this.isGenerating) return;
    const index = this.messages.indexOf(message);
    if (index === -1) return;

    // Remove all messages after the clicked one
    if (index < this.messages.length - 1) {
      this.messages.splice(index + 1);
      this.cdr.markForCheck();
    }

    const userMessage = message.content;
    const extractionType = message.extractionType;

    const contextText = await this.buildContextText(userMessage);
    const beatId = 'chat-' + Date.now();

    const languageInstruction = this.getLanguageInstruction();

    // Build prompt based on type
    let prompt = '';
    if (extractionType) {
      // Use the extraction prompt directly
      prompt = `${contextText}${userMessage}`;
      if (languageInstruction) {
        prompt += `\n\n${languageInstruction}`;
      }
    } else {
      // For normal chat, just add the user's question
      prompt = `${contextText}User Question: ${userMessage}\n\n`;
      if (languageInstruction) {
        prompt += `${languageInstruction}\n`;
      }
      prompt += 'Please answer helpfully and creatively based on the given context and previous conversation.';
    }

    // Stream the response
    this.streamResponse(prompt, beatId, { wordCount: 400 }, extractionType);
  }

  ngOnInit() {
    const storyId = this.route.snapshot.paramMap.get('storyId');
    const chapterId = this.route.snapshot.paramMap.get('chapterId');
    const sceneId = this.route.snapshot.paramMap.get('sceneId');

    if (storyId && chapterId && sceneId) {
      this.loadStory(storyId, chapterId, sceneId).then(() => {
        // Try restoring latest chat history after story is loaded
        if (storyId) {
          this.restoreLatestHistory(storyId).catch(() => void 0);
        }
      }).catch(error => {
        console.error('Error loading story:', error);
        this.goBack();
      });
    }
    
    // Load available models
    this.loadAvailableModels();

    // Subscribe to keyboard visibility for scroll-to-bottom
    this.subscriptions.add(
      this.keyboardService.keyboardVisible$.subscribe(visible => {
        if (visible) {
          setTimeout(() => this.scrollToBottom(), 400);
        }
        this.cdr.markForCheck();
      })
    );
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  private async loadStory(storyId: string, chapterId: string, sceneId: string) {
    this.story = await this.storyService.getStory(storyId);
    if (this.story) {
      this.activeChapterId = chapterId;
      this.activeSceneId = sceneId;
      
      // Load current scene as default context
      const chapter = this.story.chapters.find(c => c.id === chapterId);
      const scene = chapter?.scenes.find(s => s.id === sceneId);
      
      if (chapter && scene) {
        this.selectedScenes.push({
          chapterId: chapter.id,
          sceneId: scene.id,
          chapterTitle: `C${chapter.chapterNumber || chapter.order}:${chapter.title}`,
          sceneTitle: `C${chapter.chapterNumber || chapter.order}S${scene.sceneNumber || scene.order}:${scene.title}`,
          content: this.extractFullTextFromScene(scene),
          selected: true
        });
      }
      
      // Add initial system message if empty
      if (this.messages.length === 0) {
        this.messages.push({
          role: 'assistant',
          content: 'Hello! I am your AI assistant for this scene. I work exclusively with the context of selected scenes. You can ask me questions to extract characters, analyze details, or develop ideas.',
          timestamp: new Date()
        });
      }
    }
  }

  goBack() {
    this.router.navigate(['/stories/editor', this.story?.id], {
      queryParams: { chapterId: this.activeChapterId, sceneId: this.activeSceneId }
    });
  }

  async sendMessage(extractionType?: 'characters' | 'locations' | 'objects') {
    if (!this.currentMessage.trim() || this.isGenerating) return;

    const userMessage = this.currentMessage;
    this.currentMessage = '';

    // Blur the input to dismiss keyboard
    if (this.messageInput) {
      try {
        const ionTextarea = this.messageInput as unknown as {
          getInputElement?: () => Promise<HTMLTextAreaElement>
        };
        ionTextarea.getInputElement?.().then(el => el?.blur()).catch(() => void 0);
      } catch {
        void 0;
      }
    }

    // If editing, revert history to just before the edited message
    let effectiveExtractionType: 'characters' | 'locations' | 'objects' | undefined = extractionType;
    if (this.isEditing) {
      if (this.editingIndex >= 0) {
        // Remove the edited message and everything after it
        this.messages.splice(this.editingIndex);
      }
      // Preserve original extraction type if not explicitly overwritten
      if (!effectiveExtractionType) {
        effectiveExtractionType = this.editingExtractionType;
      }
      // Clear editing state
      this.isEditing = false;
      this.editingIndex = -1;
      this.editingExtractionType = undefined;
    }
    
    // Add user message
    this.messages.push({
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
      isPresetPrompt: !!effectiveExtractionType,
      extractionType: effectiveExtractionType
    });

    const contextText = await this.buildContextText(userMessage);
    const beatId = 'chat-' + Date.now();

    // Build prompt based on type
    let prompt = '';
    if (effectiveExtractionType) {
      // Use the extraction prompt directly
      prompt = `${contextText}${userMessage}`;
    } else {
      // For normal chat, just add the user's question
      prompt = `${contextText}User Question: ${userMessage}\n\nPlease answer helpfully and creatively based on the given context and previous conversation.`;
    }

    // Stream the response
    this.streamResponse(prompt, beatId, { wordCount: 400 }, effectiveExtractionType);
  }

  onEnterKey(event: KeyboardEvent) {
    if (!event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  formatMessage(content: string): SafeHtml {
    // Basic markdown-like formatting with safe HTML sanitization
    const formatted = content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
    return this.sanitizer.sanitize(1, formatted) || ''; // 1 = SecurityContext.HTML
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString('de-DE', { 
      hour: '2-digit', 
      minute: '2-digit' 
    });
  }

  private scrollToBottom() {
    setTimeout(() => {
      if (this.scrollContainer) {
        const element = this.scrollContainer.nativeElement;
        element.scrollTop = element.scrollHeight;
      }
    }, 100);
  }

  toggleSceneSelection(chapterId: string, sceneId: string) {
    const index = this.selectedScenes.findIndex(s => s.sceneId === sceneId);
    
    if (index > -1) {
      this.selectedScenes.splice(index, 1);
    } else {
      const chapter = this.story?.chapters.find(c => c.id === chapterId);
      const scene = chapter?.scenes.find(s => s.id === sceneId);
      
      if (chapter && scene) {
        this.selectedScenes.push({
          chapterId: chapter.id,
          sceneId: scene.id,
          chapterTitle: `C${chapter.chapterNumber || chapter.order}:${chapter.title}`,
          sceneTitle: `C${chapter.chapterNumber || chapter.order}S${scene.sceneNumber || scene.order}:${scene.title}`,
          content: this.extractFullTextFromScene(scene),
          selected: true
        });
      }
    }
  }

  isSceneSelected(sceneId: string): boolean {
    return this.selectedScenes.some(s => s.sceneId === sceneId);
  }

  removeSceneContext(scene: SceneContext) {
    const index = this.selectedScenes.findIndex(s => s.sceneId === scene.sceneId);
    if (index > -1) {
      this.selectedScenes.splice(index, 1);
    }
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

  private extractFullTextFromScene(scene: Scene): string {
    if (!scene.content) return '';

    // Use DOM parser for more reliable HTML parsing
    const parser = new DOMParser();
    const doc = parser.parseFromString(scene.content, 'text/html');
    
    // Remove all beat AI wrapper elements and their contents
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

  private initializePresetPrompts() {
    this.presetPrompts = [
      {
        id: 'extract-characters',
        title: 'Extract Characters',
        description: 'Extract all characters from selected scenes',
        extractionType: 'characters',
        icon: 'person-outline',
        prompt: `Analyze the provided scenes and identify every distinct character that appears or is referenced. For each character, fill out the template below. Keep the field labels exactly as written (in English). If a detail is unknown, write "Unknown" instead of inventing information. Fill every field value in the story's language and keep sentences concise.

**Name:** [Character name]
**Story Role:** [Protagonist | Antagonist | Supporting Character | Love Interest | Background Character | Unknown]
**Tags:** [Comma-separated topic keywords (e.g. Combat, Romance, Politics) — entries are auto-included when a tag appears in the beat prompt or scene text, written in the story's language]
**Description:** [...]

**Physical Appearance:** [...]
**Personality:** [...]
**Backstory:** [...]
**Relationships:** [...]
**History with Protagonist:** [...]
**Motivations & Goals:** [...]
**Skills & Abilities:** [...]
**Current Status:** [...]
**Plot Hooks:** [...]

Separate each character block with a blank line.`
      },
      {
        id: 'extract-locations',
        title: 'Extract Locations',
        description: 'Extract all locations and places from scenes',
        extractionType: 'locations',
        icon: 'location-outline',
        prompt: `Analyze the scenes and document every distinct setting or location that appears or is mentioned. For each location, fill out the template below. Keep the field labels exactly as written (in English). If information is missing, answer with "Unknown". Fill every field value in the story's language and stay concise.

**Name:** [Location name]
**Location Type:** [City, Ship, Tavern, Space Station, etc.]
**Tags:** [Comma-separated topic keywords (e.g. Combat, Romance, Politics) — entries are auto-included when a tag appears in the beat prompt or scene text, written in the story's language]
**Description:** [...]

**Overview:** [...]
**Sensory Details:** [...]
**Key Features:** [...]
**History & Lore:** [...]
**Story Significance:** [...]
**Mood & Atmosphere:** [...]
**Notable Characters:** [...]
**Plot Hooks:** [...]

Separate each location block with a blank line.`
      },
      {
        id: 'extract-objects',
        title: 'Extract Objects',
        description: 'Extract important objects and items',
        extractionType: 'objects',
        icon: 'cube-outline',
        prompt: `Analyze the scenes and capture every significant item, artifact, or object. For each one, complete the template below. Keep the field labels exactly as written (in English). When details are missing, respond with "Unknown". Fill every field value in the story's language and keep sentences concise.

**Name:** [Object name]
**Object Type:** [Weapon, Relic, Document, Tool, etc.]
**Tags:** [Comma-separated topic keywords (e.g. Combat, Romance, Politics) — entries are auto-included when a tag appears in the beat prompt or scene text, written in the story's language]
**Description:** [...]

**Physical Description:** [...]
**Origin & Backstory:** [...]
**Owner or Custodian:** [...]
**Abilities & Properties:** [...]
**Story Significance:** [...]
**Current Status or Location:** [...]
**Plot Hooks:** [...]

Separate each object block with a blank line.`
      }
    ];
  }

  usePresetPrompt(preset: PresetPrompt) {
    this.showPresetPrompts = false;
    this.currentMessage = preset.prompt;
    
    // Send the preset prompt immediately
    setTimeout(() => {
      this.sendMessage(preset.extractionType);
    }, 100);
  }

  getPresetColor(extractionType: 'characters' | 'locations' | 'objects'): string {
    switch (extractionType) {
      case 'characters': return 'primary';
      case 'locations': return 'secondary';
      case 'objects': return 'tertiary';
      default: return 'medium';
    }
  }

  addToCodex(message: ChatMessage): void {
    if (!message.extractionType || !this.story) return;

    const entries = this.parseExtractionResponse(message.content, message.extractionType);

    if (entries.length === 0) {
      this.messages.push({
        role: 'assistant',
        content: '⚠️ No structured entries detected to add to Codex. Please adjust the extraction prompt and try again.',
        timestamp: new Date()
      });
      this.cdr.markForCheck();
      this.scrollToBottom();
      return;
    }

    this.codexReviewEntries = entries.map(entry => ({
      name: entry.name,
      description: entry.fields['Description'] || entry.rawBlock,
      role: entry.role,
      tags: entry.tags,
      fields: entry.fields,
      selected: true
    }));
    this.codexReviewExtractionType = message.extractionType;
    this.codexReviewError = '';
    this.showCodexReviewModal = true;
    this.cdr.markForCheck();
  }

  areAllCodexEntriesSelected(): boolean {
    return this.codexReviewEntries.length > 0 && this.codexReviewEntries.every(entry => entry.selected);
  }

  getSelectedCodexEntriesCount(): number {
    return this.codexReviewEntries.filter(entry => entry.selected).length;
  }

  toggleSelectAllCodexEntries(selectAll: boolean): void {
    if (this.isSavingCodexEntries || this.codexReviewEntries.length === 0) return;
    this.codexReviewEntries = this.codexReviewEntries.map(entry => ({
      ...entry,
      selected: selectAll
    }));
    if (selectAll && this.codexReviewError) {
      this.codexReviewError = '';
    }
    this.cdr.markForCheck();
  }

  onCodexEntrySelectionChanged(): void {
    if (this.codexReviewError && this.getSelectedCodexEntriesCount() > 0) {
      this.codexReviewError = '';
    }
    this.cdr.markForCheck();
  }

  dismissCodexReviewModal(): void {
    if (this.isSavingCodexEntries) return;
    this.showCodexReviewModal = false;
    this.cdr.markForCheck();
  }

  handleCodexReviewDismiss(): void {
    if (this.isSavingCodexEntries) return;
    this.resetCodexReviewState();
    this.cdr.markForCheck();
  }

  async confirmCodexReviewAdd(): Promise<void> {
    if (this.isSavingCodexEntries || !this.story || !this.codexReviewExtractionType) return;

    const selectedEntries = this.codexReviewEntries.filter(entry => entry.selected);

    if (selectedEntries.length === 0) {
      this.codexReviewError = 'Select at least one entry to continue.';
      this.cdr.markForCheck();
      return;
    }

    this.isSavingCodexEntries = true;
    this.codexReviewError = '';
    this.cdr.markForCheck();

    try {
      const codex = await this.codexService.getOrCreateCodex(this.story.id);
      const categoryName = this.getCategoryName(this.codexReviewExtractionType);
      const category = codex.categories.find(c => c.title === categoryName);

      if (!category) {
        throw new Error(`Category ${categoryName} not found`);
      }

      for (const entry of selectedEntries) {
        const { content, metadata } = this.buildCodexEntryPayload(entry, this.codexReviewExtractionType);
        await this.codexService.addEntry(this.story.id, category.id, {
          title: entry.name,
          content,
          tags: entry.tags,
          metadata,
          storyRole: this.codexReviewExtractionType === 'characters' ? entry.role : undefined
        });
      }

      this.messages.push({
        role: 'assistant',
        content: `✅ ${selectedEntries.length} ${this.getExtractionTypeLabel(this.codexReviewExtractionType)} added to Codex.`,
        timestamp: new Date()
      });
      this.cdr.markForCheck();
      this.scrollToBottom();

      this.isSavingCodexEntries = false;
      this.dismissCodexReviewModal();
    } catch (error) {
      console.error('Error adding to codex:', error);
      this.codexReviewError = '❌ Error adding to Codex. Please try again.';
      this.isSavingCodexEntries = false;
      this.cdr.markForCheck();
    }
  }

  getFieldNamesForReview(entry: CodexEntryPreview): string[] {
    const type = this.codexReviewExtractionType;
    const orderedFields = type ? this.getFieldOrder(type) : [];
    const primaryOrder = orderedFields.filter(name => name !== 'Description' && this.hasFieldValue(entry, name));

    const additional = Object.keys(entry.fields)
      .filter(name => name !== 'Description' && !orderedFields.includes(name) && this.hasFieldValue(entry, name));

    return [...primaryOrder, ...additional];
  }

  private hasFieldValue(entry: CodexEntryPreview, name: string): boolean {
    const value = entry.fields[name];
    if (!value) return false;
    const trimmed = value.trim();
    return trimmed.length > 0 && trimmed.toLowerCase() !== 'unknown';
  }

  private resetCodexReviewState(): void {
    this.codexReviewEntries = [];
    this.codexReviewExtractionType = null;
    this.codexReviewError = '';
  }

  getExtractionTypeLabel(type: 'characters' | 'locations' | 'objects'): string {
    switch (type) {
      case 'characters': return 'Characters';
      case 'locations': return 'Locations';
      case 'objects': return 'Objects';
      default: return 'Entries';
    }
  }

  private getLanguageInstruction(): string {
    const language = this.story?.settings?.language;
    switch (language) {
      case 'de':
        return 'Antworten Sie auf Deutsch.';
      case 'fr':
        return 'Répondez en français.';
      case 'es':
        return 'Responda en español.';
      case 'en':
        return 'Respond in English.';
      case 'custom':
        return 'Respond in the same language as the provided story context.';
      default:
        return 'Use the story\'s language for your response.';
    }
  }

  private getCategoryName(extractionType: 'characters' | 'locations' | 'objects'): string {
    switch (extractionType) {
      case 'characters': return 'Characters';
      case 'locations': return 'Locations';
      case 'objects': return 'Objects';
      default: return 'Notes';
    }
  }

  private buildStoryOutline(): string {
    if (!this.story) return '';
    
    let outline = '';
    
    this.story.chapters.forEach(chapter => {
      outline += `\n## ${chapter.title}\n`;
      
      chapter.scenes.forEach(scene => {
        outline += `\n### ${scene.title}\n`;
        
        if (scene.summary) {
          outline += `${scene.summary}\n`;
        } else {
          // Fallback to truncated content if no summary
          const cleanText = this.extractFullTextFromScene(scene);
          const truncated = cleanText.substring(0, 200);
          outline += `${truncated}${cleanText.length > 200 ? '...' : ''}\n`;
        }
      });
    });
    
    return outline;
  }

  private async buildContextText(userMessage: string): Promise<string> {
    const sceneContext = this.selectedScenes
      .map(s => `<scene chapter="${s.chapterTitle}" title="${s.sceneTitle}">\n${s.content}\n</scene>`)
      .join('\n\n');

    let storyOutline = '';
    if (this.includeStoryOutline) {
      storyOutline = this.buildStoryOutline();
    }

    let contextText = '';
    if (storyOutline) {
      contextText += `Story Overview:\n${storyOutline}\n\n`;
    }
    if (sceneContext) {
      contextText += `Scene Text:\n${sceneContext}\n\n`;
    }

    if (this.includeCodexContext && this.story) {
      try {
        const codexResult = await this.codexContextService.buildCodexXml(
          this.story.id,
          userMessage,
          '',
          sceneContext,
          1000
        );
        if (codexResult.xml) {
          contextText += `Codex (World Knowledge):\n${codexResult.xml}\n\n`;
        }
      } catch (error) {
        console.error('Failed to build codex context:', error);
      }
    }

    const chatHistory = this.buildChatHistory();
    if (chatHistory) {
      contextText += `Previous chat history:\n${chatHistory}\n\n`;
    }

    return contextText;
  }

  /**
   * Shared streaming response handler - consolidates duplicate streaming logic
   * from sendMessage and resendMessage
   */
  private streamResponse(
    prompt: string,
    beatId: string,
    options: { wordCount: number },
    extractionType?: 'characters' | 'locations' | 'objects'
  ): void {
    this.isGenerating = true;
    this.streamingContent = '';
    this.scrollToBottom();

    const sessionIdSnapshot = ++this.chatSessionId;
    let accumulatedResponse = '';

    const subscription = this.callAIDirectly(prompt, beatId, options).subscribe({
      next: (chunk) => {
        if (this.chatSessionId !== sessionIdSnapshot) return;
        accumulatedResponse = chunk;
        this.streamingContent = chunk;
        this.scrollToBottom();
        this.cdr.markForCheck();
      },
      complete: () => {
        if (this.chatSessionId !== sessionIdSnapshot) return;
        this.streamingContent = '';
        this.messages.push({
          role: 'assistant',
          content: accumulatedResponse,
          timestamp: new Date(),
          extractionType
        });
        this.isGenerating = false;
        this.scrollToBottom();
        this.saveHistorySnapshot().catch(() => void 0);
        this.cdr.markForCheck();
      },
      error: (error) => {
        if (this.chatSessionId !== sessionIdSnapshot) return;
        console.error('Error generating response:', error);
        this.streamingContent = '';
        this.messages.push({
          role: 'assistant',
          content: 'Sorry, an error occurred. Please try again.',
          timestamp: new Date()
        });
        this.isGenerating = false;
        this.scrollToBottom();
        this.cdr.markForCheck();
      }
    });

    this.subscriptions.add(subscription);
  }

  /**
   * Stop the current generation and save partial content
   */
  stopGeneration(): void {
    // Invalidate current session
    this.chatSessionId = Date.now();

    // If we have partial content, save it
    if (this.streamingContent) {
      this.messages.push({
        role: 'assistant',
        content: this.streamingContent + '\n\n[Generation stopped]',
        timestamp: new Date()
      });
      this.saveHistorySnapshot().catch(() => void 0);
    }

    this.streamingContent = '';
    this.isGenerating = false;
    this.cdr.markForCheck();
  }

  private callAIDirectly(prompt: string, beatId: string, options: { wordCount: number }): Observable<string> {
    const settings = this.settingsService.getSettings();
    
    // Use selected model if available, otherwise fall back to global
    const modelToUse = this.selectedModel || settings.selectedModel;
    
    // Extract provider from the selected model
    let provider: string | null = null;
    let actualModelId: string | null = null;
    
    if (modelToUse) {
      const [modelProvider, ...modelIdParts] = modelToUse.split(':');
      provider = modelProvider;
      actualModelId = modelIdParts.join(':'); // Rejoin in case model ID contains colons
    }
    
    // Check which API to use based on the selected model's provider
    if (!provider || !this.aiProviderValidation.isProviderAvailable(provider, settings)) {
      console.warn('No AI API configured or no model selected');
      return of('Sorry, no AI API configured or no model selected.');
    }

    const useGoogleGemini = provider === 'gemini';

    // For direct calls, we bypass the beat AI service and call the API directly
    // We'll use the beat AI service's internal methods by creating a minimal wrapper
    return new Observable<string>(observer => {
      let accumulatedResponse = '';
      let logId: string;
      const startTime = Date.now();

      // Create a simple API call based on configuration
      const apiCall = useGoogleGemini 
        ? this.callGeminiAPI(prompt, { ...options, model: actualModelId })
        : this.callOpenRouterAPI(prompt, { ...options, model: actualModelId });
        
      apiCall.subscribe({
        next: (chunk) => {
          accumulatedResponse += chunk;
          observer.next(accumulatedResponse);
        },
        complete: () => {
          // Log success
          if (logId) {
            this.aiLogger.logSuccess(
              logId,
              accumulatedResponse,
              Date.now() - startTime
            );
          }
          observer.complete();
        },
        error: (error) => {
          // Log error
          if (logId) {
            this.aiLogger.logError(
              logId,
              error.message || 'Unknown error',
              Date.now() - startTime,
              { errorDetails: error }
            );
          }
          observer.error(error);
        }
      });
      
      // Store log ID for later use
      if (useGoogleGemini) {
        logId = this.logGeminiRequest(prompt, { ...options, model: actualModelId });
      } else {
        logId = this.logOpenRouterRequest(prompt, { ...options, model: actualModelId });
      }
    });
  }
  
  private callGeminiAPI(prompt: string, options: { wordCount: number; model?: string | null }): Observable<string> {
    const settings = this.settingsService.getSettings();
    const apiKey = settings.googleGemini.apiKey;
    const model = options.model || settings.googleGemini.model || 'gemini-1.5-flash';
    const maxTokens = this.getChatMaxTokens(options.wordCount);
    
    const requestBody = {
      contents: [{
        role: 'user',
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: maxTokens,
        topP: 0.95,
        topK: 40
      }
    };
    
    return from(fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    })).pipe(
      switchMap(response => {
        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }
        return this.processStreamResponse(response);
      })
    );
  }
  
  private callOpenRouterAPI(prompt: string, options: { wordCount: number; model?: string | null }): Observable<string> {
    const settings = this.settingsService.getSettings();
    const apiKey = settings.openRouter.apiKey;
    const model = options.model || settings.openRouter.model || 'anthropic/claude-3-haiku';
    const maxTokens = this.getChatMaxTokens(options.wordCount);

    const providerPrefs = buildOpenRouterProviderPrefs(settings.openRouter);

    const requestBody = {
      model: model,
      messages: [{
        role: 'user',
        content: prompt
      }],
      stream: true,
      max_tokens: maxTokens,
      temperature: 0.7,
      ...(providerPrefs && { provider: providerPrefs })
    };

    return from(fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': window.location.href,
        'X-Title': 'Creative Writer'
      },
      body: JSON.stringify(requestBody)
    })).pipe(
      switchMap(response => {
        if (!response.ok) {
          throw new Error(`API error: ${response.statusText}`);
        }
        return this.processStreamResponse(response);
      })
    );
  }

  private processStreamResponse(response: Response): Observable<string> {
    return new Observable<string>(observer => {
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const processBufferLine = (line: string) => {
        if (!line) return;
        if (!line.startsWith('data: ')) return;
        const jsonStr = line.slice(6);
        if (jsonStr === '[DONE]') return;
        try {
          const json = JSON.parse(jsonStr);
          let text = '';
          // Gemini streaming
          if (json.candidates?.[0]?.content?.parts?.[0]?.text) {
            text = json.candidates[0].content.parts[0].text;
          }
          // OpenRouter/OpenAI streaming
          else if (json.choices?.[0]?.delta?.content) {
            text = json.choices[0].delta.content;
          }
          if (text) observer.next(text);
        } catch {
          // ignore partial JSON until complete line arrives
        }
      };

      const read = async (): Promise<void> => {
        try {
          const { done, value } = await reader!.read();
          if (done) {
            // flush remaining buffer
            const remaining = buffer.trim();
            if (remaining) processBufferLine(remaining);
            observer.complete();
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          let newlineIndex = buffer.indexOf('\n');
          while (newlineIndex !== -1) {
            const line = buffer.slice(0, newlineIndex).trim();
            buffer = buffer.slice(newlineIndex + 1);
            processBufferLine(line);
            newlineIndex = buffer.indexOf('\n');
          }
          read();
        } catch (error) {
          observer.error(error);
        }
      };

      read();
    });
  }

  private getChatMaxTokens(wordCount: number): number {
    const estimated = Math.ceil(wordCount * 2.5);
    return Math.max(estimated, 3000);
  }

  private logGeminiRequest(prompt: string, options: { wordCount: number; model?: string | null }): string {
    const settings = this.settingsService.getSettings();
    const model = options.model || settings.googleGemini.model || 'gemini-1.5-flash';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`;
    const maxTokens = this.getChatMaxTokens(options.wordCount);
    
    return this.aiLogger.logRequest({
      endpoint: endpoint,
      model: model,
      wordCount: options.wordCount,
      maxTokens: maxTokens,
      prompt: prompt,
      apiProvider: 'gemini',
      streamingMode: true,
      requestDetails: {
        source: 'scene-chat',
        temperature: 0.7,
        topP: 0.95,
        topK: 40
      }
    });
  }
  
  private logOpenRouterRequest(prompt: string, options: { wordCount: number; model?: string | null }): string {
    const settings = this.settingsService.getSettings();
    const model = options.model || settings.openRouter.model || 'anthropic/claude-3-haiku';
    const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    const maxTokens = this.getChatMaxTokens(options.wordCount);
    
    return this.aiLogger.logRequest({
      endpoint: endpoint,
      model: model,
      wordCount: options.wordCount,
      maxTokens: maxTokens,
      prompt: prompt,
      apiProvider: 'openrouter',
      streamingMode: true,
      requestDetails: {
        source: 'scene-chat',
        temperature: 0.7
      }
    });
  }

  private parseExtractionResponse(content: string, type: 'characters' | 'locations' | 'objects'): ParsedExtractionEntry[] {
    const entries: ParsedExtractionEntry[] = [];

    const nameRegex = /\*\*Name:\*\*\s*([^\n]+)/g;
    let match: RegExpExecArray | null;

    while ((match = nameRegex.exec(content)) !== null) {
      const name = match[1].trim();
      if (!name) continue;

      const startIndex = match.index + match[0].length;
      const nextMatchIndex = content.indexOf('**Name:**', startIndex);
      const endIndex = nextMatchIndex !== -1 ? nextMatchIndex : content.length;
      const rawBlock = content.substring(startIndex, endIndex).trim();

      const { fields, tags, role } = this.extractFieldsFromBlock(rawBlock, type);

      entries.push({
        name,
        tags,
        role,
        fields,
        rawBlock
      });
    }

    return entries;
  }

  private extractFieldsFromBlock(block: string, type: 'characters' | 'locations' | 'objects') {
    const fields: Record<string, string> = {};
    let tags: string[] = [];
    let role: StoryRole | undefined;

    const fieldRegex = /\*\*([^*:]+):\*\*\s*([\s\S]*?)(?=\n\*\*[^*\n]+:\*\*|\s*$)/g;
    let fieldMatch: RegExpExecArray | null;

    const recognizedFields = this.buildFieldLabelMap(type);

    while ((fieldMatch = fieldRegex.exec(block)) !== null) {
      const rawLabel = fieldMatch[1].trim();
      const rawValue = this.sanitizeFieldValue(fieldMatch[2]);
      if (!rawLabel) continue;

      const normalizedKey = this.normalizeFieldKey(rawLabel);

      if (normalizedKey === 'tags') {
        tags = rawValue
          .split(/[,;|]/)
          .map(tag => tag.trim())
          .filter(tag => tag.length > 0);
        continue;
      }

      if (normalizedKey === 'story role' || normalizedKey === 'role') {
        role = this.normalizeStoryRole(rawValue);
        continue;
      }

      const label = recognizedFields.get(normalizedKey) ?? rawLabel;

      if (!rawValue) continue;

      fields[label] = rawValue;
    }

    if (type === 'characters' && !role) {
      const lowerBlock = block.toLowerCase();
      if (lowerBlock.includes('protagonist')) role = 'Protagonist';
      else if (lowerBlock.includes('antagonist')) role = 'Antagonist';
      else if (lowerBlock.includes('love interest')) role = 'Love Interest';
      else if (lowerBlock.includes('supporting')) role = 'Supporting Character';
      else if (lowerBlock.includes('background')) role = 'Background Character';
    }

    return { fields, tags, role };
  }

  private sanitizeFieldValue(value: string): string {
    return (value || '')
      .replace(/\r/g, '')
      .trim();
  }

  private buildFieldLabelMap(type: 'characters' | 'locations' | 'objects'): Map<string, string> {
    const map = new Map<string, string>();
    const addToMap = (label: string) => {
      map.set(this.normalizeFieldKey(label), label);
    };

    this.getFieldOrder(type).forEach(addToMap);

    return map;
  }

  private normalizeFieldKey(label: string): string {
    return label
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeStoryRole(rawRole: string): StoryRole | undefined {
    const normalized = rawRole.trim().toLowerCase();
    if (!normalized) return undefined;

    const map: Record<string, StoryRole> = {
      protagonist: 'Protagonist',
      'main character': 'Protagonist',
      hauptcharakter: 'Protagonist',
      held: 'Protagonist',
      antagonist: 'Antagonist',
      gegenspieler: 'Antagonist',
      'supporting character': 'Supporting Character',
      nebencharakter: 'Supporting Character',
      'secondary character': 'Supporting Character',
      'love interest': 'Love Interest',
      'romantic interest': 'Love Interest',
      'background character': 'Background Character',
      hintergrundcharakter: 'Background Character'
    };

    if (normalized in map) {
      return map[normalized];
    }

    if (normalized.includes('protagonist')) return 'Protagonist';
    if (normalized.includes('antagonist')) return 'Antagonist';
    if (normalized.includes('support')) return 'Supporting Character';
    if (normalized.includes('love')) return 'Love Interest';
    if (normalized.includes('background') || normalized.includes('ensemble')) return 'Background Character';

    return undefined;
  }

  private getFieldOrder(type: 'characters' | 'locations' | 'objects'): string[] {
    switch (type) {
      case 'characters':
        return CHARACTER_FIELD_ORDER;
      case 'locations':
        return LOCATION_FIELD_ORDER;
      case 'objects':
        return OBJECT_FIELD_ORDER;
      default:
        return [];
    }
  }

  private buildCodexEntryPayload(entry: CodexEntryPreview, type: 'characters' | 'locations' | 'objects'): { content: string; metadata: Record<string, unknown> } {
    const fieldOrder = this.getFieldOrder(type);
    const description = this.getEntryDescription(entry, fieldOrder);
    const customFields = this.buildCustomFields(fieldOrder, entry.fields);
    const metadata: Record<string, unknown> = {};

    if (customFields.length > 0) {
      metadata['customFields'] = customFields;
    }

    if (type === 'characters' && entry.role) {
      metadata['storyRole'] = entry.role;
    }

    return { content: description, metadata };
  }

  private getEntryDescription(entry: CodexEntryPreview, fieldOrder: string[]): string {
    const description = entry.fields['Description']?.trim();
    if (description && description.length > 0) {
      return description;
    }

    for (const fieldName of fieldOrder) {
      if (fieldName === 'Description') continue;
      const value = entry.fields[fieldName];
      if (value && value.trim().length > 0 && value.trim().toLowerCase() !== 'unknown') {
        return value.trim();
      }
    }

    return entry.description || '';
  }

  private buildCustomFields(fieldOrder: string[], fields: Record<string, string>): { id: string; name: string; value: string }[] {
    const customFields: { id: string; name: string; value: string }[] = [];
    const used = new Set<string>();

    const addField = (name: string) => {
      const value = fields[name];
      if (!value) return;
      const trimmed = value.trim();
      if (!trimmed) return;
      customFields.push({
        id: this.generateCustomFieldId(),
        name,
        value: trimmed
      });
      used.add(name);
    };

    fieldOrder.forEach(fieldName => {
      if (fieldName === 'Description') return;
      addField(fieldName);
    });

    Object.entries(fields).forEach(([name, value]) => {
      if (name === 'Description' || used.has(name)) return;
      if (!value) return;
      const trimmed = value.trim();
      if (!trimmed) return;
      customFields.push({
        id: this.generateCustomFieldId(),
        name,
        value: trimmed
      });
    });

    return customFields;
  }

  private generateCustomFieldId(): string {
    this.customFieldIdCounter += 1;
    return `cf-${Date.now()}-${this.customFieldIdCounter}`;
  }

  async copyToClipboard(text: string, event: Event): Promise<void> {
    // Prevent event bubbling
    event.stopPropagation();
    
    try {
      await navigator.clipboard.writeText(text);
      
      // Show temporary success feedback
      const button = event.target as HTMLElement;
      const icon = button.querySelector('ion-icon') || button;
      const originalName = icon.getAttribute('name');
      
      // Change icon to checkmark temporarily
      icon.setAttribute('name', 'checkmark-outline');
      icon.setAttribute('style', 'color: var(--ion-color-success)');
      
      // Reset icon after 1.5 seconds
      setTimeout(() => {
        icon.setAttribute('name', originalName || 'copy-outline');
        icon.removeAttribute('style');
      }, 1500);
      
    } catch (err) {
      console.error('Failed to copy text to clipboard:', err);
      
      // Fallback for older browsers or when clipboard API fails
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        // Show success feedback for fallback method too
        const button = event.target as HTMLElement;
        const icon = button.querySelector('ion-icon') || button;
        const originalName = icon.getAttribute('name');
        
        icon.setAttribute('name', 'checkmark-outline');
        icon.setAttribute('style', 'color: var(--ion-color-success)');
        
        setTimeout(() => {
          icon.setAttribute('name', originalName || 'copy-outline');
          icon.removeAttribute('style');
        }, 1500);
      } catch (fallbackErr) {
        console.error('Fallback copy method also failed:', fallbackErr);
      }
    }
  }
  
  private loadAvailableModels(): void {
    this.subscriptions.add(
      this.settingsService.settings$.subscribe(() => {
        this.reloadModels();
        this.cdr.markForCheck();
      })
    );
    this.reloadModels();
  }

  private reloadModels(): void {
    this.subscriptions.add(
      this.modelService.getCombinedModels().subscribe(models => {
        this.availableModels = models;
        if (models.length > 0 && !this.selectedModel) {
          this.setDefaultModel();
        }
        this.cdr.markForCheck();
      })
    );
  }

  private setDefaultModel(): void {
    const settings = this.settingsService.getSettings();
    if (settings.selectedModel) {
      this.selectedModel = settings.selectedModel;
    } else if (this.availableModels.length > 0) {
      this.selectedModel = this.availableModels[0].id;
    }
  }
  
  getProviderIcon(provider: string): string {
    return getIcon(provider);
  }
  
  private buildChatHistory(): string {
    // Filter out system messages, preset prompts, and the current message being processed
    const relevantMessages = this.messages.filter(message => {
      // Skip initial system message
      if (message.content.includes('Hello! I am your AI assistant')) {
        return false;
      }
      // Skip preset prompt messages (they have extractionType but we want to keep extraction results)
      if (message.isPresetPrompt) {
        return false;
      }
      return true;
    });
    
    // If no relevant messages, return empty string
    if (relevantMessages.length === 0) {
      return '';
    }
    
    // Format messages for AI context
    const formattedMessages = relevantMessages.map(message => {
      const role = message.role === 'user' ? 'Nutzer' : 'Assistent';
      // Clean up any HTML formatting for AI context
      const content = message.content
        .replace(/<br>/g, '\n')
        .replace(/<strong>(.*?)<\/strong>/g, '**$1**')
        .replace(/<em>(.*?)<\/em>/g, '*$1*')
        .replace(/<[^>]*>/g, ''); // Remove any other HTML tags
      
      return `${role}: ${content}`;
    });
    
    return formattedMessages.join('\n\n');
  }

  private initializeHeaderActions(): void {
    this.headerActions = [
      {
        icon: 'time-outline',
        action: () => this.openHistoryList(),
        showOnMobile: true,
        showOnDesktop: true
      },
      {
        icon: 'sparkles-outline',
        action: () => this.showPresetPrompts = true,
        showOnMobile: true,
        showOnDesktop: true
      },
      {
        icon: 'reader-outline',
        action: () => this.includeStoryOutline = !this.includeStoryOutline,
        color: this.includeStoryOutline ? 'primary' : 'medium',
        showOnMobile: true,
        showOnDesktop: true
      },
      {
        icon: 'library-outline',
        action: () => this.includeCodexContext = !this.includeCodexContext,
        color: this.includeCodexContext ? 'primary' : 'medium',
        showOnMobile: true,
        showOnDesktop: true
      },
      {
        icon: 'add-outline',
        action: () => this.showSceneSelector = true,
        showOnMobile: true,
        showOnDesktop: true
      },
      {
        icon: 'chatbubble-outline',
        action: () => this.confirmNewChat(),
        showOnMobile: true,
        showOnDesktop: true
      }
    ];
  }

  private async confirmNewChat(): Promise<void> {
    if (this.isGenerating) {
      // To avoid mixing streams, ask for explicit confirmation
      const alert = await this.alertController.create({
        header: 'Start New Chat?',
        message: 'This will clear the current conversation. Ongoing generation will be ignored.',
        buttons: [
          { text: 'Cancel', role: 'cancel' },
          { text: 'Start New Chat', role: 'destructive', handler: () => this.startNewChat() }
        ]
      });
      await alert.present();
      return;
    }

    const alert = await this.alertController.create({
      header: 'Start New Chat?',
      message: 'This will clear the current conversation history.',
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Start New Chat', role: 'destructive', handler: () => this.startNewChat() }
      ]
    });
    await alert.present();
  }

  private startNewChat(): void {
    // Bump session id so any in-flight responses are ignored
    this.chatSessionId = Date.now();
    this.isGenerating = false;
    this.currentMessage = '';
    this.streamingContent = '';

    // Clear chat messages and push greeting
    this.messages = [];
    this.messages.push({
      role: 'assistant',
      content: 'Hello! I am your AI assistant for this scene. I work exclusively with the context of selected scenes. You can ask me questions to extract characters, analyze details, or develop ideas.',
      timestamp: new Date()
    });

    // Reset active history; next save creates a new one
    this.activeHistoryId = null;

    this.scrollToBottom();
    this.cdr.markForCheck();
  }

  private async restoreLatestHistory(storyId: string): Promise<void> {
    const latest = await this.chatHistoryService.getLatest(storyId);
    if (!latest) return;
    this.applyHistory(latest);
  }

  private async saveHistorySnapshot(): Promise<void> {
    if (!this.story) return;
    // Skip if only greeting
    const hasRealMessages = this.messages.some(m => m.role === 'user' || (m.role === 'assistant' && !m.content.includes('Hello! I am your AI assistant')));
    if (!hasRealMessages) return;
    const selectedScenesRefs = this.selectedScenes.map(s => ({
      chapterId: s.chapterId,
      sceneId: s.sceneId,
      chapterTitle: s.chapterTitle,
      sceneTitle: s.sceneTitle
    }));
    const saved = await this.chatHistoryService.saveSnapshot({
      storyId: this.story.id,
      messages: this.messages,
      selectedScenes: selectedScenesRefs,
      includeStoryOutline: this.includeStoryOutline,
      includeCodexContext: this.includeCodexContext,
      selectedModel: this.selectedModel || undefined,
      historyId: this.activeHistoryId
    });
    this.activeHistoryId = saved.historyId;
  }

  async openHistoryList(): Promise<void> {
    if (!this.story) return;
    try {
      this.histories = await this.chatHistoryService.listHistories(this.story.id);
      this.showHistoryList = true;
      this.cdr.markForCheck();
    } catch (e) {
      console.error('Failed to load histories', e);
    }
  }

  async selectHistory(history: ChatHistoryDoc): Promise<void> {
    if (!this.story) return;
    this.applyHistory(history);
    this.showHistoryList = false;
    this.cdr.markForCheck();
  }

  getHistoryTitle(h: ChatHistoryDoc): string {
    if (h.title && h.title.trim()) return h.title;
    const firstUser = (h.messages || []).find(m => m.role === 'user');
    const base = firstUser ? firstUser.content.trim().slice(0, 60) : '';
    return base ? `${base}${(firstUser!.content.length > 60 ? '…' : '')}` : `Chat ${new Date(h.updatedAt).toLocaleString()}`;
  }

  getHistoryMeta(h: ChatHistoryDoc): string {
    const count = (h.messages || []).length;
    const when = new Date(h.updatedAt).toLocaleString();
    return `${count} messages · ${when}`;
  }

  private applyHistory(history: ChatHistoryDoc): void {
    // Bump session id to stop any in-flight streaming
    this.chatSessionId = Date.now();
    this.isGenerating = false;
    this.streamingContent = '';
    // Replace current chat with stored one
    this.messages = (history.messages || []).map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
    if (this.messages.length === 0) {
      this.messages.push({
        role: 'assistant',
        content: 'Hello! I am your AI assistant for this scene. I work exclusively with the context of selected scenes. You can ask me questions to extract characters, analyze details, or develop ideas.',
        timestamp: new Date()
      });
    }
    this.includeStoryOutline = !!history.includeStoryOutline;
    this.includeCodexContext = !!history.includeCodexContext;
    if (history.selectedModel) this.selectedModel = history.selectedModel;
    if (history.selectedScenes && this.story) {
      const restored: SceneContext[] = [];
      for (const ref of history.selectedScenes) {
        const chapter = this.story.chapters.find(c => c.id === ref.chapterId);
        const scene = chapter?.scenes.find(s => s.id === ref.sceneId);
        if (chapter && scene) {
          restored.push({
            chapterId: chapter.id,
            sceneId: scene.id,
            chapterTitle: ref.chapterTitle || `C${chapter.chapterNumber || chapter.order}:${chapter.title}`,
            sceneTitle: ref.sceneTitle || `C${chapter.chapterNumber || chapter.order}S${scene.sceneNumber || scene.order}:${scene.title}`,
            content: this.extractFullTextFromScene(scene),
            selected: true
          });
        }
      }
      if (restored.length) this.selectedScenes = restored;
    }
    this.activeHistoryId = history.historyId;
    this.scrollToBottom();
  }

  // ============================================
  // trackBy functions for mobile performance
  // ============================================
  trackBySceneId(index: number, scene: SceneContext | Scene): string {
    return 'sceneId' in scene ? scene.sceneId : scene.id;
  }

  trackByMessageTimestamp(index: number, message: ChatMessage): number {
    return message.timestamp.getTime();
  }

  trackByEntryName(index: number, entry: CodexEntryPreview): string {
    return entry.name;
  }

  trackByHistoryId(index: number, history: ChatHistoryDoc): string {
    return history._id;
  }

  trackByChapterId(index: number, chapter: Chapter): string {
    return chapter.id;
  }

  trackByPresetId(index: number, preset: PresetPrompt): string {
    return preset.id;
  }

  trackByFieldName(index: number, fieldName: string): string {
    return fieldName;
  }

  trackByTag(index: number, tag: string): string {
    return tag;
  }
}
