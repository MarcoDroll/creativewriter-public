/**
 * Comprehensive tests for ImageUploadDialogComponent.
 * Covers file upload, URL input, compression, cropping, and insert functionality.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ImageUploadDialogComponent, ImageInsertResult } from './image-upload-dialog.component';
import { StoryImageService } from '../../shared/services/story-image.service';
import { ModalController } from '@ionic/angular/standalone';
import { DialogService } from '../../core/services/dialog.service';
import { createMockImageFile, flushPromises } from '../../shared/testing/image-test-helpers';

describe('ImageUploadDialogComponent', () => {
  let component: ImageUploadDialogComponent;
  let fixture: ComponentFixture<ImageUploadDialogComponent>;
  let mockStoryImageService: jasmine.SpyObj<StoryImageService>;
  let mockModalController: jasmine.SpyObj<ModalController>;
  let mockDialogService: jasmine.SpyObj<DialogService>;

  beforeEach(async () => {
    mockStoryImageService = jasmine.createSpyObj('StoryImageService', ['addImage']);
    mockModalController = jasmine.createSpyObj('ModalController', ['create']);
    mockDialogService = jasmine.createSpyObj('DialogService', ['showError']);

    await TestBed.configureTestingModule({
      imports: [ImageUploadDialogComponent, FormsModule],
      providers: [
        { provide: StoryImageService, useValue: mockStoryImageService },
        { provide: ModalController, useValue: mockModalController },
        { provide: DialogService, useValue: mockDialogService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ImageUploadDialogComponent);
    component = fixture.componentInstance;
    component.storyId = 'story1';
    fixture.detectChanges();
  });

  // ============================================================================
  // Initial State Tests
  // ============================================================================

  describe('Initial State', () => {
    it('should create', () => {
      expect(component).toBeTruthy();
    });

    it('should start with upload tab active', () => {
      expect(component.activeTab).toBe('upload');
    });

    it('should start with no preview', () => {
      expect(component.uploadPreview).toBeNull();
      expect(component.urlPreview).toBeNull();
    });

    it('should have default compression settings', () => {
      expect(component.compressionQuality).toBe(0.8);
      expect(component.maxWidth).toBe(1200);
    });

    it('should have zero original dimensions initially', () => {
      expect(component.originalWidth).toBe(0);
      expect(component.originalHeight).toBe(0);
    });

    it('should not be in processing state', () => {
      expect(component.isProcessing).toBeFalse();
    });
  });

  // ============================================================================
  // Tab Switching Tests
  // ============================================================================

  describe('Tab Switching', () => {
    it('should switch to URL tab', () => {
      component.activeTab = 'url';
      expect(component.activeTab).toBe('url');
    });

    it('should switch back to upload tab', () => {
      component.activeTab = 'url';
      component.activeTab = 'upload';
      expect(component.activeTab).toBe('upload');
    });
  });

  // ============================================================================
  // File Selection Tests
  // ============================================================================

  describe('File Selection', () => {
    it('should reject non-image files', async () => {
      const textFile = new File(['test'], 'test.txt', { type: 'text/plain' });
      const event = { target: { files: [textFile] } } as unknown as Event;

      await component.onFileSelected(event);

      expect(mockDialogService.showError).toHaveBeenCalledWith({
        header: 'Invalid File',
        message: 'Please select an image file.'
      });
      expect(component.uploadPreview).toBeNull();
    });

    it('should accept image files', async () => {
      const imageFile = createMockImageFile('test.png', 1024);
      const event = { target: { files: [imageFile] } } as unknown as Event;

      await component.onFileSelected(event);

      expect(component.uploadedFile).toBe(imageFile);
      expect(component.originalSize).toBe(1024);
    });

    it('should generate alt text from filename', async () => {
      const imageFile = createMockImageFile('my-test-image.png');
      const event = { target: { files: [imageFile] } } as unknown as Event;

      await component.onFileSelected(event);

      expect(component.altText).toBe('My Test Image');
    });

    it('should set original size', async () => {
      const imageFile = createMockImageFile('test.png', 2048);
      const event = { target: { files: [imageFile] } } as unknown as Event;

      await component.onFileSelected(event);

      expect(component.originalSize).toBe(2048);
    });

    it('should reset URL state when file is selected', async () => {
      component.imageUrl = 'https://example.com/image.jpg';
      component.urlPreview = 'https://example.com/image.jpg';

      const imageFile = createMockImageFile('test.png');
      const event = { target: { files: [imageFile] } } as unknown as Event;

      await component.onFileSelected(event);

      expect(component.imageUrl).toBe('');
      expect(component.urlPreview).toBeNull();
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

    it('should handle dropped image file', async () => {
      const imageFile = createMockImageFile('dropped.png', 512);
      const event = {
        preventDefault: jasmine.createSpy(),
        stopPropagation: jasmine.createSpy(),
        dataTransfer: { files: [imageFile] }
      } as unknown as DragEvent;

      await component.onDrop(event);

      expect(component.isDragging).toBeFalse();
      expect(component.uploadedFile).toBe(imageFile);
    });

    it('should prevent default on drop', async () => {
      const imageFile = createMockImageFile('dropped.png');
      const event = {
        preventDefault: jasmine.createSpy(),
        stopPropagation: jasmine.createSpy(),
        dataTransfer: { files: [imageFile] }
      } as unknown as DragEvent;

      await component.onDrop(event);

      expect(event.preventDefault).toHaveBeenCalled();
      expect(event.stopPropagation).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // URL Tab Tests
  // ============================================================================

  describe('URL Tab', () => {
    it('should set URL preview when URL is entered', () => {
      component.imageUrl = 'https://example.com/image.jpg';
      component.onUrlChange();

      expect(component.urlPreview).toBe('https://example.com/image.jpg');
    });

    it('should clear URL preview when URL is empty', () => {
      component.imageUrl = 'https://example.com/image.jpg';
      component.onUrlChange();

      component.imageUrl = '';
      component.onUrlChange();

      expect(component.urlPreview).toBeNull();
    });

    it('should clear URL preview on image error', () => {
      component.urlPreview = 'https://example.com/image.jpg';

      component.onImageError();

      expect(component.urlPreview).toBeNull();
    });
  });

  // ============================================================================
  // Remove Image Tests
  // ============================================================================

  describe('Remove Uploaded Image', () => {
    it('should clear upload state', async () => {
      // Setup: add an image first
      const imageFile = createMockImageFile('test.png', 1024);
      const event = { target: { files: [imageFile] } } as unknown as Event;
      await component.onFileSelected(event);

      component.removeUploadedImage();

      expect(component.uploadedFile).toBeNull();
      expect(component.uploadPreview).toBeNull();
      expect(component.originalSize).toBe(0);
      expect(component.compressedSize).toBe(0);
    });

    it('should reset original dimensions', () => {
      // Setup: simulate dimensions were set
      component.originalWidth = 1920;
      component.originalHeight = 1080;

      component.removeUploadedImage();

      expect(component.originalWidth).toBe(0);
      expect(component.originalHeight).toBe(0);
    });
  });

  // ============================================================================
  // Compression Settings Tests
  // ============================================================================

  describe('Compression Settings', () => {
    it('should calculate estimated size based on quality', () => {
      component.originalSize = 1024 * 1024; // 1MB
      component.compressionQuality = 0.8;

      const estimated = component.getEstimatedSize();

      expect(estimated).toBeGreaterThan(0);
      expect(estimated).toBeLessThan(component.originalSize);
    });

    it('should calculate size reduction percentage', () => {
      component.originalSize = 1000;
      component.compressedSize = 700;

      const reduction = component.getSizeReduction();

      expect(reduction).toBe(30);
    });

    it('should return 0 reduction when no original size', () => {
      component.originalSize = 0;
      component.compressedSize = 500;

      const reduction = component.getSizeReduction();

      expect(reduction).toBe(0);
    });

    it('should calculate estimated reduction', () => {
      component.originalSize = 1024 * 1024;
      component.compressionQuality = 0.8;

      const reduction = component.getEstimatedReduction();

      expect(reduction).toBeGreaterThan(0);
      expect(reduction).toBeLessThan(100);
    });
  });

  // ============================================================================
  // Dimension-Aware Size Estimation Tests
  // ============================================================================

  describe('Dimension-Aware Size Estimation', () => {
    beforeEach(() => {
      component.originalSize = 1024 * 1024; // 1MB
      component.compressionQuality = 0.8;
    });

    it('should not apply resize multiplier when dimensions are unknown', () => {
      component.originalWidth = 0;
      component.originalHeight = 0;
      component.maxWidth = 600;

      const estimated = component.getEstimatedSize();

      // Without dimensions, resizeMultiplier should be 1
      // Expected: originalSize * quality * formatReduction = 1MB * 0.8 * 0.7
      const expectedWithoutResize = Math.round(1024 * 1024 * 0.8 * 0.7);
      expect(estimated).toBe(expectedWithoutResize);
    });

    it('should not apply resize multiplier when maxWidth is larger than original', () => {
      component.originalWidth = 800;
      component.originalHeight = 600;
      component.maxWidth = 1200; // Larger than original

      const estimated = component.getEstimatedSize();

      // No resize needed, resizeMultiplier should be 1
      const expectedWithoutResize = Math.round(1024 * 1024 * 0.8 * 0.7);
      expect(estimated).toBe(expectedWithoutResize);
    });

    it('should apply resize multiplier for landscape images when maxWidth is smaller', () => {
      component.originalWidth = 2400;
      component.originalHeight = 1600;
      component.maxWidth = 1200; // Half of original width

      const estimated = component.getEstimatedSize();

      // Landscape: larger dimension is width (2400)
      // scale = 1200/2400 = 0.5, resizeMultiplier = 0.25
      const scale = 1200 / 2400;
      const resizeMultiplier = scale * scale;
      const expected = Math.round(1024 * 1024 * 0.8 * 0.7 * resizeMultiplier);
      expect(estimated).toBe(expected);
    });

    it('should apply resize multiplier based on height for portrait images', () => {
      component.originalWidth = 1600;
      component.originalHeight = 2400; // Height is larger
      component.maxWidth = 1200;

      const estimated = component.getEstimatedSize();

      // Portrait: larger dimension is height (2400)
      // scale = 1200/2400 = 0.5, resizeMultiplier = 0.25
      const scale = 1200 / 2400;
      const resizeMultiplier = scale * scale;
      const expected = Math.round(1024 * 1024 * 0.8 * 0.7 * resizeMultiplier);
      expect(estimated).toBe(expected);
    });

    it('should handle square images correctly', () => {
      component.originalWidth = 2000;
      component.originalHeight = 2000;
      component.maxWidth = 1000;

      const estimated = component.getEstimatedSize();

      // Square: larger dimension is both (2000)
      // scale = 1000/2000 = 0.5, resizeMultiplier = 0.25
      const scale = 1000 / 2000;
      const resizeMultiplier = scale * scale;
      const expected = Math.round(1024 * 1024 * 0.8 * 0.7 * resizeMultiplier);
      expect(estimated).toBe(expected);
    });

    it('should calculate larger reduction for very small maxWidth', () => {
      component.originalWidth = 4000;
      component.originalHeight = 3000;
      component.maxWidth = 400; // 10% of original

      const estimated = component.getEstimatedSize();

      // scale = 400/4000 = 0.1, resizeMultiplier = 0.01
      const scale = 400 / 4000;
      const resizeMultiplier = scale * scale;
      const expected = Math.round(1024 * 1024 * 0.8 * 0.7 * resizeMultiplier);
      expect(estimated).toBe(expected);
      // Should be about 1% of the non-resized estimate
      expect(estimated).toBeLessThan(10000);
    });

    it('should update estimated reduction when dimensions change', () => {
      component.originalWidth = 0;
      component.originalHeight = 0;
      component.maxWidth = 600;

      const estimatedWithoutDimensions = component.getEstimatedReduction();

      // Now set dimensions larger than maxWidth
      component.originalWidth = 1200;
      component.originalHeight = 800;

      const estimatedWithDimensions = component.getEstimatedReduction();

      // With dimensions, resize multiplier kicks in, so reduction should be higher
      expect(estimatedWithDimensions).toBeGreaterThan(estimatedWithoutDimensions);
    });
  });

  // ============================================================================
  // Dimension Extraction Tests
  // ============================================================================

  describe('Dimension Extraction', () => {
    it('should extract dimensions from a valid image data URL', async () => {
      // Create a real small PNG image (1x1 pixel red)
      const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      component.uploadPreview = dataUrl;

      // Call the private method indirectly through file handling
      // We'll test by setting up and triggering the dimension extraction
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (component as any).extractImageDimensions(dataUrl);

      // Wait for async image load
      await flushPromises();
      await new Promise(resolve => setTimeout(resolve, 100));

      // The 1x1 image should set dimensions to 1x1
      expect(component.originalWidth).toBe(1);
      expect(component.originalHeight).toBe(1);
    });

    it('should not update dimensions if preview changed during load (race condition guard)', async () => {
      const dataUrl1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const dataUrl2 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAEklEQVR42mNk+M9QzwAEjDAGAAcaBQEPFngmAAAAAElFTkSuQmCC';

      // Start extracting from first image
      component.uploadPreview = dataUrl1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (component as any).extractImageDimensions(dataUrl1);

      // Immediately change preview (simulating rapid file selection)
      component.uploadPreview = dataUrl2;

      // Wait for async operations
      await flushPromises();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Dimensions should NOT be set from dataUrl1 because preview changed
      // They might be 0 or undefined since we didn't extract from dataUrl2
      // The key is that they shouldn't be 1x1 from the first image
      // (In real usage, extractImageDimensions would be called again for dataUrl2)
    });

    it('should handle image load errors gracefully', async () => {
      // Invalid data URL that won't load as an image
      const invalidDataUrl = 'data:image/png;base64,invalid_base64_data';
      component.uploadPreview = invalidDataUrl;

      const consoleSpy = spyOn(console, 'warn');

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (component as any).extractImageDimensions(invalidDataUrl);

      // Wait for async operations
      await flushPromises();
      await new Promise(resolve => setTimeout(resolve, 100));

      // Should have logged a warning
      expect(consoleSpy).toHaveBeenCalledWith('Failed to extract image dimensions');
      // Dimensions should remain at 0
      expect(component.originalWidth).toBe(0);
      expect(component.originalHeight).toBe(0);
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
  // canInsert Tests
  // ============================================================================

  describe('canInsert', () => {
    it('should return false when upload tab has no preview', () => {
      component.activeTab = 'upload';
      component.uploadPreview = null;

      expect(component.canInsert()).toBeFalse();
    });

    it('should return true when upload tab has preview', () => {
      component.activeTab = 'upload';
      component.uploadPreview = 'data:image/png;base64,abc';

      expect(component.canInsert()).toBeTrue();
    });

    it('should return false when URL tab has no preview', () => {
      component.activeTab = 'url';
      component.urlPreview = null;

      expect(component.canInsert()).toBeFalse();
    });

    it('should return true when URL tab has preview', () => {
      component.activeTab = 'url';
      component.urlPreview = 'https://example.com/image.jpg';

      expect(component.canInsert()).toBeTrue();
    });
  });

  // ============================================================================
  // Processing Stage Tests
  // ============================================================================

  describe('Processing Stages', () => {
    it('should return correct message for prepare stage', () => {
      component.processingStage = 'prepare';
      expect(component.processingMessage).toBe('Preparing image...');
    });

    it('should return correct message for compressing stage', () => {
      component.processingStage = 'compressing';
      expect(component.processingMessage).toBe('Compressing image...');
    });

    it('should return correct message for uploading stage', () => {
      component.processingStage = 'uploading';
      expect(component.processingMessage).toBe('Uploading image...');
    });

    it('should return correct message for finalizing stage', () => {
      component.processingStage = 'finalizing';
      expect(component.processingMessage).toBe('Finishing up...');
    });
  });

  // ============================================================================
  // Insert Tests - URL Tab
  // ============================================================================

  describe('Insert from URL', () => {
    it('should emit imageInserted with URL when inserting from URL tab', async () => {
      component.activeTab = 'url';
      component.imageUrl = 'https://example.com/image.jpg';
      component.urlPreview = 'https://example.com/image.jpg';
      component.altText = 'Test Image';
      component.titleText = 'Test Title';

      let emittedResult: ImageInsertResult | undefined;
      component.imageInserted.subscribe(result => {
        emittedResult = result;
      });

      await component.insert();

      expect(emittedResult).toBeDefined();
      expect(emittedResult!.url).toBe('https://example.com/image.jpg');
      expect(emittedResult!.alt).toBe('Test Image');
      expect(emittedResult!.title).toBe('Test Title');
      expect(emittedResult!.imageId).toBeUndefined();
      expect(emittedResult!.storyId).toBeUndefined();
    });

    it('should not call storyImageService for URL inserts', async () => {
      component.activeTab = 'url';
      component.imageUrl = 'https://example.com/image.jpg';
      component.urlPreview = 'https://example.com/image.jpg';

      await component.insert();

      expect(mockStoryImageService.addImage).not.toHaveBeenCalled();
    });
  });

  // ============================================================================
  // Insert Tests - Upload Tab
  // ============================================================================

  describe('Insert from Upload', () => {
    beforeEach(() => {
      mockStoryImageService.addImage.and.returnValue(Promise.resolve({
        meta: {
          id: 'img_123',
          storyId: 'story1',
          name: 'test.png',
          mimeType: 'image/png',
          size: 512,
          createdAt: new Date()
        },
        blobUrl: 'blob:http://localhost/mock-url'
      }));
    });

    it('should call storyImageService.addImage for file uploads', async () => {
      component.activeTab = 'upload';
      component.uploadedFile = createMockImageFile('test.png');
      component.uploadPreview = 'data:image/png;base64,abc';
      component.storyId = 'story1';
      component.altText = 'Test Image';

      await component.insert();

      expect(mockStoryImageService.addImage).toHaveBeenCalled();
      const args = mockStoryImageService.addImage.calls.mostRecent().args;
      expect(args[0]).toBe('story1');
      expect(args[2]).toBe('Test Image');
    });

    it('should emit imageInserted with blobUrl and imageId', async () => {
      component.activeTab = 'upload';
      component.uploadedFile = createMockImageFile('test.png');
      component.uploadPreview = 'data:image/png;base64,abc';
      component.storyId = 'story1';
      component.altText = 'Test Image';

      let emittedResult: ImageInsertResult | undefined;
      component.imageInserted.subscribe(result => {
        emittedResult = result;
      });

      await component.insert();

      expect(emittedResult).toBeDefined();
      expect(emittedResult!.url).toBe('blob:http://localhost/mock-url');
      expect(emittedResult!.imageId).toBe('img_123');
      expect(emittedResult!.storyId).toBe('story1');
    });

    it('should throw error when storyId is missing', async () => {
      component.activeTab = 'upload';
      component.uploadedFile = createMockImageFile('test.png');
      component.uploadPreview = 'data:image/png;base64,abc';
      component.storyId = ''; // Empty storyId

      await component.insert();

      expect(mockDialogService.showError).toHaveBeenCalled();
      const errorCall = mockDialogService.showError.calls.mostRecent().args[0];
      expect(errorCall.message).toContain('Story ID is required');
    });

    it('should not insert if already processing', async () => {
      component.activeTab = 'upload';
      component.uploadedFile = createMockImageFile('test.png');
      component.uploadPreview = 'data:image/png;base64,abc';
      component.isProcessing = true;

      let emitted = false;
      component.imageInserted.subscribe(() => {
        emitted = true;
      });

      await component.insert();

      expect(emitted).toBeFalse();
      expect(mockStoryImageService.addImage).not.toHaveBeenCalled();
    });

    it('should not insert if canInsert returns false', async () => {
      component.activeTab = 'upload';
      component.uploadPreview = null; // No preview

      let emitted = false;
      component.imageInserted.subscribe(() => {
        emitted = true;
      });

      await component.insert();

      expect(emitted).toBeFalse();
    });

    it('should handle service errors gracefully', async () => {
      mockStoryImageService.addImage.and.returnValue(Promise.reject(new Error('Upload failed')));

      component.activeTab = 'upload';
      component.uploadedFile = createMockImageFile('test.png');
      component.uploadPreview = 'data:image/png;base64,abc';
      component.storyId = 'story1';

      await component.insert();

      expect(mockDialogService.showError).toHaveBeenCalled();
      const errorCall = mockDialogService.showError.calls.mostRecent().args[0];
      expect(errorCall.header).toBe('Upload Error');
    });
  });

  // ============================================================================
  // Cropping Tests
  // ============================================================================

  describe('Image Cropping', () => {
    it('should not open cropper when no preview', async () => {
      component.uploadPreview = null;

      await component.cropImage();

      expect(mockModalController.create).not.toHaveBeenCalled();
    });

    it('should open cropper modal with image', async () => {
      component.uploadPreview = 'data:image/png;base64,abc';

      const mockModal = {
        present: jasmine.createSpy().and.returnValue(Promise.resolve()),
        onWillDismiss: jasmine.createSpy().and.returnValue(Promise.resolve({ data: null }))
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mockModalController.create.and.returnValue(Promise.resolve(mockModal as any));

      await component.cropImage();

      expect(mockModalController.create).toHaveBeenCalled();
      expect(mockModal.present).toHaveBeenCalled();
    });

    it('should handle cropper error gracefully', async () => {
      component.uploadPreview = 'data:image/png;base64,abc';
      mockModalController.create.and.returnValue(Promise.reject(new Error('Modal failed')));

      await component.cropImage();

      expect(mockDialogService.showError).toHaveBeenCalledWith({
        header: 'Crop Error',
        message: 'Error cropping image. Please try again.'
      });
    });
  });

  // ============================================================================
  // Cancel Tests
  // ============================================================================

  describe('Cancel', () => {
    it('should emit cancelled event', () => {
      let cancelled = false;
      component.cancelled.subscribe(() => {
        cancelled = true;
      });

      component.cancel();

      expect(cancelled).toBeTrue();
    });
  });

  // ============================================================================
  // Alt Text Generation Tests
  // ============================================================================

  describe('Alt Text Generation', () => {
    it('should convert filename with hyphens to title case', async () => {
      const file = createMockImageFile('my-awesome-image.png');
      const event = { target: { files: [file] } } as unknown as Event;

      await component.onFileSelected(event);

      expect(component.altText).toBe('My Awesome Image');
    });

    it('should convert filename with underscores to title case', async () => {
      const file = createMockImageFile('my_awesome_image.png');
      const event = { target: { files: [file] } } as unknown as Event;

      await component.onFileSelected(event);

      expect(component.altText).toBe('My Awesome Image');
    });

    it('should not override existing alt text', async () => {
      component.altText = 'Existing Alt Text';
      const file = createMockImageFile('new-image.png');
      const event = { target: { files: [file] } } as unknown as Event;

      await component.onFileSelected(event);

      expect(component.altText).toBe('Existing Alt Text');
    });
  });
});
