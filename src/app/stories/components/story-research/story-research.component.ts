import { CommonModule } from '@angular/common';
import { Component, ChangeDetectionStrategy, ChangeDetectorRef, OnInit, OnDestroy, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { addIcons } from 'ionicons';
import {
  IonContent,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonButton,
  IonIcon,
  IonTextarea,
  IonSpinner,
  IonItem,
  IonLabel,
  IonBadge,
  IonList,
  IonProgressBar,
  IonModal,
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonRange,
  IonAccordion,
  IonAccordionGroup
} from '@ionic/angular/standalone';
import {
  arrowBack,
  playOutline,
  timeOutline,
  documentTextOutline,
  closeOutline,
  warningOutline,
  refreshOutline,
  trashOutline,
  analyticsOutline
} from 'ionicons/icons';
import { StoryService } from '../../services/story.service';
import { Story, Chapter, Scene } from '../../models/story.interface';
import { AppHeaderComponent, HeaderAction } from '../../../ui/components/app-header.component';
import { ModelSelectorComponent } from '../../../shared/components/model-selector/model-selector.component';
import { StoryResearchService } from '../../services/story-research.service';
import { StoryResearchDoc, StoryResearchSceneFinding } from '../../models/story-research.interface';
import { SettingsService } from '../../../core/services/settings.service';
import { AIProviderValidationService } from '../../../core/services/ai-provider-validation.service';
import { ResearchJobService, ResearchSceneInfo } from '../../services/research-job.service';
import { PendingJobsService } from '../../../core/services/pending-jobs.service';
import { ServerGenerationService } from '../../../core/services/server-generation.service';
import { OpenRouterApiService } from '../../../core/services/openrouter-api.service';
import { GoogleGeminiApiService } from '../../../core/services/google-gemini-api.service';
import { OllamaApiService } from '../../../core/services/ollama-api.service';
import { ClaudeApiService } from '../../../core/services/claude-api.service';
import { OpenAICompatibleApiService } from '../../../core/services/openai-compatible-api.service';
import { firstValueFrom, Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AlertController } from '@ionic/angular';
import { TokenCounterService } from '../../../shared/services/token-counter.service';

interface SceneProgressState {
  chapterId: string;
  sceneId: string;
  chapterTitle: string;
  sceneTitle: string;
  status: 'pending' | 'running' | 'skipped' | 'completed' | 'error';
  response?: string;
  prompt?: string;
  errorMessage?: string;
  tokenEstimate?: number;
  plainText?: string;
}

interface OrderedScene {
  chapter: Chapter;
  scene: Scene;
}

@Component({
  selector: 'app-story-research',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonButton,
    IonIcon,
    IonTextarea,
    IonSpinner,
    IonItem,
    IonLabel,
    IonBadge,
    IonList,
    IonProgressBar,
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonRange,
    IonAccordion,
    IonAccordionGroup,
    AppHeaderComponent,
    ModelSelectorComponent
  ],
  templateUrl: './story-research.component.html',
  styleUrls: ['./story-research.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StoryResearchComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly storyService = inject(StoryService);
  private readonly researchService = inject(StoryResearchService);
  private readonly settingsService = inject(SettingsService);
  private readonly researchJobService = inject(ResearchJobService);
  private readonly pendingJobsService = inject(PendingJobsService);
  private readonly serverGenerationService = inject(ServerGenerationService);
  private readonly openRouterApi = inject(OpenRouterApiService);
  private readonly geminiApi = inject(GoogleGeminiApiService);
  private readonly ollamaApi = inject(OllamaApiService);
  private readonly claudeApi = inject(ClaudeApiService);
  private readonly openAICompatibleApi = inject(OpenAICompatibleApiService);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly alertController = inject(AlertController);
  private readonly tokenCounter = inject(TokenCounterService);
  private readonly aiProviderValidation = inject(AIProviderValidationService);
  private readonly MIN_CONCURRENCY = 1;
  private readonly MAX_CONCURRENCY = 6;

  story: Story | null = null;
  storyId = '';
  task = '';
  selectedModel = '';
  isRunning = false;
  progressMessage = '';
  progressIndex = 0;
  totalScenes = 0;
  sceneProgress: SceneProgressState[] = [];
  sceneFindings: StoryResearchSceneFinding[] = [];
  finalSummary = '';
  errorMessage = '';
  currentRunTask = '';
  currentRunModel = '';
  maxConcurrentScenes = 3;
  readonly minConcurrency = this.MIN_CONCURRENCY;
  readonly maxConcurrency = this.MAX_CONCURRENCY;

  histories: StoryResearchDoc[] = [];
  viewingHistory: StoryResearchDoc | null = null;
  showHistoryList = false;

  headerActions: HeaderAction[] = [];

  estimatedPromptCount = 0;
  estimatedInputTokens = 0;

  // Server-side research tracking
  activeGroupId: string | null = null;
  serverModeAvailable = false;
  hasRecoverableResearch = false;
  recoverableGroupId: string | null = null;
  private progressSubscription: Subscription | null = null;
  private streamingSubscription: Subscription | null = null;

  constructor() {
    addIcons({
      arrowBack,
      playOutline,
      timeOutline,
      documentTextOutline,
      closeOutline,
      warningOutline,
      refreshOutline,
      trashOutline,
      analyticsOutline
    });
  }

  async ngOnInit(): Promise<void> {
    const settings = this.settingsService.getSettings();
    this.selectedModel = settings.selectedModel || '';

    const storyId = this.route.snapshot.paramMap.get('id');
    if (!storyId) {
      await this.router.navigate(['/stories']);
      return;
    }
    this.storyId = storyId;

    await this.loadStoryAndHistory(storyId);
    this.setupHeaderActions();

    // Check if server-side generation is available
    this.serverModeAvailable = await this.serverGenerationService.isServiceAvailable();

    // Check for recoverable research groups (after page refresh)
    if (this.serverModeAvailable) {
      await this.checkForRecoverableResearch();
    }

    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.progressSubscription?.unsubscribe();
    this.streamingSubscription?.unsubscribe();
  }

  get activeSceneFindings(): StoryResearchSceneFinding[] {
    if (this.viewingHistory) return this.viewingHistory.sceneFindings || [];
    return this.sceneFindings;
  }

  get activeSummary(): string {
    if (this.viewingHistory) return this.viewingHistory.summary || '';
    return this.finalSummary;
  }

  get activeStatus(): 'completed' | 'failed' | 'in-progress' | 'idle' {
    if (this.isRunning) return 'in-progress';
    if (this.viewingHistory) return this.viewingHistory.status;
    if (this.finalSummary) return 'completed';
    if (this.errorMessage) return 'failed';
    return 'idle';
  }

  get activeTask(): string {
    if (this.viewingHistory) return this.viewingHistory.task;
    return this.currentRunTask || this.task;
  }

  get activeModel(): string {
    if (this.viewingHistory) return this.viewingHistory.model;
    return this.currentRunModel || this.selectedModel;
  }

  get sceneCountLabel(): string {
    return `${this.estimatedPromptCount} prompt${this.estimatedPromptCount === 1 ? '' : 's'}`;
  }

  get progressValue(): number {
    if (!this.totalScenes || this.totalScenes === 0) return 0;
    const completed = this.sceneProgress.filter(state => state.status === 'completed' || state.status === 'skipped').length;
    return Math.min(1, completed / this.totalScenes);
  }

  get showCostWarning(): boolean {
    if (!this.selectedModel) return true; // Show by default if no model selected
    const [provider] = this.selectedModel.split(':');
    // Hide warning for local/free providers
    return !['ollama', 'openAICompatible'].includes(provider);
  }

  async startResearch(): Promise<void> {
    if (!this.story || this.isRunning) return;
    const trimmedTask = this.task.trim();
    if (!trimmedTask) {
      await this.presentWarningAlert('Missing research task', 'Please describe the research task you want to run before starting.');
      return;
    }
    if (!this.selectedModel) {
      await this.presentWarningAlert('Model selection required', 'Select an AI model before starting the research.');
      return;
    }

    // Validate the provider is configured
    const [provider] = this.selectedModel.split(':');
    const settings = this.settingsService.getSettings();
    if (!this.aiProviderValidation.isProviderAvailable(provider, settings)) {
      await this.presentWarningAlert('Provider not configured', `AI provider '${provider}' is not configured. Please configure it in settings.`);
      return;
    }

    const proceed = await this.confirmHighTokenUsage();
    if (!proceed) return;

    this.isRunning = true;
    this.progressIndex = 0;
    this.progressMessage = '';
    this.sceneProgress = [];
    this.sceneFindings = [];
    this.finalSummary = '';
    this.errorMessage = '';
    this.viewingHistory = null;
    this.currentRunTask = trimmedTask;
    this.currentRunModel = this.selectedModel;
    this.activeGroupId = null;

    const orderedScenes = this.getOrderedScenes();
    if (!orderedScenes.length) {
      await this.presentWarningAlert('No scenes available', 'This story does not contain scenes yet. Add scene content before running story research.');
      this.isRunning = false;
      this.cdr.markForCheck();
      return;
    }

    // Use server-side research if available
    if (this.serverModeAvailable) {
      try {
        await this.startServerSideResearch(trimmedTask, orderedScenes);
        // Server-side research is async - the subscribeToGroupProgress will handle completion
        return;
      } catch (error) {
        console.warn('[StoryResearch] Server-side research failed, falling back to client-side:', error);
        // Fall through to client-side research
      }
    }

    // Client-side research (fallback when server is not available)
    this.totalScenes = orderedScenes.length;
    this.sceneProgress = orderedScenes.map(item => {
      const plainText = this.extractSceneText(item.scene);
      const hasContent = plainText.trim().length > 0;
      const progressState: SceneProgressState = {
        chapterId: item.chapter.id,
        sceneId: item.scene.id,
        chapterTitle: item.chapter.title,
        sceneTitle: item.scene.title,
        status: hasContent ? 'pending' : 'skipped',
        tokenEstimate: hasContent ? this.estimateTokens(plainText) : 0,
        plainText
      };
      return progressState;
    });

    this.updateProgressCounters();
    this.progressMessage = 'Processing scenes…';
    this.cdr.markForCheck();

    const findingsBuffer = new Array<StoryResearchSceneFinding | undefined>(orderedScenes.length);
    const effectiveConcurrency = Math.max(this.MIN_CONCURRENCY, Math.min(this.maxConcurrentScenes, this.MAX_CONCURRENCY));
    this.maxConcurrentScenes = effectiveConcurrency;
    const workerCount = Math.min(effectiveConcurrency, orderedScenes.length);
    let nextSceneIndex = 0;
    let firstError: Error | null = null;

    const runWorker = async (): Promise<void> => {
      while (true) {
        if (firstError) return;
        const currentIndex = nextSceneIndex++;
        if (currentIndex >= orderedScenes.length) return;

        const { chapter, scene } = orderedScenes[currentIndex];
        const progress = this.sceneProgress[currentIndex];
        const plainText = progress.plainText ?? this.extractSceneText(scene);

        if (!plainText.trim()) {
          progress.status = 'skipped';
          progress.tokenEstimate = 0;
          this.updateProgressCounters();
          this.cdr.markForCheck();
          continue;
        }

        progress.status = 'running';
        this.progressMessage = `Analyzing "${scene.title}" (${chapter.title})`;
        this.cdr.markForCheck();

        const prompt = this.buildScenePrompt(chapter, scene, trimmedTask, plainText);
        progress.prompt = prompt;

        try {
          const response = await this.callModel(prompt, { maxTokens: 900 });
          progress.response = response;
          progress.status = 'completed';
          findingsBuffer[currentIndex] = {
            chapterId: chapter.id,
            sceneId: scene.id,
            chapterTitle: chapter.title,
            sceneTitle: scene.title,
            prompt,
            response
          };
          this.updateProgressCounters();
          // Update sceneFindings for real-time display during execution
          this.sceneFindings = findingsBuffer.filter((f): f is StoryResearchSceneFinding => !!f);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error during research. Please try again.';
          progress.status = 'error';
          progress.errorMessage = message;
          firstError = error instanceof Error ? error : new Error(message);
          return;
        } finally {
          this.cdr.markForCheck();
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

      this.sceneFindings = findingsBuffer.filter((finding): finding is StoryResearchSceneFinding => !!finding);

      if (firstError) {
        throw firstError;
      }

      this.progressMessage = 'Compiling final summary';
      this.cdr.markForCheck();

      const summaryPrompt = this.buildSummaryPrompt(trimmedTask, this.sceneFindings);
      const summaryResponse = await this.callModel(summaryPrompt, { maxTokens: 1200 });
      this.finalSummary = summaryResponse;
      this.isRunning = false;
      this.progressMessage = '';

      const saved = await this.researchService.saveResearch({
        storyId: this.story.id,
        task: trimmedTask,
        model: this.currentRunModel,
        sceneFindings: this.sceneFindings,
        summary: summaryResponse,
        status: 'completed'
      });
      await this.refreshHistory(saved.researchId);
      this.cdr.markForCheck();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during research. Please try again.';
      this.errorMessage = message;
      this.isRunning = false;
      this.progressMessage = '';
      const saved = await this.researchService.saveResearch({
        storyId: this.story?.id || this.storyId,
        task: trimmedTask,
        model: this.currentRunModel,
        sceneFindings: this.sceneFindings,
        summary: this.finalSummary,
        status: 'failed',
        errorMessage: message
      });
      await this.refreshHistory(saved.researchId);
      this.cdr.markForCheck();
    }
  }

  async refreshHistory(activeId?: string): Promise<void> {
    if (!this.storyId) return;
    this.histories = await this.researchService.listResearch(this.storyId);
    if (activeId) {
      const active = this.histories.find(h => h.researchId === activeId);
      if (active) {
        this.viewingHistory = active;
        this.currentRunTask = '';
        this.currentRunModel = '';
      }
    }
    this.cdr.markForCheck();
  }

  /**
   * Check for recoverable research groups (after page refresh)
   */
  private async checkForRecoverableResearch(): Promise<void> {
    try {
      const recoverableGroups = await this.researchJobService.getRecoverableGroups();

      // Filter to groups for this story
      // Note: We can't filter by storyId here without resuming, so we show all recoverable groups
      if (recoverableGroups.length > 0) {
        this.hasRecoverableResearch = true;
        this.recoverableGroupId = recoverableGroups[0]; // Take the first one for now
        this.cdr.markForCheck();
      }
    } catch (error) {
      console.error('[StoryResearch] Error checking for recoverable research:', error);
    }
  }

  /**
   * Resume recoverable research from a previous session
   */
  async resumeRecoverableResearch(): Promise<void> {
    if (!this.recoverableGroupId) return;

    try {
      this.isRunning = true;
      this.hasRecoverableResearch = false;
      this.activeGroupId = this.recoverableGroupId;
      this.progressMessage = 'Resuming research...';
      this.cdr.markForCheck();

      // Resume the research group
      const state = await this.researchJobService.resumeResearchGroup(this.recoverableGroupId);

      if (!state) {
        // Group no longer exists
        this.isRunning = false;
        this.activeGroupId = null;
        this.recoverableGroupId = null;
        await this.presentWarningAlert('Research not found', 'The previous research session could not be recovered.');
        this.cdr.markForCheck();
        return;
      }

      // Subscribe to progress updates
      this.subscribeToGroupProgress(this.recoverableGroupId);
      this.recoverableGroupId = null;
      this.cdr.markForCheck();
    } catch (error) {
      console.error('[StoryResearch] Error resuming research:', error);
      this.isRunning = false;
      this.activeGroupId = null;
      this.hasRecoverableResearch = false;
      this.errorMessage = error instanceof Error ? error.message : 'Failed to resume research';
      this.cdr.markForCheck();
    }
  }

  /**
   * Dismiss the recoverable research banner and start fresh
   */
  dismissRecoverableResearch(): void {
    this.hasRecoverableResearch = false;
    this.recoverableGroupId = null;
    this.cdr.markForCheck();
  }

  /**
   * Start server-side research using the generation service
   */
  private async startServerSideResearch(trimmedTask: string, orderedScenes: OrderedScene[]): Promise<void> {
    // Build scene info with prompts
    const sceneInfos: ResearchSceneInfo[] = orderedScenes.map(({ chapter, scene }) => {
      const plainText = this.extractSceneText(scene);
      return {
        chapterId: chapter.id,
        sceneId: scene.id,
        chapterTitle: chapter.title,
        sceneTitle: scene.title,
        prompt: this.buildScenePrompt(chapter, scene, trimmedTask, plainText)
      };
    }).filter(info => {
      // Filter out scenes with no content
      const plainText = this.extractSceneText(
        orderedScenes.find(s => s.scene.id === info.sceneId)?.scene || { content: '' } as Scene
      );
      return plainText.trim().length > 0;
    });

    if (sceneInfos.length === 0) {
      await this.presentWarningAlert('No scenes available', 'This story does not contain scenes with content yet.');
      this.isRunning = false;
      this.cdr.markForCheck();
      return;
    }

    // Initialize progress tracking
    this.totalScenes = sceneInfos.length;
    this.sceneProgress = sceneInfos.map(info => ({
      chapterId: info.chapterId,
      sceneId: info.sceneId,
      chapterTitle: info.chapterTitle,
      sceneTitle: info.sceneTitle,
      status: 'pending' as const,
      tokenEstimate: 0,
      plainText: ''
    }));

    try {
      // Start the research group on the server
      const groupId = await this.researchJobService.startResearchGroup(
        this.storyId,
        sceneInfos,
        trimmedTask,
        this.currentRunModel
      );

      this.activeGroupId = groupId;
      this.progressMessage = 'Processing scenes on server...';
      this.cdr.markForCheck();

      // Subscribe to progress updates
      this.subscribeToGroupProgress(groupId);

    } catch (error) {
      console.error('[StoryResearch] Failed to start server-side research:', error);
      throw error;
    }
  }

  /**
   * Subscribe to progress updates from a research group
   */
  private subscribeToGroupProgress(groupId: string): void {
    // Clean up any existing subscription
    this.progressSubscription?.unsubscribe();

    this.progressSubscription = this.researchJobService.getGroupProgress(groupId).subscribe(
      progress => {
        if (!progress) return;

        // Update progress counters
        this.progressIndex = progress.completedScenes;
        this.totalScenes = progress.totalScenes;

        // Update scene progress states
        this.sceneProgress.forEach(sp => {
          const finding = progress.findings.find(f =>
            f.chapterId === sp.chapterId && f.sceneId === sp.sceneId
          );
          if (finding) {
            sp.status = 'completed';
            sp.response = finding.response;
          }
        });

        // Update findings
        this.sceneFindings = progress.findings;

        // Check if all scene jobs are done
        const allScenesDone = progress.completedScenes + progress.failedScenes >= progress.totalScenes;

        if (allScenesDone && !progress.isSummaryPhase && progress.failedScenes === 0) {
          // All scenes completed, start summary phase
          this.progressMessage = 'Compiling final summary...';
          this.startSummaryPhase(groupId);
        } else if (progress.isSummaryPhase && progress.summaryComplete) {
          // Research is complete
          this.finalSummary = progress.summary || '';
          this.completeServerSideResearch(groupId);
        } else if (progress.failedScenes > 0 && !progress.isSummaryPhase) {
          // Some scenes failed
          this.handleServerSideError(groupId, 'Some scene analyses failed');
        } else if (!progress.isActive && progress.error) {
          // Summary phase failed
          this.handleServerSideError(groupId, progress.error);
        } else {
          this.progressMessage = `Analyzing scenes (${progress.completedScenes}/${progress.totalScenes})...`;
        }

        this.cdr.markForCheck();
      }
    );

    // Also subscribe to streaming events for real-time updates
    this.streamingSubscription?.unsubscribe();
    this.streamingSubscription = this.pendingJobsService.streamingEvent$.pipe(
      filter(event => event.groupId === groupId)
    ).subscribe(() => {
      // Trigger a refresh when we get streaming events
      this.cdr.markForCheck();
    });
  }

  /**
   * Start the summary phase after all scenes are analyzed
   */
  private async startSummaryPhase(groupId: string): Promise<void> {
    const findings = this.researchJobService.getGroupFindings(groupId);
    const summaryPrompt = this.buildSummaryPrompt(this.currentRunTask, findings);

    try {
      await this.researchJobService.startSummaryJob(groupId, summaryPrompt);
    } catch (error) {
      console.error('[StoryResearch] Failed to start summary job:', error);
      this.handleServerSideError(groupId, 'Failed to start summary generation');
    }
  }

  /**
   * Complete server-side research and save results
   */
  private async completeServerSideResearch(_groupId: string): Promise<void> {
    this.isRunning = false;
    this.progressMessage = '';
    this.activeGroupId = null;

    // Clean up subscriptions
    this.progressSubscription?.unsubscribe();
    this.streamingSubscription?.unsubscribe();

    // Save to history
    const saved = await this.researchService.saveResearch({
      storyId: this.storyId,
      task: this.currentRunTask,
      model: this.currentRunModel,
      sceneFindings: this.sceneFindings,
      summary: this.finalSummary,
      status: 'completed'
    });

    await this.refreshHistory(saved.researchId);
    this.cdr.markForCheck();
  }

  /**
   * Handle server-side research errors
   */
  private async handleServerSideError(_groupId: string, errorMessage: string): Promise<void> {
    this.isRunning = false;
    this.progressMessage = '';
    this.activeGroupId = null;
    this.errorMessage = errorMessage;

    // Clean up subscriptions
    this.progressSubscription?.unsubscribe();
    this.streamingSubscription?.unsubscribe();

    // Save partial results to history
    const saved = await this.researchService.saveResearch({
      storyId: this.storyId,
      task: this.currentRunTask,
      model: this.currentRunModel,
      sceneFindings: this.sceneFindings,
      summary: this.finalSummary,
      status: 'failed',
      errorMessage
    });

    await this.refreshHistory(saved.researchId);
    this.cdr.markForCheck();
  }

  async selectHistory(history: StoryResearchDoc): Promise<void> {
    this.viewingHistory = history;
    this.showHistoryList = false;
    this.cdr.markForCheck();
  }

  clearHistorySelection(): void {
    this.viewingHistory = null;
    this.cdr.markForCheck();
  }

  async deleteHistory(history: StoryResearchDoc): Promise<void> {
    await this.researchService.deleteResearch(history.storyId, history.researchId);
    await this.refreshHistory();
    if (this.viewingHistory?.researchId === history.researchId) {
      this.viewingHistory = null;
    }
    this.cdr.markForCheck();
  }

  openHistoryModal(): void {
    this.showHistoryList = true;
    this.cdr.markForCheck();
  }

  closeHistoryModal(): void {
    this.showHistoryList = false;
    this.cdr.markForCheck();
  }

  goBack(): void {
    if (this.storyId) {
      void this.router.navigate(['/stories/editor', this.storyId]);
    } else {
      void this.router.navigate(['/stories']);
    }
  }

  sceneStatusColor(status: SceneProgressState['status']): string {
    switch (status) {
      case 'completed':
        return 'success';
      case 'running':
        return 'warning';
      case 'error':
        return 'danger';
      case 'skipped':
        return 'medium';
      default:
        return 'medium';
    }
  }

  providerLabel(modelId: string): string {
    if (!modelId) return 'Not set';
    const [provider] = modelId.split(':');
    return provider || 'default';
  }

  formatDate(date: Date | string | undefined): string {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString();
  }

  private async loadStoryAndHistory(storyId: string): Promise<void> {
    this.story = await this.storyService.getStory(storyId);
    this.histories = await this.researchService.listResearch(storyId);
    this.estimatedPromptCount = this.calculatePromptCount();
    this.estimatedInputTokens = this.calculateEstimatedTokens();
  }

  private calculatePromptCount(): number {
    if (!this.story) return 0;
    return this.getOrderedScenes().filter(item => this.extractSceneText(item.scene).trim()).length + 1;
  }

  private calculateEstimatedTokens(): number {
    if (!this.story) return 0;
    const scenes = this.getOrderedScenes()
      .map(item => this.extractSceneText(item.scene))
      .filter(text => text.trim().length > 0);
    const estimate = scenes.reduce((total, text) => total + this.estimateTokens(text), 0);
    return estimate;
  }

  private estimateTokens(text: string): number {
    if (!text) return 0;
    const estimate = this.tokenCounter.countTokensSync(text);
    return estimate.tokens;
  }

  private getOrderedScenes(): OrderedScene[] {
    if (!this.story) return [];
    const chapters = [...(this.story.chapters || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const ordered: OrderedScene[] = [];
    for (const chapter of chapters) {
      const scenes = [...(chapter.scenes || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      for (const scene of scenes) {
        ordered.push({ chapter, scene });
      }
    }
    return ordered;
  }

  private setupHeaderActions(): void {
    this.headerActions = [
      {
        icon: 'time-outline',
        label: 'History',
        action: () => this.openHistoryModal(),
        tooltip: 'Research history'
      },
      {
        icon: 'refresh-outline',
        label: 'Reset',
        action: () => this.resetCurrentState(),
        tooltip: 'Clear current research'
      }
    ];
  }

  private resetCurrentState(): void {
    if (this.isRunning) return;
    this.sceneProgress = [];
    this.sceneFindings = [];
    this.finalSummary = '';
    this.errorMessage = '';
    this.currentRunTask = '';
    this.currentRunModel = '';
    this.viewingHistory = null;
    this.cdr.markForCheck();
  }

  private buildScenePrompt(chapter: Chapter, scene: Scene, task: string, sceneContent: string): string {
    const languageInstruction = this.getLanguageInstruction();
    return `You are assisting with narrative research on a fiction project.\n\nResearch task: ${task}\n\nFocus scene:\nChapter: ${chapter.title}\nScene: ${scene.title}\n\nScene text:\n${sceneContent}\n\nInstructions:\n- Extract only the details that help address the research task.\n- Mention characters, locations, events, or world-building elements that matter.\n- Note unanswered questions or missing information.\n- Limit your answer to concise bullet points.\n- ${languageInstruction}`;
  }

  private buildSummaryPrompt(task: string, findings: StoryResearchSceneFinding[]): string {
    const languageInstruction = this.getLanguageInstruction();
    const formattedFindings = findings.map((finding, index) => `Scene ${index + 1} (${finding.chapterTitle} → ${finding.sceneTitle}):\n${finding.response}`).join('\n\n');
    return `You have reviewed multiple scenes of a story. Use the scene-level research notes to deliver the final research response.\n\nOriginal task: ${task}\n\nScene findings:\n${formattedFindings}\n\nInstructions:\n- Synthesize the findings into a cohesive answer for the research task.\n- Highlight overarching patterns, conflicts, or gaps to investigate.\n- Suggest next research steps if relevant.\n- Present the result as structured sections with short headings.\n- ${languageInstruction}`;
  }

  private async confirmHighTokenUsage(): Promise<boolean> {
    const settings = this.settingsService.getSettings();
    if (settings.research?.skipConfirmation) {
      return true;
    }

    const effectiveConcurrency = Math.max(this.MIN_CONCURRENCY, Math.min(this.maxConcurrentScenes, this.MAX_CONCURRENCY));
    const alert = await this.alertController.create({
      header: 'Token usage warning',
      message: `This will trigger ${this.estimatedPromptCount} prompts and send the full text of each scene. Up to ${effectiveConcurrency} prompts run in parallel. Expensive hosted models may incur significant costs. Continue?`,
      inputs: [
        {
          type: 'checkbox',
          label: 'Don\'t ask again',
          value: 'skip',
          checked: false
        }
      ],
      buttons: [
        { text: 'Cancel', role: 'cancel' },
        { text: 'Proceed', role: 'confirm' }
      ]
    });
    await alert.present();
    const result = await alert.onDidDismiss();

    // Save preference if checkbox was checked
    if (result.role === 'confirm' && result.data?.values?.includes('skip')) {
      await this.settingsService.updateSettings({
        research: { skipConfirmation: true }
      });
    }

    return result.role === 'confirm';
  }

  private async presentWarningAlert(header: string, message: string): Promise<void> {
    const alert = await this.alertController.create({
      header,
      message,
      buttons: ['OK']
    });
    await alert.present();
  }

  private updateProgressCounters(): void {
    this.progressIndex = this.sceneProgress.filter(state => state.status === 'completed' || state.status === 'skipped').length;
  }

  private extractSceneText(scene: Scene): string {
    const raw = scene.content ?? '';
    if (!raw.trim()) return '';

    const normalized = raw
      .replace(/(<br\s*\/?>(\s|&nbsp;)*){2,}/gi, '\n\n')
      .replace(/<br\s*\/?>(\s|&nbsp;)*/gi, '\n')
      .replace(/<\/p>/gi, '</p>\n')
      .replace(/<\/div>/gi, '</div>\n');

    const parser = new DOMParser();
    const doc = parser.parseFromString(normalized, 'text/html');

    const beatSelectors = '.beat-ai-wrapper, .beat-ai-node, .beat-ai-container, .beat-ai-suggestion, ' +
      '.beat-ai-input, .ai-suggestion, .beat-suggestion, [data-beat-ai], [data-ai], ' +
      '[class*="beat-ai"], [class*="ai-beat"], [data-type="beat-ai"]';
    doc.querySelectorAll(beatSelectors).forEach(element => element.remove());

    const text = doc.body.textContent || '';
    return text
      .replace(/\u00a0/g, ' ')
      .replace(/\s+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
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
      default:
        return 'Respond in the same language as the research task and story context.';
    }
  }

  private async callModel(prompt: string, options: { maxTokens: number; temperature?: number }): Promise<string> {
    const modelId = this.currentRunModel || this.selectedModel || this.settingsService.getSettings().selectedModel;
    if (!modelId) {
      throw new Error('No AI model configured.');
    }

    const [provider, ...idParts] = modelId.split(':');
    const modelName = idParts.join(':');
    const maxTokens = Math.max(300, options.maxTokens);
    const temperature = options.temperature ?? 0.7;
    const wordCount = Math.round(maxTokens / 1.3);

    // Validate that the provider is configured and available
    const settings = this.settingsService.getSettings();
    if (!this.aiProviderValidation.isProviderAvailable(provider, settings)) {
      throw new Error(`AI provider '${provider}' is not configured or not available. Please configure it in settings.`);
    }

    switch (provider) {
      case 'openrouter': {
        const response = await firstValueFrom(this.openRouterApi.generateText(prompt, {
          model: modelName,
          maxTokens,
          temperature,
          wordCount,
          stream: false,
          messages: [{ role: 'user', content: prompt }]
        }));
        return response.choices?.[0]?.message?.content?.trim() || '';
      }
      case 'gemini': {
        const response = await firstValueFrom(this.geminiApi.generateText(prompt, {
          model: modelName,
          maxTokens,
          temperature,
          wordCount,
          stream: false,
          messages: [{ role: 'user', content: prompt }]
        }));
        const candidate = response.candidates?.[0]?.content?.parts?.[0]?.text;
        return candidate?.trim() || '';
      }
      case 'ollama': {
        const response = await firstValueFrom(this.ollamaApi.generateText(prompt, {
          model: modelName,
          maxTokens,
          temperature,
          stream: false
        }));
        if ('response' in response) {
          return response.response?.trim() || '';
        }
        if ('message' in response) {
          return response.message?.content?.trim() || '';
        }
        return '';
      }
      case 'claude': {
        const response = await firstValueFrom(this.claudeApi.generateText(prompt, {
          model: modelName,
          maxTokens,
          temperature,
          wordCount,
          messages: [{ role: 'user', content: prompt }],
          stream: false
        }));
        const contentParts = response.content?.map(part => part.text) ?? [];
        const text = contentParts.join('\n').trim();
        return text || '';
      }
      case 'openaiCompatible': {
        const response = await firstValueFrom(
          this.openAICompatibleApi.generateText(prompt, {
            model: modelName,
            maxTokens,
            temperature,
            wordCount,
            stream: false,
            messages: [{ role: 'user', content: prompt }]
          })
        );
        return response.choices?.[0]?.message?.content?.trim() || '';
      }
      default:
        throw new Error(`The selected provider (${provider || 'unknown'}) is not supported for story research yet.`);
    }
  }
}
