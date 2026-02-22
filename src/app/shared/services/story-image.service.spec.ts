import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { StoryImageService } from './story-image.service';
import { DatabaseService } from '../../core/services/database.service';
import {
  StoryImageDoc,
  ATTACHMENT_NAME_IMAGE,
  MAX_IMAGE_SIZE,
  MAX_IMAGES_PER_STORY
} from '../models/story-media.interface';
import {
  createMockImageFile,
  createMockImageDoc,
  createMockDatabase,
  setupMockDatabaseDefaults,
  createMockBlob
} from '../testing/image-test-helpers';

describe('StoryImageService', () => {
  let service: StoryImageService;
  let mockDb: jasmine.SpyObj<PouchDB.Database>;
  let mockDatabaseService: jasmine.SpyObj<DatabaseService>;

  // Store original URL methods
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;
  let urlCounter: number;

  beforeEach(() => {
    // Setup URL mocks
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    urlCounter = 0;

    spyOn(URL, 'createObjectURL').and.callFake(
      () => `blob:http://localhost/mock-${++urlCounter}`
    );
    spyOn(URL, 'revokeObjectURL').and.callFake(() => { /* no-op for test */ });

    // Setup database mocks
    mockDb = createMockDatabase();
    setupMockDatabaseDefaults(mockDb);

    mockDatabaseService = jasmine.createSpyObj('DatabaseService', ['getDatabase']);
    mockDatabaseService.getDatabase.and.returnValue(
      Promise.resolve(mockDb as unknown as PouchDB.Database)
    );

    TestBed.configureTestingModule({
      providers: [
        StoryImageService,
        { provide: DatabaseService, useValue: mockDatabaseService }
      ]
    });

    service = TestBed.inject(StoryImageService);
  });

  afterEach(() => {
    // Restore URL methods
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  // ==========================================================================
  // Basic Service Tests
  // ==========================================================================

  describe('initialization', () => {
    it('should be created', () => {
      expect(service).toBeTruthy();
    });

    it('should expose imageRemoved$ observable', () => {
      expect(service.imageRemoved$).toBeDefined();
    });
  });

  // ==========================================================================
  // addImage Tests
  // ==========================================================================

  describe('addImage', () => {
    it('should reject non-image files', async () => {
      const textFile = new File(['test'], 'test.txt', { type: 'text/plain' });

      await expectAsync(service.addImage('story1', textFile))
        .toBeRejectedWithError('Only image files are allowed');
    });

    it('should reject files larger than MAX_IMAGE_SIZE', async () => {
      const largeFile = createMockImageFile('large.png', MAX_IMAGE_SIZE + 1);

      await expectAsync(service.addImage('story1', largeFile))
        .toBeRejectedWithError(/Image too large/);
    });

    it('should reject when MAX_IMAGES_PER_STORY reached', async () => {
      // Setup mock to return MAX_IMAGES_PER_STORY images
      const existingImages = Array.from({ length: MAX_IMAGES_PER_STORY }, (_, i) =>
        createMockImageDoc({ imageId: `img_${i}` })
      );
      mockDb.find.and.returnValue(Promise.resolve({ docs: existingImages }));

      const newFile = createMockImageFile('new.png');

      await expectAsync(service.addImage('story1', newFile))
        .toBeRejectedWithError(/Maximum 100 images per story reached/);
    });

    it('should generate unique imageId', async () => {
      const file = createMockImageFile('test.png');

      const result = await service.addImage('story1', file);

      expect(result.meta.id).toMatch(/^img_\d+_[a-z0-9]+$/);
    });

    it('should store image in PouchDB with correct structure', async () => {
      const file = createMockImageFile('test.png', 1024, 'image/png');

      await service.addImage('story1', file);

      expect(mockDb.put).toHaveBeenCalled();
      const putCall = mockDb.put.calls.mostRecent().args[0] as StoryImageDoc;

      expect(putCall._id).toMatch(/^story-image_story1_img_/);
      expect(putCall.type).toBe('story-image');
      expect(putCall.storyId).toBe('story1');
      expect(putCall.name).toBe('test.png');
      expect(putCall.mimeType).toBe('image/png');
      expect(putCall._attachments?.[ATTACHMENT_NAME_IMAGE]).toBeDefined();
    });

    it('should use custom name when provided', async () => {
      const file = createMockImageFile('original.png');

      await service.addImage('story1', file, 'Custom Name');

      const putCall = mockDb.put.calls.mostRecent().args[0] as StoryImageDoc;
      expect(putCall.name).toBe('Custom Name');
    });

    it('should cache blob URL after upload', async () => {
      const file = createMockImageFile('test.png');

      const result = await service.addImage('story1', file);

      expect(result.blobUrl).toMatch(/^blob:/);
      expect(URL.createObjectURL).toHaveBeenCalled();
    });

    it('should return StoryImageResult with correct metadata', async () => {
      const file = createMockImageFile('test.png', 2048, 'image/png');

      const result = await service.addImage('story1', file);

      expect(result.meta.storyId).toBe('story1');
      expect(result.meta.name).toBe('test.png');
      expect(result.meta.mimeType).toBe('image/png');
      expect(result.meta.size).toBe(2048);
      expect(result.meta.createdAt).toBeInstanceOf(Date);
      expect(result.blobUrl).toBeDefined();
    });
  });

  // ==========================================================================
  // removeImage Tests
  // ==========================================================================

  describe('removeImage', () => {
    it('should delete document from PouchDB', async () => {
      const mockDoc = createMockImageDoc({ storyId: 'story1', imageId: 'img_123' });
      mockDb.get.and.returnValue(Promise.resolve(mockDoc));

      await service.removeImage('story1', 'img_123');

      expect(mockDb.get).toHaveBeenCalledWith('story-image_story1_img_123');
      expect(mockDb.remove).toHaveBeenCalledWith(mockDoc);
    });

    it('should ignore 404 errors (already deleted)', async () => {
      mockDb.get.and.returnValue(Promise.reject({ status: 404 }));

      await expectAsync(service.removeImage('story1', 'img_123'))
        .toBeResolved();
    });

    it('should throw on other errors', async () => {
      mockDb.get.and.returnValue(Promise.reject({ status: 500, message: 'Server error' }));

      await expectAsync(service.removeImage('story1', 'img_123'))
        .toBeRejectedWithError('Failed to delete image');
    });

    it('should revoke cached blob URL', async () => {
      // First add an image to cache
      const file = createMockImageFile('test.png');
      await service.addImage('story1', file);
      const imageId = (mockDb.put.calls.mostRecent().args[0] as StoryImageDoc).imageId;

      // Setup for removal
      const mockDoc = createMockImageDoc({ storyId: 'story1', imageId });
      mockDb.get.and.returnValue(Promise.resolve(mockDoc));

      await service.removeImage('story1', imageId);

      expect(URL.revokeObjectURL).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // getImagesForStory Tests
  // ==========================================================================

  describe('getImagesForStory', () => {
    it('should query by storyId', async () => {
      mockDb.find.and.returnValue(Promise.resolve({ docs: [] }));

      await service.getImagesForStory('story1');

      expect(mockDb.find).toHaveBeenCalledWith({
        selector: {
          type: 'story-image',
          storyId: 'story1'
        }
      });
    });

    it('should return empty array when no images', async () => {
      mockDb.find.and.returnValue(Promise.resolve({ docs: [] }));

      const result = await service.getImagesForStory('story1');

      expect(result).toEqual([]);
    });

    it('should return metadata without attachments', async () => {
      const mockDocs = [
        createMockImageDoc({ imageId: 'img_1', name: 'first.png' }),
        createMockImageDoc({ imageId: 'img_2', name: 'second.png' })
      ];
      mockDb.find.and.returnValue(Promise.resolve({ docs: mockDocs }));

      const result = await service.getImagesForStory('story1');

      expect(result.length).toBe(2);
      expect(result[0].id).toBeDefined();
      expect(result[0].name).toBeDefined();
      expect((result[0] as unknown as { _attachments?: unknown })._attachments).toBeUndefined();
    });

    it('should sort images by createdAt descending', async () => {
      const now = new Date();
      const older = new Date(now.getTime() - 10000);
      const mockDocs = [
        createMockImageDoc({ imageId: 'img_old', createdAt: older }),
        createMockImageDoc({ imageId: 'img_new', createdAt: now })
      ];
      mockDb.find.and.returnValue(Promise.resolve({ docs: mockDocs }));

      const result = await service.getImagesForStory('story1');

      expect(result[0].id).toBe('img_new');
      expect(result[1].id).toBe('img_old');
    });

    it('should return empty array on error', async () => {
      mockDb.find.and.returnValue(Promise.reject(new Error('Database error')));

      const result = await service.getImagesForStory('story1');

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // getImageBlob Tests
  // ==========================================================================

  describe('getImageBlob', () => {
    it('should retrieve attachment as Blob', async () => {
      const mockBlob = createMockBlob(1024, 'image/png');
      mockDb.getAttachment.and.returnValue(Promise.resolve(mockBlob));

      const result = await service.getImageBlob('story1', 'img_123');

      expect(mockDb.getAttachment).toHaveBeenCalledWith(
        'story-image_story1_img_123',
        ATTACHMENT_NAME_IMAGE
      );
      expect(result).toBe(mockBlob);
    });

    it('should return null on error', async () => {
      mockDb.getAttachment.and.returnValue(Promise.reject(new Error('Not found')));

      const result = await service.getImageBlob('story1', 'img_123');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getImageBlobUrl Tests
  // ==========================================================================

  describe('getImageBlobUrl', () => {
    it('should return cached URL if exists', async () => {
      // Add image to get it cached
      const file = createMockImageFile('test.png');
      const addResult = await service.addImage('story1', file);
      const imageId = addResult.meta.id;

      // Reset spy call count
      (URL.createObjectURL as jasmine.Spy).calls.reset();

      // Get URL again
      const result = await service.getImageBlobUrl('story1', imageId);

      expect(result).toBe(addResult.blobUrl);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('should create and cache URL if not cached', async () => {
      const mockBlob = createMockBlob(1024, 'image/png');
      mockDb.getAttachment.and.returnValue(Promise.resolve(mockBlob));

      const result = await service.getImageBlobUrl('story1', 'img_123');

      expect(result).toMatch(/^blob:/);
      expect(URL.createObjectURL).toHaveBeenCalledWith(mockBlob);

      // Second call should use cache
      (URL.createObjectURL as jasmine.Spy).calls.reset();
      const result2 = await service.getImageBlobUrl('story1', 'img_123');
      expect(result2).toBe(result);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('should return null if blob not found', async () => {
      mockDb.getAttachment.and.returnValue(Promise.reject(new Error('Not found')));

      const result = await service.getImageBlobUrl('story1', 'img_123');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getImageDataUrl Tests
  // ==========================================================================

  describe('getImageDataUrl', () => {
    it('should return base64 data URL', async () => {
      const mockBlob = new Blob(['test data'], { type: 'image/png' });
      mockDb.getAttachment.and.returnValue(Promise.resolve(mockBlob));

      const result = await service.getImageDataUrl('story1', 'img_123');

      expect(result).toMatch(/^data:image\/png;base64,/);
    });

    it('should return null if blob not found', async () => {
      mockDb.getAttachment.and.returnValue(Promise.reject(new Error('Not found')));

      const result = await service.getImageDataUrl('story1', 'img_123');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // getImageMeta Tests
  // ==========================================================================

  describe('getImageMeta', () => {
    it('should return metadata without attachment', async () => {
      const mockDoc = createMockImageDoc({
        storyId: 'story1',
        imageId: 'img_123',
        name: 'test.png',
        width: 800,
        height: 600
      });
      mockDb.get.and.returnValue(Promise.resolve(mockDoc));

      const result = await service.getImageMeta('story1', 'img_123');

      expect(result).toBeTruthy();
      expect(result?.id).toBe('img_123');
      expect(result?.storyId).toBe('story1');
      expect(result?.name).toBe('test.png');
      expect(result?.width).toBe(800);
      expect(result?.height).toBe(600);
    });

    it('should return null for non-existent image (404)', async () => {
      mockDb.get.and.returnValue(Promise.reject({ status: 404 }));

      const result = await service.getImageMeta('story1', 'img_123');

      expect(result).toBeNull();
    });

    it('should return null on other errors', async () => {
      mockDb.get.and.returnValue(Promise.reject({ status: 500 }));

      const result = await service.getImageMeta('story1', 'img_123');

      expect(result).toBeNull();
    });
  });

  // ==========================================================================
  // setVideoAssociation Tests
  // ==========================================================================

  describe('setVideoAssociation', () => {
    it('should update image doc with videoId', async () => {
      const mockDoc = createMockImageDoc({ storyId: 'story1', imageId: 'img_123' });
      mockDb.get.and.returnValue(Promise.resolve({ ...mockDoc }));

      await service.setVideoAssociation('story1', 'img_123', 'vid_456');

      expect(mockDb.put).toHaveBeenCalled();
      const putCall = mockDb.put.calls.mostRecent().args[0] as StoryImageDoc;
      expect(putCall.videoId).toBe('vid_456');
    });

    it('should remove videoId when null passed', async () => {
      const mockDoc = createMockImageDoc({
        storyId: 'story1',
        imageId: 'img_123',
        videoId: 'vid_456'
      });
      mockDb.get.and.returnValue(Promise.resolve({ ...mockDoc }));

      await service.setVideoAssociation('story1', 'img_123', null);

      const putCall = mockDb.put.calls.mostRecent().args[0] as StoryImageDoc;
      expect(putCall.videoId).toBeUndefined();
    });

    it('should throw on non-existent image', async () => {
      mockDb.get.and.returnValue(Promise.reject({ status: 404 }));

      await expectAsync(service.setVideoAssociation('story1', 'img_123', 'vid_456'))
        .toBeRejected();
    });
  });

  // ==========================================================================
  // getImagesForVideo Tests
  // ==========================================================================

  describe('getImagesForVideo', () => {
    it('should filter images by videoId', async () => {
      const mockDocs = [
        createMockImageDoc({ imageId: 'img_1', videoId: 'vid_A' }),
        createMockImageDoc({ imageId: 'img_2', videoId: 'vid_B' }),
        createMockImageDoc({ imageId: 'img_3', videoId: 'vid_A' })
      ];
      mockDb.find.and.returnValue(Promise.resolve({ docs: mockDocs }));

      const result = await service.getImagesForVideo('story1', 'vid_A');

      expect(result.length).toBe(2);
      expect(result.every(img => img.videoId === 'vid_A')).toBeTrue();
    });

    it('should return empty array when no images have videoId', async () => {
      const mockDocs = [
        createMockImageDoc({ imageId: 'img_1' }),
        createMockImageDoc({ imageId: 'img_2' })
      ];
      mockDb.find.and.returnValue(Promise.resolve({ docs: mockDocs }));

      const result = await service.getImagesForVideo('story1', 'vid_A');

      expect(result).toEqual([]);
    });
  });

  // ==========================================================================
  // onImageRemovedFromContent Tests
  // ==========================================================================

  describe('onImageRemovedFromContent', () => {
    it('should emit imageRemoved$ event', fakeAsync(() => {
      const mockDoc = createMockImageDoc({ storyId: 'story1', imageId: 'img_123' });
      mockDb.get.and.returnValue(Promise.resolve(mockDoc));

      let emittedEvent: { storyId: string; imageId: string } | null = null;
      service.imageRemoved$.subscribe(event => emittedEvent = event);

      service.onImageRemovedFromContent('story1', 'img_123');
      tick();

      expect(emittedEvent).not.toBeNull();
      expect(emittedEvent!.storyId).toBe('story1');
      expect(emittedEvent!.imageId).toBe('img_123');
    }));

    it('should call removeImage', async () => {
      const mockDoc = createMockImageDoc({ storyId: 'story1', imageId: 'img_123' });
      mockDb.get.and.returnValue(Promise.resolve(mockDoc));

      await service.onImageRemovedFromContent('story1', 'img_123');

      expect(mockDb.remove).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // imageExists Tests
  // ==========================================================================

  describe('imageExists', () => {
    it('should return true for existing image', async () => {
      const mockDoc = createMockImageDoc({ storyId: 'story1', imageId: 'img_123' });
      mockDb.get.and.returnValue(Promise.resolve(mockDoc));

      const result = await service.imageExists('story1', 'img_123');

      expect(result).toBeTrue();
    });

    it('should return false for non-existent image', async () => {
      mockDb.get.and.returnValue(Promise.reject({ status: 404 }));

      const result = await service.imageExists('story1', 'img_123');

      expect(result).toBeFalse();
    });
  });

  // ==========================================================================
  // getStorageUsage Tests
  // ==========================================================================

  describe('getStorageUsage', () => {
    it('should calculate total size for story', async () => {
      const mockDocs = [
        createMockImageDoc({ imageId: 'img_1', size: 1000 }),
        createMockImageDoc({ imageId: 'img_2', size: 2000 }),
        createMockImageDoc({ imageId: 'img_3', size: 3000 })
      ];
      mockDb.find.and.returnValue(Promise.resolve({ docs: mockDocs }));

      const result = await service.getStorageUsage('story1');

      expect(result.count).toBe(3);
      expect(result.totalSize).toBe(6000);
    });

    it('should format file size correctly', async () => {
      const mockDocs = [
        createMockImageDoc({ imageId: 'img_1', size: 1024 * 1024 }) // 1MB
      ];
      mockDb.find.and.returnValue(Promise.resolve({ docs: mockDocs }));

      const result = await service.getStorageUsage('story1');

      expect(result.formattedSize).toBe('1 MB');
    });

    it('should return zero for empty story', async () => {
      mockDb.find.and.returnValue(Promise.resolve({ docs: [] }));

      const result = await service.getStorageUsage('story1');

      expect(result.count).toBe(0);
      expect(result.totalSize).toBe(0);
      expect(result.formattedSize).toBe('0 Bytes');
    });
  });

  // ==========================================================================
  // Blob URL Cache Management Tests
  // ==========================================================================

  describe('blob URL cache management', () => {
    describe('revokeBlobUrl', () => {
      it('should call URL.revokeObjectURL for cached URL', async () => {
        // Add image to cache
        const file = createMockImageFile('test.png');
        const result = await service.addImage('story1', file);
        const imageId = result.meta.id;

        service.revokeBlobUrl('story1', imageId);

        expect(URL.revokeObjectURL).toHaveBeenCalled();
      });

      it('should remove URL from cache', async () => {
        const file = createMockImageFile('test.png');
        const result = await service.addImage('story1', file);
        const imageId = result.meta.id;

        service.revokeBlobUrl('story1', imageId);

        // Should create new URL on next request
        const mockBlob = createMockBlob();
        mockDb.getAttachment.and.returnValue(Promise.resolve(mockBlob));
        (URL.createObjectURL as jasmine.Spy).calls.reset();

        await service.getImageBlobUrl('story1', imageId);
        expect(URL.createObjectURL).toHaveBeenCalled();
      });

      it('should not throw for non-cached URL', () => {
        expect(() => service.revokeBlobUrl('story1', 'nonexistent')).not.toThrow();
      });
    });

    describe('cleanupStoryBlobUrls', () => {
      it('should only cleanup specific story URLs', async () => {
        // Add images to two stories
        const file1 = createMockImageFile('test1.png');
        const file2 = createMockImageFile('test2.png');

        mockDb.find.and.returnValue(Promise.resolve({ docs: [] }));

        await service.addImage('story1', file1);
        await service.addImage('story2', file2);

        (URL.revokeObjectURL as jasmine.Spy).calls.reset();

        service.cleanupStoryBlobUrls('story1');

        // Should have revoked URLs for story1
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);

        // story2 URL should still be cached
        const mockBlob = createMockBlob();
        mockDb.getAttachment.and.returnValue(Promise.resolve(mockBlob));
        (URL.createObjectURL as jasmine.Spy).calls.reset();

        const putCall2 = mockDb.put.calls.all()[1].args[0] as StoryImageDoc;
        await service.getImageBlobUrl('story2', putCall2.imageId);

        // Should not create new URL since story2 is still cached
        expect(URL.createObjectURL).not.toHaveBeenCalled();
      });
    });

    describe('cleanupAllBlobUrls', () => {
      it('should cleanup all story URLs', async () => {
        // Add images to two stories
        const file1 = createMockImageFile('test1.png');
        const file2 = createMockImageFile('test2.png');

        mockDb.find.and.returnValue(Promise.resolve({ docs: [] }));

        await service.addImage('story1', file1);
        await service.addImage('story2', file2);

        (URL.revokeObjectURL as jasmine.Spy).calls.reset();

        service.cleanupAllBlobUrls();

        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
      });
    });
  });

  // ==========================================================================
  // ngOnDestroy Tests
  // ==========================================================================

  describe('ngOnDestroy', () => {
    it('should cleanup all blob URLs on destroy', async () => {
      const file = createMockImageFile('test.png');
      await service.addImage('story1', file);

      (URL.revokeObjectURL as jasmine.Spy).calls.reset();

      service.ngOnDestroy();

      expect(URL.revokeObjectURL).toHaveBeenCalled();
    });
  });
});
