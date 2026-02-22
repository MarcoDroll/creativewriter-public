/**
 * Comprehensive tests for StoryMediaGalleryComponent.
 * Covers media loading, pagination, image viewer, and blob URL cleanup.
 */
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { SimpleChange, CUSTOM_ELEMENTS_SCHEMA } from '@angular/core';
import { StoryMediaGalleryComponent } from './story-media-gallery.component';
import { StoryImageService } from '../../../shared/services/story-image.service';
import { StoryMediaService } from '../../../shared/services/story-media.service';
import { Story } from '../../models/story.interface';
import {
  createMockImageMeta,
  createMockVideoMeta,
  setupUrlMocks
} from '../../../shared/testing/image-test-helpers';

describe('StoryMediaGalleryComponent', () => {
  let component: StoryMediaGalleryComponent;
  let fixture: ComponentFixture<StoryMediaGalleryComponent>;
  let mockStoryImageService: jasmine.SpyObj<StoryImageService>;
  let mockStoryMediaService: jasmine.SpyObj<StoryMediaService>;
  let urlMocks: ReturnType<typeof setupUrlMocks>;

  const mockStory: Story = {
    id: 'story1',
    title: 'Test Story',
    chapters: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  beforeEach(async () => {
    mockStoryImageService = jasmine.createSpyObj('StoryImageService', [
      'getImagesForStory',
      'getImageBlobUrl'
    ]);
    mockStoryMediaService = jasmine.createSpyObj('StoryMediaService', [
      'getVideoMeta',
      'getVideoBlobUrl'
    ]);

    // Default return values
    mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve([]));
    mockStoryImageService.getImageBlobUrl.and.returnValue(Promise.resolve('blob:mock-image-url'));

    await TestBed.configureTestingModule({
      imports: [StoryMediaGalleryComponent],
      providers: [
        { provide: StoryImageService, useValue: mockStoryImageService },
        { provide: StoryMediaService, useValue: mockStoryMediaService }
      ],
      schemas: [CUSTOM_ELEMENTS_SCHEMA] // For Ionic components
    }).compileComponents();

    urlMocks = setupUrlMocks();

    fixture = TestBed.createComponent(StoryMediaGalleryComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    urlMocks.cleanup();
  });

  // ============================================================================
  // Initial State Tests
  // ============================================================================

  describe('Initial State', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should start with empty media items', () => {
      expect(component.mediaItems).toEqual([]);
    });

    it('should start with loading false', () => {
      expect(component.isLoading).toBeFalse();
      expect(component.isLoadingMore).toBeFalse();
    });

    it('should start with no selected media item', () => {
      expect(component.selectedMediaItem).toBeNull();
      expect(component.showImageViewer).toBeFalse();
    });

    it('should start with pagination state at zero', () => {
      expect(component.hasMoreImages).toBeFalse();
      expect(component.totalImagesCount).toBe(0);
    });
  });

  // ============================================================================
  // Loading Media Items Tests
  // ============================================================================

  describe('Loading Media Items', () => {
    it('should load media items when modal opens with story', fakeAsync(() => {
      const mockImages = [
        createMockImageMeta({ id: 'img_1', name: 'image1.png' }),
        createMockImageMeta({ id: 'img_2', name: 'image2.png' })
      ];
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      component.story = mockStory;
      component.isOpen = true;

      fixture.detectChanges();
      tick(); // getImagesForStory
      tick(); // getImageBlobUrl calls

      expect(mockStoryImageService.getImagesForStory).toHaveBeenCalledWith('story1');
      expect(component.mediaItems.length).toBe(2);
      expect(component.totalImagesCount).toBe(2);
    }));

    it('should not load if story is null', fakeAsync(() => {
      component.story = null;
      component.isOpen = true;

      fixture.detectChanges();
      tick();

      expect(mockStoryImageService.getImagesForStory).not.toHaveBeenCalled();
    }));

    it('should not load if modal is not open', fakeAsync(() => {
      component.story = mockStory;
      component.isOpen = false;

      fixture.detectChanges();
      tick();

      expect(mockStoryImageService.getImagesForStory).not.toHaveBeenCalled();
    }));

    it('should set isLoading during load', fakeAsync(() => {
      let resolvePromise: (value: unknown) => void;
      const slowPromise = new Promise(resolve => {
        resolvePromise = resolve;
      });
      mockStoryImageService.getImagesForStory.and.returnValue(slowPromise as Promise<never>);

      component.story = mockStory;
      component.isOpen = true;

      void component.loadMediaItems();

      expect(component.isLoading).toBeTrue();

      resolvePromise!([]);
      tick();

      expect(component.isLoading).toBeFalse();
    }));

    it('should handle error during load gracefully', fakeAsync(() => {
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.reject(new Error('Load error')));

      component.story = mockStory;
      component.isOpen = true;

      fixture.detectChanges();
      tick();

      expect(component.mediaItems).toEqual([]);
      expect(component.isLoading).toBeFalse();
    }));

    it('should load items via ngOnChanges when isOpen becomes true', fakeAsync(() => {
      const mockImages = [createMockImageMeta({ id: 'img_1' })];
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      component.story = mockStory;
      component.isOpen = true;

      component.ngOnChanges({
        isOpen: new SimpleChange(false, true, false)
      });
      tick();
      tick();

      expect(mockStoryImageService.getImagesForStory).toHaveBeenCalled();
    }));
  });

  // ============================================================================
  // Pagination Tests
  // ============================================================================

  describe('Pagination', () => {
    it('should show hasMoreImages when more than 20 images exist', fakeAsync(() => {
      const mockImages = Array.from({ length: 25 }, (_, i) =>
        createMockImageMeta({ id: `img_${i}` })
      );
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      component.story = mockStory;
      component.isOpen = true;

      fixture.detectChanges();
      tick();
      tick();

      expect(component.hasMoreImages).toBeTrue();
      expect(component.totalImagesCount).toBe(25);
      expect(component.mediaItems.length).toBe(20); // First batch
    }));

    it('should not show hasMoreImages when 20 or fewer images', fakeAsync(() => {
      const mockImages = Array.from({ length: 15 }, (_, i) =>
        createMockImageMeta({ id: `img_${i}` })
      );
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      component.story = mockStory;
      component.isOpen = true;

      fixture.detectChanges();
      tick();
      tick();

      expect(component.hasMoreImages).toBeFalse();
      expect(component.mediaItems.length).toBe(15);
    }));

    it('should load more images when loadMoreImages is called', fakeAsync(() => {
      const mockImages = Array.from({ length: 30 }, (_, i) =>
        createMockImageMeta({ id: `img_${i}` })
      );
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      component.story = mockStory;
      component.isOpen = true;

      fixture.detectChanges();
      tick();
      tick();

      expect(component.mediaItems.length).toBe(20);
      expect(component.hasMoreImages).toBeTrue();

      void component.loadMoreImages();
      tick();
      tick();

      expect(component.mediaItems.length).toBe(30);
      expect(component.hasMoreImages).toBeFalse();
    }));

    it('should set isLoadingMore during loadMoreImages', fakeAsync(() => {
      const mockImages = Array.from({ length: 25 }, (_, i) =>
        createMockImageMeta({ id: `img_${i}` })
      );
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      component.story = mockStory;
      component.isOpen = true;

      fixture.detectChanges();
      tick();
      tick();

      // Start loading more
      void component.loadMoreImages();

      expect(component.isLoadingMore).toBeTrue();

      tick();
      tick();

      expect(component.isLoadingMore).toBeFalse();
    }));

    it('should not load more if hasMoreImages is false', fakeAsync(() => {
      const mockImages = [createMockImageMeta({ id: 'img_1' })];
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      component.story = mockStory;
      component.isOpen = true;

      fixture.detectChanges();
      tick();
      tick();

      mockStoryImageService.getImageBlobUrl.calls.reset();

      void component.loadMoreImages();
      tick();

      // Should not have called getImageBlobUrl again
      expect(mockStoryImageService.getImageBlobUrl).not.toHaveBeenCalled();
    }));

    it('should prevent concurrent loadMoreImages calls', fakeAsync(() => {
      const mockImages = Array.from({ length: 25 }, (_, i) =>
        createMockImageMeta({ id: `img_${i}` })
      );
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      component.story = mockStory;
      component.isOpen = true;

      fixture.detectChanges();
      tick();
      tick();

      // Start first load
      void component.loadMoreImages();
      // Try to start another while first is in progress
      void component.loadMoreImages();

      tick();
      tick();

      // Should only have loaded once (20 initial + 5 more = 25)
      expect(component.mediaItems.length).toBe(25);
    }));
  });

  // ============================================================================
  // Media Item with Video Tests
  // ============================================================================

  describe('Media Items with Video Association', () => {
    it('should mark items with hasVideo when videoId exists', fakeAsync(() => {
      const mockImages = [
        createMockImageMeta({ id: 'img_1', videoId: 'vid_1' }),
        createMockImageMeta({ id: 'img_2', videoId: undefined })
      ];
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      component.story = mockStory;
      component.isOpen = true;

      fixture.detectChanges();
      tick();
      tick();

      expect(component.mediaItems[0].hasVideo).toBeTrue();
      expect(component.mediaItems[0].videoId).toBe('vid_1');
      expect(component.mediaItems[1].hasVideo).toBeFalse();
      expect(component.mediaItems[1].videoId).toBeUndefined();
    }));
  });

  // ============================================================================
  // Image Click Tests
  // ============================================================================

  describe('Media Item Click', () => {
    beforeEach(fakeAsync(() => {
      const mockImages = [
        createMockImageMeta({ id: 'img_1', videoId: 'vid_1' }),
        createMockImageMeta({ id: 'img_2' })
      ];
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      component.story = mockStory;
      component.isOpen = true;

      fixture.detectChanges();
      tick();
      tick();
    }));

    it('should open image viewer when item clicked', fakeAsync(() => {
      const item = component.mediaItems[1]; // Item without video

      void component.onMediaItemClick(item);
      tick();

      expect(component.selectedMediaItem).toBe(item);
      expect(component.showImageViewer).toBeTrue();
    }));

    it('should load video when clicking item with video', fakeAsync(() => {
      const mockVideoMeta = createMockVideoMeta({ id: 'vid_1', name: 'video.mp4' });
      mockStoryMediaService.getVideoMeta.and.returnValue(Promise.resolve(mockVideoMeta));
      mockStoryMediaService.getVideoBlobUrl.and.returnValue(Promise.resolve('blob:mock-video-url'));

      const item = component.mediaItems[0]; // Item with video

      void component.onMediaItemClick(item);
      tick();
      tick();

      expect(mockStoryMediaService.getVideoMeta).toHaveBeenCalledWith('story1', 'vid_1');
      expect(mockStoryMediaService.getVideoBlobUrl).toHaveBeenCalledWith('story1', 'vid_1');
      expect(component.selectedVideoSrc).toBe('blob:mock-video-url');
      expect(component.selectedVideoName).toBe('video.mp4');
    }));

    it('should set loadingVideo during video load', fakeAsync(() => {
      let resolvePromise: (value: unknown) => void;
      const slowPromise = new Promise(resolve => {
        resolvePromise = resolve;
      });
      mockStoryMediaService.getVideoMeta.and.returnValue(slowPromise as Promise<never>);

      const item = component.mediaItems[0];

      void component.onMediaItemClick(item);

      expect(component.loadingVideo).toBeTrue();

      resolvePromise!(createMockVideoMeta());
      mockStoryMediaService.getVideoBlobUrl.and.returnValue(Promise.resolve('blob:url'));
      tick();
      tick();

      expect(component.loadingVideo).toBeFalse();
    }));

    it('should handle video load error gracefully', fakeAsync(() => {
      mockStoryMediaService.getVideoMeta.and.returnValue(Promise.reject(new Error('Video error')));

      const item = component.mediaItems[0];

      void component.onMediaItemClick(item);
      tick();

      expect(component.selectedVideoSrc).toBeNull();
      expect(component.selectedVideoName).toBeNull();
      expect(component.loadingVideo).toBeFalse();
    }));

    it('should not load video for item without video', fakeAsync(() => {
      const item = component.mediaItems[1]; // Item without video

      void component.onMediaItemClick(item);
      tick();

      expect(mockStoryMediaService.getVideoMeta).not.toHaveBeenCalled();
      expect(component.selectedVideoSrc).toBeNull();
    }));
  });

  // ============================================================================
  // Image Viewer Close Tests
  // ============================================================================

  describe('Image Viewer Close', () => {
    beforeEach(fakeAsync(() => {
      const mockImages = [createMockImageMeta({ id: 'img_1' })];
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      component.story = mockStory;
      component.isOpen = true;

      fixture.detectChanges();
      tick();
      tick();

      // Open the viewer
      void component.onMediaItemClick(component.mediaItems[0]);
      tick();
    }));

    it('should close image viewer and reset state', () => {
      expect(component.showImageViewer).toBeTrue();

      component.onImageViewerClosed();

      expect(component.showImageViewer).toBeFalse();
      expect(component.selectedMediaItem).toBeNull();
      expect(component.selectedVideoSrc).toBeNull();
      expect(component.selectedVideoName).toBeNull();
    });
  });

  // ============================================================================
  // Modal Close Tests
  // ============================================================================

  describe('Modal Close', () => {
    beforeEach(fakeAsync(() => {
      const mockImages = [createMockImageMeta({ id: 'img_1' })];
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      component.story = mockStory;
      component.isOpen = true;

      fixture.detectChanges();
      tick();
      tick();
    }));

    it('should emit closed event on onClose', () => {
      let closedEmitted = false;
      component.closed.subscribe(() => {
        closedEmitted = true;
      });

      component.onClose();

      expect(closedEmitted).toBeTrue();
    });

    it('should emit closed event on modal dismiss', () => {
      let closedEmitted = false;
      component.closed.subscribe(() => {
        closedEmitted = true;
      });

      component.onModalDidDismiss();

      expect(closedEmitted).toBeTrue();
    });

    it('should not revoke image blob URLs on close (managed by StoryImageService)', () => {
      // Image blob URLs are managed by StoryImageService and should NOT be revoked here
      // (Test verifies the fix for the bug where revoking cached URLs caused image load failures)
      urlMocks.revokeObjectURLSpy.calls.reset();

      component.onClose();

      // Should NOT have revoked any URLs (no video loaded in this test)
      expect(urlMocks.revokeObjectURLSpy).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Blob URL Cleanup Tests
  // Note: Image blob URLs are managed by StoryImageService, not cleaned up here.
  // Only video blob URLs are cleaned up by this component.
  // ============================================================================

  describe('Blob URL Cleanup', () => {
    it('should cleanup video blob URL on destroy', fakeAsync(() => {
      // Setup: load images with video
      const mockImages = [createMockImageMeta({ id: 'img_1', videoId: 'vid_1' })];
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      const mockVideoMeta = createMockVideoMeta({ id: 'vid_1', name: 'video.mp4' });
      mockStoryMediaService.getVideoMeta.and.returnValue(Promise.resolve(mockVideoMeta));
      mockStoryMediaService.getVideoBlobUrl.and.returnValue(Promise.resolve('blob:video-url'));

      component.story = mockStory;
      component.isOpen = true;
      fixture.detectChanges();
      tick();
      tick();

      // Click to load video
      void component.onMediaItemClick(component.mediaItems[0]);
      tick();
      tick();

      urlMocks.revokeObjectURLSpy.calls.reset();

      component.ngOnDestroy();

      expect(urlMocks.revokeObjectURLSpy).toHaveBeenCalledWith('blob:video-url');
    }));

    it('should not revoke image blob URLs (managed by StoryImageService)', fakeAsync(() => {
      // Setup: load images without video
      const mockImages = [
        createMockImageMeta({ id: 'img_1' }),
        createMockImageMeta({ id: 'img_2' })
      ];
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      component.story = mockStory;
      component.isOpen = true;
      fixture.detectChanges();
      tick();
      tick();

      urlMocks.revokeObjectURLSpy.calls.reset();

      // Close the gallery
      component.onClose();

      // Should NOT revoke image blob URLs (they are managed by StoryImageService)
      expect(urlMocks.revokeObjectURLSpy).not.toHaveBeenCalled();
    }));
  });

  // ============================================================================
  // Skip Images That Can't Load Tests
  // ============================================================================

  describe('Skip Images That Cannot Load', () => {
    it('should skip images that return null blob URL', fakeAsync(() => {
      const mockImages = [
        createMockImageMeta({ id: 'img_1' }),
        createMockImageMeta({ id: 'img_2' }),
        createMockImageMeta({ id: 'img_3' })
      ];
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      // Second image returns null
      mockStoryImageService.getImageBlobUrl.and.callFake((storyId: string, imageId: string) => {
        if (imageId === 'img_2') {
          return Promise.resolve(null);
        }
        return Promise.resolve(`blob:mock-${imageId}`);
      });

      component.story = mockStory;
      component.isOpen = true;

      fixture.detectChanges();
      tick();
      tick();

      // Should only have 2 items (img_1 and img_3)
      expect(component.mediaItems.length).toBe(2);
      expect(component.mediaItems[0].imageId).toBe('img_1');
      expect(component.mediaItems[1].imageId).toBe('img_3');
    }));
  });

  // ============================================================================
  // Empty State Tests
  // ============================================================================

  describe('Empty State', () => {
    it('should handle story with no images', fakeAsync(() => {
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve([]));

      component.story = mockStory;
      component.isOpen = true;

      fixture.detectChanges();
      tick();

      expect(component.mediaItems).toEqual([]);
      expect(component.totalImagesCount).toBe(0);
      expect(component.hasMoreImages).toBeFalse();
    }));
  });

  // ============================================================================
  // Jump to Image Tests
  // ============================================================================

  describe('Jump to Image', () => {
    beforeEach(fakeAsync(() => {
      const mockImages = [
        createMockImageMeta({ id: 'img_1', name: 'image1.png' }),
        createMockImageMeta({ id: 'img_2', name: 'image2.png' })
      ];
      mockStoryImageService.getImagesForStory.and.returnValue(Promise.resolve(mockImages));

      component.story = mockStory;
      component.isOpen = true;

      fixture.detectChanges();
      tick();
      tick();
    }));

    it('should emit jumpToImage event with correct imageId', () => {
      let emittedEvent: { imageId: string } | null = null;
      component.jumpToImage.subscribe((e: { imageId: string }) => {
        emittedEvent = e;
      });

      const mockEvent = {
        stopPropagation: jasmine.createSpy('stopPropagation')
      } as unknown as Event;

      component.onJumpToImage('img_1', mockEvent);

      expect(emittedEvent).not.toBeNull();
      expect(emittedEvent!.imageId).toBe('img_1');
    });

    it('should call stopPropagation to prevent opening image viewer', () => {
      const mockEvent = {
        stopPropagation: jasmine.createSpy('stopPropagation')
      } as unknown as Event;

      component.onJumpToImage('img_1', mockEvent);

      expect(mockEvent.stopPropagation).toHaveBeenCalled();
    });

    it('should close the gallery after emitting event', () => {
      let closedEmitted = false;
      component.closed.subscribe(() => {
        closedEmitted = true;
      });

      const mockEvent = {
        stopPropagation: jasmine.createSpy('stopPropagation')
      } as unknown as Event;

      component.onJumpToImage('img_1', mockEvent);

      expect(closedEmitted).toBeTrue();
    });

    it('should not revoke image blob URLs when jumping (managed by StoryImageService)', () => {
      // This test verifies that jumping does NOT revoke image URLs
      // because they are managed by StoryImageService and may be needed by the editor
      urlMocks.revokeObjectURLSpy.calls.reset();

      const mockEvent = {
        stopPropagation: jasmine.createSpy('stopPropagation')
      } as unknown as Event;

      component.onJumpToImage('img_1', mockEvent);

      // Should NOT revoke image URLs - they're managed by StoryImageService
      expect(urlMocks.revokeObjectURLSpy).not.toHaveBeenCalled();
    });
  });
});
