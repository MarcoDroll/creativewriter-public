/**
 * Integration Tests for Story Export/Import with Media
 *
 * These tests use real PouchDB databases to verify actual attachment operations
 * work correctly end-to-end, unlike unit tests that mock database operations.
 *
 * Test coverage:
 * - Export story with images as ZIP archive
 * - Export story with videos as ZIP archive
 * - Preserve image-video associations in export
 * - Full round-trip: Export → Import with media intact
 * - Preserve binary data through export/import cycle
 * - Update content references after import
 * - Handle archives with multiple images and videos
 * - Keep cover image as base64 in story.json
 */
import { TestBed } from '@angular/core/testing';
import PouchDB from 'pouchdb-browser';
import PouchDBFind from 'pouchdb-find';
import JSZip from '@progress/jszip-esm';
import { StoryExportImportService, StoryExportData } from './story-export-import.service';
import { StoryService } from './story.service';
import { CodexService } from './codex.service';
import { DatabaseBackupService } from '../../shared/services/database-backup.service';
import { DatabaseService } from '../../core/services/database.service';
import { Story } from '../models/story.interface';
import { Codex } from '../models/codex.interface';
import {
  STORY_IMAGE_PREFIX,
  STORY_VIDEO_PREFIX,
  ATTACHMENT_NAME_IMAGE,
  ATTACHMENT_NAME_VIDEO,
  StoryImageDoc,
  StoryVideoDoc
} from '../../shared/models/story-media.interface';

// Register PouchDB-find plugin
PouchDB.plugin(PouchDBFind);

