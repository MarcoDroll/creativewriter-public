import { ChangeDetectorRef, Component, DestroyRef, ElementRef, EventEmitter, Output, ViewChild, ViewRef, inject, NgZone, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalController } from '@ionic/angular/standalone';
import { StoryImageService } from '../../shared/services/story-image.service';
import { ImageCropperModalComponent } from './image-cropper-modal.component';
import { DialogService } from '../../core/services/dialog.service';
import imageCompression from 'browser-image-compression';

type ProcessingStage = 'prepare' | 'compressing' | 'uploading' | 'finalizing';

export interface ImageInsertResult {
  url: string;
  alt: string;
  title?: string;
  imageId?: string;
  storyId?: string;  // Required for per-story image storage
}

@Component({
  selector: 'app-image-upload-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="dialog-overlay" role="button" tabindex="0" (click)="cancel()" (keyup.escape)="cancel()">
      <div 
        class="dialog-content"
        role="button"
        tabindex="0"
        (click)="$event.stopPropagation()"
        (keyup.enter)="$event.stopPropagation()"
        [attr.aria-busy]="isProcessing">
        <div class="processing-overlay" *ngIf="isProcessing">
          <div class="processing-container" role="status" aria-live="polite">
            <div class="processing-spinner" aria-hidden="true"></div>
            <p>{{ processingMessage }}</p>
          </div>
        </div>
        <h3>Insert Image</h3>
        
        <div class="upload-tabs">
          <button 
            class="tab-button" 
            [class.active]="activeTab === 'upload'"
            (click)="activeTab = 'upload'">
            Upload
          </button>
          <button 
            class="tab-button" 
            [class.active]="activeTab === 'url'"
            (click)="activeTab = 'url'">
            URL
          </button>
        </div>

        <div class="tab-content">
          <!-- Upload Tab -->
          <div *ngIf="activeTab === 'upload'" class="upload-section">
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
                accept="image/*"
                style="display: none;">
              <button class="upload-btn" (click)="fileInput.click()">
                📁 Select File
              </button>
              <p class="upload-hint">or drop file here</p>
            </div>
            
            <div *ngIf="uploadPreview" class="preview-section">
              <img [src]="uploadPreview" alt="Preview">
              <div class="image-actions">
                <button class="crop-btn" (click)="cropImage()" title="Crop Image">✂️</button>
                <button class="remove-btn" (click)="removeUploadedImage()" title="Remove">✕</button>
              </div>
            </div>
          </div>

          <!-- URL Tab -->
          <div *ngIf="activeTab === 'url'" class="url-section">
            <input 
              type="url" 
              class="url-input"
              [(ngModel)]="imageUrl"
              placeholder="https://example.com/image.jpg"
              (input)="onUrlChange()">
            
            <div *ngIf="urlPreview" class="preview-section">
              <img [src]="urlPreview" alt="Preview" (error)="onImageError()">
            </div>
          </div>
        </div>

        <!-- Image Details -->
        <div class="image-details" *ngIf="uploadPreview || urlPreview">
          <div class="compression-settings" *ngIf="uploadPreview">
            <label>
              Image Quality:
              <input 
                type="range" 
                min="0.1" 
                max="1" 
                step="0.1" 
                [(ngModel)]="compressionQuality"
                class="quality-slider">
              <span class="quality-value">{{ Math.round(compressionQuality * 100) }}%</span>
            </label>
            
            <label>
              Max Width (px):
              <input 
                type="number" 
                [(ngModel)]="maxWidth"
                min="100"
                max="2000"
                placeholder="1200"
                class="size-input">
            </label>
          </div>
          
          <label>
            Alt text (for accessibility):
            <input 
              type="text" 
              [(ngModel)]="altText"
              placeholder="Description of the image">
          </label>
          
          <label>
            Title (optional):
            <input 
              type="text" 
              [(ngModel)]="titleText"
              placeholder="Image title">
          </label>
          
          <div *ngIf="originalSize" class="size-info">
            <div class="size-comparison">
              <div class="size-item" *ngIf="originalWidth > 0">
                <span class="size-label">Dimensions:</span>
                <span class="size-value">{{ originalWidth }} × {{ originalHeight }}px</span>
              </div>

              <div class="size-item">
                <span class="size-label">Original:</span>
                <span class="size-value">{{ formatFileSize(originalSize) }}</span>
              </div>
              
              <div class="size-item" *ngIf="compressedSize > 0">
                <span class="size-label">Compressed:</span>
                <span class="size-value">{{ formatFileSize(compressedSize) }}</span>
              </div>
              
              <div class="size-item" *ngIf="!compressedSize">
                <span class="size-label">Estimated:</span>
                <span class="size-value estimated">{{ formatFileSize(getEstimatedSize()) }}</span>
              </div>
              
              <div class="size-item" *ngIf="getSizeReduction() > 0 || getEstimatedReduction() > 0">
                <span class="size-label">Reduction:</span>
                <span class="size-value" [class.good-compression]="(getSizeReduction() || getEstimatedReduction()) > 30">
                  {{ getSizeReduction() || getEstimatedReduction() }}%
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Dialog Actions -->
        <div class="dialog-actions">
          <button class="cancel-btn" (click)="cancel()">Cancel</button>
          <button 
            class="insert-btn" 
            [disabled]="!canInsert() || isProcessing"
            (click)="insert()">
            Insert
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .dialog-overlay {
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
    }

    .dialog-content {
      background: var(--cw-bg-elevated);
      border: 1px solid var(--cw-border-input);
      border-radius: var(--cw-radius-md);
      padding: var(--cw-space-xl);
      max-width: 500px;
      width: 90vw;
      max-height: 90vh;
      overflow-y: auto;
      overflow-x: hidden;
      box-shadow: var(--cw-shadow-xl);
      position: relative;
    }

    h3 {
      margin: 0 0 var(--cw-space-lg) 0;
      color: var(--cw-text-primary);
      font-size: var(--cw-font-size-lg);
    }

    .upload-tabs {
      display: flex;
      gap: var(--cw-space-sm);
      margin-bottom: var(--cw-space-lg);
    }

    .tab-button {
      flex: 1;
      padding: var(--cw-space-sm) var(--cw-space-lg);
      background: var(--cw-bg-input);
      border: 1px solid var(--cw-border-input);
      color: var(--cw-text-muted);
      cursor: pointer;
      border-radius: var(--cw-radius-xs);
      transition: all var(--cw-transition-fast);
    }

    .tab-button:hover {
      background: var(--cw-bg-hover);
    }

    .tab-button.active {
      background: var(--cw-bg-active);
      color: var(--cw-text-primary);
      border-color: var(--cw-border-default);
    }

    .tab-content {
      margin-bottom: var(--cw-space-lg);
    }

    .upload-area {
      border: 2px dashed var(--cw-border-default);
      border-radius: var(--cw-radius-md);
      padding: var(--cw-space-2xl);
      text-align: center;
      transition: all var(--cw-transition-normal);
    }

    .upload-area.dragover {
      border-color: var(--cw-color-success-darker);
      background: var(--cw-bg-success-subtle);
    }

    .upload-btn {
      padding: var(--cw-space-sm) var(--cw-space-lg);
      background: var(--cw-color-primary);
      color: white;
      border: none;
      border-radius: var(--cw-radius-xs);
      cursor: pointer;
      font-size: var(--cw-font-size-md);
    }

    .upload-btn:hover {
      background: var(--cw-color-primary-dark);
    }

    .upload-hint {
      margin: var(--cw-space-sm) 0 0 0;
      color: var(--cw-text-muted);
      font-size: var(--cw-font-size-sm);
    }

    .url-input {
      width: 100%;
      padding: var(--cw-space-sm);
      background: var(--cw-bg-base);
      border: 1px solid var(--cw-border-input);
      color: var(--cw-text-primary);
      border-radius: var(--cw-radius-xs);
      font-size: var(--cw-font-size-md);
    }

    .preview-section {
      position: relative;
      margin-top: var(--cw-space-lg);
      border: 1px solid var(--cw-border-input);
      border-radius: var(--cw-radius-xs);
      overflow: hidden;
    }

    .preview-section img {
      width: 100%;
      height: auto;
      max-height: 300px;
      object-fit: contain;
      background: var(--cw-bg-base);
    }

    .image-actions {
      position: absolute;
      top: var(--cw-space-sm);
      right: var(--cw-space-sm);
      display: flex;
      gap: var(--cw-space-sm);
    }

    .crop-btn, .remove-btn {
      width: 2rem;
      height: 2rem;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      font-size: var(--cw-font-size-md);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all var(--cw-transition-fast);
    }

    .crop-btn {
      background: var(--cw-color-success);
      color: white;
    }

    .crop-btn:hover {
      background: var(--cw-color-success-darker);
    }

    .remove-btn {
      background: var(--cw-color-danger);
      color: white;
      font-size: var(--cw-font-size-lg);
    }

    .remove-btn:hover {
      background: var(--cw-color-danger-dark);
    }

    .image-details {
      margin-bottom: var(--cw-space-lg);
    }

    .image-details label {
      display: block;
      margin-bottom: var(--cw-space-sm);
      color: var(--cw-text-muted);
      font-size: var(--cw-font-size-sm);
    }

    .image-details input {
      width: 100%;
      padding: var(--cw-space-sm);
      margin-top: var(--cw-space-xs);
      background: var(--cw-bg-base);
      border: 1px solid var(--cw-border-input);
      color: var(--cw-text-primary);
      border-radius: var(--cw-radius-xs);
      font-size: var(--cw-font-size-sm);
    }

    .compression-settings {
      margin-bottom: var(--cw-space-lg);
      padding: var(--cw-space-lg);
      background: var(--cw-bg-surface);
      border: 1px solid var(--cw-border-input);
      border-radius: var(--cw-radius-xs);
    }

    .compression-settings label {
      display: flex;
      align-items: center;
      gap: var(--cw-space-sm);
      margin-bottom: var(--cw-space-sm);
    }

    .quality-slider {
      flex: 1;
      height: 4px;
      background: var(--cw-bg-hover);
      outline: none;
      border-radius: var(--cw-radius-xs);
    }

    .quality-value {
      min-width: 40px;
      text-align: right;
      font-weight: var(--cw-font-weight-bold);
      color: var(--cw-color-success);
    }

    .size-input {
      max-width: 120px !important;
    }

    .size-info {
      margin-top: var(--cw-space-md);
      padding: var(--cw-space-md);
      background: var(--cw-bg-surface);
      border-radius: var(--cw-radius-md);
      text-align: left;
    }

    .size-comparison {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .size-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: var(--cw-font-size-sm);
    }

    .size-label {
      font-weight: var(--cw-font-weight-medium);
      color: var(--cw-text-muted);
    }

    .size-value {
      font-weight: var(--cw-font-weight-semibold);
      color: var(--cw-text-primary);
    }

    .size-value.estimated {
      color: var(--cw-text-disabled);
      font-style: italic;
    }

    .size-value.good-compression {
      color: var(--cw-color-success);
    }

    .dialog-actions {
      display: flex;
      gap: var(--cw-space-sm);
      justify-content: flex-end;
      margin-top: var(--cw-space-xl);
    }

    .cancel-btn, .insert-btn {
      padding: var(--cw-space-sm) var(--cw-space-lg);
      border: none;
      border-radius: var(--cw-radius-xs);
      cursor: pointer;
      font-size: var(--cw-font-size-sm);
    }

    .cancel-btn {
      background: var(--cw-bg-active);
      color: white;
    }

    .cancel-btn:hover {
      background: var(--cw-border-default);
    }

    .insert-btn {
      background: var(--cw-color-success);
      color: white;
    }

    .insert-btn:hover:not(:disabled) {
      background: var(--cw-color-success-darker);
    }

    .insert-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .processing-overlay {
      position: absolute;
      inset: 0;
      background: var(--cw-bg-modal-backdrop);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 5;
      backdrop-filter: blur(var(--cw-blur-xs));
      pointer-events: all;
    }

    .processing-container {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--cw-space-md);
      padding: var(--cw-space-lg) var(--cw-space-xl);
      background: var(--cw-bg-glass);
      border: 1px solid var(--cw-border-input);
      border-radius: var(--cw-radius-md);
      box-shadow: var(--cw-shadow-xl);
    }

    .processing-container p {
      margin: 0;
      color: var(--cw-text-primary);
      font-size: var(--cw-font-size-sm);
      font-weight: var(--cw-font-weight-medium);
    }

    .processing-spinner {
      width: 42px;
      height: 42px;
      border: 4px solid var(--cw-border-subtle);
      border-top-color: var(--cw-color-success);
      border-radius: 50%;
      animation: processing-spin 1s linear infinite;
    }

    @keyframes processing-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (max-width: 480px) {
      .dialog-content {
        padding: var(--cw-space-lg);
        width: 95vw;
      }

      h3 {
        font-size: var(--cw-font-size-md);
      }

      .upload-area {
        padding: var(--cw-space-xl);
      }
    }
  `]
})
export class ImageUploadDialogComponent {
  @Input() storyId!: string;  // Required: story to add the image to
  @Output() imageInserted = new EventEmitter<ImageInsertResult>();
  @Output() cancelled = new EventEmitter<void>();
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  activeTab: 'upload' | 'url' = 'upload';
  isDragging = false;

  // Upload state
  uploadedFile: File | null = null;
  uploadPreview: string | null = null;

  // URL state
  imageUrl = '';
  urlPreview: string | null = null;

  // Image details
  altText = '';
  titleText = '';

  // Compression settings
  compressionQuality = 0.8;
  maxWidth = 1200;
  originalSize = 0;
  compressedSize = 0;
  originalWidth = 0;
  originalHeight = 0;
  Math = Math;
  isProcessing = false;
  processingStage: ProcessingStage | null = null;

  private readonly storyImageService = inject(StoryImageService);
  private readonly modalController = inject(ModalController);
  private readonly zone = inject(NgZone);
  private readonly cdr = inject(ChangeDetectorRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialogService = inject(DialogService);
  private viewDestroyed = false;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.viewDestroyed = true;
    });
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      await this.handleFile(input.files[0]);
    }
    this.resetFileInput(input);
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;

    if (event.dataTransfer?.files && event.dataTransfer.files[0]) {
      await this.handleFile(event.dataTransfer.files[0]);
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

  private async handleFile(file: File): Promise<void> {
    if (!file.type.startsWith('image/')) {
      this.dialogService.showError({ header: 'Invalid File', message: 'Please select an image file.' });
      return;
    }

    this.uploadedFile = file;
    this.originalSize = file.size;
    this.activeTab = 'upload';
    this.imageUrl = '';
    this.urlPreview = null;
    this.compressedSize = 0;
    if (!this.altText) {
      this.altText = this.buildAltText(file.name);
    }
    this.uploadPreview = null;

    try {
      const preview = await this.readFileAsDataURL(file);
      this.commitState(() => {
        this.uploadPreview = preview;
      });
      // Extract image dimensions for accurate size estimation
      this.extractImageDimensions(preview);
    } catch (error) {
      console.error('Error reading image file', error);
      this.commitState(() => {
        this.dialogService.showError({ header: 'Load Error', message: 'Error loading the image preview. Please try again.' });
        this.removeUploadedImage();
      });
    }
  }

  private resetFileInput(input?: HTMLInputElement | null): void {
    const target = input ?? this.fileInput?.nativeElement ?? null;
    if (target) {
      target.value = '';
    }
  }

  private async readFileAsDataURL(file: File): Promise<string> {
    try {
      return await this.readFileWithFileReader(file);
    } catch (error) {
      console.warn('FileReader failed, falling back to arrayBuffer for preview', error);
      const buffer = await file.arrayBuffer();
      return this.arrayBufferToDataUrl(buffer, file.type);
    }
  }

  private readFileWithFileReader(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.onabort = () => reject(new Error('File reading was aborted'));
      reader.readAsDataURL(file);
    });
  }

  private arrayBufferToDataUrl(buffer: ArrayBuffer, mimeType: string): string {
    const base64 = this.arrayBufferToBase64(buffer);
    const safeMime = mimeType && mimeType.length > 0 ? mimeType : 'application/octet-stream';
    return `data:${safeMime};base64,${base64}`;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }

    return btoa(binary);
  }

  private extractImageDimensions(dataUrl: string): void {
    const img = new Image();
    const cleanup = () => {
      img.onload = null;
      img.onerror = null;
    };
    img.onload = () => {
      // Guard against rapid file selection - ensure this is still the current preview
      if (this.uploadPreview !== dataUrl) {
        cleanup();
        return;
      }
      this.commitState(() => {
        this.originalWidth = img.naturalWidth;
        this.originalHeight = img.naturalHeight;
      });
      cleanup();
    };
    img.onerror = () => {
      console.warn('Failed to extract image dimensions');
      cleanup();
    };
    img.src = dataUrl;
  }

  private commitState(mutator: () => void): void {
    if (this.viewDestroyed) {
      return;
    }
    this.zone.run(() => {
      if (this.viewDestroyed) {
        return;
      }
      mutator();
      const viewRef = this.cdr as ViewRef;
      if (!viewRef.destroyed) {
        viewRef.detectChanges();
      }
    });
  }

  private beginProcessing(stage: ProcessingStage): void {
    this.commitState(() => {
      this.isProcessing = true;
      this.processingStage = stage;
    });
  }

  private updateProcessingStage(stage: ProcessingStage): void {
    this.commitState(() => {
      if (!this.isProcessing) {
        return;
      }
      this.processingStage = stage;
    });
  }

  private endProcessing(): void {
    this.commitState(() => {
      this.isProcessing = false;
      this.processingStage = null;
    });
  }

  get processingMessage(): string {
    switch (this.processingStage) {
      case 'compressing':
        return 'Compressing image...';
      case 'uploading':
        return 'Uploading image...';
      case 'finalizing':
        return 'Finishing up...';
      case 'prepare':
      default:
        return 'Preparing image...';
    }
  }

  private buildAltText(filename: string): string {
    const nameWithoutExtension = filename.replace(/\.[^/.]+$/, '');
    return nameWithoutExtension
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, (char) => char.toUpperCase()) || 'Image';
  }

  removeUploadedImage(): void {
    this.uploadedFile = null;
    this.uploadPreview = null;
    this.originalSize = 0;
    this.compressedSize = 0;
    this.originalWidth = 0;
    this.originalHeight = 0;
    this.resetFileInput();
  }

  async cropImage(): Promise<void> {
    if (!this.uploadPreview) return;

    try {
      const modal = await this.modalController.create({
        component: ImageCropperModalComponent,
        componentProps: {
          imageBase64: this.uploadPreview,
          initialAspectRatio: 0 // Free aspect ratio
        },
        cssClass: 'image-cropper-modal'
      });

      await modal.present();
      const { data } = await modal.onWillDismiss();
      
      if (data?.croppedImage) {
        // Convert the cropped base64 back to a File
        const croppedFile = await this.base64ToFile(data.croppedImage, this.uploadedFile?.name || 'cropped-image.jpg');
        await this.handleFile(croppedFile);
      }
    } catch (error) {
      console.error('Error cropping image:', error);
      this.dialogService.showError({ header: 'Crop Error', message: 'Error cropping image. Please try again.' });
    }
  }

  private async base64ToFile(base64: string, filename: string): Promise<File> {
    const response = await fetch(base64);
    const blob = await response.blob();
    return new File([blob], filename, { type: blob.type });
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  getSizeReduction(): number {
    if (!this.originalSize || !this.compressedSize) return 0;
    return Math.round(((this.originalSize - this.compressedSize) / this.originalSize) * 100);
  }

  getEstimatedSize(): number {
    if (!this.originalSize) return 0;
    // Rough estimation based on quality setting
    // WebP typically achieves 25-35% size reduction at quality 0.8
    // JPEG achieves 10-20% size reduction at quality 0.8
    const qualityMultiplier = this.compressionQuality;
    const formatReduction = 0.7; // Assume 30% reduction for WebP format

    // Calculate resize reduction based on maxWidth
    // browser-image-compression uses maxWidthOrHeight, so use the larger dimension
    let resizeMultiplier = 1;
    if (this.originalWidth > 0 && this.originalHeight > 0) {
      const largerDimension = Math.max(this.originalWidth, this.originalHeight);
      if (this.maxWidth < largerDimension) {
        // Image will be scaled down - area reduces by scale^2
        const scale = this.maxWidth / largerDimension;
        resizeMultiplier = scale * scale;
      }
    }

    return Math.round(this.originalSize * qualityMultiplier * formatReduction * resizeMultiplier);
  }

  getEstimatedReduction(): number {
    if (!this.originalSize) return 0;
    const estimated = this.getEstimatedSize();
    return Math.round(((this.originalSize - estimated) / this.originalSize) * 100);
  }

  onUrlChange(): void {
    // Debounce URL preview
    if (this.imageUrl) {
      this.urlPreview = this.imageUrl;
    } else {
      this.urlPreview = null;
    }
  }

  onImageError(): void {
    this.urlPreview = null;
  }

  canInsert(): boolean {
    if (this.activeTab === 'upload') {
      return !!this.uploadPreview;
    } else {
      return !!this.urlPreview;
    }
  }

  async insert(): Promise<void> {
    if (!this.canInsert() || this.isProcessing) return;

    this.beginProcessing('prepare');

    try {
      let imageUrl: string;
      let imageId: string | undefined;
      let storyId: string | undefined;

      if (this.activeTab === 'upload' && this.uploadedFile) {
        if (!this.storyId) {
          throw new Error('Story ID is required to upload images');
        }

        this.updateProcessingStage('compressing');
        const compressedFile = await this.compressImage(this.uploadedFile);

        this.updateProcessingStage('uploading');
        const result = await this.storyImageService.addImage(
          this.storyId,
          compressedFile,
          this.altText || compressedFile.name
        );
        imageUrl = result.blobUrl;
        imageId = result.meta.id;
        storyId = this.storyId;
      } else {
        imageUrl = this.imageUrl;
        // External URL images don't have IDs from our system
        imageId = undefined;
        storyId = undefined;
      }

      this.updateProcessingStage('finalizing');
      this.imageInserted.emit({
        url: imageUrl,
        alt: this.altText || 'Image',
        title: this.titleText || undefined,
        imageId: imageId,
        storyId: storyId
      });
    } catch (error) {
      this.handleInsertError(error);
    } finally {
      this.endProcessing();
    }
  }

  private async compressImage(file: File): Promise<File> {
    try {
      const options = {
        maxSizeMB: 1, // Max 1MB after compression
        maxWidthOrHeight: this.maxWidth,
        useWebWorker: true,
        initialQuality: this.compressionQuality,
        preserveExif: false
      };

      const compressedFile = await imageCompression(file, options);
      this.compressedSize = compressedFile.size;
      
      console.log('Original size:', this.formatFileSize(file.size));
      console.log('Compressed size:', this.formatFileSize(compressedFile.size));
      
      return compressedFile;
    } catch (error) {
      console.error('Error compressing image:', error);
      // If compression fails, return original file
      return file;
    }
  }

  cancel(): void {
    this.cancelled.emit();
  }

  private handleInsertError(error: unknown): void {
    console.error('Error inserting image:', error);
    const message = this.buildUserFacingError(error);
    // Ensure dialog runs inside Angular zone for consistency across platforms
    this.zone.run(() => this.dialogService.showError({ header: 'Upload Error', message }));
  }

  private buildUserFacingError(error: unknown): string {
    if (error instanceof Error && error.message) {
      const trimmed = error.message.trim();
      const lower = trimmed.toLowerCase();
      const hasPrefix = lower.startsWith('error') || lower.startsWith('warning');
      return hasPrefix ? trimmed : `Image upload failed: ${trimmed}`;
    }

    if (typeof error === 'string' && error) {
      const trimmed = error.trim();
      return `Image upload failed: ${trimmed}`;
    }

    return 'Image upload failed. Please check the file and try again.';
  }
}
