import { Injectable, Injector, ApplicationRef, EnvironmentInjector, inject } from '@angular/core';
import { EditorState, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Schema } from 'prosemirror-model';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, chainCommands, newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock } from 'prosemirror-commands';
import { history, undo, redo } from 'prosemirror-history';
import { Subject, merge } from 'rxjs';
import { IonContent } from '@ionic/angular/standalone';
import { BeatAINodeView } from './beat-ai-nodeview';
import { ResizableImageNodeView } from './resizable-image-nodeview';
import { BeatAI, BeatAIPromptEvent } from '../../stories/models/beat-ai.interface';
import { ImageInsertResult } from '../../ui/components/image-upload-dialog.component';
import { EditorConfig, SimpleEditorConfig, StoryContext, BeatInfo } from './prosemirror-editor.interfaces';

// Import all sub-services
import { ProseMirrorSchemaService } from './prosemirror-schema.service';
import { SelectionHighlightService } from './selection-highlight.service';
import { ContextMenuService } from './context-menu.service';
import { DebugUtilityService } from './debug-utility.service';
import { EditorStateService } from './editor-state.service';
import { ProseMirrorContentService } from './prosemirror-content.service';
import { ProseMirrorPluginsService } from './prosemirror-plugins.service';
import { BeatOperationsService } from './beat-operations.service';
import { StoryImageService } from './story-image.service';

// Re-export interfaces for backward compatibility
export type { EditorConfig, SimpleEditorConfig } from './prosemirror-editor.interfaces';

@Injectable({
  providedIn: 'root'
})
export class ProseMirrorEditorService {
  // Angular dependencies
  private injector = inject(Injector);
  private appRef = inject(ApplicationRef);
  private envInjector = inject(EnvironmentInjector);

  // Sub-services
  private schemaService = inject(ProseMirrorSchemaService);
  private selectionHighlightService = inject(SelectionHighlightService);
  private contextMenuService = inject(ContextMenuService);
  private debugService = inject(DebugUtilityService);
  private editorStateService = inject(EditorStateService);
  private contentService = inject(ProseMirrorContentService);
  private pluginsService = inject(ProseMirrorPluginsService);
  private beatOpsService = inject(BeatOperationsService);
  private storyImageService = inject(StoryImageService);

  // Editor state
  private editorView: EditorView | null = null;
  private editorSchema: Schema;
  private currentStoryContext: StoryContext = {};
  private isEditorLocked = false;

  // Public subjects - merge from sub-services
  public contentUpdate$ = new Subject<string>();
  public slashCommand$ = new Subject<number>();

  constructor() {
    this.editorSchema = this.schemaService.getEditorSchema();

    // Merge content updates from sub-services
    merge(
      this.contextMenuService.contentUpdate$,
      this.beatOpsService.contentUpdate$
    ).subscribe(content => this.contentUpdate$.next(content));
  }

