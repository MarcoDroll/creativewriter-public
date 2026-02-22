import { TestBed } from '@angular/core/testing';
import { StoryMetadataIndexService } from './story-metadata-index.service';
import { DatabaseService } from '../../core/services/database.service';
import { StoryStatsService } from './story-stats.service';
import { Story } from '../models/story.interface';
import { StoryMetadataIndex } from '../models/story-metadata.interface';

describe('StoryMetadataIndexService', () => {
  let service: StoryMetadataIndexService;
  let mockDatabaseService: jasmine.SpyObj<DatabaseService>;
  let mockStoryStatsService: jasmine.SpyObj<StoryStatsService>;
  let mockDb: jasmine.SpyObj<PouchDB.Database>;

  // Helper to create a minimal valid story
  const createTestStory = (overrides: Partial<Story> = {}): Story => ({
    id: 'test-story-1',
    title: 'Test Story',
    chapters: [{
      id: 'ch1',
      title: 'Chapter 1',
      order: 0,
      chapterNumber: 1,
      scenes: [{
        id: 'sc1',
        title: 'Scene 1',
        content: 'Test content',
        order: 0,
        sceneNumber: 1,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01')
      }],
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01')
    }],
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides
  });

  // Helper to create a metadata index with a story
  const createTestIndex = (storyOverrides: Partial<Story> = {}): StoryMetadataIndex => {
    const story = createTestStory(storyOverrides);
    return {
      _id: 'story-metadata-index',
      _rev: 'rev-1',
      type: 'story-metadata-index',
      lastUpdated: new Date('2024-01-01'),
      stories: [{
        id: story.id,
        title: story.title,
        coverImageThumbnail: story.coverImage,
        previewText: 'Test content',
        chapterCount: 1,
        sceneCount: 1,
        wordCount: 1000,
        createdAt: story.createdAt,
        updatedAt: story.updatedAt,
        order: story.order
      }]
    };
  };

  beforeEach(() => {
    // Create mock database
    mockDb = jasmine.createSpyObj('PouchDB.Database', ['get', 'put', 'allDocs']);

    // Create mock services
    mockDatabaseService = jasmine.createSpyObj('DatabaseService', ['getDatabase', 'getRemoteDatabase']);
    mockDatabaseService.getDatabase.and.returnValue(Promise.resolve(mockDb));
    mockDatabaseService.getRemoteDatabase.and.returnValue(null); // No remote for these tests

    mockStoryStatsService = jasmine.createSpyObj('StoryStatsService', ['calculateTotalStoryWordCount']);
    mockStoryStatsService.calculateTotalStoryWordCount.and.returnValue(1000);

    TestBed.configureTestingModule({
      providers: [
        StoryMetadataIndexService,
        { provide: DatabaseService, useValue: mockDatabaseService },
        { provide: StoryStatsService, useValue: mockStoryStatsService }
      ]
    });

    service = TestBed.inject(StoryMetadataIndexService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('indexContentEqual (via updateStoryMetadata)', () => {
    // These tests verify the indexContentEqual() private method indirectly
    // by checking whether updateStoryMetadata() triggers a save or not

    it('should detect change when coverImageThumbnail changes from undefined to defined', async () => {
      // Existing index has no cover image
      const existingIndex = createTestIndex({ coverImage: undefined });
      mockDb.get.and.returnValue(Promise.resolve(existingIndex));
      mockDb.put.and.returnValue(Promise.resolve({ ok: true, id: 'story-metadata-index', rev: 'rev-2' }));

      // Update story with a cover image
      const storyWithCover = createTestStory({ coverImage: 'data:image/png;base64,ABC123' });

      await service.updateStoryMetadata(storyWithCover);

      // Should have called put because cover image changed
      expect(mockDb.put).toHaveBeenCalled();
    });

    it('should detect change when coverImageThumbnail changes from defined to undefined', async () => {
      // Existing index has a cover image
      const existingIndex = createTestIndex({ coverImage: 'data:image/png;base64,ABC123' });
      mockDb.get.and.returnValue(Promise.resolve(existingIndex));
      mockDb.put.and.returnValue(Promise.resolve({ ok: true, id: 'story-metadata-index', rev: 'rev-2' }));

      // Update story without a cover image
      const storyWithoutCover = createTestStory({ coverImage: undefined });

      await service.updateStoryMetadata(storyWithoutCover);

      // Should have called put because cover image changed
      expect(mockDb.put).toHaveBeenCalled();
    });

    it('should detect change when coverImageThumbnail content differs', async () => {
      // Existing index has cover image A
      const existingIndex = createTestIndex({ coverImage: 'data:image/png;base64,OLDIMAGE' });
      mockDb.get.and.returnValue(Promise.resolve(existingIndex));
      mockDb.put.and.returnValue(Promise.resolve({ ok: true, id: 'story-metadata-index', rev: 'rev-2' }));

      // Update story with different cover image
      const storyWithNewCover = createTestStory({ coverImage: 'data:image/png;base64,NEWIMAGE' });

      await service.updateStoryMetadata(storyWithNewCover);

      // Should have called put because cover image changed
      expect(mockDb.put).toHaveBeenCalled();
    });

    it('should skip save when coverImageThumbnail is identical', async () => {
      const coverImage = 'data:image/png;base64,SAMEIMAGE';

      // Existing index has the same cover image
      const existingIndex = createTestIndex({ coverImage });
      mockDb.get.and.returnValue(Promise.resolve(existingIndex));
      mockDb.put.and.returnValue(Promise.resolve({ ok: true, id: 'story-metadata-index', rev: 'rev-2' }));

      // Update story with the same cover image (no other changes)
      const storyWithSameCover = createTestStory({ coverImage });

      await service.updateStoryMetadata(storyWithSameCover);

      // Should NOT have called put because nothing changed
      expect(mockDb.put).not.toHaveBeenCalled();
    });

    it('should skip save when both coverImageThumbnails are undefined', async () => {
      // Existing index has no cover image
      const existingIndex = createTestIndex({ coverImage: undefined });
      mockDb.get.and.returnValue(Promise.resolve(existingIndex));
      mockDb.put.and.returnValue(Promise.resolve({ ok: true, id: 'story-metadata-index', rev: 'rev-2' }));

      // Update story also without cover image (no other changes)
      const storyWithoutCover = createTestStory({ coverImage: undefined });

      await service.updateStoryMetadata(storyWithoutCover);

      // Should NOT have called put because nothing changed
      expect(mockDb.put).not.toHaveBeenCalled();
    });

    it('should detect change when coverImageThumbnail is empty string vs undefined', async () => {
      // Existing index has undefined cover image
      const existingIndex = createTestIndex({ coverImage: undefined });
      mockDb.get.and.returnValue(Promise.resolve(existingIndex));
      mockDb.put.and.returnValue(Promise.resolve({ ok: true, id: 'story-metadata-index', rev: 'rev-2' }));

      // Update story with empty string cover image
      const storyWithEmptyCover = createTestStory({ coverImage: '' });

      await service.updateStoryMetadata(storyWithEmptyCover);

      // Should have called put because empty string !== undefined
      expect(mockDb.put).toHaveBeenCalled();
    });

    it('should detect change when title changes even if coverImageThumbnail is same', async () => {
      const coverImage = 'data:image/png;base64,SAMEIMAGE';

      // Existing index
      const existingIndex = createTestIndex({ title: 'Old Title', coverImage });
      mockDb.get.and.returnValue(Promise.resolve(existingIndex));
      mockDb.put.and.returnValue(Promise.resolve({ ok: true, id: 'story-metadata-index', rev: 'rev-2' }));

      // Update story with new title but same cover
      const storyWithNewTitle = createTestStory({ title: 'New Title', coverImage });

      await service.updateStoryMetadata(storyWithNewTitle);

      // Should have called put because title changed
      expect(mockDb.put).toHaveBeenCalled();
    });

    it('should handle large base64 cover images efficiently', async () => {
      // Create a large base64 string (simulating a real image)
      const largeBase64 = 'data:image/png;base64,' + 'A'.repeat(50000); // ~50KB

      // Existing index with the large image
      const existingIndex = createTestIndex({ coverImage: largeBase64 });
      mockDb.get.and.returnValue(Promise.resolve(existingIndex));
      mockDb.put.and.returnValue(Promise.resolve({ ok: true, id: 'story-metadata-index', rev: 'rev-2' }));

      // Update story with the same large image
      const storyWithSameLargeImage = createTestStory({ coverImage: largeBase64 });

      await service.updateStoryMetadata(storyWithSameLargeImage);

      // Should NOT have called put because nothing changed
      expect(mockDb.put).not.toHaveBeenCalled();
    });

    it('should detect change when large cover images differ by one character', async () => {
      // Create two large base64 strings that differ by one character
      const largeBase64A = 'data:image/png;base64,' + 'A'.repeat(50000);
      const largeBase64B = 'data:image/png;base64,' + 'A'.repeat(49999) + 'B';

      // Existing index with image A
      const existingIndex = createTestIndex({ coverImage: largeBase64A });
      mockDb.get.and.returnValue(Promise.resolve(existingIndex));
      mockDb.put.and.returnValue(Promise.resolve({ ok: true, id: 'story-metadata-index', rev: 'rev-2' }));

      // Update story with image B
      const storyWithDifferentImage = createTestStory({ coverImage: largeBase64B });

      await service.updateStoryMetadata(storyWithDifferentImage);

      // Should have called put because images differ
      expect(mockDb.put).toHaveBeenCalled();
    });
  });
});
