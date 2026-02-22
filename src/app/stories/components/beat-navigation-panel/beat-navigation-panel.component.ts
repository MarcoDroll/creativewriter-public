import { Component, Input, Output, EventEmitter, OnInit, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
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
export class BeatNavigationPanelComponent implements OnInit {
  private cdr = inject(ChangeDetectorRef);

  @Input() isOpen = false;
  @Input() story: Story | null = null;
  @Input() activeSceneId: string | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() opened = new EventEmitter<void>();
  @Output() beatSelected = new EventEmitter<string>();

  beats: BeatItem[] = [];

  constructor() {
    addIcons({ closeOutline });
  }

  ngOnInit(): void {
    this.extractBeats();
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
    this.cdr.markForCheck();
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
}
