import { Component, Input, Output, EventEmitter, TemplateRef, OnInit, ViewChild, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonicModule, IonPopover } from '@ionic/angular';
import { addIcons } from 'ionicons';
import { personCircleOutline } from 'ionicons/icons';
import { VersionService } from '../../core/services/version.service';
import { VersionTooltipComponent } from './version-tooltip.component';


export interface HeaderAction {
  icon: string;
  label?: string;
  color?: string;
  action: () => void;
  disabled?: boolean;
  showOnMobile?: boolean;
  showOnDesktop?: boolean;
  chipContent?: string;
  chipColor?: string;
  showVersionTooltip?: boolean;
  cssClass?: string;
  tooltip?: string;
}

export interface BurgerMenuItem {
  icon: string;
  label: string;
  action?: () => void;  // Optional for group headers
  color?: string;
  disabled?: boolean;
}

export interface BurgerMenuGroup {
  label?: string;           // Optional group label
  items: BurgerMenuItem[];
  collapsible?: boolean;    // For Developer Tools submenu
  icon?: string;            // Icon for collapsible header
  isExpanded?: boolean;     // Track expansion state
}

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, IonicModule, VersionTooltipComponent],
  template: `
    <ion-header>
      <ion-toolbar>
        <!-- Left Actions -->
        <ion-buttons slot="start">
          <ion-button *ngIf="showBackButton" (click)="handleBackAction()" title="Back" aria-label="Back">
            <ion-icon name="arrow-back" slot="icon-only"></ion-icon>
          </ion-button>
          
          <ng-container *ngFor="let action of leftActions">
            <ion-button 
              [class.desktop-only]="!action.showOnMobile"
              [class.mobile-only]="!action.showOnDesktop"
              [disabled]="action.disabled"
              [color]="action.color"
              [title]="action.tooltip || action.label"
              [attr.aria-label]="action.tooltip || action.label || action.icon"
              (click)="action.action()">
              <ion-icon [name]="action.icon" slot="icon-only"></ion-icon>
            </ion-button>
          </ng-container>
        </ion-buttons>

        <!-- Title -->
        <ion-title>
          <ng-container *ngIf="titleTemplate; else staticTitle">
            <ng-container *ngTemplateOutlet="titleTemplate"></ng-container>
          </ng-container>
          <ng-template #staticTitle>
            <div class="title-content">
              <img *ngIf="logoSrc" [src]="logoSrc" alt="Logo" class="header-logo">
              <span class="app-title">{{ title }}</span>
            </div>
          </ng-template>
        </ion-title>

        <!-- Right Actions -->
        <ion-buttons slot="end">
          <!-- User Info (Desktop Only) -->
          <div class="desktop-only user-info" *ngIf="showUserInfo && userGreeting">
            <div class="header-badge user-badge">
              <ion-icon name="person-circle-outline"></ion-icon>
              <span class="badge-text">{{ userGreeting }}</span>
            </div>
            <ng-content select="[slot=user-status]"></ng-content>
          </div>

          <!-- Action Buttons -->
          <ng-container *ngFor="let action of rightActions">
            <ion-button 
              *ngIf="!action.chipContent"
              [class.desktop-only]="!action.showOnMobile"
              [class.mobile-only]="!action.showOnDesktop"
              [class]="action.cssClass"
              [disabled]="action.disabled"
              [color]="action.color"
              [title]="action.tooltip || action.label"
              [attr.aria-label]="action.tooltip || action.label || action.icon"
              (click)="action.action()">
              <ion-icon [name]="action.icon" slot="start" *ngIf="action.label"></ion-icon>
              <ion-icon [name]="action.icon" slot="icon-only" *ngIf="!action.label && action.icon"></ion-icon>
              <span *ngIf="action.label">{{ action.label }}</span>
            </ion-button>
          </ng-container>

          <!-- Status Chips -->
          <ng-container *ngFor="let action of rightActions">
            <app-version-tooltip *ngIf="action.chipContent && action.showVersionTooltip">
              <ion-chip
                [class.desktop-only]="!action.showOnMobile"
                [class.mobile-only]="!action.showOnDesktop"
                [title]="action.tooltip || action.chipContent"
                [attr.aria-label]="action.tooltip || action.chipContent || action.label || action.icon"
                (click)="action.action()"
                class="header-badge-chip">
                <ion-icon [name]="action.icon" *ngIf="action.icon"></ion-icon>
                <ion-label>{{ action.chipContent }}</ion-label>
              </ion-chip>
            </app-version-tooltip>

            <ion-chip
              *ngIf="action.chipContent && !action.showVersionTooltip"
              [class.desktop-only]="!action.showOnMobile"
              [class.mobile-only]="!action.showOnDesktop"
              [title]="action.tooltip || action.chipContent"
              [attr.aria-label]="action.tooltip || action.chipContent || action.label || action.icon"
              (click)="action.action()"
              class="header-badge-chip">
              <ion-icon [name]="action.icon" *ngIf="action.icon"></ion-icon>
              <ion-label>{{ action.chipContent }}</ion-label>
            </ion-chip>
          </ng-container>

          <!-- Burger Menu Button -->
          <ion-button
            *ngIf="showBurgerMenu"
            id="burger-menu-trigger"
            aria-label="Open navigation menu"
            aria-haspopup="menu"
            aria-controls="burger-menu-popover"
            [title]="burgerMenuTitle || 'Navigation menu'"
            [attr.aria-expanded]="isBurgerMenuOpen">
            <ion-icon name="menu" slot="icon-only" aria-hidden="true"></ion-icon>
          </ion-button>
        </ion-buttons>
      </ion-toolbar>

      <!-- Secondary Toolbar -->
      <ion-toolbar *ngIf="showSecondaryToolbar && secondaryContent">
        <ng-container *ngTemplateOutlet="secondaryContent"></ng-container>
      </ion-toolbar>
    </ion-header>

    <!-- Burger Menu Popover -->
    <ion-popover
      #burgerMenuPopover
      id="burger-menu-popover"
      *ngIf="showBurgerMenu"
      trigger="burger-menu-trigger"
      triggerAction="click"
      side="bottom"
      alignment="end"
      [dismissOnSelect]="false"
      [showBackdrop]="true"
      [keepContentsMounted]="false"
      (ionPopoverWillPresent)="onBurgerMenuWillPresent()"
      (ionPopoverWillDismiss)="onBurgerMenuWillDismiss()"
      (keydown)="onPopoverKeydown($event)">
      <ng-template>
        <ion-content>
          <div class="popover-header" *ngIf="burgerMenuTitle">
            <h3>{{ burgerMenuTitle || 'Navigation' }}</h3>
          </div>

          <ion-list lines="none" role="menu" aria-label="Navigation menu">
            <ng-container *ngFor="let group of displayGroups; let groupIndex = index">
              <!-- Group Separator -->
              <div class="menu-separator" *ngIf="groupIndex > 0" role="separator"></div>

              <!-- Collapsible Group Header -->
              <ion-item
                *ngIf="group.collapsible && group.label"
                button
                (click)="toggleGroup(group)"
                role="menuitem"
                class="group-header"
                [attr.aria-expanded]="group.isExpanded"
                [attr.aria-label]="group.label + ' submenu'">
                <ion-icon [name]="group.icon || 'code-slash-outline'" slot="start" color="medium" aria-hidden="true"></ion-icon>
                <ion-label>{{ group.label }}</ion-label>
                <ion-icon [name]="group.isExpanded ? 'chevron-down' : 'chevron-forward'" slot="end" class="expand-icon" aria-hidden="true"></ion-icon>
              </ion-item>

              <!-- Non-collapsible Group Label -->
              <div class="menu-group-label" *ngIf="!group.collapsible && group.label">
                <span>{{ group.label }}</span>
              </div>

              <!-- Group Items -->
              <ng-container *ngIf="!group.collapsible || group.isExpanded">
                <ion-item
                  [button]="!item.disabled"
                  *ngFor="let item of group.items"
                  (click)="!item.disabled && item.action && handleBurgerMenuAction(item.action)"
                  role="menuitem"
                  [class.submenu-item]="group.collapsible"
                  [class.disabled]="item.disabled"
                  [attr.aria-label]="item.label"
                  [attr.aria-disabled]="item.disabled || null">
                  <ion-icon [name]="item.icon" slot="start" [color]="item.disabled ? 'medium' : (item.color || 'medium')" aria-hidden="true"></ion-icon>
                  <ion-label>{{ item.label }}</ion-label>
                </ion-item>
              </ng-container>
            </ng-container>
          </ion-list>

          <!-- Burger Menu Footer Content -->
          <div class="popover-footer" *ngIf="burgerMenuFooterContent">
            <ng-container *ngTemplateOutlet="burgerMenuFooterContent"></ng-container>
          </div>
        </ion-content>
      </ng-template>
    </ion-popover>
  `,
  styles: [`
    /* Base Header Styling */
    ion-header {
      backdrop-filter: blur(var(--cw-blur-lg));
      background: var(--cw-bg-elevated);
      box-shadow: var(--cw-shadow-md);
      position: sticky;
      top: 0;
      z-index: var(--cw-z-sticky);
      border-bottom: 1px solid var(--cw-border-subtle);
    }

    /* Mobile header height fix for scroll calculation */
    @media (max-width: 768px) {
      ion-header {
        height: auto;
        min-height: 56px;
      }
    }

    ion-toolbar {
      --background: transparent;
      --color: var(--cw-text-primary);
      --padding-start: var(--cw-space-lg);
      --padding-end: var(--cw-space-lg);
    }

    /* Title Styling */
    ion-title {
      overflow: visible !important;
      padding: 0 !important;
      position: relative;
      flex: 1;
      text-align: center;
    }

    .title-content {
      display: flex;
      align-items: center;
      gap: var(--cw-space-md);
      justify-content: center;
      overflow: visible;
      min-width: max-content;
      padding: 0 var(--cw-space-lg);
    }

    .header-logo {
      width: 48px;
      height: 48px;
      object-fit: contain;
      filter: drop-shadow(var(--cw-shadow-sm));
      flex-shrink: 0;
    }

    .app-title {
      background: var(--cw-gradient-text-brand);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      font-size: var(--cw-font-size-2xl);
      font-weight: var(--cw-font-weight-bold);
      letter-spacing: 0.5px;
      text-shadow: var(--cw-shadow-primary-glow);
    }

    /* Button Styling */
    ion-button {
      --color: var(--cw-text-primary);
      --background: var(--cw-bg-button-ghost);
      --background-hover: var(--cw-bg-button-ghost-hover);
      --border-radius: var(--cw-radius-md);
      margin: 0 var(--cw-space-xs);
      transition: all var(--cw-transition-normal);
    }

    ion-button:hover {
      transform: translateY(-1px);
      box-shadow: var(--cw-shadow-md);
    }

    ion-icon {
      font-size: var(--cw-font-size-lg);
    }

    /* User Info - Combined selector ensures flex layout on desktop while allowing mobile hide */
    .desktop-only.user-info {
      display: flex;  /* Override .desktop-only { display: block } on desktop only */
      align-items: center;
      gap: var(--cw-space-sm);
      margin-right: var(--cw-space-md);
    }

    /* Unified Header Badge Base Styles */
    .header-badge {
      display: flex;
      align-items: center;
      gap: var(--cw-space-xs);
      padding: var(--cw-space-xs) var(--cw-space-sm);
      border-radius: var(--cw-radius-sm);
      font-size: var(--cw-font-size-xs);
      font-weight: var(--cw-font-weight-medium);
      line-height: var(--cw-line-height-tight);
      transition: background-color var(--cw-transition-normal),
                  border-color var(--cw-transition-normal);
      white-space: nowrap;
      height: 28px;
      box-sizing: border-box;
    }

    .header-badge ion-icon {
      font-size: var(--cw-font-size-sm);
      flex-shrink: 0;
    }

    .header-badge .badge-text {
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100px;
    }

    /* User Badge - Info/Primary color */
    .user-badge {
      background-color: var(--cw-bg-info-subtle);
      color: var(--cw-color-primary-light);
      border: 1px solid var(--cw-border-accent);
    }

    /* Version Chip - Override ion-chip to match badge style */
    ion-chip.header-badge-chip {
      --background: var(--cw-bg-hover);
      --color: var(--cw-text-secondary);
      height: 28px;
      font-size: var(--cw-font-size-xs);
      font-weight: var(--cw-font-weight-medium);
      margin: 0;
      border: 1px solid var(--cw-border-subtle);
      border-radius: var(--cw-radius-sm);
    }

    ion-chip.header-badge-chip ion-icon {
      font-size: var(--cw-font-size-sm);
      margin-right: var(--cw-space-xs);
    }

    ion-chip.header-badge-chip ion-label {
      margin: 0;
    }

    /* Responsive Classes */
    .desktop-only {
      display: block;
    }

    .mobile-only {
      display: none;
    }

    @media (max-width: 768px) {
      .desktop-only {
        display: none;
      }

      .desktop-only.user-info {
        display: none;  /* Explicit override needed due to combined selector specificity */
      }

      .mobile-only {
        display: block;
      }

      .app-title {
        font-size: var(--cw-font-size-lg);
      }
    }

    /* Popover Styles */
    ion-popover {
      --backdrop-opacity: 0.6;
      --box-shadow: var(--cw-shadow-xl);
      --width: 280px;
      --max-width: 90vw;
    }

    ion-popover::part(content) {
      background: var(--cw-bg-glass);
      backdrop-filter: blur(var(--cw-blur-xl));
      -webkit-backdrop-filter: blur(var(--cw-blur-xl));
      border: 1px solid var(--cw-border-accent);
      border-radius: var(--cw-radius-lg);
    }

    ion-popover ion-content {
      --background: transparent;
      --color: var(--cw-text-primary);
    }

    ion-popover ion-list {
      background: transparent;
      padding: var(--cw-space-sm) 0;
    }

    ion-popover ion-item {
      --background: var(--cw-bg-hover);
      --background-hover: var(--cw-bg-info-subtle);
      --background-activated: var(--cw-bg-primary-hover);
      --color: var(--cw-text-primary);
      --ripple-color: var(--cw-border-accent);
      margin: 0 var(--cw-space-md) var(--cw-space-sm) var(--cw-space-md);
      --border-radius: var(--cw-radius-md);
      border: 1px solid var(--cw-border-accent);
      transition: background-color var(--cw-transition-normal), border-color var(--cw-transition-normal);
    }

    ion-popover ion-item:hover {
      --background: var(--cw-bg-info-subtle);
      border-color: var(--cw-border-accent);
    }

    ion-popover ion-item:focus-visible {
      outline: 2px solid var(--cw-color-primary-light);
      outline-offset: 2px;
      --background: var(--cw-bg-primary-hover);
    }

    ion-popover ion-item ion-label {
      font-weight: var(--cw-font-weight-medium);
    }

    /* Ensure ion-icon colors apply correctly */
    ion-popover ion-item ion-icon {
      color: var(--ion-color-base, inherit);
    }

    ion-popover ion-item ion-icon[color="primary"] {
      color: var(--ion-color-primary);
    }

    ion-popover ion-item ion-icon[color="secondary"] {
      color: var(--ion-color-secondary);
    }

    ion-popover ion-item ion-icon[color="tertiary"] {
      color: var(--ion-color-tertiary);
    }

    ion-popover ion-item ion-icon[color="success"] {
      color: var(--ion-color-success);
    }

    ion-popover ion-item ion-icon[color="warning"] {
      color: var(--ion-color-warning);
    }

    ion-popover ion-item ion-icon[color="danger"] {
      color: var(--ion-color-danger);
    }

    ion-popover ion-item ion-icon[color="medium"] {
      color: var(--ion-color-medium);
    }

    /* Menu separator between groups */
    .menu-separator {
      height: 1px;
      background: linear-gradient(90deg, transparent 10%, var(--cw-border-accent) 50%, transparent 90%);
      margin: var(--cw-space-sm) var(--cw-space-lg);
    }

    /* Non-collapsible group label */
    .menu-group-label {
      padding: var(--cw-space-sm) var(--cw-space-xl) var(--cw-space-xs);
      font-size: var(--cw-font-size-xs);
      font-weight: var(--cw-font-weight-semibold);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--cw-color-primary-light);
    }

    /* Collapsible group header */
    ion-popover ion-item.group-header {
      --background: var(--cw-bg-hover);
      font-weight: var(--cw-font-weight-medium);
    }

    ion-popover ion-item.group-header .expand-icon {
      font-size: var(--cw-font-size-sm);
      color: var(--cw-text-muted);
    }

    /* Submenu items - slightly indented */
    ion-popover ion-item.submenu-item {
      margin-left: var(--cw-space-xl);
      font-size: 0.95em;
    }

    /* Disabled menu items */
    ion-popover ion-item.disabled {
      opacity: 0.5;
      cursor: not-allowed;
      pointer-events: none;
    }

    .popover-header {
      padding: var(--cw-space-lg) var(--cw-space-xl) var(--cw-space-md) var(--cw-space-xl);
      border-bottom: 1px solid var(--cw-border-accent);
      background: var(--cw-bg-glass);
      backdrop-filter: blur(var(--cw-blur-xl));
      -webkit-backdrop-filter: blur(var(--cw-blur-xl));
      position: relative;
    }

    .popover-header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--cw-gradient-primary-subtle);
      z-index: -1;
    }

    .popover-header h3 {
      margin: 0;
      color: var(--cw-text-primary);
      font-size: var(--cw-font-size-md);
      font-weight: var(--cw-font-weight-semibold);
      letter-spacing: 0.3px;
      background: var(--cw-gradient-text-accent);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .popover-footer {
      border-top: 1px solid var(--cw-border-accent);
      padding: var(--cw-space-md) var(--cw-space-xl);
      background: var(--cw-bg-glass);
      position: relative;
    }

    .popover-footer::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--cw-gradient-primary-subtle);
      z-index: -1;
    }

    /* Clickable chips */
    .clickable-chip {
      cursor: pointer;
      transition: all var(--cw-transition-normal);
    }

    .clickable-chip:hover {
      transform: translateY(-1px);
      box-shadow: var(--cw-shadow-md);
      --background: var(--cw-bg-button-ghost-hover);
    }

    /* Popover Footer Styles */
    .popover-footer ion-chip {
      font-size: var(--cw-font-size-xs);
      margin: var(--cw-space-xs) 0;
    }

    .popover-footer .status-detail {
      display: flex;
      gap: var(--cw-space-sm);
      flex-wrap: wrap;
      align-items: center;
    }

    @media (min-width: 768px) {
      ion-header {
        box-shadow: var(--cw-shadow-lg);
      }

      ion-toolbar {
        --min-height: 44px;
        --padding-top: var(--cw-space-xs);
        --padding-bottom: var(--cw-space-xs);
      }
    }
  `]
})
export class AppHeaderComponent implements OnInit {
  versionService = inject(VersionService);

