import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';

import { StorySettingsComponent } from './story-settings.component';
import { StoryService } from '../../services/story.service';
import { StoryExportImportService, StoryExportData } from '../../services/story-export-import.service';
import { DbMaintenanceService } from '../../../shared/services/db-maintenance.service';
import { ModelService } from '../../../core/services/model.service';
import { DialogService } from '../../../core/services/dialog.service';
import { Story } from '../../models/story.interface';

describe('StorySettingsComponent - Export/Import', () => {
  let component: StorySettingsComponent;
  let fixture: ComponentFixture<StorySettingsComponent>;
  let mockStoryService: jasmine.SpyObj<StoryService>;
  let mockExportImportService: jasmine.SpyObj<StoryExportImportService>;
  let mockDbMaintenanceService: jasmine.SpyObj<DbMaintenanceService>;
  let mockModelService: jasmine.SpyObj<ModelService>;
  let mockDialogService: jasmine.SpyObj<DialogService>;
  let mockRouter: jasmine.SpyObj<Router>;
  let mockActivatedRoute: { snapshot: { paramMap: { get: jasmine.Spy } } };

  const mockStory: Story = {
    _id: 'story-123',
    id: 'story-123',
    title: 'Test Story',
    chapters: [
      {
        id: 'chapter-1',
        title: 'Chapter One',
        order: 1,
        chapterNumber: 1,
        scenes: [
          {
            id: 'scene-1',
            title: 'Scene One',
            content: '<p>Content</p>',
            order: 1,
            sceneNumber: 1,
            createdAt: new Date(),
            updatedAt: new Date()
          },
          {
            id: 'scene-2',
            title: 'Scene Two',
            content: '<p>More content</p>',
            order: 2,
            sceneNumber: 2,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: 'chapter-2',
        title: 'Chapter Two',
        order: 2,
        chapterNumber: 2,
        scenes: [
          {
            id: 'scene-3',
            title: 'Scene Three',
            content: '<p>Even more</p>',
            order: 1,
            sceneNumber: 1,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        ],
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const mockExportData: StoryExportData = {
    version: 1,
    exportDate: '2025-01-01T00:00:00.000Z',
    story: mockStory,
    codex: {
      id: 'codex-123',
      storyId: 'story-123',
      title: 'Test Codex',
      categories: [
        {
          id: 'cat-1',
          title: 'Characters',
          description: 'Story characters',
          icon: 'person',
          order: 1,
          entries: [
            {
              id: 'entry-1',
              categoryId: 'cat-1',
              title: 'Hero',
              content: 'The main character',
              order: 1,
              createdAt: new Date(),
              updatedAt: new Date()
            },
            {
              id: 'entry-2',
              categoryId: 'cat-1',
              title: 'Villain',
              content: 'The antagonist',
              order: 2,
              createdAt: new Date(),
              updatedAt: new Date()
            }
          ],
          createdAt: new Date(),
          updatedAt: new Date()
        }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    },
    metadata: {
      appVersion: '1.0.0',
      originalStoryId: 'story-123',
      originalCodexId: 'codex-123'
    }
  };

  beforeEach(async () => {
    mockStoryService = jasmine.createSpyObj('StoryService', ['getStory', 'updateStory']);
    mockExportImportService = jasmine.createSpyObj('StoryExportImportService', [
      'exportStory',
      'downloadExport',
      'getMaxImportFileSize',
      'validateImportData',
      'parseImportData',
      'importStory',
      'isArchiveFile',
      'parseArchiveForPreview',
      'importStoryFromArchive'
    ]);
    mockDbMaintenanceService = jasmine.createSpyObj('DbMaintenanceService', ['formatBytes'], {
      operationProgress$: of({ operation: '', progress: 0, message: '' })
    });
    mockModelService = jasmine.createSpyObj('ModelService', ['getCombinedModels']);
    mockDialogService = jasmine.createSpyObj('DialogService', ['showError', 'showSuccess', 'confirm', 'confirmDestructive', 'confirmWarning']);
    mockDialogService.showError.and.returnValue(Promise.resolve());
    mockDialogService.showSuccess.and.returnValue(Promise.resolve());
    mockDialogService.confirmDestructive.and.returnValue(Promise.resolve(true));
    mockDialogService.confirmWarning.and.returnValue(Promise.resolve(true));
    mockRouter = jasmine.createSpyObj('Router', ['navigate']);
    mockActivatedRoute = {
      snapshot: {
        paramMap: {
          get: jasmine.createSpy('get').and.returnValue('story-123')
        }
      }
    };

    // Default mock returns
    mockStoryService.getStory.and.returnValue(Promise.resolve(mockStory));
    mockModelService.getCombinedModels.and.returnValue(of([]));
    mockExportImportService.getMaxImportFileSize.and.returnValue(500 * 1024 * 1024);
    mockExportImportService.isArchiveFile.and.returnValue(false); // Default to legacy JSON behavior

    await TestBed.configureTestingModule({
      imports: [StorySettingsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: StoryService, useValue: mockStoryService },
        { provide: StoryExportImportService, useValue: mockExportImportService },
        { provide: DbMaintenanceService, useValue: mockDbMaintenanceService },
        { provide: ModelService, useValue: mockModelService },
        { provide: DialogService, useValue: mockDialogService },
        { provide: Router, useValue: mockRouter },
        { provide: ActivatedRoute, useValue: mockActivatedRoute }
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA]
    }).compileComponents();

    fixture = TestBed.createComponent(StorySettingsComponent);
    component = fixture.componentInstance;
  });

  describe('component creation', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should load story on init', fakeAsync(() => {
      fixture.detectChanges();
      tick();

      expect(mockStoryService.getStory).toHaveBeenCalledWith('story-123');
      expect(component.story).toEqual(mockStory);
    }));
  });

  describe('exportStory', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
    }));

    it('should export story successfully', async () => {
      const mockBlob = new Blob(['{"test": "data"}'], { type: 'application/zip' });
      mockExportImportService.exportStory.and.returnValue(Promise.resolve(mockBlob));

      await component.exportStory();

      expect(mockExportImportService.exportStory).toHaveBeenCalledWith('story-123');
      expect(mockExportImportService.downloadExport).toHaveBeenCalledWith(mockBlob, 'Test Story');
    });

    it('should set isExporting to true during export', async () => {
      const mockBlob = new Blob(['{}'], { type: 'application/zip' });
      mockExportImportService.exportStory.and.returnValue(
        new Promise(resolve => setTimeout(() => resolve(mockBlob), 100))
      );

      const exportPromise = component.exportStory();
      expect(component.isExporting).toBeTrue();

      await exportPromise;
      expect(component.isExporting).toBeFalse();
    });

    it('should handle export error gracefully', async () => {
      mockExportImportService.exportStory.and.returnValue(Promise.reject(new Error('Export error')));
      spyOn(console, 'error');

      await component.exportStory();

      expect(mockDialogService.showError).toHaveBeenCalledWith({
        header: 'Export Failed',
        message: 'Export failed. Please try again.'
      });
      expect(component.isExporting).toBeFalse();
    });

    it('should not export if no story is loaded', async () => {
      component.story = null;

      await component.exportStory();

      expect(mockExportImportService.exportStory).not.toHaveBeenCalled();
    });

    it('should use default title if story title is empty', async () => {
      component.story = { ...mockStory, title: '' };
      const mockBlob = new Blob(['{}'], { type: 'application/zip' });
      mockExportImportService.exportStory.and.returnValue(Promise.resolve(mockBlob));

      await component.exportStory();

      expect(mockExportImportService.downloadExport).toHaveBeenCalledWith(mockBlob, 'story');
    });
  });

  describe('onImportFileSelected', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
    }));

    it('should reject files that are too large', async () => {
      const largeFile = new File(['x'.repeat(100)], 'large.json', { type: 'application/json' });
      Object.defineProperty(largeFile, 'size', { value: 600 * 1024 * 1024 }); // 600MB (max is 500MB)

      const mockInput = { files: [largeFile], value: '' } as unknown as HTMLInputElement;
      const mockEvent = { target: mockInput } as unknown as Event;

      await component.onImportFileSelected(mockEvent);

      expect(component.importError).toContain('File too large');
      expect(component.importPreview).toBeNull();
    });

    it('should set import error for invalid JSON', async () => {
      const invalidFile = new File(['not valid json'], 'invalid.json', { type: 'application/json' });
      const mockInput = { files: [invalidFile], value: '' } as unknown as HTMLInputElement;
      const mockEvent = { target: mockInput } as unknown as Event;

      mockExportImportService.validateImportData.and.returnValue({
        valid: false,
        errors: ['Invalid JSON format']
      });

      await component.onImportFileSelected(mockEvent);

      expect(component.importError).toContain('Invalid file');
      expect(component.importPreview).toBeNull();
    });

    it('should set import preview for valid file', async () => {
      const validJson = JSON.stringify(mockExportData);
      const validFile = new File([validJson], 'valid.json', { type: 'application/json' });
      const mockInput = { files: [validFile], value: '' } as unknown as HTMLInputElement;
      const mockEvent = { target: mockInput } as unknown as Event;

      mockExportImportService.validateImportData.and.returnValue({ valid: true, errors: [] });
      mockExportImportService.parseImportData.and.returnValue(mockExportData);

      await component.onImportFileSelected(mockEvent);

      expect(component.importError).toBeNull();
      expect(component.importPreview).toEqual(mockExportData);
    });

    it('should do nothing if no files selected', async () => {
      const mockInput = { files: [] } as unknown as HTMLInputElement;
      const mockEvent = { target: mockInput } as unknown as Event;

      await component.onImportFileSelected(mockEvent);

      expect(mockExportImportService.validateImportData).not.toHaveBeenCalled();
    });

    it('should reset input value after processing', async () => {
      const validJson = JSON.stringify(mockExportData);
      const validFile = new File([validJson], 'valid.json', { type: 'application/json' });
      const mockInput = { files: [validFile], value: 'some-value' } as unknown as HTMLInputElement;
      const mockEvent = { target: mockInput } as unknown as Event;

      mockExportImportService.validateImportData.and.returnValue({ valid: true, errors: [] });
      mockExportImportService.parseImportData.and.returnValue(mockExportData);

      await component.onImportFileSelected(mockEvent);

      expect(mockInput.value).toBe('');
    });
  });

  describe('confirmImport', () => {
    let mockFile: File;

    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
      // Set up import preview state
      component.importPreview = mockExportData;
      // Create a mock file for testing
      mockFile = new File([JSON.stringify(mockExportData)], 'test.json', { type: 'application/json' });
      // Access private property for testing
      (component as unknown as { importFile: File }).importFile = mockFile;
      (component as unknown as { isArchiveImport: boolean }).isArchiveImport = false;
    }));

    it('should import story successfully', async () => {
      const importResult = { storyId: 'new-story-id', codexId: 'new-codex-id', finalTitle: 'Test Story' };
      mockExportImportService.importStory.and.returnValue(Promise.resolve(importResult));

      await component.confirmImport();

      expect(mockExportImportService.importStory).toHaveBeenCalled();
      expect(mockDialogService.showSuccess).toHaveBeenCalledWith({
        header: 'Import Complete',
        message: 'Story imported successfully!'
      });
      expect(mockRouter.navigate).toHaveBeenCalledWith(['/stories/editor', 'new-story-id']);
    });

    it('should show different message if title was changed', async () => {
      const importResult = { storyId: 'new-story-id', finalTitle: 'Test Story (imported)' };
      mockExportImportService.importStory.and.returnValue(Promise.resolve(importResult));

      await component.confirmImport();

      expect(mockDialogService.showSuccess).toHaveBeenCalledWith({
        header: 'Import Complete',
        message: 'Story imported successfully as "Test Story (imported)"!'
      });
    });

    it('should set isImporting during import', async () => {
      mockExportImportService.importStory.and.returnValue(
        new Promise(resolve => setTimeout(() => resolve({ storyId: 'id', finalTitle: 'title' }), 100))
      );

      const importPromise = component.confirmImport();
      expect(component.isImporting).toBeTrue();

      await importPromise;
      expect(component.isImporting).toBeFalse();
    });

    it('should handle import error', async () => {
      mockExportImportService.importStory.and.returnValue(Promise.reject(new Error('Import failed')));
      spyOn(console, 'error');

      await component.confirmImport();

      expect(component.importError).toContain('Import failed');
      expect(component.isImporting).toBeFalse();
    });

    it('should do nothing if no import file', async () => {
      (component as unknown as { importFile: File | null }).importFile = null;

      await component.confirmImport();

      expect(mockExportImportService.importStory).not.toHaveBeenCalled();
    });

    it('should clear import state after successful import', async () => {
      const importResult = { storyId: 'new-story-id', finalTitle: 'Test Story' };
      mockExportImportService.importStory.and.returnValue(Promise.resolve(importResult));
      spyOn(window, 'alert');

      await component.confirmImport();

      expect(component.importPreview).toBeNull();
      expect(component.importError).toBeNull();
    });
  });

  describe('cancelImport', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
    }));

    it('should clear all import state', () => {
      const mockFile = new File(['{}'], 'test.json', { type: 'application/json' });
      component.importPreview = mockExportData;
      (component as unknown as { importFile: File | null }).importFile = mockFile;
      (component as unknown as { isArchiveImport: boolean }).isArchiveImport = false;
      component.importError = 'Some error';

      component.cancelImport();

      expect(component.importPreview).toBeNull();
      expect((component as unknown as { importFile: File | null }).importFile).toBeNull();
      expect(component.importError).toBeNull();
    });
  });

  describe('getImportChapterCount', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
    }));

    it('should return chapter count from import preview', () => {
      component.importPreview = mockExportData;

      expect(component.getImportChapterCount()).toBe(2);
    });

    it('should return 0 if no import preview', () => {
      component.importPreview = null;

      expect(component.getImportChapterCount()).toBe(0);
    });

    it('should return 0 if chapters is undefined', () => {
      component.importPreview = {
        ...mockExportData,
        story: { ...mockExportData.story, chapters: undefined as unknown as [] }
      };

      expect(component.getImportChapterCount()).toBe(0);
    });
  });

  describe('getImportSceneCount', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
    }));

    it('should return total scene count from all chapters', () => {
      component.importPreview = mockExportData;

      expect(component.getImportSceneCount()).toBe(3); // 2 scenes in chapter 1, 1 in chapter 2
    });

    it('should return 0 if no import preview', () => {
      component.importPreview = null;

      expect(component.getImportSceneCount()).toBe(0);
    });

    it('should handle chapters with no scenes', () => {
      component.importPreview = {
        ...mockExportData,
        story: {
          ...mockExportData.story,
          chapters: [
            { ...mockExportData.story.chapters[0], scenes: [] },
            { ...mockExportData.story.chapters[1], scenes: undefined as unknown as [] }
          ]
        }
      };

      expect(component.getImportSceneCount()).toBe(0);
    });
  });

  describe('getImportCodexEntryCount', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
    }));

    it('should return total entry count from all categories', () => {
      component.importPreview = mockExportData;

      expect(component.getImportCodexEntryCount()).toBe(2); // 2 entries in the category
    });

    it('should return 0 if no import preview', () => {
      component.importPreview = null;

      expect(component.getImportCodexEntryCount()).toBe(0);
    });

    it('should return 0 if no codex', () => {
      component.importPreview = { ...mockExportData, codex: undefined };

      expect(component.getImportCodexEntryCount()).toBe(0);
    });

    it('should handle categories with no entries', () => {
      component.importPreview = {
        ...mockExportData,
        codex: {
          ...mockExportData.codex!,
          categories: [
            { ...mockExportData.codex!.categories[0], entries: [] }
          ]
        }
      };

      expect(component.getImportCodexEntryCount()).toBe(0);
    });
  });

  describe('getStorySceneCount', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
    }));

    it('should return total scene count from loaded story', () => {
      expect(component.getStorySceneCount()).toBe(3); // 2 + 1 scenes
    });

    it('should return 0 if no story loaded', () => {
      component.story = null;

      expect(component.getStorySceneCount()).toBe(0);
    });

    it('should return 0 if story has no chapters', () => {
      component.story = { ...mockStory, chapters: [] };

      expect(component.getStorySceneCount()).toBe(0);
    });
  });

  describe('export/import state properties', () => {
    beforeEach(fakeAsync(() => {
      fixture.detectChanges();
      tick();
    }));

    it('should have correct initial export/import state', () => {
      expect(component.isExporting).toBeFalse();
      expect(component.isImporting).toBeFalse();
      expect(component.importPreview).toBeNull();
      expect(component.importError).toBeNull();
    });

    it('should include export-import tab in tabItems', () => {
      const exportImportTab = component.tabItems.find(tab => tab.value === 'export-import');
      expect(exportImportTab).toBeDefined();
      expect(exportImportTab?.label).toBe('Export/Import');
      expect(exportImportTab?.icon).toBe('cloud-download-outline');
    });
  });
});
