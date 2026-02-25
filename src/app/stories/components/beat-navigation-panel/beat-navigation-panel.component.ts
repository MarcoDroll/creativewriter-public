import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  ElementRef,
  HostListener,
  ViewChild,
  inject
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { IonIcon, IonButton } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline } from 'ionicons/icons';
import { Story } from '../../models/story.interface';

interface BeatItem {
  beatId: string;
  prompt: string;
  position: number;
  isGenerating: boolean;
  hasContent: boolean;
}

@Component({
  selector: 'app-beat-navigation-panel',
  standalone: true,
  imports: [CommonModule, IonIcon, IonButton],
  templateUrl: './beat-navigation-panel.component.html',
  styleUrls: ['./beat-navigation-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class BeatNavigationPanelComponent implements OnInit, OnChanges, OnDestroy {
  private cdr = inject(ChangeDetectorRef);
  private scrollStateAnimationFrame: number | null = null;

  @Input() isOpen = false;
  @Input() story: Story | null = null;
  @Input() activeSceneId: string | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() opened = new EventEmitter<void>();
  @Output() beatSelected = new EventEmitter<string>();
  @ViewChild('panelBody') panelBody?: ElementRef<HTMLDivElement>;

  beats: BeatItem[] = [];
  canScroll = false;
  atTop = true;
  atBottom = true;

  constructor() {
    addIcons({ closeOutline });
  }

  ngOnInit(): void {
    this.extractBeats();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen']) {
      if (this.isOpen) {
        this.scheduleScrollStateSync();
      } else {
        this.setScrollState(false, true, true);
      }
    }
  }

  ngOnDestroy(): void {
    if (this.scrollStateAnimationFrame !== null) {
      cancelAnimationFrame(this.scrollStateAnimationFrame);
      this.scrollStateAnimationFrame = null;
    }
  }

  @HostListener('window:resize')
  onWindowResize(): void {
    if (this.isOpen) {
      this.scheduleScrollStateSync();
    }
  }

  close(): void {
    this.closed.emit();
  }

  openPanel(event: Event): void {
    event.stopPropagation();
    this.opened.emit();
  }

  selectBeat(beatId: string): void {
    this.beatSelected.emit(beatId);
  }

  private extractBeats(): void {
    // This will be called to extract beats from the current scene's content
    // For now, we'll leave it empty and populate from parent component
    this.beats = [];
  }

  updateBeats(beats: BeatItem[]): void {
    this.beats = beats;
    this.scheduleScrollStateSync();
    this.cdr.markForCheck();
  }

  onPanelScroll(): void {
    this.updateScrollState();
  }

  getBeatPreview(prompt: string): string {
    const maxLength = 50;
    if (prompt.length <= maxLength) {
      return prompt;
    }
    return prompt.substring(0, maxLength) + '...';
  }

  // trackBy function for mobile performance
  trackByBeatId(index: number, beat: BeatItem): string {
    return beat.beatId;
  }

  private scheduleScrollStateSync(): void {
    if (this.scrollStateAnimationFrame !== null) {
      cancelAnimationFrame(this.scrollStateAnimationFrame);
    }

    this.scrollStateAnimationFrame = requestAnimationFrame(() => {
      this.scrollStateAnimationFrame = null;
      this.updateScrollState();
    });
  }

  private updateScrollState(): void {
    const panelBodyElement = this.panelBody?.nativeElement;
    if (!panelBodyElement) {
      this.setScrollState(false, true, true);
      return;
    }

    const canScroll = panelBodyElement.scrollHeight > panelBodyElement.clientHeight + 1;
    const atTop = panelBodyElement.scrollTop <= 1;
    const atBottom = panelBodyElement.scrollTop + panelBodyElement.clientHeight >= panelBodyElement.scrollHeight - 1;

    this.setScrollState(canScroll, atTop, atBottom);
  }

  private setScrollState(canScroll: boolean, atTop: boolean, atBottom: boolean): void {
    if (this.canScroll === canScroll && this.atTop === atTop && this.atBottom === atBottom) {
      return;
    }

    this.canScroll = canScroll;
    this.atTop = atTop;
    this.atBottom = atBottom;
    this.cdr.markForCheck();
  }
}
