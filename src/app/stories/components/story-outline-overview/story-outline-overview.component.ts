import { Component, ChangeDetectionStrategy, OnInit, OnDestroy, inject, computed, signal, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import {
  IonContent, IonSearchbar, IonAccordion, IonAccordionGroup, IonItem,
  IonButton, IonIcon, IonList, IonSkeletonText,
  ToastController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { arrowBack, copyOutline } from 'ionicons/icons';
import { Story, Chapter } from '../../models/story.interface';
import { StoryService } from '../../services/story.service';
import { AppHeaderComponent, HeaderAction, BurgerMenuItem } from '../../../ui/components/app-header.component';
import { ModelSelectorComponent } from '../../../shared/components/model-selector/model-selector.component';
import { PromptManagerService } from '../../../shared/services/prompt-manager.service';
import { StoryStatsService } from '../../services/story-stats.service';
import { SceneAIGenerationService } from '../../../shared/services/scene-ai-generation.service';
import { DialogService } from '../../../core/services/dialog.service';
import { SceneCardComponent, SceneUpdateEvent, SceneAIGenerateEvent, SceneNavigateEvent } from '../scene-card/scene-card.component';
import { ChapterHeaderComponent, ChapterTitleUpdateEvent } from '../chapter-header/chapter-header.component';
import { SettingsService } from '../../../core/services/settings.service';

@Component({
  selector: 'app-story-outline-overview',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    AppHeaderComponent, ModelSelectorComponent,
    SceneCardComponent, ChapterHeaderComponent,
    IonContent, IonSearchbar, IonAccordion, IonAccordionGroup, IonItem,
    IonButton, IonIcon, IonList, IonSkeletonText
  ],
  templateUrl: './story-outline-overview.component.html',
  styleUrls: ['./story-outline-overview.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StoryOutlineOverviewComponent implements OnInit, OnDestroy, AfterViewInit {
  @ViewChild(IonContent) content!: IonContent;
  @ViewChild('searchbar') querySearchbar?: IonSearchbar;
  @ViewChild(IonAccordionGroup) accordionGroup?: IonAccordionGroup;

  // Cleanup tracking for memory leak prevention
  private activeTimeouts: ReturnType<typeof setTimeout>[] = [];
  private currentStoryId: string | null = null;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private storyService = inject(StoryService);
  private promptManager = inject(PromptManagerService);
  private storyStats = inject(StoryStatsService);
  private sceneAIService = inject(SceneAIGenerationService);
  private toastController = inject(ToastController);
  private dialogService = inject(DialogService);
  private settingsService = inject(SettingsService);

  // Header config
  leftActions: HeaderAction[] = [];
  rightActions: HeaderAction[] = [];
  burgerMenuItems: BurgerMenuItem[] = [];

  // Data
  story = signal<Story | null>(null);
  query = signal('');
  selectedModel = '';

  get sceneSummaryFavorites(): string[] {
    return this.settingsService.getSettings().favoriteModelLists?.sceneSummary || [];
  }

  // UI state
  loading = signal<boolean>(true);
  private pendingAccordionExpand: string[] | null = null;

  // Derived view model
  filteredChapters = computed<Chapter[]>(() => {
    const s = this.story();
    if (!s) return [] as Chapter[];
    const q = this.query().toLowerCase().trim();
    const chapters = Array.isArray(s.chapters) ? s.chapters : [];

    // If no query, return original chapters to preserve object references
    if (!q) {
      return chapters;
    }

    // Only create new objects when filtering is needed
    return chapters.map((ch) => ({
      ...ch,
      scenes: ch.scenes.filter(sc => {
        const hay = `${ch.title}\n${sc.title}\n${sc.summary || ''}`.toLowerCase();
        return hay.includes(q);
      })
    })).filter(ch => ch.scenes.length > 0);
  });

  // Cache for word counts to avoid recalculating unchanged scenes
  private wordCountCache = new Map<string, { content: string; count: number }>();

  sceneWordCounts = computed<Record<string, number>>(() => {
    const s = this.story();
    if (!s) return {};
    const counts: Record<string, number> = {};
    for (const chapter of s.chapters ?? []) {
      for (const scene of chapter.scenes ?? []) {
        const cacheKey = scene.id;
        const cached = this.wordCountCache.get(cacheKey);

        // Use cached count if content hasn't changed
        if (cached && cached.content === scene.content) {
          counts[scene.id] = cached.count;
        } else {
          const count = this.storyStats.calculateSceneWordCount(scene);
          counts[scene.id] = count;
          this.wordCountCache.set(cacheKey, { content: scene.content || '', count });
        }
      }
    }
    return counts;
  });

  constructor() {
    addIcons({ arrowBack, copyOutline });
  }

  ngOnDestroy(): void {
    // Clear all pending timeouts
    this.activeTimeouts.forEach(t => clearTimeout(t));
    this.activeTimeouts = [];
    this.wordCountCache.clear();
  }

  ngAfterViewInit(): void {
    // Set initial accordion state after view is ready
    if (this.pendingAccordionExpand && this.accordionGroup) {
      this.accordionGroup.value = this.pendingAccordionExpand;
      this.pendingAccordionExpand = null;
    }
  }

  getSceneWordCount(sceneId: string): number {
    return this.sceneWordCounts()[sceneId] ?? 0;
  }

  getSceneWordCountLabel(sceneId: string): string {
    const count = this.getSceneWordCount(sceneId);
    const noun = count === 1 ? 'word' : 'words';
    return `${count} ${noun}`;
  }

  async ngOnInit(): Promise<void> {
    const storyId = this.route.snapshot.paramMap.get('id');
    if (!storyId) {
      this.router.navigate(['/']);
      return;
    }
    const chapterId = this.route.snapshot.queryParamMap.get('chapterId');
    const sceneId = this.route.snapshot.queryParamMap.get('sceneId');
    await this.loadStory(storyId, chapterId, sceneId);
    this.setupHeader(storyId);
  }

  private async loadStory(id: string, chapterId: string | null = null, sceneId: string | null = null) {
    this.loading.set(true);
    try {
      // Clear word count cache when switching stories
      if (this.currentStoryId !== id) {
        this.wordCountCache.clear();
        this.currentStoryId = id;
      }

      const s = await this.storyService.getStory(id);
      if (!s) {
        console.warn(`Story with id ${id} not found`);
        this.router.navigate(['/']);
        return;
      }
      this.story.set(s);
      // Set initial accordion expanded state
      // If we have a chapterId, only expand that chapter. Otherwise expand first 10 chapters
      const maxDefaultExpanded = 10;
      const chaptersToExpand = chapterId
        ? [chapterId]
        : (s.chapters.length <= maxDefaultExpanded
            ? s.chapters.map(c => c.id)
            : s.chapters.slice(0, maxDefaultExpanded).map(c => c.id));

      // Set via ViewChild if available, otherwise store for ngAfterViewInit
      if (this.accordionGroup) {
        this.accordionGroup.value = chaptersToExpand;
      } else {
        this.pendingAccordionExpand = chaptersToExpand;
      }

      // Schedule scroll to scene after view is ready and accordion expanded
      if (chapterId && sceneId) {
        const timeout = setTimeout(() => this.scrollToScene(sceneId), 600);
        this.activeTimeouts.push(timeout);
      }
    } catch (error) {
      console.error('Failed to load story:', error);
      this.dialogService.showError({ header: 'Load Error', message: 'Failed to load story. Please try again.' });
      this.router.navigate(['/']);
    } finally {
      this.loading.set(false);
    }
  }

  private setupHeader(storyId: string) {
    this.leftActions = [
      {
        icon: 'arrow-back',
        action: () => this.goBackToEditor(storyId),
        tooltip: 'Back to editor',
        showOnDesktop: true,
        showOnMobile: true
      }
    ];
    // Right actions moved to tools bar for better discoverability
    this.rightActions = [];
  }

  goBackToEditor(storyId: string): void {
    this.router.navigate(['/stories/editor', storyId]);
  }

  openInEditor(chapterId: string, sceneId: string): void {
    const sid = this.story()?.id;
    if (!sid) return;
    this.router.navigate([
      '/stories/editor', sid
    ], { queryParams: { chapterId, sceneId }});
  }

  async copyAllSummaries(): Promise<void> {
    const s = this.story();
    if (!s) return;
    const lines: string[] = [];
    lines.push(`# ${s.title || 'Story'} — Outline Overview`);
    for (const ch of s.chapters) {
      lines.push(`\n## ${ch.chapterNumber}. ${ch.title || 'Untitled Chapter'}`);
      for (const sc of ch.scenes) {
        const title = `${sc.sceneNumber}. ${sc.title || 'Untitled Scene'}`;
        const summary = (sc.summary || '').trim();
        lines.push(`\n### ${title}`);
        lines.push(summary ? summary : '_(no summary)_');
      }
    }
    const text = lines.join('\n');
    try {
      await navigator.clipboard?.writeText(text);
      this.showToast('Summaries copied to clipboard', 'success');
    } catch {
      this.showToast('Failed to copy to clipboard', 'danger');
    }
  }

  // Saving state
  private savingScenes = new Set<string>();
  private savingChapters = new Set<string>();

  // AI generation state (delegated to service)
  isGeneratingSummary(sceneId: string): boolean { return this.sceneAIService.isGeneratingSummary(sceneId); }
  isGeneratingTitle(sceneId: string): boolean { return this.sceneAIService.isGeneratingTitle(sceneId); }
  isSavingScene(sceneId: string): boolean { return this.savingScenes.has(sceneId); }
  isSavingChapter(chapterId: string): boolean { return this.savingChapters.has(chapterId); }

  // --- Scene Card Event Handlers ---
  async onSceneUpdate(event: SceneUpdateEvent): Promise<void> {
    const s = this.story();
    if (!s) return;

    this.savingScenes.add(event.sceneId);

    try {
      const update = event.field === 'title'
        ? { title: event.value }
        : { summary: event.value };

      await this.storyService.updateScene(s.id, event.chapterId, event.sceneId, update);

      const updatedChapters = s.chapters.map(ch => {
        if (ch.id !== event.chapterId) return ch;
        return {
          ...ch,
          updatedAt: new Date(),
          scenes: ch.scenes.map(sc => sc.id === event.sceneId
            ? { ...sc, ...update, updatedAt: new Date() }
            : sc
          )
        };
      });
      this.story.set({ ...s, chapters: updatedChapters, updatedAt: new Date() });
    } catch (e) {
      console.error(`Failed to save scene ${event.field}`, e);
      this.showToast(`Failed to save scene ${event.field}. Please try again.`, 'danger');
    } finally {
      this.savingScenes.delete(event.sceneId);
    }
  }

  async onSceneAIGenerate(event: SceneAIGenerateEvent): Promise<void> {
    if (event.type === 'summary') {
      await this.generateSceneSummary(event.chapterId, event.sceneId);
    } else {
      await this.generateSceneTitle(event.chapterId, event.sceneId);
    }
  }

  onSceneNavigate(event: SceneNavigateEvent): void {
    this.openInEditor(event.chapterId, event.sceneId);
  }

  // --- AI Generation (delegated to SceneAIGenerationService) ---
  private async generateSceneSummary(chapterId: string, sceneId: string): Promise<void> {
    const s = this.story();
    if (!s) return;
    const chapter = s.chapters.find(c => c.id === chapterId);
    const scene = chapter?.scenes.find(sc => sc.id === sceneId);
    if (!scene || !scene.content?.trim()) return;

    const sceneWordCount = this.getSceneWordCount(sceneId) || this.storyStats.calculateSceneWordCount(scene);
    const storyLanguage = s.settings?.language || 'en';

    const result = await this.sceneAIService.generateSceneSummary({
      storyId: s.id,
      sceneId,
      sceneTitle: scene.title || 'Untitled',
      sceneContent: scene.content,
      sceneWordCount,
      storyLanguage,
      model: this.selectedModel || undefined
    });

    if (result.entriesDropped && result.entriesDropped > 0) {
      const included = (result.totalEntries || 0) - result.entriesDropped;
      this.showToast(
        `Codex limited: ${included} of ${result.totalEntries} entries included (token budget)`,
        'warning'
      );
    }

    if (!result.success) {
      this.dialogService.showError({ header: 'Generation Error', message: result.error || 'Failed to generate summary.' });
      return;
    }

    if (result.text) {
      const updatedChapters = s.chapters.map(ch => ch.id === chapterId ? {
        ...ch,
        scenes: ch.scenes.map(sc => sc.id === sceneId ? { ...sc, summary: result.text, summaryGeneratedAt: new Date(), updatedAt: new Date() } : sc),
        updatedAt: new Date()
      } : ch);
      this.story.set({ ...s, chapters: updatedChapters, updatedAt: new Date() });
      await this.storyService.updateScene(s.id, chapterId, sceneId, { summary: result.text, summaryGeneratedAt: new Date() });
      this.promptManager.refresh();
    }
  }

  private async generateSceneTitle(chapterId: string, sceneId: string): Promise<void> {
    const s = this.story();
    if (!s) return;
    const chapter = s.chapters.find(c => c.id === chapterId);
    const scene = chapter?.scenes.find(sc => sc.id === sceneId);
    if (!scene || !scene.content?.trim()) return;

    const result = await this.sceneAIService.generateSceneTitle({
      storyId: s.id,
      sceneId,
      sceneContent: scene.content,
      model: this.selectedModel || undefined
    });

    if (!result.success) {
      this.dialogService.showError({ header: 'Generation Error', message: result.error || 'Failed to generate title.' });
      return;
    }

    if (result.text) {
      const newTitle = result.text;
      const updatedChapters = s.chapters.map(ch => ch.id === chapterId ? {
        ...ch,
        scenes: ch.scenes.map(sc => sc.id === sceneId ? { ...sc, title: newTitle, updatedAt: new Date() } : sc),
        updatedAt: new Date()
      } : ch);
      this.story.set({ ...s, chapters: updatedChapters, updatedAt: new Date() });
      await this.storyService.updateScene(s.id, chapterId, sceneId, { title: newTitle });
      this.promptManager.refresh();
    }
  }

  // --- Chapter Header Event Handlers ---
  async onChapterTitleUpdate(event: ChapterTitleUpdateEvent): Promise<void> {
    const s = this.story();
    if (!s) return;

    this.savingChapters.add(event.chapterId);

    try {
      await this.storyService.updateChapter(s.id, event.chapterId, { title: event.title });
      const updatedChapters = s.chapters.map(ch =>
        ch.id === event.chapterId ? { ...ch, title: event.title, updatedAt: new Date() } : ch
      );
      this.story.set({ ...s, chapters: updatedChapters, updatedAt: new Date() });
    } catch (e) {
      console.error('Failed to save chapter title', e);
      this.showToast('Failed to save chapter title. Please try again.', 'danger');
    } finally {
      this.savingChapters.delete(event.chapterId);
    }
  }

  private async scrollToScene(sceneId: string): Promise<void> {
    const element = document.getElementById(`scene-${sceneId}`);
    if (element && this.content) {
      try {
        // Get element position relative to the page
        const rect = element.getBoundingClientRect();
        const scrollElement = await this.content.getScrollElement();
        const scrollTop = scrollElement.scrollTop;

        // Calculate absolute Y position
        const yPosition = rect.top + scrollTop - 100; // 100px offset from top

        // Use Ionic's scrollToPoint for mobile compatibility
        await this.content.scrollToPoint(0, yPosition, 500);

        // Add a highlight effect
        element.classList.add('highlight');
        const highlightTimeout = setTimeout(() => element.classList.remove('highlight'), 2000);
        this.activeTimeouts.push(highlightTimeout);
      } catch (error) {
        console.error('Error scrolling to scene:', error);
        // Fallback to standard scrollIntoView
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  private async showToast(message: string, color: 'success' | 'warning' | 'danger') {
    const toast = await this.toastController.create({
      message,
      duration: 4000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }
}
