import { Component, Output, EventEmitter, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonCard, IonCardContent, IonButton, IonIcon, IonItem, IonLabel,
  IonNote, IonText, IonThumbnail, ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { 
  cloudUploadOutline, imageOutline, trashOutline, checkmarkCircleOutline,
  warningOutline, closeCircleOutline, cropOutline
} from 'ionicons/icons';
import { ImageCropperModalComponent } from './image-cropper-modal.component';

export interface ImageUploadResult {
  base64Data: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

@Component({
  selector: 'app-image-upload',
  standalone: true,
  imports: [
    CommonModule,
    IonCard, IonCardContent, IonButton, IonIcon, IonItem, IonLabel,
    IonNote, IonText, IonThumbnail
  ],
  template: `
    <ion-card class="image-upload-card">
      <ion-card-content>
        <!-- Upload Area -->
        <div 
          class="upload-area"
          [class.dragging]="isDragging"
          [class.has-image]="currentImage"
          (click)="triggerFileInput()"
          (keydown)="onKeyDown($event)"
          (dragover)="onDragOver($event)"
          (dragleave)="onDragLeave($event)"
          (drop)="onDrop($event)"
          tabindex="0"
          role="button"
          [attr.aria-label]="currentImage ? 'Change cover image' : 'Upload cover image'">
          
          <!-- No Image State -->
          <div *ngIf="!currentImage" class="upload-prompt">
            <ion-icon name="cloud-upload-outline" class="upload-icon"></ion-icon>
            <ion-text>
              <h3>Upload Cover Image</h3>
              <p>Click or drag an image here</p>
            </ion-text>
            <ion-note>JPG, PNG, WebP • Max. 5MB</ion-note>
          </div>

          <!-- Image Preview -->
          <div *ngIf="currentImage" class="image-preview">
            <ion-thumbnail class="preview-thumbnail">
              <img [src]="currentImage" [alt]="fileName || 'Cover image'" />
            </ion-thumbnail>
            <div class="image-info">
              <ion-text>
                <h4>{{ fileName }}</h4>
                <p>{{ formatFileSize(fileSize) }}</p>
              </ion-text>
              <div class="image-actions">
                <ion-button 
                  fill="clear" 
                  size="small" 
                  color="danger"
                  (click)="removeImage($event)">
                  <ion-icon name="trash-outline" slot="icon-only"></ion-icon>
                </ion-button>
              </div>
            </div>
          </div>
        </div>

        <!-- Error Message -->
        <ion-item *ngIf="errorMessage" class="error-item">
          <ion-icon name="warning-outline" color="danger" slot="start"></ion-icon>
          <ion-label color="danger">{{ errorMessage }}</ion-label>
        </ion-item>

        <!-- Success Message -->
        <ion-item *ngIf="successMessage" class="success-item">
          <ion-icon name="checkmark-circle-outline" color="success" slot="start"></ion-icon>
          <ion-label color="success">{{ successMessage }}</ion-label>
        </ion-item>

        <!-- Hidden File Input -->
        <input
          #fileInput
          type="file"
          accept="image/jpeg,image/jpg,image/png,image/webp"
          (change)="onFileSelected($event)"
          style="display: none;">
      </ion-card-content>
    </ion-card>
  `,
  styles: [`
    .image-upload-card {
      background: var(--cw-gradient-glass);
      border: 1px solid var(--cw-border-subtle);
      border-radius: var(--cw-radius-xl);
      backdrop-filter: blur(var(--cw-blur-md)) saturate(120%);
      -webkit-backdrop-filter: blur(var(--cw-blur-md)) saturate(120%);
      box-shadow: var(--cw-shadow-md);
      transition: all var(--cw-transition-slow);
      --color: var(--cw-text-primary);
    }

    .image-upload-card:hover {
      background: var(--cw-gradient-glass-hover);
      border-color: var(--cw-border-primary);
      box-shadow: var(--cw-shadow-lg);
      transform: translateY(-2px);
    }

    .upload-area {
      border: 2px dashed var(--cw-border-default);
      border-radius: var(--cw-radius-lg);
      padding: var(--cw-space-2xl);
      text-align: center;
      cursor: pointer;
      transition: all var(--cw-transition-slow);
      background: var(--cw-bg-hover);
      min-height: 200px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .upload-area:hover {
      border-color: var(--cw-border-primary);
      background: var(--cw-bg-input);
    }

    .upload-area:focus {
      outline: none;
      border-color: var(--cw-color-primary);
      background: var(--cw-bg-input);
      box-shadow: 0 0 0 2px var(--cw-border-primary);
    }

    .upload-area.dragging {
      border-color: var(--cw-color-primary);
      background: var(--cw-bg-info-subtle);
      transform: scale(1.02);
    }

    .upload-area.has-image {
      padding: var(--cw-space-lg);
      min-height: auto;
    }

    .upload-prompt {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--cw-space-lg);
    }

    .upload-icon {
      font-size: 3rem;
      color: var(--cw-color-primary);
      margin-bottom: var(--cw-space-sm);
    }

    .upload-prompt h3 {
      color: var(--cw-text-primary);
      margin: 0;
      font-size: var(--cw-font-size-lg);
      font-weight: var(--cw-font-weight-semibold);
    }

    .upload-prompt p {
      color: var(--cw-text-muted);
      margin: 0;
      font-size: var(--cw-font-size-sm);
    }

    .upload-prompt ion-note {
      color: var(--cw-text-disabled);
      font-size: var(--cw-font-size-xs);
    }

    .image-preview {
      display: flex;
      align-items: center;
      gap: var(--cw-space-lg);
      text-align: left;
      width: 100%;
    }

    .preview-thumbnail {
      width: 80px;
      height: 80px;
      border-radius: var(--cw-radius-md);
      overflow: hidden;
      border: 2px solid var(--cw-border-default);
      flex-shrink: 0;
    }

    .preview-thumbnail img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }

    .image-info {
      flex: 1;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .image-info h4 {
      color: var(--cw-text-primary);
      margin: 0 0 var(--cw-space-xs) 0;
      font-size: var(--cw-font-size-md);
      font-weight: var(--cw-font-weight-semibold);
    }

    .image-info p {
      color: var(--cw-text-muted);
      margin: 0;
      font-size: var(--cw-font-size-xs);
    }

    .image-actions {
      display: flex;
      gap: var(--cw-space-sm);
    }

    .error-item {
      --background: var(--cw-bg-danger-subtle);
      --border-color: var(--cw-border-danger);
      margin-top: var(--cw-space-lg);
      border-radius: var(--cw-radius-md);
    }

    .success-item {
      --background: var(--cw-bg-success-subtle);
      --border-color: var(--cw-border-success);
      margin-top: var(--cw-space-lg);
      border-radius: var(--cw-radius-md);
    }

    @media (max-width: 768px) {
      .upload-area {
        padding: var(--cw-space-xl);
        min-height: 150px;
      }

      .upload-icon {
        font-size: 2.5rem;
      }

      .upload-prompt h3 {
        font-size: var(--cw-font-size-md);
      }

      .image-preview {
        flex-direction: column;
        text-align: center;
        gap: var(--cw-space-md);
      }

      .image-info {
        width: 100%;
        flex-direction: column;
        gap: var(--cw-space-sm);
      }
    }
  `]
})
export class ImageUploadComponent {
  @Input() currentImage: string | null = null;
  @Input() fileName: string | null = null;
  @Input() fileSize = 0;
  @Output() imageSelected = new EventEmitter<ImageUploadResult>();
  @Output() imageRemoved = new EventEmitter<void>();

  isDragging = false;
  errorMessage = '';
  successMessage = '';

  private readonly maxFileSize = 5 * 1024 * 1024; // 5MB
  private readonly allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

  private modalController = inject(ModalController);

  constructor() {
    addIcons({ 
      cloudUploadOutline, imageOutline, trashOutline, checkmarkCircleOutline,
      warningOutline, closeCircleOutline, cropOutline
    });
  }

  triggerFileInput(): void {
    if (this.currentImage) return; // Don't trigger if image already exists
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fileInput?.click();
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.triggerFileInput();
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

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragging = false;

    if (this.currentImage) return; // Don't allow drop if image already exists

    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.processFile(files[0]);
    }
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.processFile(input.files[0]);
    }
  }

  private async processFile(file: File): Promise<void> {
    this.clearMessages();

    // Validate file type
    if (!this.allowedTypes.includes(file.type)) {
      this.errorMessage = 'Nur JPG, PNG und WebP Dateien sind erlaubt.';
      return;
    }

    // Validate file size
    if (file.size > this.maxFileSize) {
      this.errorMessage = 'The file is too large. Maximum: 5MB';
      return;
    }

    // Read file as base64
    const reader = new FileReader();
    reader.onload = async (e) => {
      const result = e.target?.result as string;
      if (result) {
        // Open cropper modal
        const modal = await this.modalController.create({
          component: ImageCropperModalComponent,
          componentProps: {
            imageBase64: result,
            initialAspectRatio: 3/4 // Default portrait aspect ratio
          },
          cssClass: 'image-cropper-modal'
        });

        await modal.present();
        const { data } = await modal.onDidDismiss();

        if (data?.croppedImage) {
          const base64Data = data.croppedImage.split(',')[1]; // Remove data URL prefix
          
          const uploadResult: ImageUploadResult = {
            base64Data,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type
          };

          this.successMessage = 'Bild erfolgreich zugeschnitten und hochgeladen!';
          this.imageSelected.emit(uploadResult);

          // Clear success message after 3 seconds
          setTimeout(() => {
            this.successMessage = '';
          }, 3000);
        }
      }
    };

    reader.onerror = () => {
      this.errorMessage = 'Error reading the file.';
    };

    reader.readAsDataURL(file);
  }

  removeImage(event: Event): void {
    event.stopPropagation();
    this.clearMessages();
    this.imageRemoved.emit();
  }

  private clearMessages(): void {
    this.errorMessage = '';
    this.successMessage = '';
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
