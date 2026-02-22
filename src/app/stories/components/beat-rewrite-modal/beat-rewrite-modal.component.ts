import { Component, Input, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonButtons,
  IonButton,
  IonIcon,
  IonContent,
  IonFooter,
  IonTextarea,
  ModalController
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { close, refreshOutline, documentTextOutline, bookmarkOutline } from 'ionicons/icons';

@Component({
  selector: 'app-beat-rewrite-modal',
  imports: [
    CommonModule,
    FormsModule,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonFooter,
    IonTextarea
  ],
  templateUrl: './beat-rewrite-modal.component.html',
  styleUrls: ['./beat-rewrite-modal.component.scss']
})
export class BeatRewriteModalComponent implements OnInit {
  @Input() beatId!: string;
  @Input() currentInstruction?: string;
  @Input() hasOriginalText = false;
  @Input() mode: 'rewrite' | 'polish' = 'rewrite';

  instruction = '';

  private readonly modalController = inject(ModalController);

  constructor() {
    addIcons({ close, refreshOutline, documentTextOutline, bookmarkOutline });
  }

  ngOnInit(): void {
    // Pre-populate with persisted instruction
    this.instruction = this.currentInstruction || '';
  }

  async rewriteCurrent(): Promise<void> {
    if (this.mode !== 'polish' && !this.instruction.trim()) return;
    await this.modalController.dismiss({
      action: 'rewrite-current',
      instruction: this.instruction.trim()
    });
  }

  async rewriteOriginal(): Promise<void> {
    if (this.mode !== 'polish' && !this.instruction.trim()) return;
    await this.modalController.dismiss({
      action: 'rewrite-original',
      instruction: this.instruction.trim()
    });
  }

  dismiss(): void {
    this.modalController.dismiss();
  }
}