  @ViewChild('burgerMenuPopover') burgerMenuPopover?: IonPopover;
  
  @Input() title = '';
  @Input() titleTemplate?: TemplateRef<unknown>;
  @Input() logoSrc?: string;
  @Input() showBackButton = false;
  @Input() backAction?: () => void;
  @Input() leftActions: HeaderAction[] = [];
  @Input() rightActions: HeaderAction[] = [];
  @Input() showBurgerMenu = false;
  @Input() burgerMenuTitle = 'Navigation';
  @Input() burgerMenuItems: BurgerMenuItem[] = [];
  @Input() burgerMenuGroups?: BurgerMenuGroup[];  // New grouped format
  @Input() burgerMenuFooterContent?: TemplateRef<unknown>;
  @Input() showSecondaryToolbar = false;
  @Input() secondaryContent?: TemplateRef<unknown>;
  @Input() showUserInfo = false;
  @Input() userGreeting = '';

  @Output() burgerMenuToggle = new EventEmitter<boolean>();

  public isBurgerMenuOpen = false;

  constructor() {
    addIcons({ personCircleOutline });
  }

  // Computed property for backward compatibility
  get displayGroups(): BurgerMenuGroup[] {
    if (this.burgerMenuGroups && this.burgerMenuGroups.length > 0) {
      return this.burgerMenuGroups;
    }
    // Wrap legacy burgerMenuItems in a single group
    if (this.burgerMenuItems && this.burgerMenuItems.length > 0) {
      return [{ items: this.burgerMenuItems }];
    }
    return [];
  }

