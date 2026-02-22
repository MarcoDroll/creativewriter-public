/**
 * Comprehensive tests for StoryMediaService.
 * Covers video CRUD, blob URL caching, image click handling, and video indicators.
 */
import { TestBed } from '@angular/core/testing';
import { StoryMediaService } from './story-media.service';
import { DatabaseService } from '../../core/services/database.service';
import {
  MAX_VIDEO_SIZE,
  MAX_VIDEOS_PER_STORY,
  STORY_VIDEO_PREFIX,
  ATTACHMENT_NAME_VIDEO
} from '../models/story-media.interface';
import {
  createMockVideoFile,
  createMockVideoDoc,
  createMockDatabase,
  setupMockDatabaseDefaults
} from '../testing/image-test-helpers';

describe('StoryMediaService', () => {
  let service: StoryMediaService;
  let mockDb: jasmine.SpyObj<PouchDB.Database>;
  let mockDatabaseService: jasmine.SpyObj<DatabaseService>;
  let urlCounter: number;
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    urlCounter = 0;
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;

    // Mock URL API
    spyOn(URL, 'createObjectURL').and.callFake(() => `blob:http://localhost/mock-${++urlCounter}`);
    spyOn(URL, 'revokeObjectURL').and.callFake(() => { /* no-op for test */ });

    // Create mock database
    mockDb = createMockDatabase();
    setupMockDatabaseDefaults(mockDb);

    // Create mock DatabaseService
    mockDatabaseService = jasmine.createSpyObj('DatabaseService', ['getDatabase']);
    mockDatabaseService.getDatabase.and.returnValue(Promise.resolve(mockDb));

    TestBed.configureTestingModule({
      providers: [
        StoryMediaService,
        { provide: DatabaseService, useValue: mockDatabaseService }
      ]
    });

    service = TestBed.inject(StoryMediaService);
  });

  afterEach(() => {
    // Restore URL API
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  // ============================================================================
  // addVideo Tests
  // ============================================================================

  describe('addVideo', () => {
    it('should reject non-video files', async () => {
      const textFile = new File(['test'], 'test.txt', { type: 'text/plain' });

      await expectAsync(service.addVideo('story1', textFile))
        .toBeRejectedWithError('Only video files are allowed');
    });

    it('should reject files larger than MAX_VIDEO_SIZE', async () => {
      const largeVideoSize = MAX_VIDEO_SIZE + 1;
      const largeVideo = createMockVideoFile('large.mp4', largeVideoSize);

      await expectAsync(service.addVideo('story1', largeVideo))
        .toBeRejectedWithError(/Video too large/);
    });

    it('should reject when MAX_VIDEOS_PER_STORY reached', async () => {
      // Mock existing videos at limit
      const existingVideos = Array(MAX_VIDEOS_PER_STORY).fill(null).map((_, i) =>
        createMockVideoDoc({ videoId: `vid_${i}` })
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockDb.find.and.returnValue(Promise.resolve({ docs: existingVideos }) as any);

      const video = createMockVideoFile();
      await expectAsync(service.addVideo('story1', video))
        .toBeRejectedWithError(`Maximum ${MAX_VIDEOS_PER_STORY} videos per story reached`);
    });

    it('should store video as PouchDB attachment with correct format', async () => {
      const video = createMockVideoFile('test.mp4', 1024, 'video/mp4');

      const result = await service.addVideo('story1', video);

      expect(mockDb.put).toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const savedDoc = mockDb.put.calls.mostRecent().args[0] as any;
      expect(savedDoc._id).toContain(STORY_VIDEO_PREFIX);
      expect(savedDoc.type).toBe('story-video');
      expect(savedDoc.storyId).toBe('story1');
      expect(savedDoc.mimeType).toBe('video/mp4');
      expect(savedDoc._attachments?.[ATTACHMENT_NAME_VIDEO]).toBeDefined();
      expect(result.meta.id).toBeDefined();
      expect(result.blobUrl).toMatch(/^blob:/);
    });

    it('should generate unique videoId with correct format', async () => {
      const video = createMockVideoFile();

      const result = await service.addVideo('story1', video);

      expect(result.meta.id).toMatch(/^vid_\d+_[a-z0-9]+$/);
    });

    it('should cache blob URL after upload', async () => {
      const video = createMockVideoFile();

      const result1 = await service.addVideo('story1', video);

      // Reset mocks
      (URL.createObjectURL as jasmine.Spy).calls.reset();

      // Get the same blob URL should not create a new one
      const cachedUrl = await service.getVideoBlobUrl('story1', result1.meta.id);

      expect(cachedUrl).toBe(result1.blobUrl);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('should use provided name instead of file name', async () => {
      const video = createMockVideoFile('original.mp4');

      const result = await service.addVideo('story1', video, 'custom-name.mp4');

      expect(result.meta.name).toBe('custom-name.mp4');
    });

    it('should return StoryVideoResult with meta and blobUrl', async () => {
      const video = createMockVideoFile('test.mp4', 1024 * 1024, 'video/mp4');

      const result = await service.addVideo('story1', video);

      expect(result.meta).toBeDefined();
      expect(result.meta.id).toBeDefined();
      expect(result.meta.storyId).toBe('story1');
      expect(result.meta.name).toBe('test.mp4');
      expect(result.meta.mimeType).toBe('video/mp4');
      expect(result.meta.size).toBe(1024 * 1024);
      expect(result.meta.createdAt).toBeInstanceOf(Date);
      expect(result.blobUrl).toMatch(/^blob:/);
    });
  });

  // ============================================================================
  // removeVideo Tests
  // ============================================================================

  describe('removeVideo', () => {
    it('should delete video document from PouchDB', async () => {
      const mockDoc = createMockVideoDoc({ storyId: 'story1', videoId: 'vid_123' });
      mockDb.get.and.returnValue(Promise.resolve(mockDoc));
      mockDb.remove.and.returnValue(Promise.resolve({ ok: true, id: mockDoc._id, rev: '2-def' }));

      await service.removeVideo('story1', 'vid_123');

      expect(mockDb.get).toHaveBeenCalledWith(`${STORY_VIDEO_PREFIX}story1_vid_123`);
      expect(mockDb.remove).toHaveBeenCalledWith(mockDoc);
    });

    it('should ignore 404 errors', async () => {
      mockDb.get.and.returnValue(Promise.reject({ status: 404 }));

      await expectAsync(service.removeVideo('story1', 'nonexistent'))
        .toBeResolved();
    });

    it('should throw on non-404 errors', async () => {
      mockDb.get.and.returnValue(Promise.reject({ status: 500, message: 'Internal error' }));

      await expectAsync(service.removeVideo('story1', 'vid_123'))
        .toBeRejectedWithError('Failed to delete video');
    });

    it('should revoke blob URL from cache', async () => {
      // First add a video to populate cache
      const video = createMockVideoFile();
      const result = await service.addVideo('story1', video);

      // Reset mock
      (URL.revokeObjectURL as jasmine.Spy).calls.reset();

      // Setup remove mock
      const mockDoc = createMockVideoDoc({ storyId: 'story1', videoId: result.meta.id });
      mockDb.get.and.returnValue(Promise.resolve(mockDoc));

      await service.removeVideo('story1', result.meta.id);

      expect(URL.revokeObjectURL).toHaveBeenCalledWith(result.blobUrl);
    });
  });

  // ============================================================================
  // getVideosForStory Tests
  // ============================================================================

  describe('getVideosForStory', () => {
    it('should query by storyId', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockDb.find.and.returnValue(Promise.resolve({ docs: [] }) as any);

      await service.getVideosForStory('story1');

      expect(mockDb.find).toHaveBeenCalledWith({
        selector: {
          type: 'story-video',
          storyId: 'story1'
        }
      });
    });

    it('should return metadata only (no binary)', async () => {
      const mockDocs = [
        createMockVideoDoc({ storyId: 'story1', videoId: 'vid_1' }),
        createMockVideoDoc({ storyId: 'story1', videoId: 'vid_2' })
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockDb.find.and.returnValue(Promise.resolve({ docs: mockDocs }) as any);

      const result = await service.getVideosForStory('story1');

      expect(result.length).toBe(2);
      // Should have metadata properties
      expect(result[0].id).toBeDefined();
      expect(result[0].storyId).toBe('story1');
      expect(result[0].name).toBeDefined();
      // Should NOT have _attachments or binary data
      expect((result[0] as unknown as { _attachments?: unknown })._attachments).toBeUndefined();
    });

    it('should sort videos by createdAt descending', async () => {
      const oldDate = new Date('2024-01-01');
      const newDate = new Date('2024-12-01');
      const mockDocs = [
        createMockVideoDoc({ videoId: 'vid_old', createdAt: oldDate }),
        createMockVideoDoc({ videoId: 'vid_new', createdAt: newDate })
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockDb.find.and.returnValue(Promise.resolve({ docs: mockDocs }) as any);

      const result = await service.getVideosForStory('story1');

      expect(result[0].id).toBe('vid_new');
      expect(result[1].id).toBe('vid_old');
    });

    it('should return empty array on error', async () => {
      mockDb.find.and.returnValue(Promise.reject(new Error('Database error')));

      const result = await service.getVideosForStory('story1');

      expect(result).toEqual([]);
    });
  });

  // ============================================================================
  // getVideoBlob Tests
  // ============================================================================

  describe('getVideoBlob', () => {
    it('should retrieve attachment as Blob', async () => {
      const mockBlob = new Blob(['video data'], { type: 'video/mp4' });
      mockDb.getAttachment.and.returnValue(Promise.resolve(mockBlob));

      const result = await service.getVideoBlob('story1', 'vid_123');

      expect(mockDb.getAttachment).toHaveBeenCalledWith(
        `${STORY_VIDEO_PREFIX}story1_vid_123`,
        ATTACHMENT_NAME_VIDEO
      );
      expect(result).toBe(mockBlob);
    });

    it('should return null on error', async () => {
      mockDb.getAttachment.and.returnValue(Promise.reject(new Error('Not found')));

      const result = await service.getVideoBlob('story1', 'vid_123');

      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // getVideoBlobUrl Tests
  // ============================================================================

  describe('getVideoBlobUrl', () => {
    it('should return cached URL if exists', async () => {
      // Add video to populate cache
      const video = createMockVideoFile();
      const addResult = await service.addVideo('story1', video);

      // Reset mock
      (URL.createObjectURL as jasmine.Spy).calls.reset();

      const result = await service.getVideoBlobUrl('story1', addResult.meta.id);

      expect(result).toBe(addResult.blobUrl);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('should create and cache URL if not cached', async () => {
      const mockBlob = new Blob(['video data'], { type: 'video/mp4' });
      mockDb.getAttachment.and.returnValue(Promise.resolve(mockBlob));

      const result1 = await service.getVideoBlobUrl('story1', 'vid_123');

      expect(URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
      expect(result1).toMatch(/^blob:/);

      // Second call should use cache
      (URL.createObjectURL as jasmine.Spy).calls.reset();
      const result2 = await service.getVideoBlobUrl('story1', 'vid_123');

      expect(result2).toBe(result1);
      expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('should return null if blob not found', async () => {
      mockDb.getAttachment.and.returnValue(Promise.reject(new Error('Not found')));

      const result = await service.getVideoBlobUrl('story1', 'vid_123');

      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // getVideoDataUrl Tests
  // ============================================================================

  describe('getVideoDataUrl', () => {
    it('should return base64 data URL', async () => {
      const mockBlob = new Blob(['test data'], { type: 'video/mp4' });
      mockDb.getAttachment.and.returnValue(Promise.resolve(mockBlob));

      const result = await service.getVideoDataUrl('story1', 'vid_123');

      expect(result).toMatch(/^data:video\/mp4;base64,/);
    });

    it('should return null if blob not found', async () => {
      mockDb.getAttachment.and.returnValue(Promise.reject(new Error('Not found')));

      const result = await service.getVideoDataUrl('story1', 'vid_123');

      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // getVideoMeta Tests
  // ============================================================================

  describe('getVideoMeta', () => {
    it('should return metadata without attachment', async () => {
      const mockDoc = createMockVideoDoc({ storyId: 'story1', videoId: 'vid_123' });
      mockDb.get.and.returnValue(Promise.resolve(mockDoc));

      const result = await service.getVideoMeta('story1', 'vid_123');

      expect(result).not.toBeNull();
      expect(result!.id).toBe('vid_123');
      expect(result!.storyId).toBe('story1');
      expect(result!.name).toBe('test.mp4');
      expect(result!.mimeType).toBe('video/mp4');
      expect(result!.createdAt).toBeInstanceOf(Date);
    });

    it('should return null for non-existent video', async () => {
      mockDb.get.and.returnValue(Promise.reject({ status: 404 }));

      const result = await service.getVideoMeta('story1', 'nonexistent');

      expect(result).toBeNull();
    });

    it('should return null on other errors', async () => {
      mockDb.get.and.returnValue(Promise.reject({ status: 500 }));

      const result = await service.getVideoMeta('story1', 'vid_123');

      expect(result).toBeNull();
    });
  });

  // ============================================================================
  // videoExists Tests
  // ============================================================================

  describe('videoExists', () => {
    it('should return true for existing video', async () => {
      const mockDoc = createMockVideoDoc();
      mockDb.get.and.returnValue(Promise.resolve(mockDoc));

      const result = await service.videoExists('story1', 'vid_123');

      expect(result).toBeTrue();
    });

    it('should return false for non-existent video', async () => {
      mockDb.get.and.returnValue(Promise.reject({ status: 404 }));

      const result = await service.videoExists('story1', 'nonexistent');

      expect(result).toBeFalse();
    });
  });

  // ============================================================================
  // getStorageUsage Tests
  // ============================================================================

  describe('getStorageUsage', () => {
    it('should calculate total size for story videos', async () => {
      const mockDocs = [
        createMockVideoDoc({ videoId: 'vid_1', size: 1024 * 1024 }),
        createMockVideoDoc({ videoId: 'vid_2', size: 2 * 1024 * 1024 })
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockDb.find.and.returnValue(Promise.resolve({ docs: mockDocs }) as any);

      const result = await service.getStorageUsage('story1');

      expect(result.count).toBe(2);
      expect(result.totalSize).toBe(3 * 1024 * 1024);
    });

    it('should format file size correctly', async () => {
      const mockDocs = [
        createMockVideoDoc({ videoId: 'vid_1', size: 2.5 * 1024 * 1024 })
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockDb.find.and.returnValue(Promise.resolve({ docs: mockDocs }) as any);

      const result = await service.getStorageUsage('story1');

      expect(result.formattedSize).toBe('2.5 MB');
    });

    it('should return zero for story with no videos', async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockDb.find.and.returnValue(Promise.resolve({ docs: [] }) as any);

      const result = await service.getStorageUsage('story1');

      expect(result.count).toBe(0);
      expect(result.totalSize).toBe(0);
      expect(result.formattedSize).toBe('0 Bytes');
    });
  });

  // ============================================================================
  // Image Click Handler Tests
  // ============================================================================

  describe('Image Click Handling', () => {
    let container: HTMLDivElement;
    let imageElement: HTMLImageElement;

    beforeEach(() => {
      container = document.createElement('div');
      container.setAttribute('data-story-id', 'story1');

      imageElement = document.createElement('img');
      imageElement.setAttribute('data-image-id', 'img_123');
      imageElement.setAttribute('data-story-id', 'story1');
      container.appendChild(imageElement);

      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    describe('initializeImageClickHandlers', () => {
      it('should add click listener to container', () => {
        spyOn(container, 'addEventListener').and.callThrough();

        service.initializeImageClickHandlers(container);

        expect(container.addEventListener).toHaveBeenCalledWith('click', jasmine.any(Function));
      });

      it('should remove existing listeners before adding new ones', () => {
        spyOn(container, 'removeEventListener').and.callThrough();

        service.initializeImageClickHandlers(container);

        expect(container.removeEventListener).toHaveBeenCalled();
      });
    });

    describe('removeImageClickHandlers', () => {
      it('should remove click listener from container', () => {
        service.initializeImageClickHandlers(container);
        spyOn(container, 'removeEventListener').and.callThrough();

        service.removeImageClickHandlers(container);

        expect(container.removeEventListener).toHaveBeenCalledWith('click', jasmine.any(Function));
      });
    });

    describe('handleImageClick (via event delegation)', () => {
      it('should emit ImageClickEvent when image clicked', (done) => {
        service.initializeImageClickHandlers(container);

        service.imageClicked$.subscribe(event => {
          expect(event.imageId).toBe('img_123');
          expect(event.storyId).toBe('story1');
          expect(event.element).toBe(imageElement);
          expect(event.position).toBeDefined();
          done();
        });

        imageElement.click();
      });

      it('should extract imageId from data attribute', (done) => {
        imageElement.setAttribute('data-image-id', 'custom_id');
        service.initializeImageClickHandlers(container);

        service.imageClicked$.subscribe(event => {
          expect(event.imageId).toBe('custom_id');
          done();
        });

        imageElement.click();
      });

      it('should extract imageId from CSS class', (done) => {
        imageElement.removeAttribute('data-image-id');
        imageElement.className = 'some-class image-id-class_based_id another-class';
        service.initializeImageClickHandlers(container);

        service.imageClicked$.subscribe(event => {
          expect(event.imageId).toBe('class_based_id');
          done();
        });

        imageElement.click();
      });

      it('should extract storyId from parent element', (done) => {
        imageElement.removeAttribute('data-story-id');
        service.initializeImageClickHandlers(container);

        service.imageClicked$.subscribe(event => {
          expect(event.storyId).toBe('story1');
          done();
        });

        imageElement.click();
      });

      it('should include click position', (done) => {
        service.initializeImageClickHandlers(container);

        service.imageClicked$.subscribe(event => {
          expect(event.position.x).toBeDefined();
          expect(event.position.y).toBeDefined();
          done();
        });

        imageElement.click();
      });

      it('should not emit for non-image elements', () => {
        const div = document.createElement('div');
        container.appendChild(div);
        service.initializeImageClickHandlers(container);

        let emitted = false;
        service.imageClicked$.subscribe(() => {
          emitted = true;
        });

        div.click();

        expect(emitted).toBeFalse();
      });

      it('should not emit when storyId cannot be determined', () => {
        // Remove storyId from all places
        container.removeAttribute('data-story-id');
        imageElement.removeAttribute('data-story-id');
        service.initializeImageClickHandlers(container);

        let emitted = false;
        service.imageClicked$.subscribe(() => {
          emitted = true;
        });

        imageElement.click();

        expect(emitted).toBeFalse();
      });
    });
  });

  // ============================================================================
  // Video Indicator Tests
  // ============================================================================

  describe('Video Indicator Management', () => {
    let imageElement: HTMLImageElement;

    beforeEach(() => {
      imageElement = document.createElement('img');
    });

    describe('addVideoIndicator', () => {
      it('should add has-video CSS class', () => {
        service.addVideoIndicator(imageElement);

        expect(imageElement.classList.contains('has-video')).toBeTrue();
      });

      it('should set cursor to pointer', () => {
        service.addVideoIndicator(imageElement);

        expect(imageElement.style.cursor).toBe('pointer');
      });

      it('should add video title attribute', () => {
        service.addVideoIndicator(imageElement);

        expect(imageElement.title).toContain('Click to view the associated video');
      });

      it('should append to existing title', () => {
        imageElement.title = 'Original title';

        service.addVideoIndicator(imageElement);

        expect(imageElement.title).toBe('Original title - Click to view the associated video');
      });
    });

    describe('removeVideoIndicator', () => {
      it('should remove has-video CSS class', () => {
        imageElement.classList.add('has-video');

        service.removeVideoIndicator(imageElement);

        expect(imageElement.classList.contains('has-video')).toBeFalse();
      });

      it('should reset cursor style', () => {
        imageElement.style.cursor = 'pointer';

        service.removeVideoIndicator(imageElement);

        expect(imageElement.style.cursor).toBe('');
      });

      it('should remove video-related title suffix', () => {
        imageElement.title = 'My Image - Click to view the associated video';

        service.removeVideoIndicator(imageElement);

        expect(imageElement.title).toBe('My Image');
      });
    });

    describe('addMediaIdsToElement', () => {
      it('should set data-image-id attribute', () => {
        service.addMediaIdsToElement(imageElement, 'img_123', 'story1');

        expect(imageElement.getAttribute('data-image-id')).toBe('img_123');
      });

      it('should set data-story-id attribute', () => {
        service.addMediaIdsToElement(imageElement, 'img_123', 'story1');

        expect(imageElement.getAttribute('data-story-id')).toBe('story1');
      });

      it('should add CSS class with image ID', () => {
        service.addMediaIdsToElement(imageElement, 'img_123', 'story1');

        expect(imageElement.className).toContain('image-id-img_123');
      });

      it('should not duplicate CSS class on multiple calls', () => {
        service.addMediaIdsToElement(imageElement, 'img_123', 'story1');
        service.addMediaIdsToElement(imageElement, 'img_123', 'story1');

        const matches = imageElement.className.match(/image-id-img_123/g);
        expect(matches?.length).toBe(1);
      });
    });
  });

  // ============================================================================
  // Blob URL Cache Management Tests
  // ============================================================================

  describe('Blob URL Cache Management', () => {
    describe('revokeBlobUrl', () => {
      it('should call URL.revokeObjectURL for cached URL', async () => {
        // Add video to populate cache
        const video = createMockVideoFile();
        const result = await service.addVideo('story1', video);

        (URL.revokeObjectURL as jasmine.Spy).calls.reset();

        service.revokeBlobUrl('story1', result.meta.id);

        expect(URL.revokeObjectURL).toHaveBeenCalledWith(result.blobUrl);
      });

      it('should remove URL from cache', async () => {
        const video = createMockVideoFile();
        const result = await service.addVideo('story1', video);

        service.revokeBlobUrl('story1', result.meta.id);

        // Try to get from cache - should trigger new creation
        const mockBlob = new Blob(['video'], { type: 'video/mp4' });
        mockDb.getAttachment.and.returnValue(Promise.resolve(mockBlob));
        (URL.createObjectURL as jasmine.Spy).calls.reset();

        await service.getVideoBlobUrl('story1', result.meta.id);

        expect(URL.createObjectURL).toHaveBeenCalled();
      });

      it('should handle non-existent cache gracefully', () => {
        expect(() => service.revokeBlobUrl('nonexistent', 'vid_123')).not.toThrow();
      });
    });

    describe('cleanupStoryBlobUrls', () => {
      it('should only cleanup URLs for specific story', async () => {
        // Add videos to two stories
        const video1 = createMockVideoFile();
        const video2 = createMockVideoFile();
        const result1 = await service.addVideo('story1', video1);
        const result2 = await service.addVideo('story2', video2);

        (URL.revokeObjectURL as jasmine.Spy).calls.reset();

        service.cleanupStoryBlobUrls('story1');

        expect(URL.revokeObjectURL).toHaveBeenCalledWith(result1.blobUrl);
        expect(URL.revokeObjectURL).not.toHaveBeenCalledWith(result2.blobUrl);
      });

      it('should handle empty cache gracefully', () => {
        expect(() => service.cleanupStoryBlobUrls('nonexistent')).not.toThrow();
      });
    });

    describe('cleanupAllBlobUrls', () => {
      it('should cleanup URLs for all stories', async () => {
        // Add videos to multiple stories
        const video1 = createMockVideoFile();
        const video2 = createMockVideoFile();
        const result1 = await service.addVideo('story1', video1);
        const result2 = await service.addVideo('story2', video2);

        (URL.revokeObjectURL as jasmine.Spy).calls.reset();

        service.cleanupAllBlobUrls();

        expect(URL.revokeObjectURL).toHaveBeenCalledWith(result1.blobUrl);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith(result2.blobUrl);
      });

      it('should clear the cache completely', async () => {
        const video = createMockVideoFile();
        await service.addVideo('story1', video);

        service.cleanupAllBlobUrls();

        // Try to get from cache - should trigger new creation
        const mockBlob = new Blob(['video'], { type: 'video/mp4' });
        mockDb.getAttachment.and.returnValue(Promise.resolve(mockBlob));
        (URL.createObjectURL as jasmine.Spy).calls.reset();

        await service.getVideoBlobUrl('story1', 'vid_123');

        expect(URL.createObjectURL).toHaveBeenCalled();
      });
    });
  });

  // ============================================================================
  // ngOnDestroy Tests
  // ============================================================================

  describe('ngOnDestroy', () => {
    it('should cleanup all blob URLs', async () => {
      const video = createMockVideoFile();
      const result = await service.addVideo('story1', video);

      (URL.revokeObjectURL as jasmine.Spy).calls.reset();

      service.ngOnDestroy();

      expect(URL.revokeObjectURL).toHaveBeenCalledWith(result.blobUrl);
    });
  });
});
