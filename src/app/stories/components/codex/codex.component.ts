import { Component, OnInit, OnDestroy, inject, signal, computed, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  IonContent, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonItem, IonLabel,
  IonSearchbar, IonList, IonChip, IonTextarea, IonInput, IonButton, IonIcon,
  IonModal, IonGrid, IonRow, IonCol, IonText, IonNote, IonButtons, IonToolbar, IonTitle, IonHeader, IonFooter,
  IonSelect, IonSelectOption, IonToggle, IonSpinner, ModalController, ToastController
} from '@ionic/angular/standalone';
import { AppHeaderComponent, HeaderAction } from '../../../ui/components/app-header.component';
import { addIcons } from 'ionicons';
import {
  arrowBack, add, ellipsisVertical, create, trash, save, close,
  search, person, bookmark, pricetag, star, swapHorizontal, helpCircle,
  checkmarkDone, informationCircle, sparkles, cloudUpload, imageOutline, personOutline,
  checkmarkCircle, closeCircle, imagesOutline
} from 'ionicons/icons';
import { CodexService } from '../../services/codex.service';
import { Codex, CodexCategory, CodexEntry, STORY_ROLES, CustomField, StoryRole, PortraitGalleryItem } from '../../models/codex.interface';
import { v4 as uuidv4 } from 'uuid';
import { CodexTransferModalComponent } from '../codex-transfer-modal/codex-transfer-modal.component';
import { PortraitService, PortraitStyle } from '../../../shared/services/portrait.service';
import { DialogService } from '../../../core/services/dialog.service';
import { KeyboardService } from '../../../core/services/keyboard.service';