  ngOnInit(): void {
    // Initialize header component - version service loads automatically
    this.isBurgerMenuOpen = false;
  }

  handleBackAction(): void {
    if (this.backAction) {
      this.backAction();
    } else {
      // Default back navigation
      window.history.back();
    }
  }

  handleBurgerMenuAction(action: () => void): void {
    action();
    // Close the popover programmatically
    if (this.burgerMenuPopover) {
      this.burgerMenuPopover.dismiss();
    }
    // Emit that burger menu was used (for any parent components that need to know)
    this.burgerMenuToggle.emit(false);
  }

  onBurgerMenuWillPresent(): void {
    this.isBurgerMenuOpen = true;
    // Auto-focus first menu item after popover opens
    setTimeout(() => this.focusFirstItem(), 100);
  }

  onBurgerMenuWillDismiss(): void {
    this.isBurgerMenuOpen = false;
  }

  toggleGroup(group: BurgerMenuGroup): void {
    group.isExpanded = !group.isExpanded;
  }

  onPopoverKeydown(event: KeyboardEvent): void {
    switch (event.key) {
      case 'ArrowDown':
        this.focusNextItem();
        event.preventDefault();
        break;
      case 'ArrowUp':
        this.focusPreviousItem();
        event.preventDefault();
        break;
      case 'Home':
        this.focusFirstItem();
        event.preventDefault();
        break;
      case 'End':
        this.focusLastItem();
        event.preventDefault();
        break;
      case 'Escape':
        this.burgerMenuPopover?.dismiss();
        event.preventDefault();
        break;
    }
  }