  /**
   * Create the main editor with full features
   */
  createEditor(element: HTMLElement, config: EditorConfig = {}): EditorView {
    // Store initial story context
    if (config.storyContext) {
      this.currentStoryContext = config.storyContext;
    }

    const plugins = [
      // Limit history depth to prevent unbounded memory growth on mobile
      // Reduced from 100 to 20 - each state stores full doc copy
      history({ depth: 20, newGroupDelay: 500 }),
      keymap({
        'Mod-z': undo,
        'Mod-y': redo,
        'Mod-Shift-z': redo,
        'Enter': chainCommands(newlineInCode, createParagraphNear, liftEmptyBlock, splitBlock)
      }),
      keymap(baseKeymap),
      this.pluginsService.createQuoteNormalizationPlugin(), // Normalize quotes before other plugins process them
      this.pluginsService.createBeatAIPlugin(),
      this.pluginsService.createCodexHighlightingPlugin(config, null), // Will update with editorView after creation
      this.pluginsService.createDirectSpeechHighlightingPlugin(),
      this.pluginsService.createThinkingHighlightingPlugin(),
      this.contextMenuService.createContextMenuPlugin(
        () => this.getHTMLContent(),
        () => this.currentStoryContext
      ),
      this.selectionHighlightService.createFlashHighlightPlugin(),
      // Track image deletions via transactions - only fires for actual deletions, not editor destruction
      this.pluginsService.createImageDeletionTrackingPlugin(
        (storyId: string, imageId: string) => {
          this.storyImageService.onImageRemovedFromContent(storyId, imageId);
        }
      )
    ];

    const state = EditorState.create({
      schema: this.editorSchema,
      plugins
    });

    this.editorView = new EditorView(element, {
      state,
      editable: () => !this.isEditorLocked,
      nodeViews: {
        beatAI: (node, view, getPos) => new BeatAINodeView(
          node,
          view,
          getPos as () => number,
          this.injector,
          this.appRef,
          this.envInjector,
          (event: BeatAIPromptEvent) => {
            config.onBeatPromptSubmit?.(event);
          },
          (beatData: BeatAI) => {
            config.onBeatContentUpdate?.(beatData);
          },
          () => {
            config.onBeatFocus?.();
          },
          this.currentStoryContext
        ),
        // Image deletion is tracked via plugin (createImageDeletionTrackingPlugin)
        // to avoid triggering on editor destruction
        image: (node, view, getPos) => new ResizableImageNodeView(
          node,
          view,
          getPos as () => number,
          this.storyImageService  // Pass service for blob URL resolution
        )
      },
      dispatchTransaction: (transaction: Transaction) => {
        const newState = this.editorView!.state.apply(transaction);
        this.editorView!.updateState(newState);

        // Emit content updates with lazy evaluation
        if (transaction.docChanged) {
          config.onUpdate?.('__content_changed__');
        }

        // Check for slash command
        if (transaction.docChanged || transaction.selection) {
          this.checkSlashCommand(newState, config.onSlashCommand);
        }
      },
      attributes: {
        class: 'prosemirror-editor',
        spellcheck: 'false'
      }
    });

    // Update the codex plugin's editor view reference (NOT create new plugin)
    if (config.storyContext?.storyId) {
      this.pluginsService.updateEditorView(config.storyContext.storyId, this.editorView);
    }

    // Set placeholder if provided
    if (config.placeholder) {
      this.setPlaceholder(config.placeholder);
    }

    // Apply debug mode if enabled
    if (config.debugMode) {
      setTimeout(() => this.toggleDebugMode(true), 100);
    }

    return this.editorView;
  }

  /**
   * Create a simple text editor (no beats, images, etc.)
   */
  createSimpleTextEditor(element: HTMLElement, config: SimpleEditorConfig = {}): EditorView {
    const simpleSchema = this.schemaService.getSimpleSchema();

    // Create initial document with empty paragraph
    const initialDoc = simpleSchema.nodes['doc'].create({}, [
      simpleSchema.nodes['paragraph'].create({}, [])
    ]);

    const plugins = this.contentService.createSimpleEditorPlugins(simpleSchema, config.placeholder || 'Enter text...');

    // Add codex awareness plugin
    plugins.push(this.pluginsService.createCodexHighlightingPluginForSimpleEditor(config.storyContext));

    const state = EditorState.create({
      doc: initialDoc,
      schema: simpleSchema,
      plugins
    });

    // Store reference to service for use in callback
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const editorService = this;
    const editorView = new EditorView(element, {
      state,
      dispatchTransaction: function(this: EditorView, transaction) {
        const newState = this.state.apply(transaction);
        this.updateState(newState);

        // Call update callback if provided
        if (config.onUpdate) {
          const content = editorService.getSimpleTextContent(this);
          config.onUpdate(content);
        }
      },
      attributes: {
        class: 'prosemirror-editor simple-text-editor',
        spellcheck: 'false'
      },
      handleDOMEvents: {
        mousedown: (view: EditorView, event: MouseEvent) => {
          event.stopPropagation();
          return false;
        },
        touchstart: (view: EditorView, event: TouchEvent) => {
          event.stopPropagation();
          return false;
        },
        focus: (view: EditorView, event: FocusEvent) => {
          event.stopPropagation();
          return false;
        }
      }
    });

    // Set placeholder if provided
    if (config.placeholder) {
      const editorElement = editorView.dom as HTMLElement;
      editorElement.setAttribute('data-placeholder', config.placeholder);
    }

    return editorView;
  }

  // ===== Content Operations =====

  getHTMLContent(): string {
    return this.contentService.getHTMLContent(this.editorView, this.editorSchema);
  }

  getTextContent(): string {
    return this.contentService.getTextContent(this.editorView);
  }

