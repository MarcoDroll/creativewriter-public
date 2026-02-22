import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonContent,
  IonLabel,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardContent,
  IonFooter,
  IonSpinner,
  IonList,
  IonItem,
  IonCheckbox,
  IonSelect,
  IonSelectOption,
  IonBadge,
  ModalController,
  AlertController,
  LoadingController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  close,
  arrowForward,
  arrowBack,
  swapHorizontal,
  checkmarkCircle,
  alertCircle,
  informationCircle
} from 'ionicons/icons';
import { CodexService } from '../../services/codex.service';
import { StoryService } from '../../services/story.service';
import { Story } from '../../models/story.interface';
import { Codex, CodexEntry } from '../../models/codex.interface';

interface SelectableEntry extends CodexEntry {
  categoryTitle: string;
  categoryIcon?: string;
  selected: boolean;
}

interface TransferConflict {
  entryTitle: string;
  categoryTitle: string;
  reason: string;
  canProceed: boolean;
}

type WizardStep = 'select-stories' | 'select-entries' | 'preview-confirm' | 'complete';

@Component({
  selector: 'app-codex-transfer-modal',
  standalone: true,
  imports: [
    CommonModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonLabel,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardContent,
    IonFooter,
    IonSpinner,
    IonList,
    IonItem,
    IonCheckbox,
    IonSelect,
    IonSelectOption,
    IonBadge
  ],
  templateUrl: './codex-transfer-modal.component.html',
  styleUrls: ['./codex-transfer-modal.component.scss']
})
export class CodexTransferModalComponent implements OnInit {
  // Injected services
  private readonly modalController = inject(ModalController);
  private readonly alertController = inject(AlertController);
  private readonly loadingController = inject(LoadingController);
  private readonly codexService = inject(CodexService);
  private readonly storyService = inject(StoryService);

  // State signals
  currentStep = signal<WizardStep>('select-stories');
  loading = signal(false);
  error = signal<string | null>(null);

  // Story selection
  availableStories = signal<Story[]>([]);
  sourceStoryId = signal<string | null>(null);
  destinationStoryId = signal<string | null>(null);

  // Codex data
  sourceCodex = signal<Codex | null>(null);
  destinationCodex = signal<Codex | null>(null);
  selectableEntries = signal<SelectableEntry[]>([]);

  // Transfer data
  conflicts = signal<TransferConflict[]>([]);
  transferSuccess = signal(false);
  transferredCount = signal(0);

  // Computed properties
  sourceStory = computed(() => {
    const id = this.sourceStoryId();
    return this.availableStories().find(s => s.id === id) || null;
  });

  destinationStory = computed(() => {
    const id = this.destinationStoryId();
    return this.availableStories().find(s => s.id === id) || null;
  });

  selectedEntries = computed(() =>
    this.selectableEntries().filter(e => e.selected)
  );

  canProceedToEntrySelection = computed(() =>
    this.sourceStoryId() !== null &&
    this.destinationStoryId() !== null &&
    this.sourceStoryId() !== this.destinationStoryId()
  );

  canProceedToPreview = computed(() =>
    this.selectedEntries().length > 0
  );

  categoriesWithSelection = computed(() => {
    const entries = this.selectableEntries();
    const categoryMap = new Map<string, { title: string; icon?: string; entries: SelectableEntry[] }>();

    entries.forEach(entry => {
      if (!categoryMap.has(entry.categoryTitle)) {
        categoryMap.set(entry.categoryTitle, {
          title: entry.categoryTitle,
          icon: entry.categoryIcon,
          entries: []
        });
      }
      categoryMap.get(entry.categoryTitle)!.entries.push(entry);
    });

    return Array.from(categoryMap.values());
  });

  constructor() {
    addIcons({
      close,
      arrowForward,
      arrowBack,
      swapHorizontal,
      checkmarkCircle,
      alertCircle,
      informationCircle
    });
  }

  async ngOnInit() {
    await this.loadStories();
  }