  private focusNextItem(): void {
    const items = this.getVisibleMenuItems();
    const currentIndex = this.getCurrentFocusIndex(items);
    // Find next non-disabled item
    for (let i = currentIndex + 1; i < items.length; i++) {
      if (!items[i].getAttribute('aria-disabled')) {
        items[i].focus();
        return;
      }
    }
  }

  private focusPreviousItem(): void {
    const items = this.getVisibleMenuItems();
    const currentIndex = this.getCurrentFocusIndex(items);
    // Find previous non-disabled item
    for (let i = currentIndex - 1; i >= 0; i--) {
      if (!items[i].getAttribute('aria-disabled')) {
        items[i].focus();
        return;
      }
    }
  }

  private focusFirstItem(): void {
    const items = this.getVisibleMenuItems();
    // Find first non-disabled item
    for (const item of items) {
      if (!item.getAttribute('aria-disabled')) {
        item.focus();
        return;
      }
    }
  }

  private focusLastItem(): void {
    const items = this.getVisibleMenuItems();
    // Find last non-disabled item
    for (let i = items.length - 1; i >= 0; i--) {
      if (!items[i].getAttribute('aria-disabled')) {
        items[i].focus();
        return;
      }
    }
  }

  private getVisibleMenuItems(): HTMLElement[] {
    const popoverContent = document.querySelector('ion-popover ion-content');
    if (!popoverContent) return [];
    return Array.from(popoverContent.querySelectorAll('ion-item[button]')) as HTMLElement[];
  }

  private getCurrentFocusIndex(items: HTMLElement[]): number {
    const activeElement = document.activeElement;
    return items.findIndex(item => item === activeElement || item.contains(activeElement));
  }
}