  setContent(content: string): void {
    this.contentService.setContent(this.editorView, this.editorSchema, content);
  }

  insertContent(content: string, position?: number, replaceSlash = false): void {
    this.contentService.insertContent(this.editorView, this.editorSchema, content, position, replaceSlash);
  }

  removeSlashAtPosition(position: number): void {
    this.contentService.removeSlashAtPosition(this.editorView, position);
  }

  getSimpleTextContent(editorView: EditorView): string {
    return this.contentService.getSimpleTextContent(editorView);
  }

  setSimpleContent(editorView: EditorView, content: string): void {
    this.contentService.setSimpleContent(editorView, content);
  }

  /**
   * Append streaming text to the end of the document.
   * Used for real-time AI content streaming into the editor.
   *
   * @param text The text chunk to append
   */
  appendStreamingText(text: string): void {
    if (!this.editorView || !text) return;

    const { state } = this.editorView;
    // Find the correct insertion point: end of the last text block content
    // ProseMirror positions account for node boundaries, so we need to insert
    // before the closing tag of the last block (size - 1)
    const endPos = state.doc.content.size - 1;

    // Insert text at the end of the document and scroll to show it
    const tr = state.tr.insertText(text, endPos).scrollIntoView();
    this.editorView.dispatch(tr);
  }

  // ===== Beat Operations =====

  insertBeatAI(position?: number, replaceSlash = false, beatType: 'story' | 'scene' = 'story'): void {
    this.beatOpsService.insertBeatAI(this.editorView, this.editorSchema, position, replaceSlash, beatType);
  }

  handleBeatPromptSubmit(event: BeatAIPromptEvent): void {
    this.beatOpsService.handleBeatPromptSubmit(this.editorView, event, () => this.getHTMLContent());
  }

  getTextAfterBeat(beatId: string): string | null {
    return this.beatOpsService.getTextAfterBeat(this.editorView, beatId);
  }

  deleteContentAfterBeat(beatId: string): boolean {
    return this.beatOpsService.deleteContentAfterBeat(this.editorView, beatId, () => this.getHTMLContent());
  }

  /**
   * Delete only the generated content between a beat and its end marker.
   * Preserves any pre-existing text that was pushed down when the beat was inserted.
   * Falls back to deleteContentAfterBeat if no marker exists (backward compatibility).
   */
  deleteGeneratedContentOnly(beatId: string): boolean {
    return this.beatOpsService.deleteGeneratedContentOnly(this.editorView, beatId, () => this.getHTMLContent());
  }

  async switchBeatVersion(beatId: string, versionId: string): Promise<void> {
    return this.beatOpsService.switchBeatVersion(this.editorView, beatId, versionId, () => this.getHTMLContent());
  }

  extractBeatsFromEditor(): BeatInfo[] {
    return this.beatOpsService.extractBeatsFromEditor(this.editorView);
  }

  async scrollToBeat(beatId: string, ionContent?: IonContent): Promise<void> {
    return this.beatOpsService.scrollToBeat(beatId, ionContent);
  }

  // ===== Image Operations =====

  /**
   * Insert an image into the editor
   */
  insertImage(imageData: ImageInsertResult, position?: number, replaceSlash = false): void {
    if (!this.editorView) return;

    try {
      const { state } = this.editorView;
      const pos = position ?? state.selection.from;

      // Create image node with optional imageId and storyId
      const imageNode = this.editorSchema.nodes['image'].create({
        src: imageData.url,
        alt: imageData.alt,
        title: imageData.title || null,
        imageId: imageData.imageId || null,
        storyId: imageData.storyId || null
      });

      let tr;
      if (replaceSlash) {
        // Find the actual slash position by looking backwards from cursor position
        let slashPos = pos - 1;
        let foundSlash = false;

        // Look backwards up to 10 characters to find the slash
        for (let i = 1; i <= 10 && slashPos >= 0; i++) {
          const checkPos = pos - i;
          const textAtCheck = state.doc.textBetween(checkPos, checkPos + 1);

          if (textAtCheck === '/') {
            slashPos = checkPos;
            foundSlash = true;
            break;
          }
        }

        if (foundSlash) {
          // Replace the slash with the image node
          tr = state.tr.replaceRangeWith(slashPos, slashPos + 1, imageNode);
        } else {
          console.warn('No slash found, inserting at current position');
          tr = state.tr.replaceRangeWith(pos, pos, imageNode);
        }
      } else {
        // Insert at position
        tr = state.tr.replaceRangeWith(pos, pos, imageNode);
      }

      this.editorView.dispatch(tr);
    } catch (error) {
      console.error('Failed to insert image:', error);
    }
  }

