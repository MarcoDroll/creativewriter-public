import { Component, EventEmitter, Input, Output, OnInit, OnDestroy, OnChanges, SimpleChanges, ViewChild, ElementRef, inject, ChangeDetectorRef, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StoryMediaService } from '../../shared/services/story-media.service';
import { StoryImageService } from '../../shared/services/story-image.service';
import { StoryVideoMeta } from '../../shared/models/story-media.interface';
import { DialogService } from '../../core/services/dialog.service';

@Component({
  selector: 'app-video-modal',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal-overlay" *ngIf="isVisible" (click)="closeModal()" (keyup.escape)="closeModal()" (keyup.enter)="closeModal()" tabindex="0">
      <div class="modal-content" (click)="$event.stopPropagation()" (keyup)="$event.stopPropagation()" tabindex="0">
        <!-- Header -->
        <div class="modal-header">
          <h3>{{ hasVideo ? 'View Video' : 'Add Video' }}</h3>
          <button class="close-btn" (click)="closeModal()" aria-label="Close">✕</button>
        </div>

        <!-- Video Display Mode -->
        <div *ngIf="hasVideo && !isUploading" class="video-section">
          <video 
            #videoPlayer
            class="video-player"
            [src]="videoDataUrl"
            controls
            preload="metadata"
            (loadedmetadata)="onVideoLoaded()"
            (error)="onVideoError()">
            Your browser does not support the video element.
          </video>
          
          <div class="video-info">
            <p class="video-name">{{ currentVideo?.name }}</p>
            <p class="video-size">{{ formatFileSize(currentVideo?.size || 0) }}</p>
          </div>

          <div class="video-actions">
            <button class="replace-btn" (click)="startUpload()">Replace Video</button>
            <button class="remove-btn" (click)="removeVideo()">Remove Video</button>
          </div>
        </div>

        <!-- Video Upload Mode -->
        <div *ngIf="!hasVideo || isUploading" class="upload-section">
          <div 
            class="upload-area"
            [class.dragover]="isDragging"
            (drop)="onDrop($event)"
            (dragover)="onDragOver($event)"
            (dragleave)="onDragLeave($event)">
            <input 
              type="file" 
              #fileInput
              (change)="onFileSelected($event)"
              accept="video/*"
              style="display: none;">
            <button class="upload-btn" (click)="fileInput.click()" [disabled]="isProcessing">
              📹 Select Video
            </button>
            <p class="upload-hint">or drop video here (max. 50MB)</p>
          </div>

          <div *ngIf="uploadPreview" class="preview-section">
            <video 
              [src]="uploadPreview" 
              class="preview-video"
              controls
              preload="metadata">
              Your browser does not support the video element.
            </video>
            <button class="remove-preview-btn" (click)="removeUploadPreview()">✕</button>
          </div>

          <div *ngIf="isProcessing" class="processing-indicator">
            <div class="loading-spinner"></div>
            <p>Processing video...</p>
          </div>

          <div class="upload-actions" *ngIf="uploadPreview && !isProcessing">
            <button class="cancel-upload-btn" (click)="cancelUpload()">Cancel</button>
            <button class="save-btn" (click)="saveVideo()">Save Video</button>
          </div>
        </div>

        <!-- Footer -->
        <div class="modal-footer" *ngIf="!isUploading && !uploadPreview">
          <button class="close-footer-btn" (click)="closeModal()">Close</button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: var(--cw-bg-modal-backdrop);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: var(--cw-z-modal);
      outline: none;
    }

    .modal-content {
      background: var(--cw-bg-base);
      border: 1px solid var(--cw-border-input);
      border-radius: var(--cw-radius-lg);
      max-width: 90vw;
      max-height: 90vh;
      width: 800px;
      overflow-y: auto;
      box-shadow: var(--cw-shadow-xl);
      outline: none;
    }

    .modal-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: var(--cw-space-xl);
      border-bottom: 1px solid var(--cw-border-input);
    }

    .modal-header h3 {
      margin: 0;
      color: var(--cw-text-secondary);
      font-size: var(--cw-font-size-xl);
    }

    .close-btn {
      background: none;
      border: none;
      color: var(--cw-text-muted);
      font-size: var(--cw-font-size-xl);
      cursor: pointer;
      padding: var(--cw-space-sm);
      border-radius: var(--cw-radius-xs);
      transition: all var(--cw-transition-normal);
    }

    .close-btn:hover {
      background: var(--cw-border-input);
      color: var(--cw-text-primary);
    }

    .video-section, .upload-section {
      padding: var(--cw-space-xl);
    }

    .video-player {
      width: 100%;
      max-height: 60vh;
      border-radius: var(--cw-radius-md);
      background: #000;
    }

    .video-info {
      margin: var(--cw-space-lg) 0;
      padding: var(--cw-space-lg);
      background: var(--cw-bg-base);
      border-radius: var(--cw-radius-sm);
      border: 1px solid var(--cw-border-input);
    }

    .video-name {
      margin: 0 0 var(--cw-space-sm) 0;
      font-weight: var(--cw-font-weight-medium);
      color: var(--cw-text-secondary);
      word-break: break-word;
    }

    .video-size {
      margin: 0;
      color: var(--cw-text-muted);
      font-size: var(--cw-font-size-sm);
    }

    .video-actions {
      display: flex;
      gap: var(--cw-space-sm);
      justify-content: center;
    }

    .replace-btn, .remove-btn {
      padding: var(--cw-space-sm) var(--cw-space-lg);
      border: none;
      border-radius: var(--cw-radius-sm);
      cursor: pointer;
      font-size: var(--cw-font-size-sm);
      transition: all var(--cw-transition-normal);
      color: var(--cw-text-primary);
    }

    .replace-btn {
      background: var(--cw-color-info);
    }

    .replace-btn:hover {
      background: var(--cw-color-info-dark);
    }

    .remove-btn {
      background: var(--cw-color-danger-dark);
    }

    .remove-btn:hover {
      background: var(--cw-color-danger-darker);
    }

    .upload-area {
      border: 2px dashed var(--cw-text-disabled);
      border-radius: var(--cw-radius-lg);
      padding: var(--cw-space-3xl);
      text-align: center;
      transition: all var(--cw-transition-slow);
      background: var(--cw-bg-base);
    }

    .upload-area.dragover {
      border-color: var(--cw-color-success-darker);
      background: var(--cw-bg-success-subtle);
    }

    .upload-btn {
      padding: var(--cw-space-lg) var(--cw-space-2xl);
      background: var(--cw-color-success-darker);
      color: var(--cw-text-primary);
      border: none;
      border-radius: var(--cw-radius-md);
      cursor: pointer;
      font-size: var(--cw-font-size-lg);
      transition: all var(--cw-transition-normal);
    }

    .upload-btn:hover:not(:disabled) {
      background: var(--cw-color-success-active);
      transform: translateY(-1px);
    }

    .upload-btn:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .upload-hint {
      margin: var(--cw-space-lg) 0 0 0;
      color: var(--cw-text-muted);
      font-size: var(--cw-font-size-sm);
    }

    .preview-section {
      position: relative;
      margin: var(--cw-space-xl) 0;
      border: 1px solid var(--cw-border-input);
      border-radius: var(--cw-radius-md);
      overflow: hidden;
    }

    .preview-video {
      width: 100%;
      max-height: 400px;
      background: #000;
    }

    .remove-preview-btn {
      position: absolute;
      top: var(--cw-space-sm);
      right: var(--cw-space-sm);
      width: 2.5rem;
      height: 2.5rem;
      background: var(--cw-color-danger-dark);
      color: var(--cw-text-primary);
      border: none;
      border-radius: var(--cw-radius-full);
      cursor: pointer;
      font-size: var(--cw-font-size-lg);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--cw-transition-normal);
    }

    .remove-preview-btn:hover {
      background: var(--cw-color-danger);
      transform: scale(1.1);
    }

    .processing-indicator {
      text-align: center;
      padding: var(--cw-space-2xl);
      color: var(--cw-text-muted);
    }

    .loading-spinner {
      width: 40px;
      height: 40px;
      border: 4px solid var(--cw-border-input);
      border-top: 4px solid var(--cw-color-info);
      border-radius: var(--cw-radius-full);
      animation: spin 1s linear infinite;
      margin: 0 auto var(--cw-space-lg) auto;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }

    .upload-actions {
      display: flex;
      gap: var(--cw-space-sm);
      justify-content: center;
      margin-top: var(--cw-space-lg);
    }

    .cancel-upload-btn, .save-btn {
      padding: var(--cw-space-sm) var(--cw-space-xl);
      border: none;
      border-radius: var(--cw-radius-sm);
      cursor: pointer;
      font-size: var(--cw-font-size-sm);
      transition: all var(--cw-transition-normal);
      color: var(--cw-text-primary);
    }

    .cancel-upload-btn {
      background: var(--cw-text-disabled);
    }

    .cancel-upload-btn:hover {
      background: var(--cw-border-input);
    }

    .save-btn {
      background: var(--cw-color-success-darker);
    }

    .save-btn:hover {
      background: var(--cw-color-success-active);
    }

    .modal-footer {
      padding: var(--cw-space-lg) var(--cw-space-xl);
      border-top: 1px solid var(--cw-border-input);
      text-align: center;
    }

    .close-footer-btn {
      padding: var(--cw-space-sm) var(--cw-space-xl);
      background: var(--cw-text-disabled);
      color: var(--cw-text-primary);
      border: none;
      border-radius: var(--cw-radius-sm);
      cursor: pointer;
      font-size: var(--cw-font-size-sm);
      transition: all var(--cw-transition-normal);
    }

    .close-footer-btn:hover {
      background: var(--cw-border-input);
    }

    @media (max-width: 768px) {
      .modal-content {
        width: 95vw;
        max-height: 95vh;
      }

      .modal-header, .video-section, .upload-section {
        padding: var(--cw-space-lg);
      }

      .upload-area {
        padding: var(--cw-space-2xl) var(--cw-space-lg);
      }

      .video-actions, .upload-actions {
        flex-direction: column;
      }

      .video-player {
        max-height: 50vh;
      }
    }
  `]
})
export class VideoModalComponent implements OnInit, OnDestroy, OnChanges {
  @Input() isVisible = false;
  @Input() storyId: string | null = null;
  @Input() imageId: string | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() videoAssociated = new EventEmitter<{ imageId: string; videoId: string }>();

  @ViewChild('videoPlayer') videoPlayer?: ElementRef<HTMLVideoElement>;
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  private storyMediaService = inject(StoryMediaService);
  private storyImageService = inject(StoryImageService);
  private cdr = inject(ChangeDetectorRef);
  private zone = inject(NgZone);
  private dialogService = inject(DialogService);

  // State
  currentVideo: StoryVideoMeta | null = null;
  currentVideoBlobUrl: string | null = null;
  hasVideo = false;
  isUploading = false;
  isProcessing = false;
  isDragging = false;

  // Upload state
  uploadedFile: File | null = null;
  uploadPreview: string | null = null;

  // Computed properties
  get videoDataUrl(): string {
    return this.currentVideoBlobUrl || '';
  }

  async ngOnInit(): Promise<void> {
    console.log('VideoModal ngOnInit with imageId:', this.imageId);
    if (this.imageId) {
      await this.loadVideoForImage();
    }
  }

  async ngOnChanges(changes: SimpleChanges): Promise<void> {
    console.log('VideoModal ngOnChanges:', changes);
    
    // Check if imageId changed and the component is visible
    if (changes['imageId'] && this.isVisible && this.imageId) {
      console.log('ImageId changed to:', this.imageId, 'loading video...');
      await this.loadVideoForImage();
    }
    
    // Reset state when modal becomes visible with a new imageId
    if (changes['isVisible']) {
      if (this.isVisible && this.imageId) {
        console.log('Modal became visible with imageId:', this.imageId);
        await this.loadVideoForImage();
      } else if (!this.isVisible) {
        // Reset state when modal is hidden
        console.log('Modal hidden, resetting state');
        this.resetModalState();
      }
    }
  }

  ngOnDestroy(): void {
    this.pauseVideo();
    this.cleanupPreview();
  }

  private async loadVideoForImage(): Promise<void> {
    if (!this.imageId || !this.storyId) return;

    try {
      console.log('Loading video for image ID:', this.imageId, 'in story:', this.storyId);

      // Get image metadata to find associated videoId
      const imageMeta = await this.storyImageService.getImageMeta(this.storyId, this.imageId);

      if (imageMeta?.videoId) {
        // Get video metadata
        const videoMeta = await this.storyMediaService.getVideoMeta(this.storyId, imageMeta.videoId);

        if (videoMeta) {
          // Get blob URL for playback
          const blobUrl = await this.storyMediaService.getVideoBlobUrl(this.storyId, imageMeta.videoId);

          this.applyChanges(() => {
            this.currentVideo = videoMeta;
            this.currentVideoBlobUrl = blobUrl;
            this.hasVideo = true;
          });
          console.log('Found video for image:', videoMeta);
          return;
        }
      }

      // No video associated
      this.applyChanges(() => {
        this.currentVideo = null;
        this.currentVideoBlobUrl = null;
        this.hasVideo = false;
      });
      console.log('No video found for image');
    } catch (error) {
      console.error('Error loading video:', error);
      this.applyChanges(() => {
        this.currentVideo = null;
        this.currentVideoBlobUrl = null;
        this.hasVideo = false;
      });
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      this.handleFile(input.files[0]);
    }
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;

    if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
      this.handleFile(event.dataTransfer.files[0]);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;
  }

  private handleFile(file: File): void {
    if (!file.type.startsWith('video/')) {
      this.dialogService.showError({ header: 'Invalid File', message: 'Please select a video file.' });
      return;
    }

    if (file.size > 50 * 1024 * 1024) { // 50MB limit
      this.dialogService.showError({ header: 'File Too Large', message: 'Video is too large. Maximum size: 50MB' });
      return;
    }

    this.applyChanges(() => {
      this.uploadedFile = file;
    });

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      this.applyChanges(() => {
        this.uploadPreview = result;
      });
    };
    reader.onerror = () => {
      console.error('Failed to read selected video file');
      this.applyChanges(() => {
        this.uploadPreview = null;
        this.uploadedFile = null;
      });
      this.dialogService.showError({ header: 'Read Error', message: 'Could not read the selected video. Please try again.' });
    };
    reader.readAsDataURL(file);
  }

  removeUploadPreview(): void {
    this.applyChanges(() => {
      this.uploadedFile = null;
      this.uploadPreview = null;
    });
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  async saveVideo(): Promise<void> {
    if (!this.uploadedFile || !this.imageId || !this.storyId) return;

    this.applyChanges(() => {
      this.isProcessing = true;
    });

    try {
      // Upload video to story's media storage
      const result = await this.storyMediaService.addVideo(this.storyId, this.uploadedFile);

      // Associate the image with the video
      await this.storyImageService.setVideoAssociation(this.storyId, this.imageId, result.meta.id);

      this.videoAssociated.emit({ imageId: this.imageId, videoId: result.meta.id });
      await this.loadVideoForImage();
      this.applyChanges(() => {
        this.cleanupUpload();
        this.isUploading = false;
      });
    } catch (error) {
      console.error('Error saving video:', error);
      const message = error instanceof Error ? error.message : 'Error saving video. Please try again.';
      this.dialogService.showError({ header: 'Save Error', message });
    } finally {
      this.applyChanges(() => {
        this.isProcessing = false;
      });
    }
  }

  startUpload(): void {
    this.applyChanges(() => {
      this.isUploading = true;
    });
  }

  cancelUpload(): void {
    this.applyChanges(() => {
      this.cleanupUpload();
      this.isUploading = false;
    });
  }

  async removeVideo(): Promise<void> {
    if (!this.imageId || !this.storyId || !this.currentVideo) return;

    const confirmed = await this.dialogService.confirmDestructive({
      header: 'Remove Video',
      message: 'Do you really want to remove the link between image and video? The video will be deleted.',
      confirmText: 'Remove'
    });
    if (!confirmed) return;

    try {
      // Remove video association from image
      await this.storyImageService.setVideoAssociation(this.storyId, this.imageId, null);

      // Also delete the video itself (it's only used by this image)
      await this.storyMediaService.removeVideo(this.storyId, this.currentVideo.id);

      this.applyChanges(() => {
        this.currentVideo = null;
        this.currentVideoBlobUrl = null;
        this.hasVideo = false;
      });
    } catch (error) {
      console.error('Error removing video:', error);
      await this.dialogService.showError({
        header: 'Error',
        message: 'Error removing video. Please try again.'
      });
    }
  }

  closeModal(): void {
    this.pauseVideo();
    this.applyChanges(() => {
      this.cleanupUpload();
      this.isUploading = false;
    });
    this.closed.emit();
  }

  onVideoLoaded(): void {
    // Video loaded successfully
  }

  onVideoError(): void {
    console.error('Error loading video');
    this.dialogService.showError({ header: 'Video Error', message: 'Error loading video.' });
  }

  private pauseVideo(): void {
    if (this.videoPlayer?.nativeElement) {
      this.videoPlayer.nativeElement.pause();
    }
  }

  private cleanupUpload(): void {
    this.uploadedFile = null;
    this.uploadPreview = null;
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  private cleanupPreview(): void {
    if (this.uploadPreview) {
      URL.revokeObjectURL(this.uploadPreview);
    }
  }

  private resetModalState(): void {
    this.applyChanges(() => {
      this.currentVideo = null;
      this.currentVideoBlobUrl = null;
      this.hasVideo = false;
      this.isUploading = false;
      this.isProcessing = false;
      this.isDragging = false;
      this.uploadedFile = null;
      this.uploadPreview = null;
    });
    if (this.fileInput) {
      this.fileInput.nativeElement.value = '';
    }
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private applyChanges(mutator: () => void): void {
    this.zone.run(() => {
      mutator();
      this.cdr.markForCheck();
    });
  }
}
