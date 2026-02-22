import { Component, Input, ViewChild, inject, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { 
  IonHeader, IonToolbar, IonTitle, IonButtons, IonButton, 
  IonContent, IonIcon, ModalController, IonFooter, Platform
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, checkmarkOutline, cropOutline } from 'ionicons/icons';
import { ImageCropperComponent, ImageCroppedEvent, ImageTransform, LoadedImage } from 'ngx-image-cropper';

@Component({
  selector: 'app-image-cropper-modal',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader, IonToolbar, IonTitle, IonButtons, IonButton,
    IonContent, IonIcon, IonFooter,
    ImageCropperComponent
  ],
  template: `
    <ion-header>
      <ion-toolbar>
        <ion-title>Crop Image</ion-title>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">
            <ion-icon name="close-outline"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="cropper-content">
      <div class="cropper-wrapper">
        <image-cropper
          *ngIf="showCropper"
          [imageBase64]="imageBase64"
          [maintainAspectRatio]="aspectRatio > 0"
          [aspectRatio]="aspectRatio"
          [cropperMinWidth]="100"
          [cropperMinHeight]="100"
          [roundCropper]="false"
          [canvasRotation]="canvasRotation"
          [transform]="transform"
          [alignImage]="'center'"
          [backgroundColor]="'#000'"
          [format]="'webp'"
          [autoCrop]="true"
          [hideResizeSquares]="isMobile && aspectRatio > 0"
          [onlyScaleDown]="true"
          [imageQuality]="95"
          (imageCropped)="imageCropped($event)"
          (imageLoaded)="imageLoaded($event)"
          (cropperReady)="cropperReady()"
          (loadImageFailed)="loadImageFailed()">
        </image-cropper>
      </div>

      <div class="aspect-ratio-buttons">
        <ion-button 
          fill="outline" 
          size="small" 
          [color]="aspectRatio === 1 ? 'primary' : 'medium'"
          (click)="setAspectRatio(1)">
          1:1
        </ion-button>
        <ion-button 
          fill="outline" 
          size="small" 
          [color]="aspectRatio === 3/4 ? 'primary' : 'medium'"
          (click)="setAspectRatio(3/4)">
          3:4
        </ion-button>
        <ion-button 
          fill="outline" 
          size="small" 
          [color]="aspectRatio === 2/3 ? 'primary' : 'medium'"
          (click)="setAspectRatio(2/3)">
          2:3
        </ion-button>
        <ion-button 
          fill="outline" 
          size="small" 
          [color]="aspectRatio === 9/16 ? 'primary' : 'medium'"
          (click)="setAspectRatio(9/16)">
          9:16
        </ion-button>
        <ion-button 
          fill="outline" 
          size="small" 
          [color]="aspectRatio === 16/9 ? 'primary' : 'medium'"
          (click)="setAspectRatio(16/9)">
          16:9
        </ion-button>
        <ion-button 
          fill="outline" 
          size="small" 
          [color]="aspectRatio === 0 ? 'primary' : 'medium'"
          (click)="setAspectRatio(0)">
          Frei
        </ion-button>
      </div>

      <div class="image-size-info" *ngIf="originalImageSize.bytes > 0">
        <div class="size-details">
          <div class="size-item">
            <span class="size-label">Original:</span>
            <span class="size-value">{{ formatFileSize(originalImageSize) }}</span>
          </div>
          <div class="size-item" *ngIf="croppedImageSize.bytes > 0">
            <span class="size-label">Cropped:</span>
            <span class="size-value">{{ formatFileSize(croppedImageSize) }}</span>
          </div>
          <div class="size-item" *ngIf="compressionRatio > 0 && croppedImageSize.bytes > 0">
            <span class="size-label">Size:</span>
            <span class="size-value" [class.compression-good]="compressionRatio < 50" [class.compression-moderate]="compressionRatio >= 50 && compressionRatio < 80">
              {{ compressionRatio }}% of original
            </span>
          </div>
        </div>
      </div>
    </ion-content>

    <ion-footer>
      <ion-toolbar>
        <ion-buttons slot="end">
          <ion-button (click)="dismiss()">
            Cancel
          </ion-button>
          <ion-button (click)="confirmCrop()" [strong]="true">
            <ion-icon name="checkmark-outline" slot="start"></ion-icon>
            Crop
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-footer>
  `,
  styles: [`
    .cropper-content {
      --background: var(--cw-bg-base);
    }

    .cropper-wrapper {
      height: calc(100% - 60px);
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--cw-bg-backdrop);
      position: relative;
    }

    :host ::ng-deep image-cropper {
      max-height: 100%;
      max-width: 100%;
      --cropper-overlay-color: var(--cw-bg-modal-backdrop);
    }

    .aspect-ratio-buttons {
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: var(--cw-space-sm);
      background: var(--cw-bg-modal-backdrop);
      padding: var(--cw-space-sm);
      border-radius: var(--cw-radius-md);
      backdrop-filter: blur(var(--cw-blur-md));
    }

    ion-footer {
      background: var(--cw-bg-glass);
      backdrop-filter: blur(var(--cw-blur-md));
    }

    ion-footer ion-toolbar {
      --background: transparent;
      --border-width: 0;
    }

    .image-size-info {
      position: absolute;
      top: 20px;
      right: 20px;
      background: var(--cw-bg-modal-backdrop);
      padding: var(--cw-space-md);
      border-radius: var(--cw-radius-md);
      backdrop-filter: blur(var(--cw-blur-md));
      min-width: 200px;
    }

    .size-details {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .size-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: var(--cw-font-size-xs);
    }

    .size-label {
      color: var(--cw-text-muted);
      font-weight: var(--cw-font-weight-medium);
    }

    .size-value {
      color: var(--cw-text-primary);
      font-weight: var(--cw-font-weight-semibold);
      text-align: right;
    }

    .compression-good {
      color: var(--cw-color-success) !important;
    }

    .compression-moderate {
      color: var(--cw-color-warning) !important;
    }
  `]
})
export class ImageCropperModalComponent implements OnInit, OnDestroy {
  @Input() imageBase64!: string;
  @Input() initialAspectRatio: number = 3/4; // Default portrait aspect ratio
  @ViewChild(ImageCropperComponent) imageCropper!: ImageCropperComponent;

