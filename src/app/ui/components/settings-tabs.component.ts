import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IonSegment, IonSegmentButton, IonIcon, IonLabel } from '@ionic/angular/standalone';

export interface TabItem {
  value: string;
  icon: string;
  label: string;
}

@Component({
  selector: 'app-settings-tabs',
  standalone: true,
  imports: [
    CommonModule, FormsModule,
    IonSegment, IonSegmentButton, IonIcon, IonLabel
  ],
  template: `
    <div class="settings-tabs-container">
      <ion-segment 
        [ngModel]="selectedTab" 
        (ngModelChange)="onTabChange($event)"
        mode="md" 
        [scrollable]="true"
        class="settings-tabs">
        <ion-segment-button 
          *ngFor="let tab of tabs" 
          [value]="tab.value">
          <ion-icon [name]="tab.icon"></ion-icon>
          <ion-label>{{ tab.label }}</ion-label>
        </ion-segment-button>
      </ion-segment>
    </div>
  `,
  styles: [`
    /* Tab Navigation Styles - Compact */
    .settings-tabs-container {
      position: sticky;
      top: 0;
      z-index: 10;
      width: 100%;
      overflow-x: auto;
      background: var(--cw-bg-elevated);
      backdrop-filter: blur(var(--cw-blur-lg));
      -webkit-backdrop-filter: blur(var(--cw-blur-lg));
      border-bottom: 1px solid var(--cw-border-subtle);
      box-shadow: var(--cw-shadow-md);
      padding: 0.125rem;
      margin-bottom: 0.375rem;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }

    .settings-tabs-container::-webkit-scrollbar {
      display: none;
    }

    .settings-tabs {
      display: inline-flex;
      gap: var(--cw-space-xs);
      min-width: 100%;
      width: max-content;
      flex-wrap: nowrap;
    }

    ion-segment {
      --background: transparent;
    }

    ion-segment-button {
      --background: transparent;
      --background-checked: var(--cw-gradient-primary-subtle);
      --color: var(--cw-text-primary);
      --color-checked: var(--cw-text-primary);
      --indicator-color: var(--cw-gradient-primary);
      --indicator-height: 2px;
      --border-radius: var(--cw-radius-sm);
      padding: 0.125rem var(--cw-space-xs);
      min-height: 28px;
      flex: 0 0 auto;
      transition: all var(--cw-transition-normal);
      border: 1px solid transparent;
      opacity: 0.8;
    }

    ion-segment-button:hover {
      --background: var(--cw-bg-hover);
      opacity: 1;
      transform: translateY(-1px);
    }

    ion-segment-button.segment-button-checked {
      border-color: var(--cw-border-accent);
      background: var(--cw-gradient-primary-subtle);
      opacity: 1;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
    }

    ion-segment-button ion-icon {
      font-size: 0.95rem;
      margin-bottom: 0;
      color: inherit;
    }

    ion-segment-button ion-label {
      font-size: var(--cw-font-size-2xs);
      font-weight: var(--cw-font-weight-medium);
      letter-spacing: 0.2px;
      color: inherit;
    }

    ion-segment-button.segment-button-checked ion-icon,
    ion-segment-button.segment-button-checked ion-label {
      color: var(--cw-text-primary);
    }

    @media (max-width: 768px) {
      .settings-tabs-container {
        padding: 0.125rem;
        margin-bottom: 0.25rem;
      }

      .settings-tabs {
        gap: 0.125rem;
      }

      ion-segment-button {
        padding: 0.125rem;
        min-height: 24px;
        min-width: 80px;
      }

      ion-segment-button ion-icon {
        font-size: 0.85rem;
      }

      ion-segment-button ion-label {
        font-size: 0.6rem;
      }
    }
  `]
})
export class SettingsTabsComponent {
  @Input() tabs: TabItem[] = [];
  @Input() selectedTab = '';
  @Output() selectedTabChange = new EventEmitter<string>();

  onTabChange(value: string): void {
    this.selectedTab = value;
    this.selectedTabChange.emit(value);
  }
}