@Component({
  selector: 'app-codex',
  standalone: true,
  imports: [
    CommonModule, FormsModule, NgSelectModule, AppHeaderComponent,
    IonContent, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonItem, IonLabel,
    IonSearchbar, IonList, IonChip, IonTextarea, IonInput, IonButton, IonIcon,
    IonModal, IonGrid, IonRow, IonCol, IonText, IonNote, IonButtons, IonToolbar, IonTitle, IonHeader, IonFooter,
    IonSelect, IonSelectOption, IonToggle, IonSpinner
  ],
  templateUrl: './codex.component.html',
  styleUrls: ['./codex.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CodexComponent implements OnInit, OnDestroy {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private codexService = inject(CodexService);
  private modalController = inject(ModalController);
  private toastController = inject(ToastController);
  private cdr = inject(ChangeDetectorRef);
  portraitService = inject(PortraitService);
  private dialogService = inject(DialogService);
  private keyboardService = inject(KeyboardService);
  private subscriptions = new Subscription();

  storyId = signal<string>('');
  codex = signal<Codex | undefined>(undefined);
  selectedCategoryId = signal<string | null>(null);
  selectedEntry = signal<CodexEntry | null>(null);
  searchQuery = signal<string>('');
  searchResults = signal<CodexEntry[]>([]);
  categoryMenuId = signal<string | null>(null);

  // Modals
  showAddCategoryModal = signal<boolean>(false);
  showHelpCard = signal<boolean>(true);

  // Portrait generation state
  isGeneratingPortrait = signal<boolean>(false);
  uploadingImage = signal<boolean>(false);

  // Portrait style options
  portraitStyles: { value: PortraitStyle; label: string }[] = [
    { value: 'photorealistic', label: 'Photorealistic' },
    { value: 'digital-illustration', label: 'Digital Illustration' },
    { value: 'anime', label: 'Anime' },
    { value: 'oil-painting', label: 'Oil Painting' },
    { value: 'watercolor', label: 'Watercolor' },
    { value: 'comic-book', label: 'Comic Book' }
  ];
  selectedPortraitStyle: PortraitStyle = 'photorealistic';

  // Form data
  newCategory = { title: '', icon: '', description: '' };
  editingEntry: Partial<CodexEntry> & { customFields?: CustomField[] } = {};
  tagInput = '';
  
  // Story roles
  storyRoles = STORY_ROLES;
  
  // Custom fields
  newCustomFieldName = '';
  newCustomFieldValue = '';
  
  headerActions: HeaderAction[] = [];

  constructor() {
    addIcons({
      arrowBack, add, ellipsisVertical, create, trash, save, close,
      search, person, bookmark, pricetag, star, swapHorizontal, helpCircle,
      checkmarkDone, informationCircle, sparkles, cloudUpload, imageOutline, personOutline,
      checkmarkCircle, closeCircle, imagesOutline
    });
    this.initializeHeaderActions();

    // Restore portrait style from localStorage
    try {
      const saved = localStorage.getItem('codex-portrait-style');
      if (saved && this.portraitStyles.some(s => s.value === saved)) {
        this.selectedPortraitStyle = saved as PortraitStyle;
      }
    } catch { /* ignore */ }
  }

  onPortraitStyleChange(style: PortraitStyle) {
    if (!style || !this.portraitStyles.some(s => s.value === style)) return;
    this.selectedPortraitStyle = style;
    try {
      localStorage.setItem('codex-portrait-style', style);
    } catch { /* ignore */ }
  }

  getDefaultIcon(): string {
    return 'bookmark';
  }

  // Computed values
  sortedCategories = computed(() => {
    const codex = this.codex();
    if (!codex) return [];
    return [...codex.categories].sort((a, b) => a.order - b.order);
  });

  selectedCategory = computed(() => {
    const codex = this.codex();
    const categoryId = this.selectedCategoryId();
    if (!codex || !categoryId) return null;
    return codex.categories.find((c: CodexCategory) => c.id === categoryId) || null;
  });

  sortedEntries = computed(() => {
    const category = this.selectedCategory();
    if (!category) return [];
    return [...category.entries].sort((a: CodexEntry, b: CodexEntry) => a.order - b.order);
  });

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
  }

  private async loadCodex(storyId: string) {
    try {
      const codex = await this.codexService.getOrCreateCodex(storyId);
      this.codex.set(codex);
      
      // Auto-select first category if none selected
      if (codex.categories.length > 0 && !this.selectedCategoryId()) {
        this.selectedCategoryId.set(codex.categories[0].id);
      }
    } catch (error) {
      console.error('Error loading codex:', error);
    }
  }

  selectCategory(categoryId: string) {
    this.selectedCategoryId.set(categoryId);
    this.categoryMenuId.set(null);
  }

  selectEntry(entry: CodexEntry) {
    this.selectedEntry.set(entry);
    this.editingEntry = {
      ...entry,
      tags: entry.tags ? [...entry.tags] : [],
      storyRole: (entry.metadata?.['storyRole'] as StoryRole) || '',
      customFields: entry.metadata?.['customFields'] && Array.isArray(entry.metadata['customFields']) ? [...entry.metadata['customFields']] : [],
      alwaysInclude: entry.alwaysInclude || false,
      portraitGallery: entry.portraitGallery ? [...entry.portraitGallery] : [],
      activePortraitId: entry.activePortraitId
    };
    // Clear tag input - tags are already in editingEntry.tags
    this.tagInput = '';
    this.resetCustomFieldInputs();
  }

  closeEntryModal() {
    this.selectedEntry.set(null);
    this.editingEntry = {};
    this.resetCustomFieldInputs();
  }

  async addCategory() {
    const storyId = this.storyId();
    if (!storyId || !this.newCategory.title.trim()) return;

    try {
      await this.codexService.addCategory(storyId, this.newCategory);
      this.newCategory = { title: '', icon: '', description: '' };
      this.showAddCategoryModal.set(false);
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error adding category:', error);
    }
  }

  editCategory() {
    // TODO: Implement category editing
    this.categoryMenuId.set(null);
  }

  async deleteCategory(categoryId: string) {
    const storyId = this.storyId();
    if (!storyId) return;

    const confirmed = await this.dialogService.confirmDestructive({
      header: 'Delete Category',
      message: 'Delete category and all entries? This action cannot be undone.',
      confirmText: 'Delete'
    });
    if (confirmed) {
      try {
        await this.codexService.deleteCategory(storyId, categoryId);
        if (this.selectedCategoryId() === categoryId) {
          const codex = this.codex();
          this.selectedCategoryId.set(codex?.categories[0]?.id || null);
        }
        this.cdr.detectChanges();
      } catch (error) {
        console.error('Error deleting category:', error);
      }
    }
    this.categoryMenuId.set(null);
  }

  async createNewEntry() {
    const storyId = this.storyId();
    const categoryId = this.selectedCategoryId();
    if (!storyId || !categoryId) return;

    try {
      // Check if this is a character category (case-insensitive and handles variations)
      const category = this.selectedCategory();
      const isCharacterCategory = this.isCharacterCategory(category);
      
      // Create default custom fields for character entries
      const defaultCharacterFields: CustomField[] = isCharacterCategory ? [
        {
          id: Date.now().toString(),
          name: 'Physical Appearance',
          value: ''
        },
        {
          id: (Date.now() + 1).toString(),
          name: 'Backstory',
          value: ''
        },
        {
          id: (Date.now() + 2).toString(),
          name: 'Personality',
          value: ''
        }
      ] : [];
      
      // Create a new entry with default values
      const newEntry = {
        title: 'New Entry',
        content: '',
        tags: [],
        metadata: isCharacterCategory ? {
          customFields: defaultCharacterFields
        } : {}
      };
      
      const createdEntry = await this.codexService.addEntry(storyId, categoryId, newEntry);
      
      // Directly open the edit dialog for the new entry
      this.selectEntry(createdEntry);
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error creating entry:', error);
    }
  }

  async saveEntry() {
    const storyId = this.storyId();
    const entry = this.selectedEntry();
    if (!storyId || !entry) return;

    try {
      // Parse tags before saving
      this.parseAndAddTags();
      
      // Prepare the updated entry with story role and custom fields in metadata
      const updatedEntry = {
        ...this.editingEntry,
        alwaysInclude: this.editingEntry.alwaysInclude || false,
        metadata: {
          ...this.editingEntry.metadata,
          storyRole: this.editingEntry.storyRole,
          customFields: this.editingEntry.customFields || []
        }
      };
      
      // Remove temporary fields from top level as they should be in metadata
      delete updatedEntry.storyRole;
      delete updatedEntry.customFields;

      await this.codexService.updateEntry(storyId, entry.categoryId, entry.id, updatedEntry);
      this.closeEntryModal();
      this.cdr.detectChanges();
    } catch (error) {
      console.error('Error saving entry:', error);
    }
  }

  async deleteEntry() {
    const storyId = this.storyId();
    const entry = this.selectedEntry();
    if (!storyId || !entry) return;

    const confirmed = await this.dialogService.confirmDestructive({
      header: 'Delete Entry',
      message: 'Delete this entry? This action cannot be undone.',
      confirmText: 'Delete'
    });
    if (confirmed) {
      try {
        await this.codexService.deleteEntry(storyId, entry.categoryId, entry.id);
        this.closeEntryModal();
        this.cdr.detectChanges();
      } catch (error) {
        console.error('Error deleting entry:', error);
      }
    }
  }

  parseAndAddTags() {
    if (!this.tagInput || !this.tagInput.trim()) return;
    
    // Ensure tags array exists
    if (!this.editingEntry.tags) {
      this.editingEntry.tags = [];
    }
    
    // Parse comma-separated tags
    const newTags = this.tagInput
      .split(',')
      .map(tag => tag.trim())
      .filter(tag => tag.length > 0)
      .filter(tag => !this.editingEntry.tags!.includes(tag));
    
    // Add new tags
    this.editingEntry.tags.push(...newTags);
    
    // Clear input
    this.tagInput = '';
  }

  removeTag(tag: string) {
    if (!this.editingEntry.tags) return;
    
    const index = this.editingEntry.tags.indexOf(tag);
    if (index > -1) {
      this.editingEntry.tags.splice(index, 1);
    }
  }

  onSearch() {
    const query = this.searchQuery();
    const storyId = this.storyId();
    
    if (!query.trim() || !storyId) {
      this.searchResults.set([]);
      return;
    }

    const results = this.codexService.searchEntries(storyId, query);
    this.searchResults.set(results);
  }

  toggleCategoryMenu(categoryId: string) {
    this.categoryMenuId.set(
      this.categoryMenuId() === categoryId ? null : categoryId
    );
  }

  getCategoryName(categoryId: string): string {
    const codex = this.codex();
    if (!codex) return '';
    const category = codex.categories.find((c: CodexCategory) => c.id === categoryId);
    return category?.title || '';
  }

  getContentPreview(content: string): string {
    return content.length > 100 ? content.substring(0, 100) + '...' : content;
  }

  formatDate(date: Date): string {
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date);
  }

  isCharacterEntry(): boolean {
    const category = this.selectedCategory();
    return this.isCharacterCategory(category);
  }

  private isCharacterCategory(category: CodexCategory | null): boolean {
    if (!category) return false;
    const categoryTitle = category.title?.toLowerCase() || '';
    
    // Check for English terms
    if (categoryTitle === 'characters' || 
        categoryTitle === 'character' ||
        categoryTitle.includes('character')) {
      return true;
    }
    
    // Check for German terms
    if (categoryTitle === 'charaktere' ||
        categoryTitle === 'charakter' ||
        categoryTitle.includes('charakter') ||
        categoryTitle === 'figuren' ||
        categoryTitle.includes('figur') ||
        categoryTitle === 'personen' ||
        categoryTitle.includes('person')) {
      return true;
    }
    
    // Check for icon
    if (category.icon === '👤') {
      return true;
    }
    
    return false;
  }

  addCustomField() {
    const name = this.newCustomFieldName.trim();
    const value = this.newCustomFieldValue.trim();
    
    if (!name) return;

    if (!this.editingEntry.customFields) {
      this.editingEntry.customFields = [];
    }

    const newField: CustomField = {
      id: Date.now().toString(),
      name: name,
      value: value
    };

    this.editingEntry.customFields.push(newField);
    this.resetCustomFieldInputs();
  }

  removeCustomField(fieldId: string) {
    if (this.editingEntry.customFields) {
      this.editingEntry.customFields = this.editingEntry.customFields.filter((field: CustomField) => field.id !== fieldId);
    }
  }

  resetCustomFieldInputs() {
    this.newCustomFieldName = '';
    this.newCustomFieldValue = '';
  }

  getFieldValuePreview(value: string): string {
    if (!value) return '';
    // Replace line breaks with spaces and limit length
    const singleLine = value.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    return singleLine.length > 30 ? singleLine.substring(0, 30) + '...' : singleLine;
  }

  getCustomFields(entry: CodexEntry): CustomField[] {
    const fields = entry.metadata?.['customFields'];
    return Array.isArray(fields) ? fields : [];
  }

  goBack() {
    this.router.navigate(['/stories/editor', this.storyId()]);
  }

  private initializeHeaderActions(): void {
    this.headerActions = [
      {
        icon: 'swap-horizontal',
        label: 'Transfer',
        action: () => this.openTransferModal(),
        showOnMobile: true,
        showOnDesktop: true
      },
      {
        icon: 'add',
        label: 'Category',
        action: () => this.showAddCategoryModal.set(true),
        showOnMobile: true,
        showOnDesktop: true
      }
    ];
  }

  async openTransferModal() {
    const modal = await this.modalController.create({
      component: CodexTransferModalComponent,
      cssClass: 'codex-transfer-modal',
      backdropDismiss: false,
      canDismiss: true,
      showBackdrop: true
    });

    await modal.present();

    const { data } = await modal.onDidDismiss();
    if (data?.transferred && data?.count > 0) {
      // Show success feedback
      console.log(`Successfully transferred ${data.count} entries`);
      // Optionally reload codex if needed
      // await this.loadCodex(this.storyId());
    }
  }

  dismissHelpCard() {
    this.showHelpCard.set(false);
    // Store preference in localStorage
    try {
      localStorage.setItem('codex-transfer-help-dismissed', 'true');
    } catch (error) {
      console.error('Error saving help card preference:', error);
    }
  }

  ngOnInit() {
    // Check if help card was previously dismissed
    try {
      const dismissed = localStorage.getItem('codex-transfer-help-dismissed');
      if (dismissed === 'true') {
        this.showHelpCard.set(false);
      }
    } catch (error) {
      console.error('Error reading help card preference:', error);
    }

    // Subscribe to keyboard visibility for scroll-into-view on Android
    this.subscriptions.add(
      this.keyboardService.keyboardVisible$.subscribe(visible => {
        if (visible) {
          setTimeout(() => this.scrollFocusedTextareaIntoView(), 350);
          this.cdr.markForCheck();
        }
      })
    );

    this.subscriptions.add(
      this.route.params.subscribe(params => {
        const storyId = params['id'];
        this.storyId.set(storyId);
        this.loadCodex(storyId);
        this.cdr.markForCheck();
      })
    );

    // Subscribe to codex changes from service
    this.subscriptions.add(
      this.codexService.codex$.subscribe(codexMap => {
        const storyId = this.storyId();
        if (storyId && codexMap.has(storyId)) {
          const codex = codexMap.get(storyId);
          this.codex.set(codex);

          // Auto-select first category if none selected and categories exist
          if (codex && codex.categories.length > 0 && !this.selectedCategoryId()) {
            this.selectedCategoryId.set(codex.categories[0].id);
          }

          // Force change detection
          this.cdr.markForCheck();
        }
      })
    );
  }

  // Portrait methods

  /**
   * Get the portrait source URL for display in entry cards
   */
  getPortraitSrc(entry: CodexEntry): string | null {
    const activePortrait = this.codexService.getActivePortrait(entry);
    if (activePortrait) {
      return `data:image/jpeg;base64,${activePortrait}`;
    }
    return null;
  }

  /**
   * Get the active portrait base64 for the editing entry
   */
  getActivePortraitBase64(): string | null {
    if (!this.editingEntry.portraitGallery || this.editingEntry.portraitGallery.length === 0) {
      return null;
    }

    const activeId = this.editingEntry.activePortraitId;
    const activePortrait = this.editingEntry.portraitGallery.find(p => p.id === activeId);
    return activePortrait?.base64 || this.editingEntry.portraitGallery[0]?.base64 || null;
  }

  /**
   * Check if gallery is full (5 portraits max)
   */
  isGalleryFull(): boolean {
    return (this.editingEntry.portraitGallery?.length || 0) >= 5;
  }

  /**
   * Check if portrait generation is available
   */
  canGeneratePortrait(): boolean {
    return this.isCharacterEntry() && this.portraitService.isOpenRouterConfigured();
  }

  /**
   * Select a portrait as active
   */
  async selectPortrait(portraitId: string): Promise<void> {
    const entry = this.selectedEntry();
    if (!entry) return;

    this.editingEntry.activePortraitId = portraitId;

    // Save immediately
    await this.codexService.updateEntry(
      this.storyId(),
      entry.categoryId,
      entry.id,
      {
        activePortraitId: portraitId
      }
    );

    this.cdr.markForCheck();
    await this.showToast('Portrait selected.', 'success');
  }

  /**
   * Remove a specific portrait from the gallery
   */
  async removeGalleryPortrait(portraitId: string): Promise<void> {
    const entry = this.selectedEntry();
    if (!entry || !this.editingEntry.portraitGallery) return;

    // Remove from gallery
    this.editingEntry.portraitGallery = this.editingEntry.portraitGallery.filter(
      p => p.id !== portraitId
    );

    // If we removed the active portrait, select a new one
    if (this.editingEntry.activePortraitId === portraitId) {
      const newActive = this.editingEntry.portraitGallery[0];
      this.editingEntry.activePortraitId = newActive?.id;
    }

    // Save
    await this.codexService.updateEntry(
      this.storyId(),
      entry.categoryId,
      entry.id,
      {
        portraitGallery: this.editingEntry.portraitGallery,
        activePortraitId: this.editingEntry.activePortraitId
      }
    );

    await this.showToast('Portrait removed from gallery.', 'success');
    this.cdr.markForCheck();
  }

  /**
   * Add a portrait to the gallery
   */
  private addToGallery(base64: string, source: 'generated' | 'uploaded'): void {
    // Initialize gallery if needed
    if (!this.editingEntry.portraitGallery) {
      this.editingEntry.portraitGallery = [];
    }

    // Enforce 5-item limit (remove oldest)
    if (this.editingEntry.portraitGallery.length >= 5) {
      this.editingEntry.portraitGallery.shift();
    }

    // Create new gallery item
    const newPortrait: PortraitGalleryItem = {
      id: uuidv4(),
      base64,
      createdAt: new Date(),
      source
    };

    // Add to gallery and set as active
    this.editingEntry.portraitGallery.push(newPortrait);
    this.editingEntry.activePortraitId = newPortrait.id;
  }

  /**
   * Generate portrait for the current character entry
   */
  async generatePortrait() {
    const entry = this.selectedEntry();
    if (!entry) return;

    // Check OpenRouter configuration
    if (!this.portraitService.isOpenRouterConfigured()) {
      await this.showToast('OpenRouter is required for portrait generation. Configure it in Settings.', 'warning');
      return;
    }

    // Check premium access
    const hasAccess = await this.portraitService.checkPremiumAccess();
    if (!hasAccess) return;

    this.isGeneratingPortrait.set(true);
    this.cdr.markForCheck();

    try {
      const customFields = this.getCustomFields(entry);
      const physicalAppearance = customFields.find(f =>
        f.name.toLowerCase().includes('physical') || f.name.toLowerCase().includes('appearance')
      )?.value;
      const backstory = customFields.find(f =>
        f.name.toLowerCase().includes('backstory') || f.name.toLowerCase().includes('history')
      )?.value;
      const personality = customFields.find(f =>
        f.name.toLowerCase().includes('personality') || f.name.toLowerCase().includes('traits')
      )?.value;

      const imageBase64 = await this.portraitService.generatePortrait({
        title: entry.title,
        content: entry.content,
        physicalAppearance,
        backstory,
        personality,
        style: this.selectedPortraitStyle
      });

      // Add to gallery
      this.addToGallery(imageBase64, 'generated');

      // Update entry with gallery
      await this.codexService.updateEntry(
        this.storyId(),
        entry.categoryId,
        entry.id,
        {
          portraitGallery: this.editingEntry.portraitGallery,
          activePortraitId: this.editingEntry.activePortraitId
        }
      );

      await this.showToast('Portrait generated and added to gallery!', 'success');
    } catch (error) {
      console.error('Portrait generation failed:', error);
      await this.showToast(
        error instanceof Error ? error.message : 'Portrait generation failed',
        'danger'
      );
    } finally {
      this.isGeneratingPortrait.set(false);
      this.cdr.markForCheck();
    }
  }

  /**
   * Handle portrait upload
   */
  async uploadPortrait(event: Event) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;

    const file = input.files[0];
    const entry = this.selectedEntry();
    if (!entry) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      await this.showToast('Please select a valid image file.', 'warning');
      return;
    }

    // Validate file size (max 5MB before compression)
    if (file.size > 5 * 1024 * 1024) {
      await this.showToast('Image is too large. Maximum size is 5MB.', 'warning');
      return;
    }

    this.uploadingImage.set(true);
    this.cdr.markForCheck();

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64 = e.target?.result as string;

          // Compress to max 50kb
          const compressed = await this.portraitService.compressImage(base64, 50);

          // Add to gallery
          this.addToGallery(compressed, 'uploaded');

          // Update entry with gallery
          await this.codexService.updateEntry(
            this.storyId(),
            entry.categoryId,
            entry.id,
            {
              portraitGallery: this.editingEntry.portraitGallery,
              activePortraitId: this.editingEntry.activePortraitId
            }
          );

          await this.showToast('Image uploaded and added to gallery!', 'success');
        } catch (error) {
          console.error('Image processing failed:', error);
          await this.showToast('Failed to process image.', 'danger');
        } finally {
          this.uploadingImage.set(false);
          this.cdr.markForCheck();
        }
      };
      reader.onerror = async () => {
        await this.showToast('Failed to read image file.', 'danger');
        this.uploadingImage.set(false);
        this.cdr.markForCheck();
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Upload failed:', error);
      this.uploadingImage.set(false);
      this.cdr.markForCheck();
    }

    // Clear input for re-upload of same file
    input.value = '';
  }


  /**
   * Show toast notification
   */
  private async showToast(message: string, color: 'success' | 'warning' | 'danger') {
    const toast = await this.toastController.create({
      message,
      duration: 3000,
      color,
      position: 'bottom'
    });
    await toast.present();
  }

  /**
   * Scroll focused textarea into view when keyboard appears.
   * Follows the scene-chat pattern for Android keyboard handling.
   */
  private scrollFocusedTextareaIntoView(): void {
    const activeElement = document.activeElement;
    if (!activeElement) return;

    const isTextInput = activeElement.tagName === 'TEXTAREA' ||
                        activeElement.closest('ion-textarea') ||
                        activeElement.closest('ion-input') ||
                        activeElement.tagName === 'INPUT';

    if (isTextInput) {
      activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // ============================================
  // trackBy functions for mobile performance
  // ============================================
  trackByCategoryId(index: number, category: CodexCategory): string {
    return category.id;
  }

  trackByEntryId(index: number, entry: CodexEntry): string {
    return entry.id;
  }

  trackByTag(index: number, tag: string): string {
    return tag;
  }

  trackByPortraitId(index: number, portrait: PortraitGalleryItem): string {
    return portrait.id;
  }

  trackByRoleValue(index: number, role: { value: StoryRole; label: string }): string {
    return role.value;
  }

  trackByStyleValue(index: number, style: { value: PortraitStyle; label: string }): string {
    return style.value;
  }

  trackByFieldIndex(index: number, _field: CustomField): number {
    return index;
  }
}
