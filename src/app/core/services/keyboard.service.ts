import { Injectable, OnDestroy, inject, NgZone } from '@angular/core';
import { BehaviorSubject, Observable, Subscription } from 'rxjs';
import { distinctUntilChanged, map } from 'rxjs/operators';
import { Platform } from '@ionic/angular';

/**
 * VirtualKeyboard API types (Chromium 94+)
 */
interface VirtualKeyboardAPI {
  overlaysContent: boolean;
  boundingRect: DOMRect;
  addEventListener(type: 'geometrychange', listener: () => void): void;
  removeEventListener(type: 'geometrychange', listener: () => void): void;
}

interface NavigatorWithVirtualKeyboard extends Navigator {
  virtualKeyboard: VirtualKeyboardAPI;
}

/**
 * Keyboard state interface
 */
export interface KeyboardState {
  visible: boolean;
  height: number;
}

/**
 * Scroll into view options
 */
export interface ScrollCursorOptions {
  targetPosition?: number; // 0-1, where to position cursor on screen (default 0.4)
}

/**
 * Shared KeyboardService for unified mobile keyboard handling.
 *
 * Provides reactive state management for keyboard visibility and height,
 * handling both VirtualKeyboard API (Chromium 94+) and Ionic Platform fallback.
 *
 * Features:
 * - Detects VirtualKeyboard API (Chromium 94+) or falls back to Ionic Platform events
 * - Exposes reactive keyboardState$, keyboardVisible$, keyboardHeight$ observables
 * - Manages `.keyboard-visible` class on document.body
 * - Manages `--keyboard-height` CSS variable on document.documentElement
 * - Provides scrollCursorIntoView() utility for scroll-to-cursor
 *
 * @example
 * ```typescript
 * private keyboardService = inject(KeyboardService);
 *
 * // Subscribe to keyboard state changes
 * this.keyboardService.keyboardState$.subscribe(state => {
 *   if (state.visible && state.height > 0) {
 *     this.scrollToActiveFocus();
 *   }
 * });
 *
 * // Or just visibility
 * this.keyboardService.keyboardVisible$.subscribe(visible => {
 *   if (visible) {
 *     this.onKeyboardShown();
 *   }
 * });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class KeyboardService implements OnDestroy {
  private platform = inject(Platform);
  private ngZone = inject(NgZone);

  // State management
  private readonly _keyboardState$ = new BehaviorSubject<KeyboardState>({ visible: false, height: 0 });

  // Public observables
  readonly keyboardState$: Observable<KeyboardState> = this._keyboardState$.asObservable();
  readonly keyboardVisible$: Observable<boolean> = this._keyboardState$.pipe(
    map(state => state.visible),
    distinctUntilChanged()
  );
  readonly keyboardHeight$: Observable<number> = this._keyboardState$.pipe(
    map(state => state.height),
    distinctUntilChanged()
  );

  // Initialization tracking
  private initialized = false;
  private subscriptions = new Subscription();

  // VirtualKeyboard API state
  private virtualKeyboard: VirtualKeyboardAPI | null = null;
  private boundVirtualKeyboardGeometryChange: (() => void) | null = null;

  // Cached mobile device detection
  private _isMobileDevice: boolean | null = null;

  constructor() {
    // Initialize keyboard handling when platform is ready
    this.initialize();
  }

  /**
   * Initialize keyboard handling after platform is ready.
   */
  private initialize(): void {
    if (this.initialized) return;

    // Wait for platform to be ready
    this.platform.ready().then(() => {
      this.ngZone.run(() => {
        this.setupKeyboardHandling();
        this.initialized = true;
      });
    }).catch((error) => {
      console.warn('KeyboardService: Platform ready failed, proceeding anyway', error);
      this.initialized = true;
    });
  }

  /**
   * Set up keyboard handling based on available APIs.
   * Uses VirtualKeyboard API for Chromium browsers (Android Chrome 94+)
   * or falls back to Ionic Platform keyboard events for Safari/Firefox.
   */
  private setupKeyboardHandling(): void {
    if (!this.isMobileDevice()) {
      // On desktop, keyboard handling is not needed
      return;
    }

    // Check for VirtualKeyboard API (Chromium browsers: Android Chrome 94+)
    if ('virtualKeyboard' in navigator) {
      this.setupVirtualKeyboardAPI();
      return;
    }

    // Fallback for Safari/Firefox: use Ionic Platform service
    this.setupIonicPlatformFallback();
  }

  /**
   * Set up VirtualKeyboard API handling (Chromium 94+).
   * CSS env(keyboard-inset-height) handles padding automatically.
   * We track geometry changes for keyboard state and scroll-to-cursor.
   */
  private setupVirtualKeyboardAPI(): void {
    this.virtualKeyboard = (navigator as NavigatorWithVirtualKeyboard).virtualKeyboard;

    if (!this.virtualKeyboard) return;

    // Note: Don't set overlaysContent = true. Let the browser handle viewport
    // adjustment natively to avoid scroll position resets during layout reflows.
    // We only track keyboard height for scroll-to-cursor functionality.

    // Listen for geometry changes
    this.boundVirtualKeyboardGeometryChange = () => {
      if (this.virtualKeyboard) {
        const newHeight = this.virtualKeyboard.boundingRect.height;
        const wasVisible = this._keyboardState$.value.visible;
        const isVisible = newHeight > 0;

        // Update state
        this.updateState({ visible: isVisible, height: newHeight });

        // Update CSS when visibility changes
        if (!wasVisible && isVisible) {
          // Keyboard just appeared
          this.setKeyboardVisibleCSS(true, newHeight);
        } else if (wasVisible && !isVisible) {
          // Keyboard just hidden
          this.setKeyboardVisibleCSS(false, 0);
        } else if (isVisible) {
          // Height changed while visible
          this.setKeyboardVisibleCSS(true, newHeight);
        }
      }
    };

    this.virtualKeyboard.addEventListener('geometrychange', this.boundVirtualKeyboardGeometryChange);
  }

  /**
   * Set up Ionic Platform fallback for Safari/Firefox.
   */
  private setupIonicPlatformFallback(): void {
    this.subscriptions.add(
      this.platform.keyboardDidShow.subscribe(event => {
        const height = event.keyboardHeight;
        this.updateState({ visible: true, height });
        this.setKeyboardVisibleCSS(true, height);
      })
    );

    this.subscriptions.add(
      this.platform.keyboardDidHide.subscribe(() => {
        this.updateState({ visible: false, height: 0 });
        this.setKeyboardVisibleCSS(false, 0);
      })
    );
  }

  /**
   * Update keyboard state
   */
  private updateState(newState: KeyboardState): void {
    const current = this._keyboardState$.value;
    if (current.visible !== newState.visible || current.height !== newState.height) {
      this._keyboardState$.next(newState);
    }
  }

  /**
   * Set CSS class on body and CSS variable for keyboard height.
   */
  private setKeyboardVisibleCSS(visible: boolean, height: number): void {
    if (visible) {
      document.body.classList.add('keyboard-visible');
      document.documentElement.style.setProperty('--keyboard-height', `${height}px`);
    } else {
      document.body.classList.remove('keyboard-visible');
      document.documentElement.style.removeProperty('--keyboard-height');
    }
  }

  /**
   * Check if the current device is mobile.
   * Result is cached since it won't change during session.
   */
  private isMobileDevice(): boolean {
    if (this._isMobileDevice === null) {
      this._isMobileDevice = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
             window.innerWidth <= 768;
    }
    return this._isMobileDevice;
  }

  /**
   * Get current keyboard state synchronously.
   */
  getState(): KeyboardState {
    return this._keyboardState$.value;
  }

  /**
   * Check if VirtualKeyboard API is supported.
   */
  isVirtualKeyboardSupported(): boolean {
    return 'virtualKeyboard' in navigator;
  }

  /**
   * Check if we're on a mobile device.
   */
  isMobile(): boolean {
    return this.isMobileDevice();
  }

  /**
   * Scroll cursor/element into view when keyboard is shown.
   *
   * @param coordsTop The top coordinate of the cursor/element
   * @param options Scroll options
   */
  scrollCursorIntoView(coordsTop: number, options: ScrollCursorOptions = {}): void {
    const state = this.getState();
    if (!state.visible || state.height === 0) return;

    const targetPosition = options.targetPosition ?? 0.4;
    const availableHeight = window.innerHeight - state.height;
    const targetY = availableHeight * targetPosition;

    if (coordsTop > targetY) {
      const scrollAmount = coordsTop - targetY;
      window.scrollBy(0, scrollAmount);
    }
  }

  ngOnDestroy(): void {
    // Clean up VirtualKeyboard API listener
    if (this.virtualKeyboard && this.boundVirtualKeyboardGeometryChange) {
      this.virtualKeyboard.removeEventListener('geometrychange', this.boundVirtualKeyboardGeometryChange);
      this.boundVirtualKeyboardGeometryChange = null;
      this.virtualKeyboard = null;
    }

    // Clean up Ionic subscriptions
    this.subscriptions.unsubscribe();

    // Clean up CSS
    this.setKeyboardVisibleCSS(false, 0);
  }
}
