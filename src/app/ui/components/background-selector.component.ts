import { Component, OnInit, OnChanges, SimpleChanges, Input, Output, EventEmitter, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonGrid, IonRow, IonCol, IonText, IonCard, IonCardContent, IonButton, IonAlert } from '@ionic/angular/standalone';
import { checkmarkCircle, trashOutline } from 'ionicons/icons';
import { addIcons } from 'ionicons';
import { SyncedCustomBackgroundService, CustomBackgroundOption } from '../../shared/services/synced-custom-background.service';
import { LazyImageDirective } from '../../shared/directives/lazy-image.directive';
import { convertToWebP } from '../../shared/services/image-optimization.service';

interface BackgroundOption {
  filename: string;
  displayName: string;
  previewPath: string;
}

@Component({
  selector: 'app-background-selector',
  standalone: true,
  imports: [
    CommonModule,
    IonIcon,
    IonGrid,
    IonRow,
    IonCol,
    IonText,
    IonCard,
    IonCardContent,
    IonButton,
    IonAlert,
    LazyImageDirective
  ],
  template: `
    <div class="background-selector">
      <h3>Select Background</h3>
      
      <!-- Standard Backgrounds -->
      <div class="section-header">
        <h4>Standard Backgrounds</h4>
      </div>
      
      <ion-grid>
        <ion-row>
          <!-- Default option (no background) -->
          <ion-col size="6" size-md="4" size-lg="3">
            <ion-card 
              [class.selected]="selectedBackground() === 'none'"
              (click)="selectBackground('none')"
              button
            >
              <ion-card-content class="preview-card">
                <div class="preview-container no-background">
                  <div class="no-bg-placeholder">
                    <ion-text>No Background</ion-text>
                  </div>
                </div>
                <div class="background-name">Standard</div>
                <ion-icon 
                  *ngIf="selectedBackground() === 'none'"
                  name="checkmark-circle"
                  class="selected-icon"
                ></ion-icon>
              </ion-card-content>
            </ion-card>
          </ion-col>

          <!-- Standard background image options -->
          <ion-col 
            size="6" 
            size-md="4" 
            size-lg="3"
            *ngFor="let background of backgroundOptions"
          >
            <ion-card 
              [class.selected]="selectedBackground() === background.filename"
              (click)="selectBackground(background.filename)"
              button
            >
              <ion-card-content class="preview-card">
                <div class="preview-container">
                  <img 
                    [appLazyImage]="background.previewPath" 
                    [alt]="background.displayName"
                    class="background-preview lazy-image"
                    [lazyPlaceholder]="placeholderImage"
                  />
                </div>
                <div class="background-name">{{ background.displayName }}</div>
                <ion-icon 
                  *ngIf="selectedBackground() === background.filename"
                  name="checkmark-circle"
                  class="selected-icon"
                ></ion-icon>
              </ion-card-content>
            </ion-card>
          </ion-col>
        </ion-row>
      </ion-grid>

      <!-- Custom Backgrounds Section -->
      <div class="section-header" *ngIf="customBackgrounds().length > 0">
        <h4>My Backgrounds</h4>
        <ion-text color="medium">
          <small>{{ customBackgrounds().length }} custom backgrounds</small>
        </ion-text>
      </div>
      
      <ion-grid *ngIf="customBackgrounds().length > 0">
        <ion-row>
          <ion-col 
            size="6" 
            size-md="4" 
            size-lg="3"
            *ngFor="let customBg of customBackgrounds()"
          >
            <ion-card 
              [class.selected]="selectedBackground() === 'custom:' + customBg.id"
              (click)="selectBackground('custom:' + customBg.id)"
              button
            >
              <ion-card-content class="preview-card custom-card">
                <div class="preview-container">
                  <img 
                    [appLazyImage]="customBg.blobUrl" 
                    [alt]="customBg.name"
                    class="background-preview lazy-image"
                    [lazyPlaceholder]="placeholderImage"
                  />
                  
                  <!-- Delete button -->
                  <ion-button 
                    fill="clear" 
                    size="small" 
                    color="danger"
                    class="delete-button"
                    (click)="confirmDeleteCustomBackground($event, customBg)"
                  >
                    <ion-icon name="trash-outline" slot="icon-only"></ion-icon>
                  </ion-button>
                </div>
                <div class="background-name">{{ customBg.name }}</div>
                <div class="background-size">{{ formatFileSize(customBg.size) }}</div>
                <ion-icon 
                  *ngIf="selectedBackground() === 'custom:' + customBg.id"
                  name="checkmark-circle"
                  class="selected-icon"
                ></ion-icon>
              </ion-card-content>
            </ion-card>
          </ion-col>
        </ion-row>
      </ion-grid>

      <!-- Empty state for custom backgrounds -->
      <div class="empty-custom-backgrounds" *ngIf="customBackgrounds().length === 0">
        <ion-text color="medium">
          <p>No custom backgrounds available yet.</p>
          <p>Upload your own images via the settings.</p>
        </ion-text>
      </div>

      <!-- Delete Confirmation Alert -->
      <ion-alert
        [isOpen]="showDeleteAlert"
        header="Delete Background?"
        [message]="deleteMessage"
        [buttons]="deleteButtons"
        (didDismiss)="cancelDelete()"
      ></ion-alert>
    </div>
  `,
  styles: [`
    .background-selector {
      padding: 0;
    }

    .background-selector h3 {
      display: none;
    }

    .section-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: 1.5rem 0 1rem 0;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--cw-border-subtle);
    }

    .section-header h4 {
      background: var(--cw-gradient-text-accent);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
    }

    .section-header:first-of-type {
      margin-top: 0;
    }

    .preview-card {
      position: relative;
      padding: 0.75rem;
      text-align: center;
    }

    .preview-container {
      position: relative;
      width: 100%;
      height: 80px;
      border-radius: 8px;
      overflow: hidden;
      margin-bottom: 0.5rem;
      border: 2px solid var(--cw-border-subtle);
      transition: border-color 0.2s ease;
    }

    .background-preview {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .no-background {
      background: linear-gradient(45deg,
        var(--cw-bg-hover) 25%,
        transparent 25%),
      linear-gradient(-45deg,
        var(--cw-bg-hover) 25%,
        transparent 25%),
      linear-gradient(45deg,
        transparent 75%,
        var(--cw-bg-hover) 75%),
      linear-gradient(-45deg,
        transparent 75%,
        var(--cw-bg-hover) 75%);
      background-size: 10px 10px;
      background-position: 0 0, 0 5px, 5px -5px, -5px 0px;
      background-color: var(--cw-bg-input);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .no-bg-placeholder {
      background: var(--cw-bg-modal-backdrop);
      color: var(--cw-text-secondary);
      padding: var(--cw-space-xs) var(--cw-space-sm);
      border-radius: var(--cw-radius-xs);
      font-size: var(--cw-font-size-2xs);
    }

    .background-name {
      font-size: 0.8rem;
      color: var(--cw-text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    ion-card {
      --background: var(--cw-gradient-glass);
      --color: var(--cw-text-secondary);
      border: 1px solid var(--cw-border-subtle);
      border-radius: var(--cw-radius-md);
      margin: var(--cw-space-xs);
      cursor: pointer;
      transition: all var(--cw-transition-fast);
      backdrop-filter: blur(var(--cw-blur-sm));
      -webkit-backdrop-filter: blur(var(--cw-blur-sm));
    }

    ion-card:hover {
      transform: translateY(-2px);
      border-color: var(--cw-border-accent);
      box-shadow: var(--cw-shadow-md);
    }

    .selected {
      --background: var(--cw-gradient-primary-subtle);
      border-color: var(--cw-color-primary-light) !important;
    }

    .selected .preview-container {
      border-color: var(--cw-color-primary-light);
    }

    .selected .background-name {
      color: var(--cw-color-primary-light);
      font-weight: 600;
    }

    .selected-icon {
      position: absolute;
      top: 0.5rem;
      right: 0.5rem;
      color: var(--cw-color-primary-light);
      font-size: 1.2rem;
    }

    .custom-card {
      position: relative;
    }

    .delete-button {
      position: absolute;
      top: var(--cw-space-xs);
      left: var(--cw-space-xs);
      z-index: 10;
      opacity: 0;
      transition: opacity var(--cw-transition-fast);
      --background: var(--cw-bg-modal-backdrop);
      --color: white;
      width: 28px;
      height: 28px;
    }

    .custom-card:hover .delete-button {
      opacity: 1;
    }

    .background-size {
      font-size: 0.7rem;
      color: var(--cw-text-disabled);
      text-align: center;
      margin-top: 0.25rem;
    }

    .empty-custom-backgrounds {
      text-align: center;
      padding: var(--cw-space-2xl);
      background: var(--cw-bg-input);
      border: 1px solid var(--cw-border-subtle);
      border-radius: var(--cw-radius-md);
      margin-top: var(--cw-space-lg);
      backdrop-filter: blur(var(--cw-blur-sm));
      -webkit-backdrop-filter: blur(var(--cw-blur-sm));
    }

    .empty-custom-backgrounds p {
      margin: var(--cw-space-sm) 0;
      font-size: var(--cw-font-size-sm);
      color: var(--cw-text-muted);
    }

    /* Lazy loading styles */
    .lazy-image {
      transition: opacity 0.3s ease;
    }

    .lazy-loading {
      opacity: 0.6;
      filter: blur(1px);
    }

    .lazy-loaded {
      opacity: 1;
      filter: none;
    }

    .lazy-error {
      opacity: 0.3;
      filter: grayscale(1);
    }

    @media (max-width: 768px) {
      .preview-container {
        height: 60px;
      }

      .background-name {
        font-size: 0.7rem;
      }

      .section-header {
        flex-direction: column;
        align-items: flex-start;
        gap: 0.25rem;
      }

      .delete-button {
        opacity: 1;
        width: 24px;
        height: 24px;
      }
    }
  `]
})
export class BackgroundSelectorComponent implements OnInit, OnChanges {
  private customBackgroundService = inject(SyncedCustomBackgroundService);

