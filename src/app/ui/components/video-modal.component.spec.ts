/**
 * Comprehensive tests for VideoModalComponent.
 * Covers video display, upload, association, and removal functionality.
 */
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { SimpleChange } from '@angular/core';
import { VideoModalComponent } from './video-modal.component';
import { StoryMediaService } from '../../shared/services/story-media.service';
import { StoryImageService } from '../../shared/services/story-image.service';
import { DialogService } from '../../core/services/dialog.service';
import {
  createMockVideoFile,
  createMockVideoMeta,
  createMockImageMeta
} from '../../shared/testing/image-test-helpers';

describe('VideoModalComponent', () => {
  let component: VideoModalComponent;
  let fixture: ComponentFixture<VideoModalComponent>;
  let mockStoryMediaService: jasmine.SpyObj<StoryMediaService>;
  let mockStoryImageService: jasmine.SpyObj<StoryImageService>;
  let mockDialogService: jasmine.SpyObj<DialogService>;

  beforeEach(async () => {
    mockStoryMediaService = jasmine.createSpyObj('StoryMediaService', [
      'addVideo',
      'removeVideo',
      'getVideoMeta',
      'getVideoBlobUrl'
    ]);
    mockStoryImageService = jasmine.createSpyObj('StoryImageService', [
      'getImageMeta',
      'setVideoAssociation'
    ]);
    mockDialogService = jasmine.createSpyObj('DialogService', [
      'showError',
      'confirmDestructive'
    ]);

    // Set default return values
    mockStoryImageService.getImageMeta.and.returnValue(Promise.resolve(null));
    mockDialogService.confirmDestructive.and.returnValue(Promise.resolve(false));

    await TestBed.configureTestingModule({
      imports: [VideoModalComponent, FormsModule],
      providers: [
        { provide: StoryMediaService, useValue: mockStoryMediaService },
        { provide: StoryImageService, useValue: mockStoryImageService },
        { provide: DialogService, useValue: mockDialogService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(VideoModalComponent);
    component = fixture.componentInstance;
    // Don't call detectChanges here - let each test control initialization
  });

  // ============================================================================
  // Initial State Tests
  // ============================================================================

  describe('Initial State', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should start with modal not visible', () => {
      expect(component.isVisible).toBeFalse();
    });

    it('should start with no video', () => {
      expect(component.hasVideo).toBeFalse();
      expect(component.currentVideo).toBeNull();
    });

    it('should start with no upload in progress', () => {
      expect(component.isUploading).toBeFalse();
      expect(component.isProcessing).toBeFalse();
    });

    it('should start with no drag state', () => {
      expect(component.isDragging).toBeFalse();
    });
  });

  // ============================================================================
  // Loading Video Tests
  // ============================================================================

  describe('Loading Video for Image', () => {
    it('should set hasVideo=true when image has video association', fakeAsync(() => {
      const mockImageMeta = createMockImageMeta({ videoId: 'vid_123' });
      const mockVideoMeta = createMockVideoMeta({ id: 'vid_123' });

      mockStoryImageService.getImageMeta.and.returnValue(Promise.resolve(mockImageMeta));
      mockStoryMediaService.getVideoMeta.and.returnValue(Promise.resolve(mockVideoMeta));
      mockStoryMediaService.getVideoBlobUrl.and.returnValue(Promise.resolve('blob:mock-url'));

      component.storyId = 'story1';
      component.imageId = 'img_123';
      component.isVisible = true;

      // Trigger initialization
      fixture.detectChanges();
      tick(); // Process ngOnInit promise
      tick(); // Process getImageMeta promise
      tick(); // Process getVideoMeta promise
      tick(); // Process getVideoBlobUrl promise

      // Verify component state reflects the video was loaded
      expect(component.hasVideo).toBeTrue();
      expect(component.currentVideo).toBeTruthy();
      expect(component.currentVideoBlobUrl).toBe('blob:mock-url');
    }));

    it('should not call getVideoMeta when image has no video association', async () => {
      const mockImageMeta = createMockImageMeta({ videoId: undefined });

      mockStoryImageService.getImageMeta.and.returnValue(Promise.resolve(mockImageMeta));

      component.storyId = 'story1';
      component.imageId = 'img_123';
      component.isVisible = true;

      await component.ngOnInit();

      expect(mockStoryImageService.getImageMeta).toHaveBeenCalled();
      expect(mockStoryMediaService.getVideoMeta).not.toHaveBeenCalled();
    });

    it('should handle error when loading video gracefully', async () => {
      mockStoryImageService.getImageMeta.and.returnValue(Promise.reject(new Error('Load error')));

      component.storyId = 'story1';
      component.imageId = 'img_123';
      component.isVisible = true;

      // Should not throw
      await expectAsync(component.ngOnInit()).toBeResolved();
    });

    it('should not load when storyId is missing', async () => {
      component.storyId = null;
      component.imageId = 'img_123';

      await component.ngOnInit();

      expect(mockStoryImageService.getImageMeta).not.toHaveBeenCalled();
    });

    it('should not load when imageId is missing', async () => {
      component.storyId = 'story1';
      component.imageId = null;

      await component.ngOnInit();

      expect(mockStoryImageService.getImageMeta).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // File Selection Tests
  // ============================================================================

  describe('File Selection', () => {
    it('should reject non-video files', () => {
      const textFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      const event = { target: { files: [textFile] } } as unknown as Event;

      component.onFileSelected(event);

      expect(mockDialogService.showError).toHaveBeenCalledWith({
        header: 'Invalid File',
        message: 'Please select a video file.'
      });
      expect(component.uploadedFile).toBeNull();
    });

    it('should reject files larger than 50MB', () => {
      const largeFile = createMockVideoFile('large.mp4', 51 * 1024 * 1024);
      const event = { target: { files: [largeFile] } } as unknown as Event;

      component.onFileSelected(event);

      expect(mockDialogService.showError).toHaveBeenCalledWith({
        header: 'File Too Large',
        message: 'Video is too large. Maximum size: 50MB'
      });
      expect(component.uploadedFile).toBeNull();
    });

    it('should accept valid video files', () => {
      const videoFile = createMockVideoFile('test.mp4', 1024 * 1024);
      const event = { target: { files: [videoFile] } } as unknown as Event;

      component.onFileSelected(event);

      expect(component.uploadedFile).toBe(videoFile);
    });
  });

  // ============================================================================
  // Drag and Drop Tests
  // ============================================================================

  describe('Drag and Drop', () => {
    it('should set isDragging on dragover', () => {
      const event = {
        preventDefault: jasmine.createSpy(),
        stopPropagation: jasmine.createSpy()
      } as unknown as DragEvent;

      component.onDragOver(event);

      expect(component.isDragging).toBeTrue();
      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });

    it('should unset isDragging on dragleave', () => {
      component.isDragging = true;
      const event = {
        preventDefault: jasmine.createSpy(),
        stopPropagation: jasmine.createSpy()
      } as unknown as DragEvent;

      component.onDragLeave(event);

      expect(component.isDragging).toBeFalse();
    });

    it('should handle dropped video file', () => {
      const videoFile = createMockVideoFile('dropped.mp4', 1024 * 1024);
      const event = {
        preventDefault: jasmine.createSpy(),
        stopPropagation: jasmine.createSpy(),
        dataTransfer: { files: [videoFile] }
      } as unknown as DragEvent;

      component.onDrop(event);

      expect(component.isDragging).toBeFalse();
      expect(component.uploadedFile).toBe(videoFile);
    });

    it('should reject dropped non-video file', () => {
      const textFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      const event = {
        preventDefault: jasmine.createSpy(),
        stopPropagation: jasmine.createSpy(),
        dataTransfer: { files: [textFile] }
      } as unknown as DragEvent;

      component.onDrop(event);

      expect(mockDialogService.showError).toHaveBeenCalled();
      expect(component.uploadedFile).toBeNull();
    });
  });

  // ============================================================================
  // Upload Preview Tests
  // ============================================================================

  describe('Upload Preview', () => {
    it('should remove upload preview', () => {
      component.uploadedFile = createMockVideoFile();
      component.uploadPreview = 'data:video/mp4;base64,abc';

      component.removeUploadPreview();

      expect(component.uploadedFile).toBeNull();
      expect(component.uploadPreview).toBeNull();
    });
  });

  // ============================================================================
  // Save Video Tests
  // ============================================================================

  describe('Save Video', () => {
    beforeEach(() => {
      mockStoryMediaService.addVideo.and.returnValue(Promise.resolve({
        meta: {
          id: 'vid_123',
          storyId: 'story1',
          name: 'test.mp4',
          mimeType: 'video/mp4',
          size: 1024 * 1024,
          createdAt: new Date()
        },
        blobUrl: 'blob:mock-url'
      }));
      mockStoryImageService.setVideoAssociation.and.returnValue(Promise.resolve());
      mockStoryImageService.getImageMeta.and.returnValue(Promise.resolve(
        createMockImageMeta({ videoId: 'vid_123' })
      ));
      mockStoryMediaService.getVideoMeta.and.returnValue(Promise.resolve(
        createMockVideoMeta({ id: 'vid_123' })
      ));
      mockStoryMediaService.getVideoBlobUrl.and.returnValue(Promise.resolve('blob:mock-url'));
    });

    it('should not save if no file selected', async () => {
      component.uploadedFile = null;
      component.storyId = 'story1';
      component.imageId = 'img_123';

      await component.saveVideo();

      expect(mockStoryMediaService.addVideo).not.toHaveBeenCalled();
    });

    it('should not save if imageId is missing', async () => {
      component.uploadedFile = createMockVideoFile();
      component.storyId = 'story1';
      component.imageId = null;

      await component.saveVideo();

      expect(mockStoryMediaService.addVideo).not.toHaveBeenCalled();
    });

    it('should not save if storyId is missing', async () => {
      component.uploadedFile = createMockVideoFile();
      component.storyId = null;
      component.imageId = 'img_123';

      await component.saveVideo();

      expect(mockStoryMediaService.addVideo).not.toHaveBeenCalled();
    });

    it('should upload video and associate with image', async () => {
      const mockFile = createMockVideoFile();
      component.uploadedFile = mockFile;
      component.storyId = 'story1';
      component.imageId = 'img_123';

      await component.saveVideo();

      // Note: uploadedFile is cleared after successful save, so we use the saved reference
      expect(mockStoryMediaService.addVideo).toHaveBeenCalledWith('story1', mockFile);
      expect(mockStoryImageService.setVideoAssociation).toHaveBeenCalledWith('story1', 'img_123', 'vid_123');
    });

    it('should emit videoAssociated event on success', async () => {
      component.uploadedFile = createMockVideoFile();
      component.storyId = 'story1';
      component.imageId = 'img_123';

      let emittedEvent: { imageId: string; videoId: string } | undefined;
      component.videoAssociated.subscribe(event => {
        emittedEvent = event;
      });

      await component.saveVideo();

      expect(emittedEvent).toBeDefined();
      expect(emittedEvent!.imageId).toBe('img_123');
      expect(emittedEvent!.videoId).toBe('vid_123');
    });

    it('should set isProcessing during save', async () => {
      component.uploadedFile = createMockVideoFile();
      component.storyId = 'story1';
      component.imageId = 'img_123';

      const savePromise = component.saveVideo();

      expect(component.isProcessing).toBeTrue();

      await savePromise;

      expect(component.isProcessing).toBeFalse();
    });

    it('should handle save error gracefully', async () => {
      mockStoryMediaService.addVideo.and.returnValue(Promise.reject(new Error('Upload failed')));

      component.uploadedFile = createMockVideoFile();
      component.storyId = 'story1';
      component.imageId = 'img_123';

      await component.saveVideo();

      expect(mockDialogService.showError).toHaveBeenCalledWith({
        header: 'Save Error',
        message: 'Upload failed'
      });
      expect(component.isProcessing).toBeFalse();
    });
  });

  // ============================================================================
  // Remove Video Tests
  // ============================================================================

  describe('Remove Video', () => {
    beforeEach(() => {
      component.storyId = 'story1';
      component.imageId = 'img_123';
      component.currentVideo = createMockVideoMeta({ id: 'vid_456' });
      component.hasVideo = true;

      mockStoryImageService.setVideoAssociation.and.returnValue(Promise.resolve());
      mockStoryMediaService.removeVideo.and.returnValue(Promise.resolve());
    });

    it('should not remove if user cancels confirmation', async () => {
      mockDialogService.confirmDestructive.and.returnValue(Promise.resolve(false));

      await component.removeVideo();

      expect(mockStoryImageService.setVideoAssociation).not.toHaveBeenCalled();
      expect(mockStoryMediaService.removeVideo).not.toHaveBeenCalled();
    });

    it('should remove video on confirmation', async () => {
      mockDialogService.confirmDestructive.and.returnValue(Promise.resolve(true));

      await component.removeVideo();

      expect(mockStoryImageService.setVideoAssociation).toHaveBeenCalledWith('story1', 'img_123', null);
      expect(mockStoryMediaService.removeVideo).toHaveBeenCalledWith('story1', 'vid_456');
    });

    it('should reset video state after removal', async () => {
      mockDialogService.confirmDestructive.and.returnValue(Promise.resolve(true));

      await component.removeVideo();

      expect(component.currentVideo).toBeNull();
      expect(component.currentVideoBlobUrl).toBeNull();
      expect(component.hasVideo).toBeFalse();
    });

    it('should handle removal error gracefully', async () => {
      mockDialogService.confirmDestructive.and.returnValue(Promise.resolve(true));
      mockStoryImageService.setVideoAssociation.and.returnValue(Promise.reject(new Error('Removal failed')));

      await component.removeVideo();

      expect(mockDialogService.showError).toHaveBeenCalledWith({
        header: 'Error',
        message: 'Error removing video. Please try again.'
      });
    });

    it('should not remove if imageId is missing', async () => {
      component.imageId = null;
      mockDialogService.confirmDestructive.and.returnValue(Promise.resolve(true));

      await component.removeVideo();

      expect(mockStoryImageService.setVideoAssociation).not.toHaveBeenCalled();
    });

    it('should not remove if currentVideo is null', async () => {
      component.currentVideo = null;
      mockDialogService.confirmDestructive.and.returnValue(Promise.resolve(true));

      await component.removeVideo();

      expect(mockStoryImageService.setVideoAssociation).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Modal Controls Tests
  // ============================================================================

  describe('Modal Controls', () => {
    it('should start upload mode', () => {
      component.isUploading = false;

      component.startUpload();

      expect(component.isUploading).toBeTrue();
    });

    it('should cancel upload', () => {
      component.isUploading = true;
      component.uploadedFile = createMockVideoFile();
      component.uploadPreview = 'data:video/mp4;base64,abc';

      component.cancelUpload();

      expect(component.isUploading).toBeFalse();
      expect(component.uploadedFile).toBeNull();
      expect(component.uploadPreview).toBeNull();
    });

    it('should emit closed event on closeModal', () => {
      let closed = false;
      component.closed.subscribe(() => {
        closed = true;
      });

      component.closeModal();

      expect(closed).toBeTrue();
    });

    it('should cleanup upload state on closeModal', () => {
      component.isUploading = true;
      component.uploadedFile = createMockVideoFile();
      component.uploadPreview = 'data:video/mp4;base64,abc';

      component.closeModal();

      expect(component.isUploading).toBeFalse();
      expect(component.uploadedFile).toBeNull();
      expect(component.uploadPreview).toBeNull();
    });
  });

  // ============================================================================
  // File Size Formatting Tests
  // ============================================================================

  describe('File Size Formatting', () => {
    it('should format bytes correctly', () => {
      expect(component.formatFileSize(0)).toBe('0 Bytes');
      expect(component.formatFileSize(500)).toBe('500 Bytes');
    });

    it('should format KB correctly', () => {
      expect(component.formatFileSize(1024)).toBe('1 KB');
      expect(component.formatFileSize(2560)).toBe('2.5 KB');
    });

    it('should format MB correctly', () => {
      expect(component.formatFileSize(1024 * 1024)).toBe('1 MB');
      expect(component.formatFileSize(2.5 * 1024 * 1024)).toBe('2.5 MB');
    });
  });

  // ============================================================================
  // Video Data URL Getter Tests
  // ============================================================================

  describe('Video Data URL', () => {
    it('should return empty string when no blob URL', () => {
      component.currentVideoBlobUrl = null;

      expect(component.videoDataUrl).toBe('');
    });

    it('should return blob URL when available', () => {
      component.currentVideoBlobUrl = 'blob:http://localhost/mock-url';

      expect(component.videoDataUrl).toBe('blob:http://localhost/mock-url');
    });
  });

  // ============================================================================
  // ngOnChanges Tests
  // ============================================================================

  describe('ngOnChanges', () => {
    beforeEach(() => {
      mockStoryImageService.getImageMeta.and.returnValue(Promise.resolve(null));
    });

    it('should load video when imageId changes and modal is visible', async () => {
      component.storyId = 'story1';
      component.isVisible = true;
      component.imageId = 'img_new';

      await component.ngOnChanges({
        imageId: new SimpleChange('img_old', 'img_new', false)
      });

      expect(mockStoryImageService.getImageMeta).toHaveBeenCalledWith('story1', 'img_new');
    });

    it('should reset state when modal becomes hidden', async () => {
      component.hasVideo = true;
      component.currentVideo = createMockVideoMeta();
      component.isUploading = true;
      component.isVisible = false;

      await component.ngOnChanges({
        isVisible: new SimpleChange(true, false, false)
      });

      expect(component.hasVideo).toBeFalse();
      expect(component.currentVideo).toBeNull();
      expect(component.isUploading).toBeFalse();
    });
  });

  // ============================================================================
  // Video Event Handler Tests
  // ============================================================================

  describe('Video Event Handlers', () => {
    it('should handle video loaded event', () => {
      expect(() => component.onVideoLoaded()).not.toThrow();
    });

    it('should show error on video error', () => {
      component.onVideoError();

      expect(mockDialogService.showError).toHaveBeenCalledWith({
        header: 'Video Error',
        message: 'Error loading video.'
      });
    });
  });
});
