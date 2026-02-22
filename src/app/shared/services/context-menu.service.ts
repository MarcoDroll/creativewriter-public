import { Injectable, inject } from '@angular/core';
import { EditorView } from 'prosemirror-view';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { ModalController } from '@ionic/angular/standalone';
import { Subject } from 'rxjs';
import { AIRewriteModalComponent, AIRewriteResult } from '../../ui/components/ai-rewrite-modal.component';
import { StoryContext, SurroundingContext } from './prosemirror-editor.interfaces';
import { hasEmptyParagraphs } from './prosemirror-editor.utils';
import { PremiumRewriteService } from './premium-rewrite.service';

@Injectable({
  providedIn: 'root'
})
export class ContextMenuService {
  private modalController = inject(ModalController);
  private premiumRewriteService = inject(PremiumRewriteService);
  private contextMenuElement: HTMLElement | null = null;

  public contentUpdate$ = new Subject<string>();

  /**
   * Create the context menu plugin
   */
  createContextMenuPlugin(
    getHTMLContent: () => string,
    getStoryContext: () => StoryContext | null
  ): Plugin {
    return new Plugin({
      key: new PluginKey('contextMenu'),
      props: {
        handleDOMEvents: {
          contextmenu: (view, event) => {
            event.preventDefault();
            this.showContextMenu(view, event, getHTMLContent, getStoryContext);
            return true;
          },
          click: () => {
            // Hide context menu on any click
            this.hideContextMenu();
            return false;
          }
        }
      }
    });
  }

