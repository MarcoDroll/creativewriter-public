import { TestBed } from '@angular/core/testing';
import JSZip from '@progress/jszip-esm';
import { StoryExportImportService, StoryExportData, ValidationResult } from './story-export-import.service';
import { StoryService } from './story.service';
import { CodexService } from './codex.service';
import { DatabaseBackupService } from '../../shared/services/database-backup.service';
import { DatabaseService } from '../../core/services/database.service';
import { Story } from '../models/story.interface';
import { Codex } from '../models/codex.interface';

describe('StoryExportImportService', () => {
  let service: StoryExportImportService;
  let mockStoryService: jasmine.SpyObj<StoryService>;
  let mockCodexService: jasmine.SpyObj<CodexService>;
  let mockDatabaseBackupService: jasmine.SpyObj<DatabaseBackupService>;
  let mockDatabaseService: jasmine.SpyObj<DatabaseService>;
  let mockDb: jasmine.SpyObj<PouchDB.Database>;

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
            content: '<p>Some content</p><div class="beat-ai-node" data-beat-id="beat-1">Beat content</div>',
            order: 1,
            sceneNumber: 1,
            createdAt: new Date('2025-01-01'),
            updatedAt: new Date('2025-01-02')
          }
        ],
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-02')
      }
    ],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-02')
  };

  const mockCodex: Codex = {
    id: 'codex-123',
    storyId: 'story-123',
    title: 'Test Codex',
    categories: [
      {
        id: 'category-1',
        title: 'Characters',
        description: 'Story characters',
        icon: 'person',
        order: 1,
        entries: [
          {
            id: 'entry-1',
            categoryId: 'category-1',
            title: 'Hero',
            content: 'The main character',
            order: 1,
            createdAt: new Date('2025-01-01'),
            updatedAt: new Date('2025-01-02')
          }
        ],
        createdAt: new Date('2025-01-01'),
        updatedAt: new Date('2025-01-02')
      }
    ],
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-02')
  };

  // V1 legacy format for backward compatibility tests
  const validExportDataV1: StoryExportData = {
    version: 1,
    exportDate: '2025-01-01T00:00:00.000Z',
    story: mockStory,
    codex: mockCodex,
    metadata: {
      appVersion: '1.0.0',
      originalStoryId: 'story-123',
      originalCodexId: 'codex-123'
    }
  };

  // V2 format with media support
  const validExportDataV2: StoryExportData = {
    version: 2,
    exportDate: '2025-01-01T00:00:00.000Z',
    story: mockStory,
    codex: mockCodex,
    media: {
      images: [],
      videos: []
    },
    metadata: {
      appVersion: '1.0.0',
      originalStoryId: 'story-123',
      originalCodexId: 'codex-123',
      mediaStats: {
        imageCount: 0,
        videoCount: 0,
        totalMediaSize: 0
      }
    }
  };

  beforeEach(() => {
    // Create mock database with find method
    mockDb = jasmine.createSpyObj('PouchDB.Database', ['get', 'put', 'allDocs', 'find', 'getAttachment', 'putAttachment']);
    mockDb.find.and.returnValue(Promise.resolve({ docs: [] }));
    mockDb.putAttachment.and.returnValue(Promise.resolve({ ok: true, id: 'doc-id', rev: '2-new' }));

    // Create mock services
    mockStoryService = jasmine.createSpyObj('StoryService', ['getStory', 'getAllStories', 'updateStory']);
    mockCodexService = jasmine.createSpyObj('CodexService', ['getCodex', 'setCodexCache']);
    mockDatabaseBackupService = jasmine.createSpyObj('DatabaseBackupService', ['downloadFile']);
    mockDatabaseService = jasmine.createSpyObj('DatabaseService', ['getDatabase']);

    mockDatabaseService.getDatabase.and.returnValue(Promise.resolve(mockDb as unknown as PouchDB.Database));

    TestBed.configureTestingModule({
      providers: [
        StoryExportImportService,
        { provide: StoryService, useValue: mockStoryService },
        { provide: CodexService, useValue: mockCodexService },
        { provide: DatabaseBackupService, useValue: mockDatabaseBackupService },
        { provide: DatabaseService, useValue: mockDatabaseService }
      ]
    });

    service = TestBed.inject(StoryExportImportService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('getMaxImportFileSize', () => {
    it('should return 500MB as max file size for archives', () => {
      const maxSize = service.getMaxImportFileSize();
      expect(maxSize).toBe(500 * 1024 * 1024);
    });
  });

  describe('isArchiveFile', () => {
    it('should return true for .cwx files', () => {
      const file = new File([''], 'story.cwx');
      expect(service.isArchiveFile(file)).toBeTrue();
    });

    it('should return true for application/zip mime type', () => {
      const file = new File([''], 'story.zip', { type: 'application/zip' });
      expect(service.isArchiveFile(file)).toBeTrue();
    });

    it('should return false for .json files', () => {
      const file = new File([''], 'story.json', { type: 'application/json' });
      expect(service.isArchiveFile(file)).toBeFalse();
    });
  });

  describe('validateImportData', () => {
    it('should return valid for correct v1 export data', () => {
      const jsonData = JSON.stringify(validExportDataV1);
      const result: ValidationResult = service.validateImportData(jsonData);

      expect(result.valid).toBeTrue();
      expect(result.errors.length).toBe(0);
    });

    it('should return valid for correct v2 export data', () => {
      const jsonData = JSON.stringify(validExportDataV2);
      const result: ValidationResult = service.validateImportData(jsonData);

      expect(result.valid).toBeTrue();
      expect(result.errors.length).toBe(0);
    });

    it('should return invalid for malformed JSON', () => {
      const result = service.validateImportData('not valid json {{{');

      expect(result.valid).toBeFalse();
      expect(result.errors).toContain('Invalid JSON format');
    });

    it('should return invalid for missing version field', () => {
      const dataWithoutVersion = { ...validExportDataV1 };
      delete (dataWithoutVersion as Partial<StoryExportData>).version;
      const jsonData = JSON.stringify(dataWithoutVersion);

      const result = service.validateImportData(jsonData);

      expect(result.valid).toBeFalse();
      expect(result.errors).toContain('Missing or invalid version field');
    });

    it('should return invalid for unsupported version', () => {
      const dataWithHighVersion = { ...validExportDataV1, version: 999 };
      const jsonData = JSON.stringify(dataWithHighVersion);

      const result = service.validateImportData(jsonData);

      expect(result.valid).toBeFalse();
      expect(result.errors.some(e => e.includes('Unsupported version'))).toBeTrue();
    });

    it('should return invalid for missing story data', () => {
      const dataWithoutStory = { ...validExportDataV1 };
      delete (dataWithoutStory as Partial<StoryExportData>).story;
      const jsonData = JSON.stringify(dataWithoutStory);

      const result = service.validateImportData(jsonData);

      expect(result.valid).toBeFalse();
      expect(result.errors).toContain('Missing story data');
    });

    it('should return invalid for missing story title', () => {
      const dataWithoutTitle = {
        ...validExportDataV1,
        story: { ...validExportDataV1.story, title: '' }
      };
      const jsonData = JSON.stringify(dataWithoutTitle);

      const result = service.validateImportData(jsonData);

      expect(result.valid).toBeFalse();
      expect(result.errors).toContain('Story is missing title');
    });

    it('should return invalid for missing chapters array', () => {
      const dataWithoutChapters = {
        ...validExportDataV1,
        story: { ...validExportDataV1.story, chapters: null }
      };
      const jsonData = JSON.stringify(dataWithoutChapters);

      const result = service.validateImportData(jsonData);

      expect(result.valid).toBeFalse();
      expect(result.errors).toContain('Story is missing chapters array');
    });

    it('should return invalid for missing metadata', () => {
      const dataWithoutMetadata = { ...validExportDataV1 };
      delete (dataWithoutMetadata as Partial<StoryExportData>).metadata;
      const jsonData = JSON.stringify(dataWithoutMetadata);

      const result = service.validateImportData(jsonData);

      expect(result.valid).toBeFalse();
      expect(result.errors).toContain('Missing metadata');
    });
  });

  describe('parseImportData', () => {
    it('should parse valid export data', () => {
      const jsonData = JSON.stringify(validExportDataV1);
      const result = service.parseImportData(jsonData);

      expect(result.version).toBe(1);
      expect(result.story.title).toBe('Test Story');
      expect(result.codex?.title).toBe('Test Codex');
    });

    it('should throw error for invalid data', () => {
      expect(() => {
        service.parseImportData('invalid json');
      }).toThrowError(/Invalid import data/);
    });
  });

  describe('exportStory', () => {
    it('should export story as a ZIP blob', async () => {
      mockStoryService.getStory.and.returnValue(Promise.resolve(mockStory));
      mockCodexService.getCodex.and.returnValue(mockCodex);

      const result = await service.exportStory('story-123');

      expect(result).toBeInstanceOf(Blob);
    });

    it('should create valid ZIP with story.json', async () => {
      mockStoryService.getStory.and.returnValue(Promise.resolve(mockStory));
      mockCodexService.getCodex.and.returnValue(mockCodex);

      const blob = await service.exportStory('story-123');

      // Parse the ZIP
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(blob);
      const storyJsonFile = zipContent.file('story.json');

      expect(storyJsonFile).not.toBeNull();

      const jsonContent = await storyJsonFile!.async('string');
      const parsed = JSON.parse(jsonContent) as StoryExportData;

      expect(parsed.version).toBe(2);
      expect(parsed.story.title).toBe('Test Story');
      expect(parsed.codex?.title).toBe('Test Codex');
      expect(parsed.metadata.originalStoryId).toBe('story-123');
      expect(parsed.media).toBeDefined();
    });

    it('should export story without codex', async () => {
      mockStoryService.getStory.and.returnValue(Promise.resolve(mockStory));
      mockCodexService.getCodex.and.returnValue(undefined);

      const blob = await service.exportStory('story-123');

      const zip = new JSZip();
      const zipContent = await zip.loadAsync(blob);
      const storyJsonFile = zipContent.file('story.json');
      const jsonContent = await storyJsonFile!.async('string');
      const parsed = JSON.parse(jsonContent) as StoryExportData;

      expect(parsed.story.title).toBe('Test Story');
      expect(parsed.codex).toBeUndefined();
    });

    it('should throw error for non-existent story', async () => {
      mockStoryService.getStory.and.returnValue(Promise.resolve(null));

      await expectAsync(service.exportStory('non-existent')).toBeRejectedWithError('Story not found');
    });

    it('should remove _rev from exported story', async () => {
      const storyWithRev = { ...mockStory, _rev: '1-abc123' };
      mockStoryService.getStory.and.returnValue(Promise.resolve(storyWithRev));
      mockCodexService.getCodex.and.returnValue(undefined);

      const blob = await service.exportStory('story-123');

      const zip = new JSZip();
      const zipContent = await zip.loadAsync(blob);
      const storyJsonFile = zipContent.file('story.json');
      const jsonContent = await storyJsonFile!.async('string');
      const parsed = JSON.parse(jsonContent) as StoryExportData;

      expect(parsed.story._rev).toBeUndefined();
    });

    it('should include media manifest in export', async () => {
      mockStoryService.getStory.and.returnValue(Promise.resolve(mockStory));
      mockCodexService.getCodex.and.returnValue(undefined);

      const blob = await service.exportStory('story-123');

      const zip = new JSZip();
      const zipContent = await zip.loadAsync(blob);
      const storyJsonFile = zipContent.file('story.json');
      const jsonContent = await storyJsonFile!.async('string');
      const parsed = JSON.parse(jsonContent) as StoryExportData;

      expect(parsed.media).toBeDefined();
      expect(parsed.media!.images).toEqual([]);
      expect(parsed.media!.videos).toEqual([]);
      expect(parsed.metadata.mediaStats).toBeDefined();
      expect(parsed.metadata.mediaStats!.imageCount).toBe(0);
      expect(parsed.metadata.mediaStats!.videoCount).toBe(0);
    });
  });

  describe('importStory (legacy v1)', () => {
    beforeEach(() => {
      mockStoryService.getAllStories.and.returnValue(Promise.resolve([]));
      mockStoryService.updateStory.and.returnValue(Promise.resolve());
      mockDb.put.and.returnValue(Promise.resolve({ ok: true, id: 'new-id', rev: '1-new' }));
    });

    it('should import story and generate new IDs', async () => {
      const jsonData = JSON.stringify(validExportDataV1);

      const result = await service.importStory(jsonData);

      expect(result.storyId).toBeDefined();
      expect(result.storyId).not.toBe('story-123'); // Should have new ID
      expect(result.finalTitle).toBe('Test Story');
    });

    it('should handle duplicate title by appending (imported)', async () => {
      const existingStory = { ...mockStory, title: 'Test Story' };
      mockStoryService.getAllStories.and.returnValue(Promise.resolve([existingStory]));

      const jsonData = JSON.stringify(validExportDataV1);
      const result = await service.importStory(jsonData);

      expect(result.finalTitle).toBe('Test Story (imported)');
    });

    it('should handle multiple duplicates by appending (imported N)', async () => {
      const existingStories = [
        { ...mockStory, title: 'Test Story' },
        { ...mockStory, title: 'Test Story (imported)' }
      ];
      mockStoryService.getAllStories.and.returnValue(Promise.resolve(existingStories));

      const jsonData = JSON.stringify(validExportDataV1);
      const result = await service.importStory(jsonData);

      expect(result.finalTitle).toBe('Test Story (imported 2)');
    });

    it('should import story without codex', async () => {
      const exportWithoutCodex = { ...validExportDataV1, codex: undefined };
      const jsonData = JSON.stringify(exportWithoutCodex);

      const result = await service.importStory(jsonData);

      expect(result.storyId).toBeDefined();
      expect(result.codexId).toBeUndefined();
    });

    it('should import story with codex', async () => {
      const jsonData = JSON.stringify(validExportDataV1);

      const result = await service.importStory(jsonData);

      expect(result.storyId).toBeDefined();
      expect(result.codexId).toBeDefined();
      expect(mockCodexService.setCodexCache).toHaveBeenCalled();
    });

    it('should regenerate beat IDs in scene content', async () => {
      const jsonData = JSON.stringify(validExportDataV1);

      // Capture the story that was saved
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let savedStory: any;
      mockDb.put.and.callFake((doc: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((doc as any).chapters) {
          savedStory = doc;
        }
        return Promise.resolve({ ok: true, id: 'new-id', rev: '1-new' });
      });

      await service.importStory(jsonData);

      // The beat ID should be regenerated (different from original)
      const sceneContent = savedStory?.chapters?.[0]?.scenes?.[0]?.content;
      expect(sceneContent).toBeDefined();
      expect(sceneContent).toContain('data-beat-id=');
      expect(sceneContent).not.toContain('data-beat-id="beat-1"'); // Original ID should be replaced
    });
  });

  describe('parseArchiveForPreview', () => {
    it('should parse valid archive and return export data', async () => {
      // Create a test archive
      const zip = new JSZip();
      zip.file('story.json', JSON.stringify(validExportDataV2));
      const blob = await zip.generateAsync({ type: 'blob' });
      const file = new File([blob], 'test.cwx');

      const result = await service.parseArchiveForPreview(file);

      expect(result.version).toBe(2);
      expect(result.story.title).toBe('Test Story');
    });

    it('should throw error for archive without story.json', async () => {
      const zip = new JSZip();
      zip.file('other.txt', 'some content');
      const blob = await zip.generateAsync({ type: 'blob' });
      const file = new File([blob], 'test.cwx');

      await expectAsync(service.parseArchiveForPreview(file))
        .toBeRejectedWithError(/story\.json not found/);
    });

    it('should throw error for invalid story data in archive', async () => {
      const invalidData = { ...validExportDataV2, story: null };
      const zip = new JSZip();
      zip.file('story.json', JSON.stringify(invalidData));
      const blob = await zip.generateAsync({ type: 'blob' });
      const file = new File([blob], 'test.cwx');

      await expectAsync(service.parseArchiveForPreview(file))
        .toBeRejectedWithError(/Invalid archive data/);
    });
  });

  describe('importStoryFromArchive', () => {
    beforeEach(() => {
      mockStoryService.getAllStories.and.returnValue(Promise.resolve([]));
      mockStoryService.updateStory.and.returnValue(Promise.resolve());
      mockDb.put.and.returnValue(Promise.resolve({ ok: true, id: 'new-id', rev: '1-new' }));
    });

    it('should import story from valid archive', async () => {
      const zip = new JSZip();
      zip.file('story.json', JSON.stringify(validExportDataV2));
      const blob = await zip.generateAsync({ type: 'blob' });
      const file = new File([blob], 'test.cwx');

      const result = await service.importStoryFromArchive(file);

      expect(result.storyId).toBeDefined();
      expect(result.storyId).not.toBe('story-123');
      expect(result.finalTitle).toBe('Test Story');
    });

    it('should throw error for archive without story.json', async () => {
      const zip = new JSZip();
      zip.file('other.txt', 'some content');
      const blob = await zip.generateAsync({ type: 'blob' });
      const file = new File([blob], 'test.cwx');

      await expectAsync(service.importStoryFromArchive(file))
        .toBeRejectedWithError(/story\.json not found/);
    });
  });

  describe('downloadExport', () => {
    it('should create download link with .cwx extension', () => {
      const blob = new Blob(['test'], { type: 'application/zip' });
      const storyTitle = 'My Test Story';

      // Spy on document methods
      const mockLink = document.createElement('a');
      spyOn(mockLink, 'click');
      spyOn(document, 'createElement').and.returnValue(mockLink);
      spyOn(document.body, 'appendChild');
      spyOn(document.body, 'removeChild');
      spyOn(URL, 'createObjectURL').and.returnValue('blob:test-url');
      spyOn(URL, 'revokeObjectURL');

      service.downloadExport(blob, storyTitle);

      expect(mockLink.download).toMatch(/my-test-story-export-\d{4}-\d{2}-\d{2}\.cwx/);
      expect(mockLink.href).toBe('blob:test-url');
      expect(mockLink.click).toHaveBeenCalled();
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });

    it('should sanitize special characters in filename', () => {
      const blob = new Blob(['test'], { type: 'application/zip' });
      const storyTitle = 'Story: A "Special" Tale!';

      const mockLink = document.createElement('a');
      spyOn(mockLink, 'click');
      spyOn(document, 'createElement').and.returnValue(mockLink);
      spyOn(document.body, 'appendChild');
      spyOn(document.body, 'removeChild');
      spyOn(URL, 'createObjectURL').and.returnValue('blob:test-url');
      spyOn(URL, 'revokeObjectURL');

      service.downloadExport(blob, storyTitle);

      expect(mockLink.download).not.toContain(':');
      expect(mockLink.download).not.toContain('"');
      expect(mockLink.download).not.toContain('!');
    });
  });

  describe('safeParseDate (via regenerateStoryIds)', () => {
    beforeEach(() => {
      mockStoryService.getAllStories.and.returnValue(Promise.resolve([]));
      mockDb.put.and.returnValue(Promise.resolve({ ok: true, id: 'new-id', rev: '1-new' }));
    });

    it('should handle valid date strings', async () => {
      const exportWithValidDates = {
        ...validExportDataV1,
        story: {
          ...validExportDataV1.story,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-02T00:00:00.000Z'
        }
      };
      const jsonData = JSON.stringify(exportWithValidDates);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let savedStory: any;
      mockDb.put.and.callFake((doc: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((doc as any).chapters) {
          savedStory = doc;
        }
        return Promise.resolve({ ok: true, id: 'new-id', rev: '1-new' });
      });

      await service.importStory(jsonData);

      // Dates should be reset to current time on import
      expect(savedStory?.createdAt).toBeInstanceOf(Date);
      expect(savedStory?.updatedAt).toBeInstanceOf(Date);
    });

    it('should handle invalid date by using current date', async () => {
      const exportWithInvalidDates = {
        ...validExportDataV1,
        story: {
          ...validExportDataV1.story,
          chapters: [{
            ...validExportDataV1.story.chapters[0],
            createdAt: 'invalid-date',
            updatedAt: 'also-invalid'
          }]
        }
      };
      const jsonData = JSON.stringify(exportWithInvalidDates);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let savedStory: any;
      mockDb.put.and.callFake((doc: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((doc as any).chapters) {
          savedStory = doc;
        }
        return Promise.resolve({ ok: true, id: 'new-id', rev: '1-new' });
      });

      await service.importStory(jsonData);

      // Invalid dates should be replaced with valid Date objects
      const chapter = savedStory?.chapters?.[0];
      expect(chapter?.createdAt).toBeInstanceOf(Date);
      expect(chapter?.updatedAt).toBeInstanceOf(Date);
      expect(isNaN(chapter?.createdAt?.getTime())).toBeFalse();
      expect(isNaN(chapter?.updatedAt?.getTime())).toBeFalse();
    });
  });

  describe('ID regeneration', () => {
    beforeEach(() => {
      mockStoryService.getAllStories.and.returnValue(Promise.resolve([]));
      mockDb.put.and.returnValue(Promise.resolve({ ok: true, id: 'new-id', rev: '1-new' }));
    });

    it('should generate unique IDs for all entities', async () => {
      const savedDocs: unknown[] = [];
      mockDb.put.and.callFake((doc: unknown) => {
        savedDocs.push(doc);
        return Promise.resolve({ ok: true, id: 'new-id', rev: '1-new' });
      });

      const jsonData = JSON.stringify(validExportDataV1);
      const result = await service.importStory(jsonData);

      // Story should have new ID
      expect(result.storyId).not.toBe('story-123');

      // Find the saved story
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const savedStory = savedDocs.find((d: any) => d.chapters) as any;
      expect(savedStory).toBeDefined();

      // Chapter should have new ID
      expect(savedStory.chapters[0].id).not.toBe('chapter-1');

      // Scene should have new ID
      expect(savedStory.chapters[0].scenes[0].id).not.toBe('scene-1');

      // Codex should have new ID
      expect(result.codexId).not.toBe('codex-123');
    });

    it('should update codex storyId to match new story ID', async () => {
      let savedCodex: Codex | undefined;
      mockDb.put.and.callFake((doc: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((doc as any).type === 'codex') {
          savedCodex = doc as Codex;
        }
        return Promise.resolve({ ok: true, id: 'new-id', rev: '1-new' });
      });

      const jsonData = JSON.stringify(validExportDataV1);
      const result = await service.importStory(jsonData);

      expect(savedCodex).toBeDefined();
      expect(savedCodex?.storyId).toBe(result.storyId);
    });
  });

  describe('content reference updates', () => {
    beforeEach(() => {
      mockStoryService.getAllStories.and.returnValue(Promise.resolve([]));
      mockDb.put.and.returnValue(Promise.resolve({ ok: true, id: 'new-id', rev: '1-new' }));
    });

    it('should update data-story-id in content', async () => {
      const storyWithImageRefs = {
        ...mockStory,
        chapters: [{
          ...mockStory.chapters[0],
          scenes: [{
            ...mockStory.chapters[0].scenes[0],
            content: '<img data-story-id="story-123" data-image-id="img_old_123" class="image-id-img_old_123" />'
          }]
        }]
      };

      const exportData = {
        ...validExportDataV1,
        story: storyWithImageRefs
      };
      const jsonData = JSON.stringify(exportData);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let savedStory: any;
      mockDb.put.and.callFake((doc: unknown) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if ((doc as any).chapters) {
          savedStory = doc;
        }
        return Promise.resolve({ ok: true, id: 'new-id', rev: '1-new' });
      });

      const result = await service.importStory(jsonData);

      const sceneContent = savedStory?.chapters?.[0]?.scenes?.[0]?.content;
      expect(sceneContent).toContain(`data-story-id="${result.storyId}"`);
      expect(sceneContent).not.toContain('data-story-id="story-123"');
    });
  });
});
