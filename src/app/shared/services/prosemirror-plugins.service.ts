import { Injectable, inject } from '@angular/core';
import { Plugin, PluginKey, EditorState, Transaction } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Node as ProseMirrorNode } from 'prosemirror-model';
import { Subscription } from 'rxjs';
import { CodexService } from '../../stories/services/codex.service';
import { CodexEntry } from '../../stories/models/codex.interface';
import { createCodexHighlightingPlugin, updateCodexHighlightingPlugin } from './codex-highlighting-plugin';
import { createDirectSpeechHighlightingPlugin } from './direct-speech-highlighting-plugin';
import { createThinkingHighlightingPlugin } from './thinking-highlighting-plugin';
import { createQuoteNormalizationPlugin } from './quote-normalization-plugin';
import { EditorConfig, StoryContext } from './prosemirror-editor.interfaces';

/**
 * Callback for when an image is deleted from the document via editing.
 * Only called for actual deletions (backspace, delete key), NOT for editor destruction.
 * Can be async - the plugin handles errors internally.
 */
export type ImageDeletedCallback = (storyId: string, imageId: string) => void | Promise<void>;

@Injectable({
  providedIn: 'root'
})
export class ProseMirrorPluginsService {
  private codexService = inject(CodexService);

  // Track subscriptions and editor view references per story to prevent memory leaks
  private subscriptions = new Map<string, Subscription>();
  private editorViews = new Map<string, EditorView | null>();

  /**
   * Create Beat AI plugin (basic plugin for beat node support)
   */
  createBeatAIPlugin(): Plugin {
    return new Plugin({
      key: new PluginKey('beatAI'),
      state: {
        init: () => ({}),
        apply: (tr, value) => value
      }
    });
  }

  /**
   * Create codex highlighting plugin for the main editor
   */
  createCodexHighlightingPlugin(config: EditorConfig, editorView: EditorView | null): Plugin {
    // Get initial codex entries
    let codexEntries: CodexEntry[] = [];
    const storyId = config.storyContext?.storyId;

    if (storyId) {
      // Store initial editor view reference
      this.editorViews.set(storyId, editorView);

      // Clean up existing subscription if any (prevents duplicate subscriptions)
      this.cleanupCodexSubscription(storyId);

      // Create new subscription
      const subscription = this.codexService.codex$.subscribe(codexMap => {
        const codex = codexMap.get(storyId);
        if (codex) {
          codexEntries = this.extractAllCodexEntries(codex);
          // Always use latest editor view reference from the Map
          const currentView = this.editorViews.get(storyId);
          if (currentView) {
            updateCodexHighlightingPlugin(currentView, codexEntries);
          }
        }
      });

      this.subscriptions.set(storyId, subscription);
    }

    return createCodexHighlightingPlugin({
      codexEntries,
      storyId
    });
  }

  /**
   * Update the editor view reference for a story
   */
  updateEditorView(storyId: string, editorView: EditorView | null): void {
    this.editorViews.set(storyId, editorView);
  }

  /**
   * Clean up codex subscription and editor view reference for a story
   */
  cleanupCodexSubscription(storyId: string): void {
    const subscription = this.subscriptions.get(storyId);
    if (subscription) {
      subscription.unsubscribe();
      this.subscriptions.delete(storyId);
    }
    this.editorViews.delete(storyId);
  }

  /**
   * Create codex highlighting plugin for simple text editor
   */
  createCodexHighlightingPluginForSimpleEditor(storyContext?: StoryContext): Plugin {
    if (!storyContext?.storyId) {
      // Return empty plugin if no story context
      return createCodexHighlightingPlugin({ codexEntries: [] });
    }

    // Get initial codex entries synchronously
    const codex = this.codexService.getCodex(storyContext.storyId);
    let codexEntries: CodexEntry[] = [];

    if (codex) {
      codexEntries = this.extractAllCodexEntries(codex);
    }

    return createCodexHighlightingPlugin({
      codexEntries,
      storyId: storyContext.storyId
    });
  }

