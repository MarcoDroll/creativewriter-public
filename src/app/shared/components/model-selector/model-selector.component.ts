import { Component, EventEmitter, Input, Output, OnInit, ChangeDetectionStrategy, ChangeDetectorRef, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { NgSelectModule } from '@ng-select/ng-select';
import { IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { starOutline, logoGoogle } from 'ionicons/icons';
import { ModelService } from '../../../core/services/model.service';
import { ModelOption } from '../../../core/models/model.interface';
import { SettingsService } from '../../../core/services/settings.service';
import { ProviderIconComponent } from '../provider-icon/provider-icon.component';

@Component({
  selector: 'app-model-selector',
  standalone: true,
  imports: [CommonModule, FormsModule, NgSelectModule, IonIcon, ProviderIconComponent],
  templateUrl: './model-selector.component.html',
  styleUrls: ['./model-selector.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ModelSelectorComponent implements OnInit {
  private modelService = inject(ModelService);
  private settingsService = inject(SettingsService);
  private cdr = inject(ChangeDetectorRef);

  constructor() {
    addIcons({ starOutline, logoGoogle });
  }

  @Input() placeholder = 'Select model...';
  @Input() clearable = false;
  @Input() searchable = true;
  @Input() appendTo = 'body'; // e.g., 'body'

  // Two-way bindable model id (provider-prefixed, e.g., 'openrouter:anthropic/claude-3-haiku')
  @Input() model = '';
  @Output() modelChange = new EventEmitter<string>();

  // Quick picks: array of model IDs to show as quick-select buttons
  @Input() quickPickIds: string[] = [];

  availableModels: ModelOption[] = [];
  quickPickModels: ModelOption[] = [];

  ngOnInit(): void {
    this.modelService.loadAllModels().subscribe(({ openRouter, gemini, ollama, claude, replicate, openAICompatible }) => {
      const enriched = [
        ...openRouter.map(m => ({ ...m, id: `openrouter:${m.id}` })),
        ...gemini.map(m => ({ ...m, id: `gemini:${m.id}` })),
        ...ollama.map(m => ({ ...m, id: `ollama:${m.id}` })),
        ...claude.map(m => ({ ...m, id: `claude:${m.id}` })),
        ...replicate.map(m => ({ ...m, id: `replicate:${m.id}` })),
        ...openAICompatible.map(m => ({ ...m, id: `openaiCompatible:${m.id}` })),
      ];
      this.availableModels = enriched;

      // Resolve quick pick IDs to full ModelOption objects
      this.quickPickModels = this.quickPickIds
        .map(id => this.availableModels.find(m => m.id === id))
        .filter((m): m is ModelOption => m !== undefined);

      // Initialize from settings if not set
      if (!this.model) {
        const settings = this.settingsService.getSettings();
        this.model = settings.selectedModel || enriched[0]?.id || '';
        this.modelChange.emit(this.model);
      }

      this.cdr.markForCheck();
    });
  }

  onModelChange(value: string): void {
    this.model = value;
    this.modelChange.emit(value);
  }

  selectQuickPick(model: ModelOption): void {
    this.model = model.id;
    this.modelChange.emit(model.id);
  }

}
