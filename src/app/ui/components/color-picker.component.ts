import { Component, Input, Output, EventEmitter, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

interface ColorPreset {
  name: string;
  value: string;
  contrast: 'dark' | 'light';
}

@Component({
  selector: 'app-color-picker',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="color-picker-container">
      <!-- Current Color Display -->
      <div class="current-color-section">
        <div class="color-preview" [style.background-color]="currentColor">
          <span class="preview-text" [style.color]="getContrastColor(currentColor)">
            Aa
            <small>123</small>
          </span>
        </div>
        <div class="color-info">
          <div class="color-value">{{ getColorDisplayValue() }}</div>
          <div class="color-format-toggle">
            <button (click)="toggleFormat()" class="format-btn">
              {{ colorFormat === 'hex' ? 'HEX → RGB' : 'RGB → HEX' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Preset Colors -->
      <div class="preset-colors">
        <h4>Predefined Colors</h4>
        <div class="color-grid">
          <button
            *ngFor="let preset of colorPresets"
            class="color-preset"
            [style.background-color]="preset.value"
            [class.selected]="preset.value === currentColor"
            (click)="selectPreset(preset)"
            [title]="preset.name">
            <span class="checkmark" *ngIf="preset.value === currentColor">✓</span>
          </button>
        </div>
      </div>

      <!-- Custom Color Section -->
      <div class="custom-color-section">
        <h4>Custom Color</h4>
        
        <!-- Color Sliders -->
        <div class="color-controls">
          <div class="slider-group">
            <label>
              <span class="slider-label">R</span>
              <input 
                type="range" 
                min="0" 
                max="255" 
                [(ngModel)]="rgbValues.r"
                (ngModelChange)="onRgbChange()"
                class="color-slider red"
                [style.background]="getRedSliderGradient()">
              <span class="slider-value">{{ rgbValues.r }}</span>
            </label>
          </div>
          
          <div class="slider-group">
            <label>
              <span class="slider-label">G</span>
              <input 
                type="range" 
                min="0" 
                max="255" 
                [(ngModel)]="rgbValues.g"
                (ngModelChange)="onRgbChange()"
                class="color-slider green"
                [style.background]="getGreenSliderGradient()">
              <span class="slider-value">{{ rgbValues.g }}</span>
            </label>
          </div>
          
          <div class="slider-group">
            <label>
              <span class="slider-label">B</span>
              <input 
                type="range" 
                min="0" 
                max="255" 
                [(ngModel)]="rgbValues.b"
                (ngModelChange)="onRgbChange()"
                class="color-slider blue"
                [style.background]="getBlueSliderGradient()">
              <span class="slider-value">{{ rgbValues.b }}</span>
            </label>
          </div>
        </div>

        <!-- Hex Input -->
        <div class="hex-input-group">
          <input 
            type="text" 
            [(ngModel)]="hexInput"
            (ngModelChange)="onHexChange()"
            placeholder="#000000"
            maxlength="7"
            class="hex-input">
          <button class="copy-btn" (click)="copyToClipboard()" title="Copy to clipboard">
            📋
          </button>
        </div>
      </div>

      <!-- Recent Colors -->
      <div class="recent-colors" *ngIf="recentColors.length > 0">
        <h4>Recently Used</h4>
        <div class="color-grid">
          <button
            *ngFor="let color of recentColors"
            class="color-preset"
            [style.background-color]="color"
            [class.selected]="color === currentColor"
            (click)="selectRecentColor(color)">
          </button>
        </div>
      </div>

      <!-- Accessibility Info -->
      <div class="accessibility-info">
        <div class="contrast-preview">
          <div class="contrast-sample dark-bg" [style.color]="currentColor">
            Text on dark background
          </div>
          <div class="contrast-sample light-bg" [style.color]="currentColor">
            Text on light background
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .color-picker-container {
      background: var(--cw-bg-input);
      border: 1px solid var(--cw-border-accent);
      border-radius: var(--cw-radius-lg);
      padding: var(--cw-space-xl);
      backdrop-filter: blur(var(--cw-blur-md));
    }

    .current-color-section {
      display: flex;
      gap: var(--cw-space-lg);
      margin-bottom: var(--cw-space-xl);
      align-items: center;
    }

    .color-preview {
      width: 80px;
      height: 80px;
      border-radius: var(--cw-radius-md);
      border: 2px solid var(--cw-border-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: var(--cw-font-size-2xl);
      font-weight: var(--cw-font-weight-bold);
      transition: all var(--cw-transition-slow);
      box-shadow: var(--cw-shadow-md);
    }

    .preview-text {
      text-shadow: var(--cw-shadow-text);
      display: flex;
      flex-direction: column;
      align-items: center;
      line-height: 1;
    }

    .preview-text small {
      font-size: 0.7em;
      margin-top: var(--cw-space-2xs);
    }

    .color-info {
      flex: 1;
    }

    .color-value {
      font-size: var(--cw-font-size-lg);
      font-weight: var(--cw-font-weight-medium);
      color: var(--cw-text-primary);
      margin-bottom: var(--cw-space-sm);
      font-family: 'Courier New', monospace;
    }

    .format-btn {
      background: var(--cw-bg-info-subtle);
      border: 1px solid var(--cw-border-accent);
      color: var(--cw-color-primary-light);
      padding: var(--cw-space-xs) var(--cw-space-md);
      border-radius: var(--cw-radius-sm);
      cursor: pointer;
      font-size: var(--cw-font-size-xs);
      transition: all var(--cw-transition-normal);
    }

    .format-btn:hover {
      background: var(--cw-bg-primary-hover);
      transform: translateY(-1px);
    }

    .preset-colors, .recent-colors {
      margin-bottom: var(--cw-space-xl);
    }

    h4 {
      color: var(--cw-text-muted);
      font-size: var(--cw-font-size-sm);
      margin-bottom: var(--cw-space-md);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .color-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
      gap: var(--cw-space-sm);
    }

    .color-preset {
      width: 40px;
      height: 40px;
      border-radius: var(--cw-radius-sm);
      border: 2px solid transparent;
      cursor: pointer;
      transition: all var(--cw-transition-normal);
      position: relative;
      background-clip: padding-box;
    }

    .color-preset:hover {
      transform: scale(1.1);
      border-color: var(--cw-border-primary);
      box-shadow: var(--cw-shadow-md);
    }

    .color-preset.selected {
      border-color: var(--cw-color-info);
      box-shadow: 0 0 0 3px var(--cw-bg-info-subtle);
    }

    .checkmark {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: var(--cw-text-primary);
      font-size: var(--cw-font-size-lg);
      font-weight: var(--cw-font-weight-bold);
      text-shadow: var(--cw-shadow-text);
    }

    .custom-color-section {
      margin-bottom: var(--cw-space-xl);
    }

    .color-controls {
      margin-bottom: var(--cw-space-lg);
    }

    .slider-group {
      margin-bottom: var(--cw-space-md);
    }

    .slider-group label {
      display: flex;
      align-items: center;
      gap: var(--cw-space-md);
    }

    .slider-label {
      color: var(--cw-text-muted);
      font-weight: var(--cw-font-weight-medium);
      width: 20px;
    }

    .color-slider {
      flex: 1;
      height: 6px;
      border-radius: var(--cw-radius-xs);
      outline: none;
      -webkit-appearance: none;
      appearance: none;
      cursor: pointer;
    }

    .color-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 16px;
      height: 16px;
      background: var(--cw-text-primary);
      border: 2px solid var(--cw-border-input);
      border-radius: var(--cw-radius-full);
      cursor: pointer;
      box-shadow: var(--cw-shadow-sm);
    }

    .color-slider::-moz-range-thumb {
      width: 16px;
      height: 16px;
      background: var(--cw-text-primary);
      border: 2px solid var(--cw-border-input);
      border-radius: var(--cw-radius-full);
      cursor: pointer;
      box-shadow: var(--cw-shadow-sm);
    }

    .slider-value {
      color: var(--cw-text-primary);
      font-family: 'Courier New', monospace;
      font-size: var(--cw-font-size-sm);
      min-width: 35px;
      text-align: right;
    }

    .hex-input-group {
      display: flex;
      gap: var(--cw-space-sm);
      margin-top: var(--cw-space-lg);
    }

    .hex-input {
      flex: 1;
      background: var(--cw-bg-base);
      border: 1px solid var(--cw-border-accent);
      color: var(--cw-text-primary);
      padding: var(--cw-space-sm) var(--cw-space-md);
      border-radius: var(--cw-radius-sm);
      font-family: 'Courier New', monospace;
      font-size: var(--cw-font-size-md);
    }

    .hex-input:focus {
      outline: none;
      border-color: var(--cw-color-info);
      box-shadow: 0 0 0 2px var(--cw-bg-info-subtle);
    }

    .copy-btn {
      background: var(--cw-bg-info-subtle);
      border: 1px solid var(--cw-border-accent);
      padding: var(--cw-space-sm) var(--cw-space-md);
      border-radius: var(--cw-radius-sm);
      cursor: pointer;
      transition: all var(--cw-transition-normal);
      font-size: var(--cw-font-size-md);
    }

    .copy-btn:hover {
      background: var(--cw-bg-primary-hover);
      transform: translateY(-1px);
    }

    .accessibility-info {
      margin-top: var(--cw-space-xl);
      padding-top: var(--cw-space-xl);
      border-top: 1px solid var(--cw-border-subtle);
    }

    .contrast-preview {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--cw-space-sm);
    }

    .contrast-sample {
      padding: var(--cw-space-md);
      border-radius: var(--cw-radius-sm);
      text-align: center;
      font-size: var(--cw-font-size-sm);
      font-weight: var(--cw-font-weight-medium);
      transition: color var(--cw-transition-slow);
    }

    .dark-bg {
      background: var(--cw-bg-base);
    }

    .light-bg {
      background: var(--cw-text-primary);
    }

    @media (max-width: 768px) {
      .color-picker-container {
        padding: var(--cw-space-lg);
      }

      .color-preview {
        width: 60px;
        height: 60px;
      }

      .color-grid {
        grid-template-columns: repeat(auto-fill, minmax(35px, 1fr));
      }

      .color-preset {
        width: 35px;
        height: 35px;
      }
    }
  `]
})
export class ColorPickerComponent implements OnInit {
  @Input() color = '#e0e0e0';
  @Output() colorChange = new EventEmitter<string>();

  currentColor = '#e0e0e0';
  hexInput = '#e0e0e0';
  colorFormat: 'hex' | 'rgb' = 'hex';
  recentColors: string[] = [];
  
  rgbValues = {
    r: 224,
    g: 224,
    b: 224
  };

  colorPresets: ColorPreset[] = [
    // Grautöne (für dunkle Themes)
    { name: 'Hellgrau', value: '#e0e0e0', contrast: 'dark' },
    { name: 'Silber', value: '#c0c0c0', contrast: 'dark' },
    { name: 'Mittelgrau', value: '#a0a0a0', contrast: 'dark' },
    { name: 'Dunkelgrau', value: '#808080', contrast: 'dark' },
    
    // Pastel colors (readable on dark background)
    { name: 'Pastellblau', value: '#a8c7ff', contrast: 'dark' },
    { name: 'Pastel Green', value: '#a8f0a8', contrast: 'dark' },
    { name: 'Pastellgelb', value: '#f0f0a8', contrast: 'dark' },
    { name: 'Pastellrosa', value: '#ffa8d0', contrast: 'dark' },
    { name: 'Pastelllila', value: '#d0a8ff', contrast: 'dark' },
    { name: 'Pastellorange', value: '#ffd0a8', contrast: 'dark' },
    
    // Kräftige Farben
    { name: 'Cyan', value: '#00ffff', contrast: 'dark' },
    { name: 'Magenta', value: '#ff00ff', contrast: 'dark' },
    { name: 'Gelb', value: '#ffff00', contrast: 'dark' },
    { name: 'White', value: '#ffffff', contrast: 'dark' },
    
    // Developer Colors
    { name: 'Terminal Green', value: '#00ff00', contrast: 'dark' },
    { name: 'Warning Orange', value: '#ff9800', contrast: 'dark' },
    { name: 'Error Red', value: '#ff5252', contrast: 'dark' },
    { name: 'Info Blau', value: '#2196f3', contrast: 'dark' }
  ];

  ngOnInit(): void {
    this.currentColor = this.color;
    this.hexInput = this.color;
    this.updateRgbFromHex(this.color);
    this.loadRecentColors();
  }

  selectPreset(preset: ColorPreset): void {
    this.currentColor = preset.value;
    this.hexInput = preset.value;
    this.updateRgbFromHex(preset.value);
    this.emitColorChange();
  }

  selectRecentColor(color: string): void {
    this.currentColor = color;
    this.hexInput = color;
    this.updateRgbFromHex(color);
    this.emitColorChange();
  }

  onRgbChange(): void {
    this.currentColor = this.rgbToHex(this.rgbValues.r, this.rgbValues.g, this.rgbValues.b);
    this.hexInput = this.currentColor;
    this.emitColorChange();
  }

  onHexChange(): void {
    if (this.isValidHex(this.hexInput)) {
      this.currentColor = this.hexInput;
      this.updateRgbFromHex(this.hexInput);
      this.emitColorChange();
    }
  }

  toggleFormat(): void {
    this.colorFormat = this.colorFormat === 'hex' ? 'rgb' : 'hex';
    if (this.colorFormat === 'rgb') {
      this.hexInput = `rgb(${this.rgbValues.r}, ${this.rgbValues.g}, ${this.rgbValues.b})`;
    } else {
      this.hexInput = this.currentColor;
    }
  }

  getColorDisplayValue(): string {
    if (this.colorFormat === 'rgb') {
      return `rgb(${this.rgbValues.r}, ${this.rgbValues.g}, ${this.rgbValues.b})`;
    }
    return this.currentColor;
  }

  copyToClipboard(): void {
    navigator.clipboard.writeText(this.currentColor).then(() => {
      // Could add a toast notification here
    });
  }

  private emitColorChange(): void {
    this.colorChange.emit(this.currentColor);
    this.addToRecentColors(this.currentColor);
  }

  private updateRgbFromHex(hex: string): void {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (result) {
      this.rgbValues = {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16)
      };
    }
  }

  private rgbToHex(r: number, g: number, b: number): string {
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  private isValidHex(hex: string): boolean {
    return /^#?[0-9A-F]{6}$/i.test(hex);
  }

  private loadRecentColors(): void {
    const saved = localStorage.getItem('creative-writer-recent-colors');
    if (saved) {
      this.recentColors = JSON.parse(saved);
    }
  }

  private addToRecentColors(color: string): void {
    // Remove if already exists
    this.recentColors = this.recentColors.filter(c => c !== color);
    // Add to beginning
    this.recentColors.unshift(color);
    // Keep only last 8 colors
    this.recentColors = this.recentColors.slice(0, 8);
    // Save to localStorage
    localStorage.setItem('creative-writer-recent-colors', JSON.stringify(this.recentColors));
  }

  getContrastColor(hexColor: string): string {
    // Calculate luminance to determine if black or white text is better
    const rgb = this.hexToRgb(hexColor);
    if (!rgb) return '#000000';
    
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return luminance > 0.5 ? '#000000' : '#ffffff';
  }

  private hexToRgb(hex: string): {r: number, g: number, b: number} | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16)
    } : null;
  }

  getRedSliderGradient(): string {
    return `linear-gradient(to right, rgb(0, ${this.rgbValues.g}, ${this.rgbValues.b}), rgb(255, ${this.rgbValues.g}, ${this.rgbValues.b}))`;
  }

  getGreenSliderGradient(): string {
    return `linear-gradient(to right, rgb(${this.rgbValues.r}, 0, ${this.rgbValues.b}), rgb(${this.rgbValues.r}, 255, ${this.rgbValues.b}))`;
  }

  getBlueSliderGradient(): string {
    return `linear-gradient(to right, rgb(${this.rgbValues.r}, ${this.rgbValues.g}, 0), rgb(${this.rgbValues.r}, ${this.rgbValues.g}, 255))`;
  }
}