  /**
   * Extract all codex entries from a codex
   */
  private extractAllCodexEntries(codex: import('../../stories/models/codex.interface').Codex): CodexEntry[] {
    const entries: CodexEntry[] = [];

    if (codex.categories) {
      for (const category of codex.categories) {
        if (category.entries) {
          // Create deep copies of entries to prevent mutation
          const copiedEntries = category.entries.map(entry => ({
            ...entry,
            tags: entry.tags ? [...entry.tags] : []
          }));
          entries.push(...copiedEntries);
        }
      }
    }

    return entries;
  }

  /**
   * Create direct speech highlighting plugin
   */
  createDirectSpeechHighlightingPlugin(): Plugin {
    return createDirectSpeechHighlightingPlugin();
  }

  /**
   * Create thinking highlighting plugin for internal monologue (text in asterisks)
   */
  createThinkingHighlightingPlugin(): Plugin {
    return createThinkingHighlightingPlugin();
  }

  /**
   * Create quote normalization plugin
   * Converts curly quotes, German quotes, and guillemets to ASCII quotes
   */
  createQuoteNormalizationPlugin(): Plugin {
    return createQuoteNormalizationPlugin();
  }

  /**
   * Check for slash command in editor state
   */
  checkSlashCommand(state: EditorState, onSlashCommand?: (position: number) => void): void {
    const { selection } = state;
    const { from } = selection;

    // Get text before cursor (just 1 character)
    const textBefore = state.doc.textBetween(Math.max(0, from - 1), from);

    // Check if we just typed a slash
    if (textBefore === '/') {
      // Don't trigger if we're inside a beat AI node
      const nodeAtPos = state.doc.resolve(from).parent;
      const isInBeatNode = nodeAtPos.type.name === 'beatAI';

      if (!isInBeatNode) {
        onSlashCommand?.(from);
      }
    }
  }

  /**
   * Create image deletion tracking plugin.
   * Detects when image nodes are removed from the document via editing.
   * Only fires for actual deletions, NOT for editor destruction.
   */
  createImageDeletionTrackingPlugin(onImageDeleted: ImageDeletedCallback): Plugin {
    return new Plugin({
      key: new PluginKey('imageDeletionTracking'),
      appendTransaction: (transactions: readonly Transaction[], oldState: EditorState, newState: EditorState) => {
        // Only process if document changed
        const docChanged = transactions.some(tr => tr.docChanged);
        if (!docChanged) return null;

        // Collect images from old and new documents
        const oldImages = this.collectImagesFromDoc(oldState.doc);
        const newImages = this.collectImagesFromDoc(newState.doc);

        // Find images that were in old doc but not in new doc
        const deletedImages: { storyId: string; imageId: string }[] = [];

        for (const [imageId, storyId] of oldImages) {
          if (!newImages.has(imageId) && storyId) {
            deletedImages.push({ storyId, imageId });
          }
        }

        // Notify about deleted images
        for (const { storyId, imageId } of deletedImages) {
          // Use setTimeout to avoid calling during transaction processing
          // Wrap in try-catch to prevent unhandled rejections from affecting editor
          setTimeout(async () => {
            try {
              await onImageDeleted(storyId, imageId);
            } catch (error) {
              console.error(`Failed to delete image ${imageId} from story ${storyId}:`, error);
            }
          }, 0);
        }

        return null; // No additional transaction needed
      }
    });
  }

  /**
   * Collect all image IDs and their storyIds from a document.
   * Returns a Map of imageId -> storyId.
   */
  private collectImagesFromDoc(doc: ProseMirrorNode): Map<string, string | null> {
    const images = new Map<string, string | null>();

    doc.descendants((node: ProseMirrorNode) => {
      if (node.type.name === 'image') {
        const imageId = node.attrs['imageId'] as string | null;
        const storyId = node.attrs['storyId'] as string | null;
        if (imageId) {
          images.set(imageId, storyId);
        }
      }
      return true; // Continue traversing
    });

    return images;
  }
}
