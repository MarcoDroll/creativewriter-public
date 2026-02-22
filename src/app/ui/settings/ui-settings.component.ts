import { Component, Input, Output, EventEmitter, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonAccordion, IonAccordionGroup, IonBadge,
  IonIcon, IonItem, IonLabel
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { textOutline, imageOutline, chatbubbleOutline, colorWandOutline, colorPaletteOutline, bulbOutline } from 'ionicons/icons';
import { Settings } from '../../core/models/settings.interface';
import { ColorPickerComponent } from '../components/color-picker.component';
import { BackgroundSelectorComponent } from '../components/background-selector.component';
import { BackgroundUploadComponent } from '../components/background-upload.component';
import { BackgroundService } from '../../shared/services/background.service';
import { CustomBackground, SyncedCustomBackgroundService } from '../../shared/services/synced-custom-background.service';

@Component({
  selector: 'app-ui-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonAccordion, IonAccordionGroup, IonBadge,
    IonIcon, IonItem, IonLabel,
    ColorPickerComponent, BackgroundSelectorComponent, BackgroundUploadComponent
  ],
  templateUrl: './ui-settings.component.html',
  styleUrls: ['./ui-settings.component.scss']
})
export class UiSettingsComponent implements OnInit {
  private backgroundService = inject(BackgroundService);
  private customBackgroundService = inject(SyncedCustomBackgroundService);

  constructor() {
    addIcons({ textOutline, imageOutline, chatbubbleOutline, colorWandOutline, colorPaletteOutline, bulbOutline });
  }

  @Input() settings!: Settings;
  @Output() settingsChange = new EventEmitter<void>();

  ngOnInit(): void {
    // Pull custom backgrounds from remote when entering appearance tab
    // Fire-and-forget - UI will update reactively when backgrounds load
    this.customBackgroundService.pullBackgroundsFromRemote();
  }

  onTextColorChange(color: string): void {
    // Update local settings first to track changes
    this.settings.appearance.textColor = color;
    this.settingsChange.emit();
  }

  onDirectSpeechColorChange(color: string): void {
    // Update local settings - set to the custom color
    this.settings.appearance.directSpeechColor = color;
    this.settingsChange.emit();
  }

  resetDirectSpeechColorToAuto(): void {
    // Reset to null to derive from text color automatically
    this.settings.appearance.directSpeechColor = null;
    this.settingsChange.emit();
  }

  /**
   * Get the effective direct speech color (custom or derived from text color)
   */
  getEffectiveDirectSpeechColor(): string {
    if (this.settings.appearance.directSpeechColor) {
      return this.settings.appearance.directSpeechColor;
    }
    // Derive from text color with a slight purple shift
    return this.deriveDirectSpeechColor(this.settings.appearance.textColor);
  }

  /**
   * Check if using automatic (derived) color
   */
  isUsingAutomaticColor(): boolean {
    return this.settings.appearance.directSpeechColor === null;
  }

  /**
   * Derive a direct speech color from the text color by shifting it toward purple/violet.
   * Creates a subtle but noticeable difference for dialogue highlighting.
   */
  private deriveDirectSpeechColor(textColor: string): string {
    // Validate hex color format
    if (!textColor || !textColor.match(/^#[0-9a-fA-F]{6}$/)) {
      return '#7c3aed'; // Return fallback purple for invalid input
    }

    // Parse hex color
    const hex = textColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Shift toward purple: reduce green, increase blue slightly
    // This creates a subtle purple/violet tint
    const newR = Math.min(255, Math.round(r * 0.85 + 40)); // Add some red for warmth
    const newG = Math.max(0, Math.round(g * 0.7)); // Reduce green
    const newB = Math.min(255, Math.round(b * 0.85 + 60)); // Add more blue

    // Convert back to hex
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
  }

  // ============================================
  // THINKING COLOR (internal monologue in asterisks)
  // ============================================

  onThinkingColorChange(color: string): void {
    // Update local settings - set to the custom color
    this.settings.appearance.thinkingColor = color;
    this.settingsChange.emit();
  }

  resetThinkingColorToAuto(): void {
    // Reset to null to derive from text color automatically
    this.settings.appearance.thinkingColor = null;
    this.settingsChange.emit();
  }

  /**
   * Get the effective thinking color (custom or derived from text color)
   */
  getEffectiveThinkingColor(): string {
    if (this.settings.appearance.thinkingColor) {
      return this.settings.appearance.thinkingColor;
    }
    // Derive from text color with a slight cyan shift
    return this.deriveThinkingColor(this.settings.appearance.textColor);
  }

  /**
   * Check if using automatic (derived) thinking color
   */
  isUsingAutomaticThinkingColor(): boolean {
    return this.settings.appearance.thinkingColor === null;
  }

  /**
   * Derive a thinking color from the text color by shifting it toward cyan/teal.
   * Creates a subtle but noticeable difference for internal monologue highlighting.
   */
  private deriveThinkingColor(textColor: string): string {
    // Validate hex color format
    if (!textColor || !textColor.match(/^#[0-9a-fA-F]{6}$/)) {
      return '#06b6d4'; // Return fallback cyan for invalid input
    }

    // Parse hex color
    const hex = textColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);

    // Shift toward cyan: reduce red, increase green and blue
    // This creates a subtle cyan/teal tint
    const newR = Math.max(0, Math.round(r * 0.6)); // Reduce red significantly
    const newG = Math.min(255, Math.round(g * 0.85 + 50)); // Add green
    const newB = Math.min(255, Math.round(b * 0.85 + 60)); // Add blue

    // Convert back to hex
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    return `#${toHex(newR)}${toHex(newG)}${toHex(newB)}`;
  }

  onBackgroundImageChange(backgroundImage: string): void {
    // Update local settings first to track changes
    this.settings.appearance.backgroundImage = backgroundImage;
    this.settingsChange.emit();

    // Set preview background for immediate visual feedback
    this.backgroundService.setPreviewBackground(backgroundImage);
  }

  onBackgroundUploaded(customBackground: CustomBackground): void {
    // Automatically select the newly uploaded background
    const customId = `custom:${customBackground._id}`;
    this.onBackgroundImageChange(customId);
  }

  /**
   * Returns a friendly label for the currently selected background
   */
  getBackgroundLabel(): string {
    const bg = this.settings.appearance.backgroundImage;

    if (!bg || bg === 'none') {
      return 'None';
    }

    if (bg.startsWith('custom:')) {
      return 'Custom';
    }

    // Extract filename from path and format it
    const filename = bg.split('/').pop()?.replace(/\.[^.]+$/, '') || bg;

    // Convert kebab-case to Title Case
    return filename
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
}