  // Input/Output for parent component integration
  @Input() selectedBackgroundImage = 'none';
  @Output() backgroundImageChange = new EventEmitter<string>();

  // Available background images (loaded dynamically)
  backgroundOptions: BackgroundOption[] = [];

  // Signal for currently selected background
  selectedBackground = signal<string>('none');
  
  // Placeholder image for lazy loading
  placeholderImage = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwIiBoZWlnaHQ9IjgwIiB2aWV3Qm94PSIwIDAgMTAwIDgwIiBmaWxsPSJub25lIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPgo8cmVjdCB3aWR0aD0iMTAwIiBoZWlnaHQ9IjgwIiBmaWxsPSIjZjVmNWY1Ii8+CjxwYXRoIGQ9Ik0yMCAyMGg2MHY0MEgyMFYyMHoiIGZpbGw9Im5vbmUiIHN0cm9rZT0iI2RkZCIgc3Ryb2tlLXdpZHRoPSIyIi8+CjxjaXJjbGUgY3g9IjM1IiBjeT0iMzUiIHI9IjUiIGZpbGw9IiNkZGQiLz4KPHBhdGggZD0iTTM1IDUwbDEwLTEwbDE1IDE1SDM1eiIgZmlsbD0iI2RkZCIvPgo8L3N2Zz4K';
  
