import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * Auto-growing textarea component using CSS Grid mirroring technique.
 * Works reliably on Android Chrome where Ionic's autoGrow fails.
 *
 * Based on: https://css-tricks.com/the-cleanest-trick-for-autogrowing-textareas/
 */
@Component({
  selector: 'app-autogrow-textarea',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './autogrow-textarea.component.html',
  styleUrls: ['./autogrow-textarea.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AutogrowTextareaComponent {
  @Input() value: string | undefined = '';
  @Input() placeholder = '';
  @Input() minHeight = '60px';
  @Input() maxHeight = '50vh';
  @Input() disabled = false;
  @Input() readonly = false;
  @Input() ariaLabel?: string;
  @Input() ariaLabelledBy?: string;
  @Output() valueChange = new EventEmitter<string>();

  /** Get value as string for display, treating undefined as empty */
  get displayValue(): string {
    return this.value ?? '';
  }

  /**
   * Get value for the CSS mirror element.
   * Adds newline to ensure trailing line breaks expand the container.
   */
  get mirrorValue(): string {
    return (this.value ?? '') + '\n';
  }

  onInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    this.valueChange.emit(textarea.value);
  }
}