  croppedImage = '';
  canvasRotation = 0;
  transform: ImageTransform = {};
  aspectRatio = 3/4;
  isReady = false;
  showCropper = false;
  isMobile = false;

  // Image size tracking
  originalImageSize = { bytes: 0, kb: 0, mb: 0 };
  croppedImageSize = { bytes: 0, kb: 0, mb: 0 };
  compressionRatio = 0;

  private modalCtrl = inject(ModalController);
  private platform = inject(Platform);

  // Cleanup tracking to prevent memory leaks
  private showCropperTimeout: ReturnType<typeof setTimeout> | null = null;
  private isDestroyed = false;

  constructor() {
    addIcons({ closeOutline, checkmarkOutline, cropOutline });
  }

  private calculateBase64ImageSize(base64String: string) {
    if (!base64String) return { bytes: 0, kb: 0, mb: 0 };
    
    // Remove the data URL prefix if present
    const base64 = base64String.split(',')[1] || base64String;
    
    // Calculate padding
    const padding = (base64.endsWith('==') ? 2 : (base64.endsWith('=') ? 1 : 0));
    
    // Calculate size in bytes
    const sizeInBytes = Math.ceil(base64.length / 4) * 3 - padding;
    
    // Convert to KB/MB
    const sizeInKB = sizeInBytes / 1024;
    const sizeInMB = sizeInKB / 1024;
    
    return {
      bytes: sizeInBytes,
      kb: Math.round(sizeInKB * 100) / 100,
      mb: Math.round(sizeInMB * 100) / 100
    };
  }

  formatFileSize(sizeObj: { bytes: number; kb: number; mb: number }): string {
    if (sizeObj.mb >= 1) {
      return `${sizeObj.mb} MB`;
    } else if (sizeObj.kb >= 1) {
      return `${sizeObj.kb} KB`;
    } else {
      return `${sizeObj.bytes} bytes`;
    }
  }