describe('StoryExportImportService Integration', () => {
  let service: StoryExportImportService;
  let testDb: PouchDB.Database;
  let mockStoryService: jasmine.SpyObj<StoryService>;
  let mockCodexService: jasmine.SpyObj<CodexService>;
  let mockDatabaseBackupService: jasmine.SpyObj<DatabaseBackupService>;

  const TEST_DB_NAME = 'test-export-import-integration';

  // Test data constants
  const TEST_STORY_ID = 'test-story-123';
  const TEST_IMAGE_ID = 'img_test_001';
  const TEST_VIDEO_ID = 'vid_test_001';

  // Small test PNG (1x1 pixel, red)
  const TEST_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  // Small test MP4 header (minimal valid MP4)
  const TEST_MP4_BASE64 = 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE=';

  /**
   * Create a test story document
   */
  function createTestStory(overrides: Partial<Story> = {}): Story {
    const now = new Date();
    return {
      _id: TEST_STORY_ID,
      id: TEST_STORY_ID,
      title: 'Test Story for Export',
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
              content: '<p>Some content</p>',
              order: 1,
              sceneNumber: 1,
              createdAt: now,
              updatedAt: now
            }
          ],
          createdAt: now,
          updatedAt: now
        }
      ],
      createdAt: now,
      updatedAt: now,
      ...overrides
    };
  }

  /**
   * Create a test codex
   */
  function createTestCodex(storyId: string): Codex {
    const now = new Date();
    return {
      id: `codex-${storyId}`,
      storyId: storyId,
      title: 'Test Codex',
      categories: [
        {
          id: 'category-1',
          title: 'Characters',
          description: 'Test characters',
          icon: 'person',
          order: 1,
          entries: [
            {
              id: 'entry-1',
              categoryId: 'category-1',
              title: 'Test Character',
              content: 'A test character',
              order: 1,
              createdAt: now,
              updatedAt: now
            }
          ],
          createdAt: now,
          updatedAt: now
        }
      ],
      createdAt: now,
      updatedAt: now
    };
  }

  /**
   * Create a real image attachment in the test database
   */
  async function createTestImage(
    db: PouchDB.Database,
    storyId: string,
    imageId: string,
    options: { videoId?: string } = {}
  ): Promise<{ docId: string; blob: Blob }> {
    const docId = `${STORY_IMAGE_PREFIX}${storyId}_${imageId}`;

    // Decode base64 to blob
    const binaryString = atob(TEST_PNG_BASE64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'image/png' });

    const imageDoc: Omit<StoryImageDoc, '_attachments'> = {
      _id: docId,
      type: 'story-image',
      storyId,
      imageId,
      name: `${imageId}.png`,
      mimeType: 'image/png',
      size: blob.size,
      width: 1,
      height: 1,
      createdAt: new Date(),
      videoId: options.videoId
    };

    // Put document then attach blob
    const result = await db.put(imageDoc);
    await db.putAttachment(docId, ATTACHMENT_NAME_IMAGE, result.rev, blob, 'image/png');

    return { docId, blob };
  }

  /**
   * Create a real video attachment in the test database
   */
  async function createTestVideo(
    db: PouchDB.Database,
    storyId: string,
    videoId: string
  ): Promise<{ docId: string; blob: Blob }> {
    const docId = `${STORY_VIDEO_PREFIX}${storyId}_${videoId}`;

    // Decode base64 to blob
    const binaryString = atob(TEST_MP4_BASE64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: 'video/mp4' });

    const videoDoc: Omit<StoryVideoDoc, '_attachments'> = {
      _id: docId,
      type: 'story-video',
      storyId,
      videoId,
      name: `${videoId}.mp4`,
      mimeType: 'video/mp4',
      size: blob.size,
      createdAt: new Date()
    };

    // Put document then attach blob
    const result = await db.put(videoDoc);
    await db.putAttachment(docId, ATTACHMENT_NAME_VIDEO, result.rev, blob, 'video/mp4');

    return { docId, blob };
  }

  /**
   * Compare two blobs for equality
   */
  async function blobsAreEqual(blob1: Blob, blob2: Blob): Promise<boolean> {
    if (blob1.size !== blob2.size) {
      return false;
    }

    const buffer1 = await blob1.arrayBuffer();
    const buffer2 = await blob2.arrayBuffer();

    const view1 = new Uint8Array(buffer1);
    const view2 = new Uint8Array(buffer2);

    for (let i = 0; i < view1.length; i++) {
      if (view1[i] !== view2[i]) {
        return false;
      }
    }

    return true;
  }

  beforeEach(async () => {
    // Create real test database with unique name to avoid conflicts
    const uniqueDbName = `${TEST_DB_NAME}-${Date.now()}`;
    testDb = new PouchDB(uniqueDbName);

    // Create index for type field (needed by the service)
    await testDb.createIndex({ index: { fields: ['type'] } });
    await testDb.createIndex({ index: { fields: ['type', 'storyId'] } });

    // Create mock services
    mockStoryService = jasmine.createSpyObj('StoryService', ['getStory', 'getAllStories', 'updateStory']);
    mockCodexService = jasmine.createSpyObj('CodexService', ['getCodex', 'setCodexCache']);
    mockDatabaseBackupService = jasmine.createSpyObj('DatabaseBackupService', ['downloadFile']);

    // Configure StoryService mock to read from real database
    mockStoryService.getStory.and.callFake(async (storyId: string) => {
      try {
        return await testDb.get(storyId);
      } catch {
        return null;
      }
    });
    mockStoryService.getAllStories.and.returnValue(Promise.resolve([]));
    mockStoryService.updateStory.and.returnValue(Promise.resolve());

    // Configure CodexService mock
    mockCodexService.getCodex.and.returnValue(undefined);

    // Configure TestBed with real database
    TestBed.configureTestingModule({
      providers: [
        StoryExportImportService,
        { provide: StoryService, useValue: mockStoryService },
        { provide: CodexService, useValue: mockCodexService },
        { provide: DatabaseBackupService, useValue: mockDatabaseBackupService },
        {
          provide: DatabaseService,
          useValue: {
            getDatabase: () => Promise.resolve(testDb)
          }
        }
      ]
    });

    service = TestBed.inject(StoryExportImportService);
  });

  afterEach(async () => {
    // Clean up test database
    try {
      await testDb.destroy();
    } catch {
      // Ignore cleanup errors
    }
  });

  afterAll(async () => {
    // Clean up any orphaned test databases from failed test runs
    // This is important for mobile development where IndexedDB quota is limited
    if ('databases' in indexedDB) {
      try {
        const databases = await indexedDB.databases();
        for (const dbInfo of databases) {
          if (dbInfo.name?.includes('test-export-import-integration')) {
            indexedDB.deleteDatabase(dbInfo.name);
          }
        }
      } catch {
        // Ignore cleanup errors - some browsers may not support databases()
      }
    }
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Export Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Export with Images', () => {
    it('should export story with images as ZIP archive', async () => {
      // Setup: Create story + image in real DB
      const story = createTestStory();
      await testDb.put(story);
      const { blob: originalBlob } = await createTestImage(testDb, TEST_STORY_ID, TEST_IMAGE_ID);

      // Action: Call exportStory()
      const archiveBlob = await service.exportStory(TEST_STORY_ID);

      // Assert: Result is a Blob
      expect(archiveBlob).toBeInstanceOf(Blob);

      // Assert: ZIP contains story.json + images folder
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(archiveBlob);

      expect(zipContent.file('story.json')).not.toBeNull();

      const imagesFolder = zipContent.folder('images');
      expect(imagesFolder).not.toBeNull();

      // Assert: Image file exists in ZIP
      const imageFile = zipContent.file(`images/${TEST_IMAGE_ID}.png`);
      expect(imageFile).not.toBeNull();

      // Assert: Image binary data matches original
      const exportedImageBuffer = await imageFile!.async('arraybuffer');
      const exportedBlob = new Blob([exportedImageBuffer], { type: 'image/png' });
      expect(await blobsAreEqual(originalBlob, exportedBlob)).toBeTrue();

      // Assert: story.json contains image manifest
      const storyJsonFile = zipContent.file('story.json');
      const jsonContent = await storyJsonFile!.async('string');
      const exportData = JSON.parse(jsonContent) as StoryExportData;

      expect(exportData.media).toBeDefined();
      expect(exportData.media!.images.length).toBe(1);
      expect(exportData.media!.images[0].imageId).toBe(TEST_IMAGE_ID);
      expect(exportData.media!.images[0].filename).toBe(`${TEST_IMAGE_ID}.png`);
    });

    it('should export story with videos as ZIP archive', async () => {
      // Setup: Create story + video in real DB
      const story = createTestStory();
      await testDb.put(story);
      const { blob: originalBlob } = await createTestVideo(testDb, TEST_STORY_ID, TEST_VIDEO_ID);

      // Action: Call exportStory()
      const archiveBlob = await service.exportStory(TEST_STORY_ID);

      // Assert: ZIP contains videos folder
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(archiveBlob);

      const videosFolder = zipContent.folder('videos');
      expect(videosFolder).not.toBeNull();

      // Assert: Video file exists in ZIP
      const videoFile = zipContent.file(`videos/${TEST_VIDEO_ID}.mp4`);
      expect(videoFile).not.toBeNull();

      // Assert: Video binary data matches original
      const exportedVideoBuffer = await videoFile!.async('arraybuffer');
      const exportedBlob = new Blob([exportedVideoBuffer], { type: 'video/mp4' });
      expect(await blobsAreEqual(originalBlob, exportedBlob)).toBeTrue();

      // Assert: story.json contains video manifest
      const storyJsonFile = zipContent.file('story.json');
      const jsonContent = await storyJsonFile!.async('string');
      const exportData = JSON.parse(jsonContent) as StoryExportData;

      expect(exportData.media).toBeDefined();
      expect(exportData.media!.videos.length).toBe(1);
      expect(exportData.media!.videos[0].videoId).toBe(TEST_VIDEO_ID);
    });

    it('should preserve image-video associations in export', async () => {
      // Setup: Create story with image linked to video
      const story = createTestStory();
      await testDb.put(story);

      // Create video first
      await createTestVideo(testDb, TEST_STORY_ID, TEST_VIDEO_ID);

      // Create image with video link
      await createTestImage(testDb, TEST_STORY_ID, TEST_IMAGE_ID, { videoId: TEST_VIDEO_ID });

      // Action: Export
      const archiveBlob = await service.exportStory(TEST_STORY_ID);

      // Assert: Manifest contains association
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(archiveBlob);
      const storyJsonFile = zipContent.file('story.json');
      const jsonContent = await storyJsonFile!.async('string');
      const exportData = JSON.parse(jsonContent) as StoryExportData;

      const imageRef = exportData.media!.images[0];
      expect(imageRef.videoId).toBe(TEST_VIDEO_ID);
    });

    it('should keep cover image as base64 in story.json', async () => {
      // Setup: Story with cover image (base64)
      const coverBase64 = `data:image/png;base64,${TEST_PNG_BASE64}`;
      const story = createTestStory({ coverImage: coverBase64 });
      await testDb.put(story);

      // Action: Export
      const archiveBlob = await service.exportStory(TEST_STORY_ID);

      // Assert: story.json contains base64 cover, not file reference
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(archiveBlob);
      const storyJsonFile = zipContent.file('story.json');
      const jsonContent = await storyJsonFile!.async('string');
      const exportData = JSON.parse(jsonContent) as StoryExportData;

      expect(exportData.story.coverImage).toBe(coverBase64);
      expect(exportData.story.coverImage).toContain('data:image/png;base64,');
    });

    it('should handle archives with multiple images and videos', async () => {
      // Setup: Story with 3 images, 2 videos
      const story = createTestStory();
      await testDb.put(story);

      const imageIds = ['img_001', 'img_002', 'img_003'];
      const videoIds = ['vid_001', 'vid_002'];

      for (const imageId of imageIds) {
        await createTestImage(testDb, TEST_STORY_ID, imageId);
      }

      for (const videoId of videoIds) {
        await createTestVideo(testDb, TEST_STORY_ID, videoId);
      }

      // Action: Export
      const archiveBlob = await service.exportStory(TEST_STORY_ID);

      // Assert: All media included
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(archiveBlob);
      const storyJsonFile = zipContent.file('story.json');
      const jsonContent = await storyJsonFile!.async('string');
      const exportData = JSON.parse(jsonContent) as StoryExportData;

      expect(exportData.media!.images.length).toBe(3);
      expect(exportData.media!.videos.length).toBe(2);
      expect(exportData.metadata.mediaStats!.imageCount).toBe(3);
      expect(exportData.metadata.mediaStats!.videoCount).toBe(2);

      // Assert: All files exist in ZIP
      for (const imageId of imageIds) {
        expect(zipContent.file(`images/${imageId}.png`)).not.toBeNull();
      }
      for (const videoId of videoIds) {
        expect(zipContent.file(`videos/${videoId}.mp4`)).not.toBeNull();
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Import Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Import from Archive', () => {
    it('should import exported story with all media intact', async () => {
      // Setup: Create story with images and videos
      const story = createTestStory();
      await testDb.put(story);
      await createTestImage(testDb, TEST_STORY_ID, TEST_IMAGE_ID);
      await createTestVideo(testDb, TEST_STORY_ID, TEST_VIDEO_ID);

      // Export
      const archiveBlob = await service.exportStory(TEST_STORY_ID);

      // Import into same DB (will create new story with different ID)
      const file = new File([archiveBlob], 'test-export.cwx', { type: 'application/zip' });
      const result = await service.importStoryFromArchive(file);

      // Assert: New story has new ID
      expect(result.storyId).not.toBe(TEST_STORY_ID);
      expect(result.storyId).toBeTruthy();

      // Assert: New story exists in database
      const newStory = await testDb.get(result.storyId) as Story;
      expect(newStory).toBeDefined();
      expect(newStory.title).toBe('Test Story for Export');

      // Assert: Images imported with new IDs
      const imageResult = await testDb.find({
        selector: {
          type: 'story-image',
          storyId: result.storyId
        }
      });
      expect(imageResult.docs.length).toBe(1);

      const importedImage = imageResult.docs[0] as StoryImageDoc;
      expect(importedImage.imageId).not.toBe(TEST_IMAGE_ID);

      // Assert: Videos imported with new IDs
      const videoResult = await testDb.find({
        selector: {
          type: 'story-video',
          storyId: result.storyId
        }
      });
      expect(videoResult.docs.length).toBe(1);

      const importedVideo = videoResult.docs[0] as StoryVideoDoc;
      expect(importedVideo.videoId).not.toBe(TEST_VIDEO_ID);
    });

    it('should preserve image binary data through export/import cycle', async () => {
      // Setup: Create image with known binary content
      const story = createTestStory();
      await testDb.put(story);
      const { blob: originalBlob } = await createTestImage(testDb, TEST_STORY_ID, TEST_IMAGE_ID);

      // Export → Import
      const archiveBlob = await service.exportStory(TEST_STORY_ID);
      const file = new File([archiveBlob], 'test-export.cwx', { type: 'application/zip' });
      const result = await service.importStoryFromArchive(file);

      // Get imported image
      const imageResult = await testDb.find({
        selector: {
          type: 'story-image',
          storyId: result.storyId
        }
      });

      expect(imageResult.docs.length).toBe(1);
      const importedImage = imageResult.docs[0] as StoryImageDoc;

      // Get attachment from imported image
      const importedBlob = await testDb.getAttachment(importedImage._id, ATTACHMENT_NAME_IMAGE) as Blob;

      // Assert: Binary data matches exactly
      expect(await blobsAreEqual(originalBlob, importedBlob)).toBeTrue();
    });

    it('should preserve video binary data through export/import cycle', async () => {
      // Setup: Create video with known binary content
      const story = createTestStory();
      await testDb.put(story);
      const { blob: originalBlob } = await createTestVideo(testDb, TEST_STORY_ID, TEST_VIDEO_ID);

      // Export → Import
      const archiveBlob = await service.exportStory(TEST_STORY_ID);
      const file = new File([archiveBlob], 'test-export.cwx', { type: 'application/zip' });
      const result = await service.importStoryFromArchive(file);

      // Get imported video
      const videoResult = await testDb.find({
        selector: {
          type: 'story-video',
          storyId: result.storyId
        }
      });

      expect(videoResult.docs.length).toBe(1);
      const importedVideo = videoResult.docs[0] as StoryVideoDoc;

      // Get attachment from imported video
      const importedBlob = await testDb.getAttachment(importedVideo._id, ATTACHMENT_NAME_VIDEO) as Blob;

      // Assert: Binary data matches exactly
      expect(await blobsAreEqual(originalBlob, importedBlob)).toBeTrue();
    });

    it('should update image references in beat content after import', async () => {
      // Setup: Story with beat containing image references
      const oldImageId = 'img_old_123';
      const storyWithImageRefs = createTestStory({
        chapters: [{
          id: 'chapter-1',
          title: 'Chapter One',
          order: 1,
          chapterNumber: 1,
          scenes: [{
            id: 'scene-1',
            title: 'Scene One',
            content: `<div class="image-container image-id-${oldImageId}"><img data-story-id="${TEST_STORY_ID}" data-image-id="${oldImageId}" /></div>`,
            order: 1,
            sceneNumber: 1,
            createdAt: new Date(),
            updatedAt: new Date()
          }],
          createdAt: new Date(),
          updatedAt: new Date()
        }]
      });

      await testDb.put(storyWithImageRefs);
      await createTestImage(testDb, TEST_STORY_ID, oldImageId);

      // Export → Import
      const archiveBlob = await service.exportStory(TEST_STORY_ID);
      const file = new File([archiveBlob], 'test-export.cwx', { type: 'application/zip' });
      const result = await service.importStoryFromArchive(file);

      // Get imported story
      const importedStory = await testDb.get(result.storyId) as Story;
      const sceneContent = importedStory.chapters[0].scenes[0].content;

      // Get new image ID
      const imageResult = await testDb.find({
        selector: {
          type: 'story-image',
          storyId: result.storyId
        }
      });
      const newImageId = (imageResult.docs[0] as StoryImageDoc).imageId;

      // Assert: Content has new image IDs in attributes and CSS classes
      expect(sceneContent).toContain(`data-story-id="${result.storyId}"`);
      expect(sceneContent).not.toContain(`data-story-id="${TEST_STORY_ID}"`);
      expect(sceneContent).toContain(`data-image-id="${newImageId}"`);
      expect(sceneContent).not.toContain(`data-image-id="${oldImageId}"`);
      expect(sceneContent).toContain(`image-id-${newImageId}`);
      expect(sceneContent).not.toContain(`image-id-${oldImageId}`);
    });

    it('should preserve image-video associations through import', async () => {
      // Setup: Story with image linked to video
      const story = createTestStory();
      await testDb.put(story);
      await createTestVideo(testDb, TEST_STORY_ID, TEST_VIDEO_ID);
      await createTestImage(testDb, TEST_STORY_ID, TEST_IMAGE_ID, { videoId: TEST_VIDEO_ID });

      // Export → Import
      const archiveBlob = await service.exportStory(TEST_STORY_ID);
      const file = new File([archiveBlob], 'test-export.cwx', { type: 'application/zip' });
      const result = await service.importStoryFromArchive(file);

      // Get imported image and video
      const imageResult = await testDb.find({
        selector: { type: 'story-image', storyId: result.storyId }
      });
      const videoResult = await testDb.find({
        selector: { type: 'story-video', storyId: result.storyId }
      });

      const importedImage = imageResult.docs[0] as StoryImageDoc;
      const importedVideo = videoResult.docs[0] as StoryVideoDoc;

      // Assert: Image still linked to video with new IDs
      expect(importedImage.videoId).toBe(importedVideo.videoId);
    });

    it('should handle import of multiple images and videos', async () => {
      // Setup: Story with 3 images, 2 videos
      const story = createTestStory();
      await testDb.put(story);

      const imageIds = ['img_001', 'img_002', 'img_003'];
      const videoIds = ['vid_001', 'vid_002'];

      for (const imageId of imageIds) {
        await createTestImage(testDb, TEST_STORY_ID, imageId);
      }
      for (const videoId of videoIds) {
        await createTestVideo(testDb, TEST_STORY_ID, videoId);
      }

      // Export → Import
      const archiveBlob = await service.exportStory(TEST_STORY_ID);
      const file = new File([archiveBlob], 'test-export.cwx', { type: 'application/zip' });
      const result = await service.importStoryFromArchive(file);

      // Assert: All media imported
      const imageResult = await testDb.find({
        selector: { type: 'story-image', storyId: result.storyId }
      });
      const videoResult = await testDb.find({
        selector: { type: 'story-video', storyId: result.storyId }
      });

      expect(imageResult.docs.length).toBe(3);
      expect(videoResult.docs.length).toBe(2);

      // Assert: All have new IDs
      for (const doc of imageResult.docs) {
        const imageDoc = doc as StoryImageDoc;
        expect(imageIds).not.toContain(imageDoc.imageId);
      }
      for (const doc of videoResult.docs) {
        const videoDoc = doc as StoryVideoDoc;
        expect(videoIds).not.toContain(videoDoc.videoId);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Export with Codex Tests
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Export/Import with Codex', () => {
    it('should export and import story with codex', async () => {
      // Setup: Create story and codex
      const story = createTestStory();
      const codex = createTestCodex(TEST_STORY_ID);
      await testDb.put(story);

      // Mock getCodex to return our codex
      mockCodexService.getCodex.and.returnValue(codex);

      // Export
      const archiveBlob = await service.exportStory(TEST_STORY_ID);

      // Verify export contains codex
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(archiveBlob);
      const storyJsonFile = zipContent.file('story.json');
      const jsonContent = await storyJsonFile!.async('string');
      const exportData = JSON.parse(jsonContent) as StoryExportData;

      expect(exportData.codex).toBeDefined();
      expect(exportData.codex!.title).toBe('Test Codex');

      // Import
      const file = new File([archiveBlob], 'test-export.cwx', { type: 'application/zip' });
      const result = await service.importStoryFromArchive(file);

      // Assert: Codex was imported
      expect(result.codexId).toBeDefined();
      expect(mockCodexService.setCodexCache).toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Edge Cases
  // ═══════════════════════════════════════════════════════════════════════════

  describe('Edge Cases', () => {
    it('should handle export of story with no media', async () => {
      // Setup: Story with no images or videos
      const story = createTestStory();
      await testDb.put(story);

      // Export
      const archiveBlob = await service.exportStory(TEST_STORY_ID);

      // Assert: Archive is valid with empty media
      const zip = new JSZip();
      const zipContent = await zip.loadAsync(archiveBlob);
      const storyJsonFile = zipContent.file('story.json');
      const jsonContent = await storyJsonFile!.async('string');
      const exportData = JSON.parse(jsonContent) as StoryExportData;

      expect(exportData.media).toBeDefined();
      expect(exportData.media!.images).toEqual([]);
      expect(exportData.media!.videos).toEqual([]);
      expect(exportData.metadata.mediaStats!.imageCount).toBe(0);
      expect(exportData.metadata.mediaStats!.videoCount).toBe(0);
    });

    it('should import archive with no media', async () => {
      // Setup: Export story with no media
      const story = createTestStory();
      await testDb.put(story);

      const archiveBlob = await service.exportStory(TEST_STORY_ID);

      // Import
      const file = new File([archiveBlob], 'test-export.cwx', { type: 'application/zip' });
      const result = await service.importStoryFromArchive(file);

      // Assert: Import succeeded
      expect(result.storyId).toBeTruthy();

      // Assert: No media documents created
      const imageResult = await testDb.find({
        selector: { type: 'story-image', storyId: result.storyId }
      });
      const videoResult = await testDb.find({
        selector: { type: 'story-video', storyId: result.storyId }
      });

      expect(imageResult.docs.length).toBe(0);
      expect(videoResult.docs.length).toBe(0);
    });

    it('should generate unique titles for duplicate imports', async () => {
      // Setup: Create and export story
      const story = createTestStory();
      await testDb.put(story);

      const archiveBlob = await service.exportStory(TEST_STORY_ID);

      // Mock getAllStories to return existing stories
      mockStoryService.getAllStories.and.returnValue(Promise.resolve([
        { title: 'Test Story for Export' } as Story,
        { title: 'Test Story for Export (imported)' } as Story
      ]));

      // Import
      const file = new File([archiveBlob], 'test-export.cwx', { type: 'application/zip' });
      const result = await service.importStoryFromArchive(file);

      // Assert: Title was made unique
      expect(result.finalTitle).toBe('Test Story for Export (imported 2)');
    });
  });
});