  /**
   * Show context menu at the specified position
   */
  private showContextMenu(
    view: EditorView,
    event: MouseEvent,
    getHTMLContent: () => string,
    getStoryContext: () => StoryContext | null
  ): void {
    this.hideContextMenu(); // Remove any existing menu

    const { state } = view;
    const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });

    if (!pos) return;

    // Check if there's selected text
    const { from, to } = state.selection;
    const hasSelection = from !== to;
    const selectedText = hasSelection ? state.doc.textBetween(from, to) : '';

    // Check if there are empty paragraphs in the document
    const hasEmpty = hasEmptyParagraphs(state);

    // Don't show menu if no empty paragraphs and no selection
    if (!hasEmpty && !hasSelection) return;

    const menu = document.createElement('div');
    menu.className = 'prosemirror-context-menu';
    menu.style.cssText = `
      position: fixed;
      left: ${event.clientX}px;
      top: ${event.clientY}px;
      background: var(--cw-bg-elevated);
      border: 1px solid var(--cw-border-default);
      border-radius: var(--cw-radius-md);
      padding: 4px 0;
      z-index: var(--cw-z-popover);
      box-shadow: var(--cw-shadow-lg);
      backdrop-filter: blur(var(--cw-blur-md));
      -webkit-backdrop-filter: blur(var(--cw-blur-md));
      min-width: 180px;
      font-size: var(--cw-font-size-sm);
      color: var(--cw-text-secondary);
    `;

    // Add AI rewrite option if text is selected
    if (hasSelection && selectedText.trim()) {
      const menuLabel = this.premiumRewriteService.isPremium ? 'Rewrite with AI' : 'Rewrite with AI ★';
      const aiRewriteItem = this.createContextMenuItem(menuLabel, async () => {
        const hasAccess = await this.premiumRewriteService.checkAndGateAccess();
        if (hasAccess) {
          // Extract full scene text before and after the selection
          const beforeText = state.doc.textBetween(
            0,
            from,
            '\n\n',
            ''  // Explicitly ignore leaf nodes like images
          );
          const afterText = state.doc.textBetween(
            to,
            state.doc.content.size,
            '\n\n',
            ''  // Explicitly ignore leaf nodes like images
          );
          // Only pass context if we have actual content
          const surroundingContext: SurroundingContext | undefined =
            (beforeText || afterText) ? { beforeText, afterText } : undefined;
          this.openAIRewriteModal(view, selectedText, from, to, getHTMLContent, getStoryContext(), surroundingContext);
        }
        this.hideContextMenu();
      });
      menu.appendChild(aiRewriteItem);
    }

    // Add empty paragraphs removal option if empty paragraphs exist
    if (hasEmpty) {
      const removeEmptyItem = this.createContextMenuItem('Remove empty paragraphs', () => {
        this.removeEmptyParagraphs(view, getHTMLContent);
        this.hideContextMenu();
      });
      menu.appendChild(removeEmptyItem);
    }

    document.body.appendChild(menu);

    // Store reference for cleanup
    this.contextMenuElement = menu;

    // Position adjustment if menu goes off screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${event.clientX - rect.width}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${event.clientY - rect.height}px`;
    }
  }

  /**
   * Hide the context menu
   */
  hideContextMenu(): void {
    if (this.contextMenuElement && this.contextMenuElement.parentNode) {
      this.contextMenuElement.parentNode.removeChild(this.contextMenuElement);
      this.contextMenuElement = null;
    }
  }

  /**
   * Remove all empty paragraphs from the document
   */
  private removeEmptyParagraphs(view: EditorView, getHTMLContent: () => string): void {
    const { state } = view;
    const tr = state.tr;
    const toRemove: { from: number; to: number }[] = [];

    // Collect all empty paragraph positions
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.content.size === 0) {
        toRemove.push({ from: pos, to: pos + node.nodeSize });
      }
      return true;
    });

    // Remove empty paragraphs from end to beginning to maintain position validity
    toRemove.reverse().forEach(({ from, to }) => {
      tr.delete(from, to);
    });

    if (toRemove.length > 0) {
      view.dispatch(tr);

      // Emit content update to trigger save
      const content = getHTMLContent();
      this.contentUpdate$.next(content);
    }
  }

  /**
   * Create a context menu item element
   */
  private createContextMenuItem(text: string, onClick: () => void): HTMLElement {
    const menuItem = document.createElement('div');
    menuItem.className = 'context-menu-item';
    menuItem.textContent = text;
    menuItem.style.cssText = `
      padding: 6px 12px;
      cursor: pointer;
      transition: background-color 0.2s;
    `;

    menuItem.addEventListener('mouseenter', () => {
      menuItem.style.backgroundColor = 'var(--cw-bg-hover)';
    });

    menuItem.addEventListener('mouseleave', () => {
      menuItem.style.backgroundColor = 'transparent';
    });

    menuItem.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });

    return menuItem;
  }

  /**
   * Open the AI rewrite modal
   */
  async openAIRewriteModal(
    view: EditorView,
    selectedText: string,
    from: number,
    to: number,
    getHTMLContent: () => string,
    currentStoryContext: StoryContext | null,
    surroundingContext?: SurroundingContext
  ): Promise<void> {
    try {
      // Save current scroll position before opening modal
      const scrollElement = view.dom.closest('.content-editor') || view.dom.parentElement;
      const savedScrollTop = scrollElement?.scrollTop || 0;

      const modal = await this.modalController.create({
        component: AIRewriteModalComponent,
        componentProps: {
          selectedText,
          surroundingContext,
          storyId: currentStoryContext?.storyId || '',
          currentChapterId: currentStoryContext?.chapterId || '',
          currentSceneId: currentStoryContext?.sceneId || ''
        },
        cssClass: 'ai-rewrite-modal'
      });

      await modal.present();
      const { data } = await modal.onDidDismiss();

      if (data?.rewrittenText) {
        // Replace text with proper cursor positioning
        this.replaceSelectedText(view, data as AIRewriteResult, from, to, getHTMLContent);
      }

      // Always restore editor state after modal interaction
      this.restoreEditorState(view, scrollElement, savedScrollTop);
    } catch (error) {
      console.error('Error opening AI rewrite modal:', error);
    }
  }

  /**
   * Replace selected text with rewritten text
   */
  private replaceSelectedText(view: EditorView, result: AIRewriteResult, from: number, to: number, getHTMLContent: () => string): void {
    const { state } = view;
    const tr = state.tr;

    // Replace the selected text with the rewritten text
    tr.insertText(result.rewrittenText, from, to);

    // Set cursor position to end of replaced text to prevent jumping
    const newCursorPos = from + result.rewrittenText.length;
    tr.setSelection(TextSelection.create(tr.doc, newCursorPos));

    view.dispatch(tr);

    // Emit content update to trigger save
    const content = getHTMLContent();
    this.contentUpdate$.next(content);
  }

  /**
   * Restore editor scroll position and focus after modal interaction.
   */
  private restoreEditorState(view: EditorView, scrollElement: Element | null, savedScrollTop: number): void {
    requestAnimationFrame(() => {
      // Restore scroll position if available
      if (scrollElement) {
        scrollElement.scrollTop = savedScrollTop;
      }

      // Always restore focus, regardless of scroll restoration success
      view.focus();
    });
  }
}
