import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { RouterTestingModule } from '@angular/router/testing';
import { HttpClientTestingModule } from '@angular/common/http/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { ToastController } from '@ionic/angular/standalone';

import { StoryOutlineOverviewComponent } from './story-outline-overview.component';
import { StoryService } from '../../services/story.service';
import { PromptManagerService } from '../../../shared/services/prompt-manager.service';
import { StoryStatsService } from '../../services/story-stats.service';
import { SceneAIGenerationService } from '../../../shared/services/scene-ai-generation.service';
import { DialogService } from '../../../core/services/dialog.service';
import { Story, Chapter, Scene } from '../../models/story.interface';

describe('StoryOutlineOverviewComponent', () => {
  let component: StoryOutlineOverviewComponent;
  let fixture: ComponentFixture<StoryOutlineOverviewComponent>;
  let mockStoryService: jasmine.SpyObj<StoryService>;
  let mockPromptManager: jasmine.SpyObj<PromptManagerService>;
  let mockStoryStats: jasmine.SpyObj<StoryStatsService>;
  let mockSceneAIService: jasmine.SpyObj<SceneAIGenerationService>;
  let mockDialogService: jasmine.SpyObj<DialogService>;
  let mockToastController: jasmine.SpyObj<ToastController>;
  let mockRouter: jasmine.SpyObj<Router>;

  const mockScene: Scene = {
    id: 'scene-1',
    title: 'Test Scene',
    content: 'Test scene content with some words.',
    summary: 'Test summary',
    order: 1,
    sceneNumber: 1,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const mockChapter: Chapter = {
    id: 'chapter-1',
    title: 'Test Chapter',
    order: 1,
    chapterNumber: 1,
    scenes: [mockScene],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const mockStory: Story = {
    id: 'story-1',
    title: 'Test Story',
    chapters: [mockChapter],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  beforeEach(async () => {
    mockStoryService = jasmine.createSpyObj('StoryService', ['getStory', 'updateScene', 'updateChapter']);
    mockPromptManager = jasmine.createSpyObj('PromptManagerService', ['refresh']);
    mockStoryStats = jasmine.createSpyObj('StoryStatsService', ['calculateSceneWordCount']);
    mockSceneAIService = jasmine.createSpyObj('SceneAIGenerationService', [
      'generateSceneSummary', 'generateSceneTitle', 'isGeneratingSummary', 'isGeneratingTitle'
    ]);
    mockDialogService = jasmine.createSpyObj('DialogService', ['showError']);
    mockToastController = jasmine.createSpyObj('ToastController', ['create']);
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);

    // Default mocks
    mockStoryService.getStory.and.returnValue(Promise.resolve(mockStory));
    mockStoryService.updateScene.and.returnValue(Promise.resolve());
    mockStoryService.updateChapter.and.returnValue(Promise.resolve());
    mockStoryStats.calculateSceneWordCount.and.returnValue(100);
    mockSceneAIService.isGeneratingSummary.and.returnValue(false);
    mockSceneAIService.isGeneratingTitle.and.returnValue(false);

    const mockToast = jasmine.createSpyObj('Toast', ['present']);
    mockToastController.create.and.returnValue(Promise.resolve(mockToast));

    await TestBed.configureTestingModule({
      imports: [
        StoryOutlineOverviewComponent,
        RouterTestingModule,
        HttpClientTestingModule
      ],
      providers: [
        { provide: StoryService, useValue: mockStoryService },
        { provide: PromptManagerService, useValue: mockPromptManager },
        { provide: StoryStatsService, useValue: mockStoryStats },
        { provide: SceneAIGenerationService, useValue: mockSceneAIService },
        { provide: DialogService, useValue: mockDialogService },
        { provide: ToastController, useValue: mockToastController },
        { provide: Router, useValue: mockRouter },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: { get: () => 'story-1' },
              queryParamMap: { get: () => null }
            }
          }
        }
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(StoryOutlineOverviewComponent);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  describe('Initialization', () => {
    it('should load story from route param', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect(mockStoryService.getStory).toHaveBeenCalledWith('story-1');
      expect(component.story()).toBeTruthy();
      expect(component.story()?.id).toBe('story-1');
    }));

    it('should redirect to home if no story id in route', fakeAsync(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        imports: [StoryOutlineOverviewComponent, RouterTestingModule, HttpClientTestingModule],
        providers: [
          { provide: StoryService, useValue: mockStoryService },
          { provide: PromptManagerService, useValue: mockPromptManager },
          { provide: StoryStatsService, useValue: mockStoryStats },
          { provide: SceneAIGenerationService, useValue: mockSceneAIService },
          { provide: DialogService, useValue: mockDialogService },
          { provide: ToastController, useValue: mockToastController },
          { provide: Router, useValue: mockRouter },
          {
            provide: ActivatedRoute,
            useValue: {
              snapshot: {
                paramMap: { get: () => null },
                queryParamMap: { get: () => null }
              }
            }
          }
        ],
        schemas: [CUSTOM_ELEMENTS_SCHEMA]
      }).compileComponents();

      const noIdFixture = TestBed.createComponent(StoryOutlineOverviewComponent);
      noIdFixture.detectChanges();
      tick();

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/']);
    }));

    it('should load story with many chapters', fakeAsync(() => {
      const manyChapters: Chapter[] = Array.from({ length: 15 }, (_, i) => ({
        ...mockChapter,
        id: `chapter-${i}`,
        chapterNumber: i + 1
      }));
      const storyWithManyChapters = { ...mockStory, chapters: manyChapters };
      mockStoryService.getStory.and.returnValue(Promise.resolve(storyWithManyChapters));

      fixture.detectChanges();
      tick();

      // Accordion expanded state is now managed by Ionic internally
      expect(component.story()?.chapters.length).toBe(15);
    }));
  });

  describe('Search/Filter', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
    }));

    it('should filter chapters by title', () => {
      const storyWithMultipleChapters: Story = {
        ...mockStory,
        chapters: [
          { ...mockChapter, id: 'ch1', title: 'Alpha Chapter', scenes: [mockScene] },
          { ...mockChapter, id: 'ch2', title: 'Beta Chapter', scenes: [mockScene] }
        ]
      };
      component.story.set(storyWithMultipleChapters);

      component.query.set('alpha');

      const filtered = component.filteredChapters();
      expect(filtered.length).toBe(1);
      expect(filtered[0].title).toBe('Alpha Chapter');
    });

    it('should filter scenes by summary content', () => {
      const storyWithSummaries: Story = {
        ...mockStory,
        chapters: [{
          ...mockChapter,
          scenes: [
            { ...mockScene, id: 'sc1', summary: 'Dragons attack the castle' },
            { ...mockScene, id: 'sc2', summary: 'Heroes celebrate victory' }
          ]
        }]
      };
      component.story.set(storyWithSummaries);

      component.query.set('dragon');

      const filtered = component.filteredChapters();
      expect(filtered.length).toBe(1);
      expect(filtered[0].scenes.length).toBe(1);
      expect(filtered[0].scenes[0].summary).toContain('Dragons');
    });

    it('should return empty when no matches', () => {
      component.query.set('xyznonexistent');

      const filtered = component.filteredChapters();
      expect(filtered.length).toBe(0);
    });
  });

  describe('Copy All Summaries', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
    }));

    it('should format summaries as markdown', () => {
      spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.resolve());

      component.copyAllSummaries();

      expect(navigator.clipboard.writeText).toHaveBeenCalled();
      const calledWith = (navigator.clipboard.writeText as jasmine.Spy).calls.mostRecent().args[0];
      expect(calledWith).toContain('# Test Story');
      expect(calledWith).toContain('## 1. Test Chapter');
      expect(calledWith).toContain('### 1. Test Scene');
      expect(calledWith).toContain('Test summary');
    });

    it('should handle missing summaries', () => {
      const storyNoSummary: Story = {
        ...mockStory,
        chapters: [{
          ...mockChapter,
          scenes: [{ ...mockScene, summary: undefined }]
        }]
      };
      component.story.set(storyNoSummary);
      spyOn(navigator.clipboard, 'writeText').and.returnValue(Promise.resolve());

      component.copyAllSummaries();

      const calledWith = (navigator.clipboard.writeText as jasmine.Spy).calls.mostRecent().args[0];
      expect(calledWith).toContain('_(no summary)_');
    });
  });

  describe('Scene Updates', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
    }));

    it('should update scene summary', fakeAsync(() => {
      component.onSceneUpdate({
        sceneId: 'scene-1',
        chapterId: 'chapter-1',
        field: 'summary',
        value: 'Updated summary'
      });
      tick();

      expect(mockStoryService.updateScene).toHaveBeenCalledWith(
        'story-1', 'chapter-1', 'scene-1', { summary: 'Updated summary' }
      );
    }));

    it('should update scene title', fakeAsync(() => {
      component.onSceneUpdate({
        sceneId: 'scene-1',
        chapterId: 'chapter-1',
        field: 'title',
        value: 'Updated Title'
      });
      tick();

      expect(mockStoryService.updateScene).toHaveBeenCalledWith(
        'story-1', 'chapter-1', 'scene-1', { title: 'Updated Title' }
      );
    }));
  });

  describe('Chapter Updates', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
    }));

    it('should update chapter title', fakeAsync(() => {
      component.onChapterTitleUpdate({
        chapterId: 'chapter-1',
        title: 'New Chapter Title'
      });
      tick();

      expect(mockStoryService.updateChapter).toHaveBeenCalledWith(
        'story-1', 'chapter-1', { title: 'New Chapter Title' }
      );
    }));
  });

  describe('AI Generation', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
    }));

    it('should call AI service for summary generation', fakeAsync(() => {
      mockSceneAIService.generateSceneSummary.and.returnValue(Promise.resolve({
        success: true,
        text: 'AI generated summary'
      }));

      component.selectedModel = 'test-model';
      component.onSceneAIGenerate({
        sceneId: 'scene-1',
        chapterId: 'chapter-1',
        type: 'summary'
      });
      tick();

      expect(mockSceneAIService.generateSceneSummary).toHaveBeenCalled();
    }));

    it('should call AI service for title generation', fakeAsync(() => {
      mockSceneAIService.generateSceneTitle.and.returnValue(Promise.resolve({
        success: true,
        text: 'AI Generated Title'
      }));

      component.selectedModel = 'test-model';
      component.onSceneAIGenerate({
        sceneId: 'scene-1',
        chapterId: 'chapter-1',
        type: 'title'
      });
      tick();

      expect(mockSceneAIService.generateSceneTitle).toHaveBeenCalled();
    }));

    it('should show error dialog on AI generation failure', fakeAsync(() => {
      mockSceneAIService.generateSceneSummary.and.returnValue(Promise.resolve({
        success: false,
        error: 'API Error'
      }));

      component.selectedModel = 'test-model';
      component.onSceneAIGenerate({
        sceneId: 'scene-1',
        chapterId: 'chapter-1',
        type: 'summary'
      });
      tick();

      expect(mockDialogService.showError).toHaveBeenCalledWith({
        header: 'Generation Error',
        message: 'API Error'
      });
    }));
  });

  // Accordion state is now managed internally by Ionic's IonAccordionGroup

  describe('Word Count', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
    }));

    it('should get scene word count', () => {
      expect(component.getSceneWordCount('scene-1')).toBe(100);
    });

    it('should get word count label', () => {
      expect(component.getSceneWordCountLabel('scene-1')).toBe('100 words');
    });
  });

  describe('Navigation', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
    }));

    it('should navigate to scene in editor', () => {
      component.onSceneNavigate({
        sceneId: 'scene-1',
        chapterId: 'chapter-1'
      });

      expect(mockRouter.navigate).toHaveBeenCalledWith(
        ['/stories/editor', 'story-1'],
        { queryParams: { chapterId: 'chapter-1', sceneId: 'scene-1' } }
      );
    });

    it('should go back to editor', () => {
      component.goBackToEditor('story-1');

      expect(mockRouter.navigate).toHaveBeenCalledWith(['/stories/editor', 'story-1']);
    });
  });

});
