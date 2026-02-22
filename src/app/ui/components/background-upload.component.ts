import { Component, Output, EventEmitter, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { 
  IonButton, IonIcon, IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonItem, IonLabel, IonInput, IonText, IonSpinner,
  IonAlert, IonToast
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { 
  cloudUploadOutline, imageOutline, closeCircleOutline, 
  checkmarkCircleOutline, trashOutline 
} from 'ionicons/icons';
import { SyncedCustomBackgroundService, CustomBackground } from '../../shared/services/synced-custom-background.service';

@Component({
  selector: 'app-background-upload',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonButton, IonIcon, IonCard, IonCardContent, IonCardHeader, IonCardTitle,
    IonItem, IonLabel, IonInput, IonText, IonSpinner,
    IonAlert, IonToast
  ],
  template: `
    <div class="background-upload">
      <ion-card>
        <ion-card-header>
          <ion-card-title>
            <ion-icon name="cloud-upload-outline"></ion-icon>
            Upload Custom Background
          </ion-card-title>
        </ion-card-header>
        
        <ion-card-content>
          <!-- File Input -->
          <div class="upload-area" 
               role="button"
               tabindex="0"
               [class.dragover]="isDragOver()"
               (click)="triggerFileInput()"
               (keyup.enter)="triggerFileInput()"
               (keyup.space)="triggerFileInput()"
               (dragover)="onDragOver($event)"
               (dragleave)="onDragLeave($event)"
               (drop)="onDrop($event)">
            
            <input 
              #fileInput 
              type="file" 
              accept="image/png,image/jpeg,image/jpg,image/webp" 
              (change)="onFileSelected($event)"
              style="display: none;">
            
            <div class="upload-content" *ngIf="!selectedFile() && !isUploading()">
              <ion-icon name="image-outline" class="upload-icon"></ion-icon>
              <p>Click or drag file here</p>
              <small>PNG, JPG, JPEG, WebP (max. 5MB)</small>
            </div>
            
            <!-- Upload Progress -->
            <div class="upload-progress" *ngIf="isUploading()">
              <ion-spinner name="crescent"></ion-spinner>
              <p>Uploading...</p>
            </div>
          </div>

          <!-- Preview Selected File -->
          <div class="file-preview" *ngIf="selectedFile() && !isUploading()">
            <div class="preview-image">
              <img [src]="previewUrl()" [alt]="selectedFile()?.name" />
            </div>
            
            <div class="file-info">
              <ion-item>
                <ion-label>
                  <h3>{{ selectedFile()?.name }}</h3>
                  <p>{{ formatFileSize(selectedFile()?.size || 0) }}</p>
                </ion-label>
                <ion-button 
                  fill="clear" 
                  color="danger" 
                  (click)="clearSelection()"
                  slot="end">
                  <ion-icon name="close-circle-outline" slot="icon-only"></ion-icon>
                </ion-button>
              </ion-item>
              
              <!-- Custom Name Input -->
              <ion-item>
                <ion-label position="stacked">Name (optional)</ion-label>
                <ion-input 
                  [(ngModel)]="customName"
                  placeholder="Automatic name will be used"
                  maxlength="50">
                </ion-input>
              </ion-item>
              
              <!-- Upload Button -->
              <div class="upload-actions">
                <ion-button 
                  expand="block" 
                  color="primary"
                  (click)="uploadFile()"
                  [disabled]="isUploading() || !isUserLoggedIn()">
                  <ion-icon name="cloud-upload-outline" slot="start"></ion-icon>
                  <span *ngIf="isUserLoggedIn()">Upload & Sync</span>
                  <span *ngIf="!isUserLoggedIn()">Login required</span>
                </ion-button>
                
                <ion-text color="warning" *ngIf="!isUserLoggedIn()">
                  <p><small>You must be logged in to use custom backgrounds.</small></p>
                </ion-text>
              </div>
            </div>
          </div>

          <!-- Success Message -->
          <div class="upload-success" *ngIf="uploadSuccess()">
            <ion-icon name="checkmark-circle-outline" color="success"></ion-icon>
            <p>Background uploaded successfully!</p>
          </div>

          <!-- Error Message -->
          <div class="upload-error" *ngIf="errorMessage()">
            <ion-text color="danger">
              <p>{{ errorMessage() }}</p>
            </ion-text>
          </div>
        </ion-card-content>
      </ion-card>

      <!-- Storage Info -->
      <ion-card class="storage-info">
        <ion-card-content>
          <div class="storage-stats">
            <ion-text color="medium" *ngIf="isUserLoggedIn()">
              <p>Storage: {{ formatFileSize(getTotalStorage()) }} used</p>
              <p>{{ getUserBackgroundCount() }} custom backgrounds</p>
              <p>Synced as: {{ getCurrentUser()?.displayName }}</p>
            </ion-text>
            <ion-text color="medium" *ngIf="!isUserLoggedIn()">
              <p>Sign in for cross-device synchronization</p>
            </ion-text>
          </div>
          
          <ion-button 
            fill="clear" 
            color="danger" 
            size="small"
            (click)="showClearAlert = true"
            *ngIf="getBackgroundCount() > 0">
            <ion-icon name="trash-outline" slot="start"></ion-icon>
            Delete All
          </ion-button>
        </ion-card-content>
      </ion-card>

      <!-- Clear All Alert -->
      <ion-alert
        [isOpen]="showClearAlert"
        header="Delete All Backgrounds?"
        message="This action cannot be undone."
[buttons]="clearAllButtons"
        (didDismiss)="showClearAlert = false">
      </ion-alert>

      <!-- Toast Messages -->
      <ion-toast
        [isOpen]="showToast()"
        [message]="toastMessage()"
        [duration]="3000"
        [color]="toastColor()"
        (didDismiss)="hideToast()">
      </ion-toast>
    </div>
  `,
  styles: [`
    .background-upload {
      max-width: 600px;
      margin: 0 auto;
    }

    ion-card {
      --background: var(--cw-gradient-glass);
      --color: var(--cw-text-secondary);
      border: 1px solid var(--cw-border-subtle);
      backdrop-filter: blur(var(--cw-blur-sm));
      -webkit-backdrop-filter: blur(var(--cw-blur-sm));
    }

    ion-card-title {
      display: flex;
      align-items: center;
      gap: var(--cw-space-sm);
      color: var(--cw-color-primary-light);
    }

    .upload-area {
      border: 2px dashed var(--cw-border-accent);
      border-radius: var(--cw-radius-lg);
      padding: var(--cw-space-2xl);
      text-align: center;
      cursor: pointer;
      transition: all var(--cw-transition-normal);
      background: var(--cw-bg-input);
      backdrop-filter: blur(var(--cw-blur-sm));
      -webkit-backdrop-filter: blur(var(--cw-blur-sm));
      margin-bottom: var(--cw-space-lg);
    }

    .upload-area:hover,
    .upload-area.dragover {
      border-color: var(--cw-color-primary-light);
      background: var(--cw-gradient-primary-subtle);
    }

    .upload-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--cw-space-sm);
      color: var(--cw-text-muted);
    }

    .upload-content p {
      color: var(--cw-text-secondary);
      margin: 0;
    }

    .upload-content small {
      color: var(--cw-text-muted);
    }

    .upload-icon {
      font-size: 3rem;
      color: var(--cw-text-muted);
    }

    .upload-progress {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--cw-space-lg);
      color: var(--cw-text-secondary);
    }

    .file-preview {
      display: flex;
      gap: var(--cw-space-lg);
      align-items: flex-start;
    }

    .preview-image {
      flex-shrink: 0;
      width: 150px;
      height: 100px;
      border-radius: var(--cw-radius-md);
      overflow: hidden;
      border: 1px solid var(--cw-border-subtle);
    }

    .preview-image img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .file-info {
      flex: 1;
      min-width: 0;
    }

    .file-info ion-item {
      --background: transparent;
      --color: var(--cw-text-secondary);
    }

    .upload-actions {
      padding: var(--cw-space-lg) 0;
    }

    .upload-success {
      display: flex;
      align-items: center;
      gap: var(--cw-space-sm);
      padding: var(--cw-space-lg);
      background: var(--cw-bg-success-subtle);
      border: 1px solid var(--cw-border-success);
      border-radius: var(--cw-radius-md);
      margin-top: var(--cw-space-lg);
      color: var(--cw-text-secondary);
    }

    .upload-success ion-icon {
      font-size: 1.5rem;
    }

    .upload-error {
      padding: var(--cw-space-lg);
      background: var(--cw-bg-danger-subtle);
      border: 1px solid var(--cw-border-danger);
      border-radius: var(--cw-radius-md);
      margin-top: var(--cw-space-lg);
    }

    .storage-info {
      margin-top: var(--cw-space-lg);
    }

    .storage-stats {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: var(--cw-space-sm);
    }

    .storage-stats p {
      margin: var(--cw-space-xs) 0;
      font-size: var(--cw-font-size-sm);
      color: var(--cw-text-muted);
    }

    @media (max-width: 768px) {
      .file-preview {
        flex-direction: column;
      }

      .preview-image {
        width: 100%;
        height: 150px;
      }

      .storage-stats {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--cw-space-sm);
      }
    }
  `]
})
export class BackgroundUploadComponent {
  private customBackgroundService = inject(SyncedCustomBackgroundService);

  @Output() backgroundUploaded = new EventEmitter<CustomBackground>();

  // Reactive signals
  selectedFile = signal<File | null>(null);
  previewUrl = signal<string>('');
  customName = '';
  isUploading = signal<boolean>(false);
  uploadSuccess = signal<boolean>(false);
  errorMessage = signal<string>('');
  isDragOver = signal<boolean>(false);
  
  // Toast signals
  showToast = signal<boolean>(false);
  toastMessage = signal<string>('');
  toastColor = signal<'success' | 'danger' | 'warning'>('success');
  
  // Alert state
  showClearAlert = false;
  
  // Alert buttons
  clearAllButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.clearAllBackgrounds() }
  ];

  constructor() {
    addIcons({ 
      cloudUploadOutline, imageOutline, closeCircleOutline, 
      checkmarkCircleOutline, trashOutline 
    });
  }

  triggerFileInput(): void {
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fileInput?.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.handleFile(input.files[0]);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragOver.set(false);
    
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      this.handleFile(event.dataTransfer.files[0]);
    }
  }

  private handleFile(file: File): void {
    // Reset previous states
    this.errorMessage.set('');
    this.uploadSuccess.set(false);
    
    // Validate file
    if (!this.isValidImageFile(file)) {
      this.errorMessage.set('Invalid file type. Only PNG, JPG, JPEG and WebP are allowed.');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      this.errorMessage.set('File is too large. Maximum 5MB allowed.');
      return;
    }

    this.selectedFile.set(file);
    this.createPreview(file);
  }

  private createPreview(file: File): void {
    const reader = new FileReader();
    reader.onload = (e) => {
      this.previewUrl.set(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  }

  private isValidImageFile(file: File): boolean {
    const validTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    return validTypes.includes(file.type);
  }

  clearSelection(): void {
    this.selectedFile.set(null);
    this.previewUrl.set('');
    this.customName = '';
    this.errorMessage.set('');
    this.uploadSuccess.set(false);
  }

  async uploadFile(): Promise<void> {
    const file = this.selectedFile();
    if (!file) return;

    this.isUploading.set(true);
    this.errorMessage.set('');

    try {
      const result = await this.customBackgroundService.uploadBackground(
        file, 
        this.customName.trim() || undefined
      );
      
      this.uploadSuccess.set(true);
      this.backgroundUploaded.emit(result);
      
      // Show success toast
      this.showSuccessToast('Background uploaded successfully!');
      
      // Clear form after short delay
      setTimeout(() => {
        this.clearSelection();
        this.uploadSuccess.set(false);
      }, 2000);
      
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'Upload fehlgeschlagen');
      this.showErrorToast('Upload fehlgeschlagen');
    } finally {
      this.isUploading.set(false);
    }
  }

  getTotalStorage(): number {
    return this.customBackgroundService.getTotalStorageSize();
  }

  getBackgroundCount(): number {
    return this.customBackgroundService.backgrounds().length;
  }

  getUserBackgroundCount(): number {
    return this.customBackgroundService.getStorageInfo().userBackgrounds;
  }

  isUserLoggedIn(): boolean {
    return this.customBackgroundService.isUserLoggedIn();
  }

  getCurrentUser() {
    return this.customBackgroundService.getCurrentUser();
  }

  formatFileSize(bytes: number): string {
    return this.customBackgroundService.formatFileSize(bytes);
  }

  async clearAllBackgrounds(): Promise<void> {
    try {
      await this.customBackgroundService.clearAllBackgrounds();
      this.showSuccessToast('All backgrounds deleted');
      this.clearSelection();
    } catch {
      this.showErrorToast('Error deleting');
    }
  }

  private showSuccessToast(message: string): void {
    this.toastMessage.set(message);
    this.toastColor.set('success');
    this.showToast.set(true);
  }

  private showErrorToast(message: string): void {
    this.toastMessage.set(message);
    this.toastColor.set('danger');
    this.showToast.set(true);
  }

  hideToast(): void {
    this.showToast.set(false);
  }
}
