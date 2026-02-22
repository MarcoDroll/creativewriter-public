import { Component, Input, Output, EventEmitter, ElementRef, ViewChild, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SlashCommand, SlashCommandAction, SlashCommandResult } from '../../models/slash-command.interface';

@Component({
  selector: 'app-slash-command-dropdown',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './slash-command-dropdown.component.html',
  styleUrls: ['./slash-command-dropdown.component.scss']
})
export class SlashCommandDropdownComponent implements OnInit, OnDestroy {
  @Input() position: { top: number; left: number } = { top: 0, left: 0 };
  @Input() cursorPosition = 0;
  @Output() commandSelected = new EventEmitter<SlashCommandResult>();
  @Output() dismissed = new EventEmitter<void>();
  
  @ViewChild('dropdown', { static: true }) dropdown!: ElementRef;
  
  selectedIndex = 0;
  private keyDownHandler: ((event: KeyboardEvent) => void) | null = null;
  private clickHandler: ((event: Event) => void) | null = null;
  
  commands: SlashCommand[] = [
    {
      id: 'beat',
      label: 'Beat',
      description: 'Insert an AI-generated beat',
      icon: '📝',
      action: SlashCommandAction.INSERT_BEAT
    },
    {
      id: 'image',
      label: 'Insert image',
      description: 'Add an image',
      icon: '🖼️',
      action: SlashCommandAction.INSERT_IMAGE
    }
  ];

  ngOnInit() {
    // Create bound handlers so we can properly remove them later
    this.keyDownHandler = this.handleKeyDown.bind(this);
    this.clickHandler = this.handleClickOutside.bind(this);
    
    // Listen for keyboard events
    document.addEventListener('keydown', this.keyDownHandler);
    document.addEventListener('click', this.clickHandler);
  }

  ngOnDestroy() {
    // Remove event listeners using the same handler references
    if (this.keyDownHandler) {
      document.removeEventListener('keydown', this.keyDownHandler);
    }
    if (this.clickHandler) {
      document.removeEventListener('click', this.clickHandler);
    }
  }

  trackCommand(index: number, command: SlashCommand): string {
    return command.id;
  }

  getCommandIndex(command: SlashCommand): number {
    return this.commands.findIndex(c => c.id === command.id);
  }

  selectCommand(command: SlashCommand): void {
    this.commandSelected.emit({
      action: command.action,
      position: this.cursorPosition,
      data: { command }
    });
    // Emit dismissed event to close the dropdown
    this.dismissed.emit();
  }

  private handleKeyDown(event: KeyboardEvent): void {
    // Only handle keys when dropdown is actually visible and focused
    if (!this.dropdown?.nativeElement) return;
    
    // Check if the dropdown is actually in the DOM
    if (!document.body.contains(this.dropdown.nativeElement)) return;
    
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        this.selectedIndex = Math.min(this.selectedIndex + 1, this.commands.length - 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        event.stopPropagation();
        this.selectedIndex = Math.max(this.selectedIndex - 1, 0);
        break;
      case 'Enter':
        event.preventDefault();
        event.stopPropagation();
        if (this.commands[this.selectedIndex]) {
          this.selectCommand(this.commands[this.selectedIndex]);
        }
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        this.dismissed.emit();
        break;
    }
  }

  private handleClickOutside(event: Event): void {
    if (this.dropdown && !this.dropdown.nativeElement.contains(event.target as Node)) {
      this.dismissed.emit();
    }
  }
}