  /**
   * Load all available stories
   */
  private async loadStories() {
    this.loading.set(true);
    this.error.set(null);

    try {
      const stories = await this.storyService.getAllStories(1000);

      // Filter out stories with no title or empty stories
      const validStories = stories.filter(s => s.title && s.title.trim().length > 0);

      this.availableStories.set(validStories);

      if (validStories.length < 2) {
        this.error.set('You need at least 2 stories to transfer Codex entries.');
      }
    } catch (err) {
      console.error('[CodexTransferModal] Error loading stories:', err);
      this.error.set('Failed to load stories. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Load source codex and prepare selectable entries
   */
  private async loadSourceCodex() {
    const sourceId = this.sourceStoryId();
    if (!sourceId) return;

    this.loading.set(true);
    this.error.set(null);

    try {
      const codex = await this.codexService.getOrCreateCodex(sourceId);
      this.sourceCodex.set(codex);

      // Transform to selectable entries
      const entries: SelectableEntry[] = [];

      codex.categories.forEach(category => {
        category.entries.forEach(entry => {
          entries.push({
            ...entry,
            categoryTitle: category.title,
            categoryIcon: category.icon,
            selected: false
          });
        });
      });

      this.selectableEntries.set(entries);

      if (entries.length === 0) {
        this.error.set('Source story has no Codex entries to transfer.');
      }
    } catch (err) {
      console.error('[CodexTransferModal] Error loading source codex:', err);
      this.error.set('Failed to load source Codex. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Load destination codex for conflict detection
   */
  private async loadDestinationCodex() {
    const destId = this.destinationStoryId();
    if (!destId) return;

    try {
      const codex = await this.codexService.getOrCreateCodex(destId);
      this.destinationCodex.set(codex);
    } catch (err) {
      console.error('[CodexTransferModal] Error loading destination codex:', err);
      this.error.set('Failed to load destination Codex. Please try again.');
    }
  }

  /**
   * Detect conflicts between selected entries and destination codex
   */
  private detectConflicts() {
    const selected = this.selectedEntries();
    const destCodex = this.destinationCodex();
    const conflicts: TransferConflict[] = [];

    if (!destCodex) return;

    selected.forEach(entry => {
      // Find matching category in destination
      const destCategory = destCodex.categories.find(
        cat => cat.title.toLowerCase() === entry.categoryTitle.toLowerCase()
      );

      if (destCategory) {
        // Check for duplicate entry titles
        const duplicate = destCategory.entries.find(
          e => e.title.toLowerCase() === entry.title.toLowerCase()
        );

        if (duplicate) {
          conflicts.push({
            entryTitle: entry.title,
            categoryTitle: entry.categoryTitle,
            reason: `Entry "${entry.title}" already exists in category "${entry.categoryTitle}"`,
            canProceed: true // We'll create a copy with a suffix
          });
        }
      }
    });

    this.conflicts.set(conflicts);
  }

  /**
   * Toggle entry selection
   */
  toggleEntry(entry: SelectableEntry) {
    const entries = this.selectableEntries();
    const index = entries.indexOf(entry);
    if (index !== -1) {
      entries[index].selected = !entries[index].selected;
      this.selectableEntries.set([...entries]); // Trigger signal update
    }
  }

  /**
   * Select all entries in a category
   */
  selectCategoryEntries(categoryTitle: string, select: boolean) {
    const entries = this.selectableEntries();
    entries.forEach(entry => {
      if (entry.categoryTitle === categoryTitle) {
        entry.selected = select;
      }
    });
    this.selectableEntries.set([...entries]); // Trigger signal update
  }

  /**
   * Check if all entries in a category are selected
   */
  isCategoryFullySelected(categoryTitle: string): boolean {
    const entries = this.selectableEntries().filter(e => e.categoryTitle === categoryTitle);
    return entries.length > 0 && entries.every(e => e.selected);
  }

  /**
   * Check if some entries in a category are selected
   */
  isCategoryPartiallySelected(categoryTitle: string): boolean {
    const entries = this.selectableEntries().filter(e => e.categoryTitle === categoryTitle);
    const selectedCount = entries.filter(e => e.selected).length;
    return selectedCount > 0 && selectedCount < entries.length;
  }

  /**
   * Get count of selected entries in a category
   */
  getCategorySelectedCount(categoryTitle: string): number {
    return this.selectableEntries().filter(
      e => e.categoryTitle === categoryTitle && e.selected
    ).length;
  }

  /**
   * Navigate to next step
   */
  async nextStep() {
    const current = this.currentStep();

    switch (current) {
      case 'select-stories':
        if (!this.canProceedToEntrySelection()) {
          const alert = await this.alertController.create({
            header: 'Invalid Selection',
            message: 'Please select different source and destination stories.',
            buttons: ['OK']
          });
          await alert.present();
          return;
        }

        await this.loadSourceCodex();
        await this.loadDestinationCodex();

        if (!this.error()) {
          this.currentStep.set('select-entries');
        }
        break;

      case 'select-entries':
        if (!this.canProceedToPreview()) {
          const alert = await this.alertController.create({
            header: 'No Entries Selected',
            message: 'Please select at least one entry to transfer.',
            buttons: ['OK']
          });
          await alert.present();
          return;
        }

        this.detectConflicts();
        this.currentStep.set('preview-confirm');
        break;

      case 'preview-confirm':
        await this.executeTransfer();
        break;
    }
  }

  /**
   * Navigate to previous step
   */
  previousStep() {
    const current = this.currentStep();

    switch (current) {
      case 'select-entries':
        this.currentStep.set('select-stories');
        this.selectableEntries.set([]); // Clear selections
        break;

      case 'preview-confirm':
        this.currentStep.set('select-entries');
        this.conflicts.set([]); // Clear conflicts
        break;

      case 'complete':
        // Reset to beginning
        this.currentStep.set('select-stories');
        this.resetState();
        break;
    }
  }

  /**
   * Execute the transfer operation
   */
  private async executeTransfer() {
    const destId = this.destinationStoryId();
    const selected = this.selectedEntries();
    const destCodex = this.destinationCodex();

    if (!destId || !destCodex) return;

    const loading = await this.loadingController.create({
      message: `Transferring ${selected.length} ${selected.length === 1 ? 'entry' : 'entries'}...`
    });
    await loading.present();

    let successCount = 0;

    try {
      // Group entries by category
      const entriesByCategory = new Map<string, SelectableEntry[]>();
      selected.forEach(entry => {
        if (!entriesByCategory.has(entry.categoryTitle)) {
          entriesByCategory.set(entry.categoryTitle, []);
        }
        entriesByCategory.get(entry.categoryTitle)!.push(entry);
      });

      // Transfer entries category by category
      for (const [categoryTitle, entries] of entriesByCategory) {
        // Find or create category in destination
        let destCategory = destCodex.categories.find(
          cat => cat.title.toLowerCase() === categoryTitle.toLowerCase()
        );

        if (!destCategory) {
          // Create new category
          const sourceCategory = this.sourceCodex()?.categories.find(
            cat => cat.title === categoryTitle
          );

          destCategory = await this.codexService.addCategory(destId, {
            title: categoryTitle,
            description: sourceCategory?.description,
            icon: sourceCategory?.icon
          });
        }

        // Transfer entries
        for (const entry of entries) {
          try {
            // Check for duplicate and create unique title if needed
            let entryTitle = entry.title;
            const existingEntry = destCategory.entries.find(
              e => e.title.toLowerCase() === entryTitle.toLowerCase()
            );

            if (existingEntry) {
              // Append suffix to make unique
              let suffix = 1;
              while (destCategory.entries.some(
                e => e.title.toLowerCase() === `${entryTitle} (${suffix})`.toLowerCase()
              )) {
                suffix++;
              }
              entryTitle = `${entryTitle} (${suffix})`;
            }

            // Add entry (without id to generate new one)
            await this.codexService.addEntry(destId, destCategory.id, {
              title: entryTitle,
              content: entry.content,
              tags: entry.tags ? [...entry.tags] : undefined,
              portraitGallery: entry.portraitGallery ? entry.portraitGallery.map(p => ({ ...p })) : undefined,
              activePortraitId: entry.activePortraitId,
              metadata: entry.metadata ? { ...entry.metadata } : undefined,
              storyRole: entry.storyRole,
              alwaysInclude: entry.alwaysInclude
            });

            successCount++;
          } catch (err) {
            console.error(`[CodexTransferModal] Error transferring entry "${entry.title}":`, err);
          }
        }
      }

      this.transferredCount.set(successCount);
      this.transferSuccess.set(true);
      this.currentStep.set('complete');

      await loading.dismiss();
    } catch (err) {
      await loading.dismiss();
      console.error('[CodexTransferModal] Error during transfer:', err);

      const alert = await this.alertController.create({
        header: 'Transfer Failed',
        message: `Failed to transfer entries. ${successCount} of ${selected.length} entries were transferred successfully.`,
        buttons: ['OK']
      });
      await alert.present();
    }
  }

  /**
   * Reset component state
   */
  private resetState() {
    this.sourceStoryId.set(null);
    this.destinationStoryId.set(null);
    this.sourceCodex.set(null);
    this.destinationCodex.set(null);
    this.selectableEntries.set([]);
    this.conflicts.set([]);
    this.transferSuccess.set(false);
    this.transferredCount.set(0);
    this.error.set(null);
  }

  /**
   * Close modal
   */
  dismiss() {
    this.modalController.dismiss({
      transferred: this.transferSuccess(),
      count: this.transferredCount()
    });
  }

  /**
   * Get step progress (1-based for display)
   */
  getStepNumber(): number {
    const steps: WizardStep[] = ['select-stories', 'select-entries', 'preview-confirm', 'complete'];
    return steps.indexOf(this.currentStep()) + 1;
  }

  /**
   * Get total number of steps
   */
  getTotalSteps(): number {
    return 4;
  }

  /**
   * Get count of selected entries in a category (for template)
   */
  getCategorySelectedEntriesCount(categoryEntries: SelectableEntry[]): number {
    return categoryEntries.filter(e => e.selected).length;
  }

  /**
   * Check if category has any selected entries (for template)
   */
  categoryHasSelectedEntries(categoryEntries: SelectableEntry[]): boolean {
    return categoryEntries.some(e => e.selected);
  }

  /**
   * Track by function for ngFor performance
   */
  trackByStoryId(index: number, story: Story): string {
    return story.id;
  }

  /**
   * Track by function for entries
   */
  trackByEntryId(index: number, entry: SelectableEntry): string {
    return entry.id;
  }

  /**
   * Track by function for conflicts
   */
  trackByConflictKey(index: number, conflict: TransferConflict): string {
    return `${conflict.categoryTitle}-${conflict.entryTitle}`;
  }
}