  /**
   * Update the image ID and optionally storyId for an existing image in the document
   */
  updateImageId(imageSrc: string, imageId: string, storyId?: string): void {
    if (!this.editorView) return;

    const { state, dispatch } = this.editorView;
    const { doc, tr } = state;

    // Find all image nodes with matching src
    let updated = false;
    doc.descendants((node, pos) => {
      if (node.type.name === 'image' && node.attrs['src'] === imageSrc) {
        // Update the image node with the new imageId and storyId
        const newAttrs: Record<string, unknown> = {
          ...node.attrs,
          imageId: imageId
        };
        if (storyId) {
          newAttrs['storyId'] = storyId;
        }
        tr.setNodeMarkup(pos, null, newAttrs);
        updated = true;
      }
    });

    if (updated) {
      dispatch(tr);
      console.log('Updated image ID in ProseMirror document:', imageId);
    }
  }

  requestImageInsert(): void {
    // Placeholder for slash command integration
  }

  // ===== Selection & Highlighting =====

  selectFirstMatchOf(phrase: string): boolean {
    if (!this.editorView) return false;
    return this.selectionHighlightService.selectFirstMatchOf(this.editorView, phrase);
  }

  flashSelection(durationMs = 1600): void {
    if (!this.editorView) return;
    this.selectionHighlightService.flashSelection(this.editorView, durationMs);
  }

  flashRange(from: number, to: number, durationMs = 1600): void {
    if (!this.editorView) return;
    this.selectionHighlightService.flashRange(this.editorView, from, to, durationMs);
  }

  // ===== Editor State Management =====

  focus(): void {
    if (this.editorView) {
      this.editorView.focus();
    }
  }

  registerBeatNodeView(nodeView: BeatAINodeView): void {
    this.editorStateService.registerBeatNodeView(nodeView);
  }

  unregisterBeatNodeView(nodeView: BeatAINodeView): void {
    this.editorStateService.unregisterBeatNodeView(nodeView);
  }

  updateStoryContext(storyContext: StoryContext): void {
    this.currentStoryContext = storyContext;
    this.editorStateService.updateStoryContext(storyContext);
  }

  /**
   * Lock/unlock the editor to prevent user input during AI generation.
   * Note: Programmatic updates via dispatch() still work when locked.
   */
  setEditorLocked(locked: boolean): void {
    this.isEditorLocked = locked;
    if (this.editorView) {
      this.editorView.setProps({
        editable: () => !this.isEditorLocked
      });
    }
  }

  destroy(): void {
    // Reset lock state for next editor instance (singleton service persists)
    this.isEditorLocked = false;
    this.contextMenuService.hideContextMenu();

    // Cleanup codex subscription to prevent memory leaks and stale callbacks
    if (this.currentStoryContext?.storyId) {
      this.pluginsService.cleanupCodexSubscription(this.currentStoryContext.storyId);
    }

    if (this.editorView) {
      this.editorStateService.cleanupEditorView(this.editorView);
      this.editorView.destroy();
      this.editorView = null;
    }
    this.editorStateService.clearBeatNodeViews();
  }

  destroySimpleEditor(editorView: EditorView): void {
    if (!editorView) return;
    this.editorStateService.cleanupEditorView(editorView);
    editorView.destroy();
  }

  // ===== Debug Mode =====

  toggleDebugMode(enabled: boolean): void {
    this.debugService.toggleDebugMode(this.editorView, enabled);
  }

  // ===== Private Helpers =====

  private setPlaceholder(placeholder: string): void {
    if (!this.editorView) return;
    const editorElement = this.editorView.dom as HTMLElement;
    editorElement.setAttribute('data-placeholder', placeholder);
  }

  private checkSlashCommand(state: EditorState, onSlashCommand?: (position: number) => void): void {
    this.pluginsService.checkSlashCommand(state, (position) => {
      this.slashCommand$.next(position);
      onSlashCommand?.(position);
    });
  }
}