  // Custom backgrounds from service
  customBackgrounds = computed(() => this.customBackgroundService.backgrounds());
  
  // Delete confirmation state
  showDeleteAlert = false;
  backgroundToDelete: CustomBackgroundOption | null = null;
  
  // Alert content
  get deleteMessage(): string {
    return this.backgroundToDelete ? 
      `Do you really want to delete "${this.backgroundToDelete.name}"?` : '';
  }
  
  deleteButtons = [
    { text: 'Cancel', role: 'cancel' },
    { text: 'Delete', role: 'destructive', handler: () => this.deleteCustomBackground() }
  ];

  constructor() {
    addIcons({ checkmarkCircle, trashOutline });
  }

  ngOnInit() {
    // Initialize with input value
    this.selectedBackground.set(this.selectedBackgroundImage);
    
    // Load available backgrounds dynamically
    this.loadAvailableBackgrounds();
  }

  ngOnChanges(changes: SimpleChanges) {
    // Update when input changes
    if (changes['selectedBackgroundImage'] && changes['selectedBackgroundImage'].currentValue !== undefined) {
      this.selectedBackground.set(changes['selectedBackgroundImage'].currentValue);
    }
  }

  selectBackground(filename: string) {
    this.selectedBackground.set(filename);
    
    // Emit change to parent component
    this.backgroundImageChange.emit(filename);
  }
  
  confirmDeleteCustomBackground(event: Event, customBg: CustomBackgroundOption): void {
    event.stopPropagation(); // Prevent card selection
    this.backgroundToDelete = customBg;
    this.showDeleteAlert = true;
  }
  
  async deleteCustomBackground(): Promise<void> {
    if (!this.backgroundToDelete) return;
    
    try {
      await this.customBackgroundService.deleteBackground(this.backgroundToDelete.id);
      
      // If the deleted background was selected, reset to 'none'
      if (this.selectedBackground() === 'custom:' + this.backgroundToDelete.id) {
        this.selectBackground('none');
      }
      
    } catch (error) {
      console.error('Error deleting custom background:', error);
    } finally {
      this.cancelDelete();
    }
  }
  
  cancelDelete(): void {
    this.showDeleteAlert = false;
    this.backgroundToDelete = null;
  }
  
  formatFileSize(bytes: number): string {
    return this.customBackgroundService.formatFileSize(bytes);
  }

  private loadAvailableBackgrounds() {
    // Use static list directly - these are bundled assets that will always exist
    // The LazyImageDirective handles any load errors gracefully
    const knownBackgrounds = [
      'abstract-energy-lines.png',
      'cosmic-galaxy-burst.png',
      'cyberpunk-anime-girl.png',
      'cyberpunk-asian-street.png',
      'cyberpunk-city-noir.png',
      'cyberpunk-neon-corridor.png',
      'dark-witch-forest.png',
      'gothic-dark-moon-woman.png',
      'medieval-castle-street.png',
      'modern-dark-apartment.png',
      'noir-theater-man.png',
      'pirate-ship-captain.png',
      'sci-fi-laboratory.png',
      'space-nebula-stars.png',
      'zombie-apocalypse-scene.png'
    ];

    this.backgroundOptions = knownBackgrounds
      .map(filename => ({
        filename,
        displayName: this.generateDisplayName(filename),
        // Use WebP for previews (smaller file size, faster loading)
        previewPath: `assets/backgrounds/${convertToWebP(filename)}`
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }

  private generateDisplayName(filename: string): string {
    // Remove file extension
    const nameWithoutExt = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '');

    // Convert kebab-case or snake_case to readable format
    const readable = nameWithoutExt
      .replace(/[-_]/g, ' ')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');

    return readable;
  }
}