  ngOnInit() {
    this.aspectRatio = this.initialAspectRatio;
    this.isMobile = this.platform.is('mobile') || this.platform.is('tablet');

    // Calculate original image size
    this.originalImageSize = this.calculateBase64ImageSize(this.imageBase64);
    console.log('Original image size calculated:', this.originalImageSize);

    // Show cropper after a short delay to ensure proper initialization
    // Store timeout reference for cleanup
    this.showCropperTimeout = setTimeout(() => {
      if (!this.isDestroyed) {
        this.showCropper = true;
      }
    }, 100);
  }

  ngOnDestroy() {
    this.isDestroyed = true;
    if (this.showCropperTimeout) {
      clearTimeout(this.showCropperTimeout);
      this.showCropperTimeout = null;
    }
  }

  imageCropped(event: ImageCroppedEvent) {
    console.log('Image cropped event:', event);
    // Use base64 if available, or convert blob to base64
    if (event.base64) {
      this.croppedImage = event.base64;
      this.updateCroppedImageSize(event.base64);
    } else if (event.blob) {
      // Convert blob to base64 for compatibility with image-upload component
      const reader = new FileReader();
      reader.onload = () => {
        // Guard against component destruction during async read
        if (this.isDestroyed) return;
        this.croppedImage = reader.result as string;
        this.updateCroppedImageSize(this.croppedImage);
      };
      reader.readAsDataURL(event.blob);
    } else if (event.objectUrl) {
      // Fallback to objectUrl if neither base64 nor blob is available
      this.croppedImage = event.objectUrl;
      // Can't calculate size for objectUrl, so reset to 0
      this.updateCroppedImageSize('');
    }
  }

  private updateCroppedImageSize(imageData: string) {
    this.croppedImageSize = this.calculateBase64ImageSize(imageData);
    this.compressionRatio = this.originalImageSize.bytes > 0 
      ? Math.round((this.croppedImageSize.bytes / this.originalImageSize.bytes) * 100) 
      : 0;
    console.log('🔍 Cropped image size updated:');
    console.log('  Original:', this.formatFileSize(this.originalImageSize));
    console.log('  Cropped:', this.formatFileSize(this.croppedImageSize));
    console.log('  Ratio:', this.compressionRatio + '% of original');
    console.log('  Reduction:', (100 - this.compressionRatio) + '%');
  }

  imageLoaded(image: LoadedImage) {
    console.log('Image loaded:', image);
    this.isReady = true;
  }

  cropperReady() {
    console.log('Cropper ready');
    this.isReady = true;
  }

  loadImageFailed() {
    console.error('Image loading failed');
    this.dismiss();
  }

  setAspectRatio(ratio: number) {
    this.aspectRatio = ratio;
  }

  async confirmCrop() {
    console.log('Confirm crop clicked');
    
    // Since autoCrop is disabled, manually trigger the crop
    if (this.imageCropper) {
      console.log('Manually triggering crop');
      try {
        const event = await this.imageCropper.crop();
        console.log('Manual crop event:', event);
        
        if (event?.base64) {
          this.croppedImage = event.base64;
          this.updateCroppedImageSize(event.base64);
          this.modalCtrl.dismiss({
            croppedImage: this.croppedImage
          });
        } else if (event?.blob) {
          // Convert blob to base64 for compatibility
          const reader = new FileReader();
          reader.onload = () => {
            // Guard against component destruction during async read
            if (this.isDestroyed) return;
            this.croppedImage = reader.result as string;
            this.updateCroppedImageSize(this.croppedImage);
            this.modalCtrl.dismiss({
              croppedImage: this.croppedImage
            });
          };
          reader.readAsDataURL(event.blob);
          return; // Exit early to wait for FileReader
        } else if (event?.objectUrl) {
          this.croppedImage = event.objectUrl;
          this.modalCtrl.dismiss({
            croppedImage: this.croppedImage
          });
        } else {
          console.error('No crop result available');
        }
      } catch (error) {
        console.error('Error cropping image:', error);
      }
    } else {
      console.error('Image cropper not available');
    }
  }

  dismiss() {
    this.modalCtrl.dismiss();
  }
}
