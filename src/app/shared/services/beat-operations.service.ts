import { Injectable, inject } from '@angular/core';
import { EditorView } from 'prosemirror-view';
import { Schema, DOMParser, Node as ProseMirrorNode } from 'prosemirror-model';
import { Subject } from 'rxjs';
import { IonContent } from '@ionic/angular/standalone';
import { BeatAI, BeatAIPromptEvent } from '../../stories/models/beat-ai.interface';
import { BeatAIService } from './beat-ai.service';
import { BeatHistoryService } from './beat-history.service';
import { PromptManagerService } from './prompt-manager.service';
import { BeatInfo } from './prosemirror-editor.interfaces';
import { findNextBeatPosition, convertTextToHtml } from './prosemirror-editor.utils';

@Injectable({
  providedIn: 'root'
})
export class BeatOperationsService {
  private beatAIService = inject(BeatAIService);
  private beatHistoryService = inject(BeatHistoryService);
  private promptManager = inject(PromptManagerService);

  private beatStreamingPositions = new Map<string, number>();

  public contentUpdate$ = new Subject<string>();

  /**
   * Insert a new Beat AI node at the specified position
   */
  insertBeatAI(
    editorView: EditorView | null,
    schema: Schema,
    position?: number,
    replaceSlash = false,
    beatType: 'story' | 'scene' = 'story'
  ): void {
    if (!editorView) return;

    try {
      const { state } = editorView;
      const pos = position ?? state.selection.from;

      const beatData = this.beatAIService.createNewBeat(beatType);
      const beatNode = schema.nodes['beatAI'].create({
        id: beatData.id,
        prompt: beatData.prompt,
        generatedContent: beatData.generatedContent,
        isGenerating: beatData.isGenerating,
        isCollapsed: beatData.isCollapsed,
        createdAt: beatData.createdAt.toISOString(),
        updatedAt: beatData.updatedAt.toISOString(),
        wordCount: beatData.wordCount,
        beatType: beatData.beatType,
        model: beatData.model || '',
        includeStoryOutline: beatData.includeStoryOutline
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
          // Replace the slash with the beat node
          tr = state.tr.replaceRangeWith(slashPos, slashPos + 1, beatNode);
        } else {
          console.warn('No slash found, inserting at current position');
          tr = state.tr.replaceRangeWith(pos, pos, beatNode);
        }
      } else {
        // Insert at position
        tr = state.tr.replaceRangeWith(pos, pos, beatNode);
      }

      editorView.dispatch(tr);
    } catch (error) {
      console.error('Failed to insert Beat AI node:', error);
    }
  }

  /**
   * Update beat node attributes
   */
  updateBeatNode(editorView: EditorView | null, beatId: string, updates: Partial<BeatAI>): void {
    if (!editorView) return;

    const { state } = editorView;
    let nodePos: number | null = null;
    let targetNode: ProseMirrorNode | null = null;

    // Find the beat node with the given ID
    state.doc.descendants((node, pos) => {
      if (node.type.name === 'beatAI' && node.attrs['id'] === beatId) {
        nodePos = pos;
        targetNode = node;
        return false; // Stop iteration
      }
      return true;
    });

    if (nodePos !== null && targetNode) {
      const newAttrs = {
        ...(targetNode as ProseMirrorNode).attrs,
        ...updates,
        updatedAt: new Date().toISOString()
      };

      const tr = state.tr.setNodeMarkup(nodePos, undefined, newAttrs);
      editorView.dispatch(tr);
    }
  }

  /**
   * Find the position of a beat node by ID
   */
  findBeatNodePosition(editorView: EditorView | null, beatId: string): number | null {
    if (!editorView) return null;

    const { state } = editorView;
    let nodePos: number | null = null;

    state.doc.descendants((node, pos) => {
      if (node.type.name === 'beatAI' && node.attrs['id'] === beatId) {
        nodePos = pos;
        return false; // Stop iteration
      }
      return true;
    });

    return nodePos;
  }

  /**
   * Find the position of a beat end marker by beat ID
   */
  findBeatEndMarkerPosition(editorView: EditorView | null, beatId: string): number | null {
    if (!editorView) return null;

    const { state } = editorView;
    let markerPos: number | null = null;

    state.doc.descendants((node, pos) => {
      if (node.type.name === 'beatEndMarker' && node.attrs['beatId'] === beatId) {
        markerPos = pos;
        return false; // Stop iteration
      }
      return true;
    });

    return markerPos;
  }

  /**
   * Insert a beat end marker at the specified position
   * Returns the position where the marker was inserted
   */
  private insertBeatEndMarker(editorView: EditorView, beatId: string, position: number): void {
    const markerNode = editorView.state.schema.nodes['beatEndMarker'].create({ beatId });
    const tr = editorView.state.tr.insert(position, markerNode);
    editorView.dispatch(tr);
  }

  /**
   * Delete only the generated content between a beat and its end marker
   * Falls back to deleteContentAfterBeat if no marker exists (backward compatibility)
   */
  deleteGeneratedContentOnly(editorView: EditorView | null, beatId: string, getHTMLContent: () => string): boolean {
    if (!editorView) return false;

    const beatPos = this.findBeatNodePosition(editorView, beatId);
    if (beatPos === null) return false;

    const { state } = editorView;
    const beatNode = state.doc.nodeAt(beatPos);
    if (!beatNode) return false;

    const deleteStartPos = beatPos + beatNode.nodeSize;

    // Try to find the marker for this beat
    const markerPos = this.findBeatEndMarkerPosition(editorView, beatId);

    // If no marker exists, fall back to old behavior (delete to next beat)
    if (markerPos === null) {
      return this.deleteContentAfterBeat(editorView, beatId, getHTMLContent);
    }

    // Delete only up to the marker (not including the marker itself)
    if (markerPos <= deleteStartPos) {
      return false;
    }

    const tr = state.tr.delete(deleteStartPos, markerPos);
    editorView.dispatch(tr);

    const content = getHTMLContent();
    this.contentUpdate$.next(content);

    // Refresh prompt manager after the deletion
    setTimeout(() => {
      this.promptManager.refresh().catch(error => {
        console.error('Error refreshing prompt manager:', error);
      });
    }, 500);

    return true;
  }

  /**
   * Get the text content only up to the beat end marker (generated content only)
   * Falls back to getTextAfterBeat if no marker exists (backward compatibility)
   */
  getGeneratedTextOnly(editorView: EditorView | null, beatId: string): string | null {
    if (!editorView) return null;

    const beatPos = this.findBeatNodePosition(editorView, beatId);
    if (beatPos === null) return null;

    const { state } = editorView;
    const beatNode = state.doc.nodeAt(beatPos);
    if (!beatNode) return null;

    const contentStartPos = beatPos + beatNode.nodeSize;
    const markerPos = this.findBeatEndMarkerPosition(editorView, beatId);

    // If no marker, fall back to next beat behavior (legacy documents)
    if (markerPos === null) {
      console.debug(`[BeatOperations] No end marker found for beat ${beatId}, using legacy text extraction`);
      return this.getTextAfterBeat(editorView, beatId);
    }

    if (markerPos <= contentStartPos) {
      return '';
    }

    return state.doc.textBetween(contentStartPos, markerPos, '\n\n', '\n');
  }

  /**
   * Get the text content between a beat and the next beat (or end of scene)
   */
  getTextAfterBeat(editorView: EditorView | null, beatId: string): string | null {
    if (!editorView) return null;

    const beatPos = this.findBeatNodePosition(editorView, beatId);
    if (beatPos === null) return null;

    const { state } = editorView;
    const beatNode = state.doc.nodeAt(beatPos);
    if (!beatNode) return null;

    const contentStartPos = beatPos + beatNode.nodeSize;
    const nextBeatPos = findNextBeatPosition(contentStartPos, state);
    const contentEndPos = nextBeatPos ?? state.doc.content.size;

    if (contentEndPos <= contentStartPos) {
      return '';
    }

    // Extract text content between the beat and next beat
    const textContent = state.doc.textBetween(contentStartPos, contentEndPos, '\n\n', '\n');

    return textContent;
  }

  /**
   * Delete content after a beat node
   */
  deleteContentAfterBeat(editorView: EditorView | null, beatId: string, getHTMLContent: () => string): boolean {
    if (!editorView) return false;

    const beatPos = this.findBeatNodePosition(editorView, beatId);
    if (beatPos === null) return false;

    const { state } = editorView;
    const beatNode = state.doc.nodeAt(beatPos);
    if (!beatNode) return false;

    const deleteStartPos = beatPos + beatNode.nodeSize;
    const nextBeatPos = findNextBeatPosition(deleteStartPos, state);
    const deleteEndPos = nextBeatPos ?? state.doc.content.size;

    if (deleteEndPos <= deleteStartPos) {
      return false;
    }

    const tr = state.tr.delete(deleteStartPos, deleteEndPos);
    editorView.dispatch(tr);

    const content = getHTMLContent();
    this.contentUpdate$.next(content);

    // Refresh prompt manager after the deletion so context stays accurate
    setTimeout(() => {
      this.promptManager.refresh().catch(error => {
        console.error('Error refreshing prompt manager:', error);
      });
    }, 500);

    return true;
  }

  /**
   * Handle beat prompt submission and generation
   */
  handleBeatPromptSubmit(
    editorView: EditorView | null,
    event: BeatAIPromptEvent,
    getHTMLContent: () => string
  ): void {
    if (!editorView) return;

    // Handle delete after beat action
    if (event.action === 'deleteAfter') {
      // Save content to history BEFORE deleting so it can be recovered
      // Use getGeneratedTextOnly to only save what will actually be deleted
      if (event.storyId) {
        const contentToDelete = this.getGeneratedTextOnly(editorView, event.beatId);
        if (contentToDelete && contentToDelete.trim().length > 0) {
          const beatPos = this.findBeatNodePosition(editorView, event.beatId);
          const beatNode = beatPos !== null ? editorView.state.doc.nodeAt(beatPos) : null;

          this.savePreviousContentToHistory(
            event.beatId,
            event.storyId,
            contentToDelete,
            event.beatType || 'story',
            {
              prompt: beatNode?.attrs['prompt'] || undefined,
              model: beatNode?.attrs['model'] || undefined,
              stagingNotes: beatNode?.attrs['stagingNotes'] || undefined
            }
          ).catch(error => {
            console.error('[BeatOperations] Failed to save content to history before delete:', error);
          });
        }
      }
      // Delete only up to the end marker (preserves user content after marker)
      this.deleteGeneratedContentOnly(editorView, event.beatId, getHTMLContent);
      return;
    }

    // Save existing content to history BEFORE it gets overwritten
    if (event.storyId) {
      const existingContent = this.getTextAfterBeat(editorView, event.beatId);
      if (existingContent && existingContent.trim().length > 0) {
        // Read metadata from beat node for history entry
        const beatPos = this.findBeatNodePosition(editorView, event.beatId);
        const beatNode = beatPos !== null ? editorView.state.doc.nodeAt(beatPos) : null;

        // Save existing content as a previous version (don't block generation)
        this.savePreviousContentToHistory(
          event.beatId,
          event.storyId,
          existingContent,
          event.beatType || 'story',
          {
            prompt: beatNode?.attrs['prompt'] || undefined,
            model: beatNode?.attrs['model'] || undefined,
            stagingNotes: beatNode?.attrs['stagingNotes'] || undefined
          }
        ).catch(error => {
          console.error('[BeatOperations] Failed to save previous content to history:', error);
        });
      }
    }

    // Handle regenerate action - delete only generated content (up to marker) before regenerating
    if (event.action === 'regenerate') {
      this.deleteGeneratedContentOnly(editorView, event.beatId, getHTMLContent);
    }

    // Handle rewrite action - delete old content before rewriting
    if (event.action === 'rewrite' && event.existingText) {
      this.deleteContentAfterBeat(editorView, event.beatId, getHTMLContent);
    }

    // Handle polish action - delete old content before polishing
    if (event.action === 'polish' && event.existingText) {
      this.deleteContentAfterBeat(editorView, event.beatId, getHTMLContent);
    }

    // Start generation process and update prompt
    this.updateBeatNode(editorView, event.beatId, {
      isGenerating: true,
      generatedContent: '',
      prompt: event.prompt || ''
    });

    // Find the beat node position to insert content after it
    const beatNodePosition = this.findBeatNodePosition(editorView, event.beatId);
    if (beatNodePosition === null) return;

    // Track accumulating content for real-time insertion
    let accumulatedContent = '';
    let isFirstChunk = true;

    // Subscribe to streaming generation events
    const generationSubscription = this.beatAIService.generation$.subscribe(generationEvent => {
      if (generationEvent.beatId !== event.beatId) return;

      if (!generationEvent.isComplete && generationEvent.chunk) {
        // Stream chunk received - append to accumulated content
        accumulatedContent += generationEvent.chunk;

        // For streaming, we append each chunk directly
        if (generationEvent.chunk) {
          this.appendContentAfterBeatNode(editorView, event.beatId, generationEvent.chunk, isFirstChunk);
          isFirstChunk = false;
        }
      } else if (generationEvent.isComplete) {
        // Generation completed
        this.updateBeatNode(editorView, event.beatId, {
          isGenerating: false,
          generatedContent: accumulatedContent,
          prompt: event.prompt || '',
          hasHistory: true
        });
        // Clean up stored position
        this.beatStreamingPositions.delete(event.beatId);
        generationSubscription.unsubscribe();
      }
    });

    // For scene beats, use textAfterBeat for bridging context
    // Prefer the value passed from the component for consistency with preview
    // Only fall back to local extraction if not provided
    let textAfterBeatForBridging: string | undefined = event.textAfterBeat;
    if (event.beatType === 'scene' && !textAfterBeatForBridging) {
      const afterText = this.getTextAfterBeat(editorView, event.beatId);
      if (afterText && afterText.trim().length > 0) {
        textAfterBeatForBridging = afterText;
      }
    }

    // Generate AI content with streaming
    // For rewrite actions, use the rewrite instruction for AI; otherwise use the original prompt
    const aiPrompt = event.rewriteInstruction || event.prompt || '';
    this.beatAIService.generateBeatContent(aiPrompt, event.beatId, {
      wordCount: event.wordCount,
      model: event.model,
      storyId: event.storyId,
      chapterId: event.chapterId,
      sceneId: event.sceneId,
      beatPosition: beatNodePosition,
      beatType: event.beatType,
      customContext: event.customContext,
      action: event.action === 'rewrite' ? 'rewrite' : event.action === 'polish' ? 'polish' : (event.action === 'regenerate' ? 'regenerate' : 'generate'),
      existingText: event.existingText,
      textAfterBeat: textAfterBeatForBridging,
      stagingNotes: event.stagingNotes,
      originalPrompt: event.prompt,  // Pass original prompt for history
      rewriteInstruction: event.rewriteInstruction  // Pass rewrite instruction for history
    }).subscribe({
      next: (finalContent) => {
        // Final content received - ensure beat node is updated
        this.updateBeatNode(editorView, event.beatId, {
          isGenerating: false,
          generatedContent: finalContent,
          prompt: event.prompt || '',
          hasHistory: true
        });
      },
      error: (error) => {
        console.error('Beat generation failed:', error);

        // Insert error message
        this.appendContentAfterBeatNode(editorView, event.beatId, 'Error during generation. Please try again.', true);

        this.updateBeatNode(editorView, event.beatId, {
          isGenerating: false,
          generatedContent: 'Error during generation. Please try again.',
          prompt: event.prompt || ''
        });

        generationSubscription.unsubscribe();
      }
    });
  }

  /**
   * Switch beat to a different version from history
   * Uses transaction-like behavior with rollback on failure
   */
  async switchBeatVersion(
    editorView: EditorView | null,
    beatId: string,
    versionId: string,
    getHTMLContent: () => string
  ): Promise<void> {
    if (!editorView) {
      throw new Error('Editor not initialized');
    }

    // 1. Get version content from history (read-only, no rollback needed)
    const history = await this.beatHistoryService.getHistory(beatId);
    if (!history) {
      throw new Error(`No history found for beat ${beatId}`);
    }

    const version = history.versions.find(v => v.versionId === versionId);
    if (!version) {
      throw new Error(`Version ${versionId} not found in history`);
    }

    // 2. Capture current state BEFORE modifications for potential rollback
    const previousContent = this.getTextAfterBeat(editorView, beatId);
    const beatPos = this.findBeatNodePosition(editorView, beatId);
    if (beatPos === null) {
      throw new Error(`Beat node ${beatId} not found`);
    }
    const beatNode = editorView.state.doc.nodeAt(beatPos);
    if (!beatNode) {
      throw new Error(`Beat node ${beatId} not found in document`);
    }
    const previousPrompt = beatNode.attrs['prompt'] || '';
    const previousVersionId = beatNode.attrs['currentVersionId'] || '';
    const previousModel = beatNode.attrs['model'] || '';
    const previousStagingNotes = beatNode.attrs['stagingNotes'] || '';
    const previousGeneratedContent = beatNode.attrs['generatedContent'] || '';
    const previousBeatType = (beatNode.attrs['beatType'] || 'story') as 'story' | 'scene' | 'envision';

    // 2b. Save current content to history BEFORE switching (if there's content to save)
    if (previousContent && previousContent.trim().length > 0) {
      try {
        await this.savePreviousContentToHistory(
          beatId,
          history.storyId,
          previousContent,
          previousBeatType,
          {
            prompt: previousPrompt,
            model: previousModel,
            stagingNotes: previousStagingNotes
          }
        );
      } catch (saveError) {
        console.warn('[BeatOperations] Failed to save current content to history before switch:', saveError);
        // Continue with switch even if save fails
      }
    }

    try {
      // 3. Delete current content after beat
      const deleteSuccess = this.deleteContentAfterBeat(editorView, beatId, getHTMLContent);
      if (!deleteSuccess) {
        console.warn('[BeatOperations] Failed to delete content, continuing anyway');
      }

      // 4. Insert version content
      const updatedBeatPos = this.findBeatNodePosition(editorView, beatId);
      if (updatedBeatPos === null) {
        throw new Error(`Beat node ${beatId} not found after delete`);
      }
      const updatedBeatNode = editorView.state.doc.nodeAt(updatedBeatPos);
      if (!updatedBeatNode) {
        throw new Error(`Beat node ${beatId} not found in document after delete`);
      }
      const afterBeatPos = updatedBeatPos + updatedBeatNode.nodeSize;

      // Convert plain text content to HTML format, preserving newlines as paragraphs
      const htmlContent = convertTextToHtml(version.content);

      // Insert the version content as HTML
      this.insertHtmlContent(editorView, beatId, htmlContent, afterBeatPos);

      // 5. Update beat node attributes
      // For rewrite versions, do NOT update the prompt - it contains the rewrite instruction,
      // not the original beat prompt. We only want to restore the content.
      const beatNodeUpdate: Record<string, unknown> = {
        currentVersionId: versionId,
        hasHistory: true,
        stagingNotes: version.stagingNotes || undefined,
        generatedContent: version.content
      };
      if (version.action !== 'rewrite') {
        beatNodeUpdate['prompt'] = version.prompt;
      }
      this.updateBeatNode(editorView, beatId, beatNodeUpdate);

      // 6. Mark version as current in history
      await this.beatHistoryService.setCurrentVersion(beatId, versionId);

      // Emit content update
      const content = getHTMLContent();
      this.contentUpdate$.next(content);

      // Refresh prompt manager
      setTimeout(() => {
        this.promptManager.refresh().catch(error => {
          console.error('Error refreshing prompt manager:', error);
        });
      }, 500);
    } catch (error) {
      // ROLLBACK: Attempt to restore previous state
      console.error('[BeatOperations] Version switch failed, attempting rollback:', error);
      try {
        // Delete any partial content that may have been inserted
        this.deleteContentAfterBeat(editorView, beatId, getHTMLContent);

        // Restore previous content if it existed
        if (previousContent && previousContent.trim().length > 0) {
          const rollbackBeatPos = this.findBeatNodePosition(editorView, beatId);
          if (rollbackBeatPos !== null) {
            const rollbackBeatNode = editorView.state.doc.nodeAt(rollbackBeatPos);
            if (rollbackBeatNode) {
              const rollbackAfterPos = rollbackBeatPos + rollbackBeatNode.nodeSize;
              const rollbackHtml = convertTextToHtml(previousContent);
              this.insertHtmlContent(editorView, beatId, rollbackHtml, rollbackAfterPos);
            }
          }
        }

        // Restore previous beat node attributes
        this.updateBeatNode(editorView, beatId, {
          prompt: previousPrompt,
          currentVersionId: previousVersionId || undefined,
          hasHistory: true,
          model: previousModel || undefined,
          stagingNotes: previousStagingNotes || undefined,
          generatedContent: previousGeneratedContent
        });

        console.info('[BeatOperations] Rollback completed successfully');
      } catch (rollbackError) {
        console.error('[BeatOperations] Rollback also failed:', rollbackError);
      }
      throw error;
    }
  }

  /**
   * Extract all beats from the editor for beat navigation panel
   */
  extractBeatsFromEditor(editorView: EditorView | null): BeatInfo[] {
    if (!editorView) return [];

    const beats: BeatInfo[] = [];
    const { state } = editorView;

    state.doc.descendants((node, pos) => {
      if (node.type.name === 'beatAI') {
        const beatData = node.attrs as BeatAI;

        // Check if there's content after this beat
        let hasContent = false;
        let checkPos = pos + node.nodeSize;

        while (checkPos < state.doc.content.size) {
          const nextNode = state.doc.nodeAt(checkPos);
          if (!nextNode) break;

          // Stop if we hit another beat
          if (nextNode.type.name === 'beatAI') {
            break;
          }

          // Check if paragraph has content
          if (nextNode.type.name === 'paragraph' && nextNode.textContent.trim()) {
            hasContent = true;
            break;
          }

          checkPos += nextNode.nodeSize;
        }

        beats.push({
          beatId: beatData.id,
          prompt: beatData.prompt || 'No prompt',
          position: pos,
          isGenerating: beatData.isGenerating || false,
          hasContent
        });
      }
      return true;
    });

    return beats;
  }

  /**
   * Scroll to a specific beat in the editor
   */
  async scrollToBeat(beatId: string, ionContent?: IonContent): Promise<void> {
    // Find the beat element by data-beat-id attribute
    const beatElement = document.querySelector(`[data-beat-id="${beatId}"]`) as HTMLElement;

    if (beatElement) {
      if (ionContent) {
        // Use IonContent's scroll methods to keep header fixed
        const contentElement = await ionContent.getScrollElement();
        const beatRect = beatElement.getBoundingClientRect();
        const contentRect = contentElement.getBoundingClientRect();

        // Calculate the scroll position
        const scrollTop = contentElement.scrollTop + beatRect.top - contentRect.top - 80;

        // Scroll to the position smoothly
        await ionContent.scrollToPoint(0, scrollTop, 500);
      } else {
        // Fallback to native scrollIntoView
        beatElement.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
      }

      // Flash the beat to indicate selection
      setTimeout(() => {
        this.flashBeat(beatElement);
      }, 300);
    } else {
      console.warn(`Could not find beat element with ID: ${beatId}`);
    }
  }

  /**
   * Flash a beat to indicate selection
   */
  private flashBeat(beatElement: HTMLElement): void {
    const container = beatElement.closest('.beat-ai-container') as HTMLElement;
    if (container) {
      // Add flash animation
      container.style.transition = 'background-color 0.3s ease';
      container.style.backgroundColor = 'rgba(56, 128, 255, 0.3)';

      setTimeout(() => {
        container.style.backgroundColor = '';
        setTimeout(() => {
          container.style.transition = '';
        }, 300);
      }, 600);
    }
  }

  /**
   * Append content after a beat node (used for streaming)
   */
  private appendContentAfterBeatNode(editorView: EditorView, beatId: string, newContent: string, isFirstChunk = false): void {
    if (!editorView) return;

    const beatPos = this.findBeatNodePosition(editorView, beatId);
    if (beatPos === null) return;

    const { state } = editorView;
    const beatNode = state.doc.nodeAt(beatPos);
    if (!beatNode) return;

    // Position immediately after the beat node
    const afterBeatPos = beatPos + beatNode.nodeSize;

    if (isFirstChunk) {
      // Check if marker already exists (regenerate case)
      const existingMarkerPos = this.findBeatEndMarkerPosition(editorView, beatId);

      // If no marker exists, insert one first so generated content will push it down
      if (existingMarkerPos === null) {
        this.insertBeatEndMarker(editorView, beatId, afterBeatPos);
      }

      // First chunk - create HTML with <p> wrapper and process linebreaks
      const htmlContent = '<p>' + newContent.replace(/\n/g, '</p><p>') + '</p>';

      // Parse HTML and insert into document (at afterBeatPos, before the marker)
      // Need to re-calculate afterBeatPos since document may have changed after marker insertion
      const updatedBeatPos = this.findBeatNodePosition(editorView, beatId);
      if (updatedBeatPos === null) return;
      const updatedBeatNode = editorView.state.doc.nodeAt(updatedBeatPos);
      if (!updatedBeatNode) return;
      const updatedAfterBeatPos = updatedBeatPos + updatedBeatNode.nodeSize;

      this.insertHtmlContent(editorView, beatId, htmlContent, updatedAfterBeatPos);
    } else {
      // Subsequent chunks - process linebreaks and append to existing content
      const processedContent = newContent.replace(/\n/g, '</p><p>');
      this.appendHtmlChunk(editorView, beatId, processedContent);
    }
  }

  /**
   * Insert HTML content at a position
   */
  private insertHtmlContent(editorView: EditorView, beatId: string, htmlContent: string, position: number): void {
    if (!editorView) return;

    try {
      const div = document.createElement('div');
      div.innerHTML = htmlContent;

      const fragment = DOMParser.fromSchema(editorView.state.schema).parseSlice(div);
      const tr = editorView.state.tr.replaceRange(position, position, fragment);
      editorView.dispatch(tr);

      // Find the actual end position
      const newState = editorView.state;
      const insertedSize = fragment.content.size;
      const insertEndPos = position + insertedSize;

      // Find the last paragraph and get position at end of its text content
      let endPosition = insertEndPos - 1;

      // Walk backwards to find the last text position
      for (let pos = insertEndPos - 1; pos >= position; pos--) {
        try {
          const $pos = newState.doc.resolve(pos);
          if ($pos.parent.type.name === 'paragraph' && $pos.parentOffset > 0) {
            endPosition = pos;
            break;
          }
        } catch {
          // Position might be invalid, continue searching
        }
      }

      this.beatStreamingPositions.set(beatId, endPosition);
    } catch (error) {
      console.error('Failed to insert HTML content:', error);
    }
  }

  /**
   * Append HTML chunk to existing content
   */
  private appendHtmlChunk(editorView: EditorView, beatId: string, processedContent: string): void {
    if (!editorView) return;

    const insertPos = this.beatStreamingPositions.get(beatId);
    if (!insertPos || insertPos > editorView.state.doc.content.size) {
      return;
    }

    // Lazy cleanup: Remove empty paragraphs that might have been created by previous chunks
    this.removeLastEmptyParagraphIfExists(editorView, beatId);

    // Get updated position after potential cleanup
    const updatedInsertPos = this.beatStreamingPositions.get(beatId);
    if (!updatedInsertPos || updatedInsertPos > editorView.state.doc.content.size) {
      return;
    }

    // If the processed content contains </p><p>, we need to handle it specially
    if (processedContent.includes('</p><p>')) {
      // Split by paragraph boundaries
      const parts = processedContent.split('</p><p>');
      let currentPos = updatedInsertPos;

      // First part goes into current paragraph
      if (parts[0]) {
        const tr1 = editorView.state.tr.insertText(parts[0], currentPos);
        editorView.dispatch(tr1);
        currentPos += parts[0].length;
      }

      // Remaining parts create new paragraphs
      for (let i = 1; i < parts.length; i++) {
        if (editorView) {
          const state = editorView.state;

          // Find the paragraph containing the current position
          const $pos = state.doc.resolve(currentPos);
          let paragraphNode = null;
          let paragraphPos = -1;

          // Walk up to find the paragraph
          for (let depth = $pos.depth; depth >= 0; depth--) {
            if ($pos.node(depth).type.name === 'paragraph') {
              paragraphNode = $pos.node(depth);
              paragraphPos = $pos.start(depth) - 1;
              break;
            }
          }

          if (paragraphNode && paragraphPos >= 0) {
            // Insert new paragraph after the current one
            const afterCurrentParagraph = paragraphPos + paragraphNode.nodeSize;

            // Create new paragraph with content
            const newParagraphNode = state.schema.nodes['paragraph'].create(null,
              parts[i] ? [state.schema.text(parts[i])] : []);

            const tr = state.tr.insert(afterCurrentParagraph, newParagraphNode);
            editorView.dispatch(tr);

            // Update position to end of new paragraph's text content
            currentPos = afterCurrentParagraph + (parts[i] ? parts[i].length : 0) + 1;
          }
        }
      }

      this.beatStreamingPositions.set(beatId, currentPos);
    } else {
      // Simple text append
      const state = editorView.state;
      const validPos = Math.min(updatedInsertPos, state.doc.content.size);

      const tr = state.tr.insertText(processedContent, validPos);
      editorView.dispatch(tr);
      this.beatStreamingPositions.set(beatId, validPos + processedContent.length);
    }
  }

  /**
   * Remove last empty paragraph if exists
   */
  private removeLastEmptyParagraphIfExists(editorView: EditorView, beatId: string): void {
    if (!editorView) return;

    const currentPos = this.beatStreamingPositions.get(beatId);
    if (!currentPos) return;

    const state = editorView.state;

    try {
      // Find the current paragraph containing our position
      const $pos = state.doc.resolve(currentPos);
      let currentParagraphNode = null;
      let currentParagraphPos = -1;

      // Walk up to find the paragraph
      for (let depth = $pos.depth; depth >= 0; depth--) {
        if ($pos.node(depth).type.name === 'paragraph') {
          currentParagraphNode = $pos.node(depth);
          currentParagraphPos = $pos.start(depth) - 1;
          break;
        }
      }

      if (currentParagraphNode && currentParagraphPos >= 0) {
        // Check if current paragraph is empty
        const paragraphContent = currentParagraphNode.textContent.trim();

        if (paragraphContent === '') {
          // This paragraph is empty, remove it
          const paragraphEndPos = currentParagraphPos + currentParagraphNode.nodeSize;
          const tr = state.tr.delete(currentParagraphPos, paragraphEndPos);
          editorView.dispatch(tr);

          // Update the stored position
          const newState = editorView.state;
          const newPos = Math.max(0, currentParagraphPos - 1);

          // Make sure we're at a valid position
          if (newPos < newState.doc.content.size) {
            this.beatStreamingPositions.set(beatId, newPos);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to remove empty paragraph:', error);
    }
  }

  /**
   * Save existing beat content to history before it gets overwritten
   * This ensures the previous version is preserved for later retrieval
   */
  private async savePreviousContentToHistory(
    beatId: string,
    storyId: string,
    content: string,
    beatType: 'story' | 'scene' | 'envision',
    metadata?: {
      prompt?: string;
      model?: string;
      action?: 'generate' | 'regenerate' | 'rewrite' | 'polish';
      rewriteInstruction?: string;
      stagingNotes?: string;
      wordCount?: number;
      selectedScenes?: { sceneId: string; chapterId: string; }[];
      includeStoryOutline?: boolean;
    }
  ): Promise<void> {
    // Check if this content already exists in ANY version to avoid duplicates
    const existingHistory = await this.beatHistoryService.getHistory(beatId);
    if (existingHistory) {
      // Normalize content for comparison (trim whitespace)
      const normalizedContent = content.trim();
      // Check ALL versions for duplicate content, not just the most recent
      const isDuplicate = existingHistory.versions.some(
        v => v.content.trim() === normalizedContent
      );
      if (isDuplicate) {
        console.info('[BeatOperations] Skipping duplicate content in history');
        return;
      }
    }

    // Strip HTML tags for accurate word count
    const textContent = content.replace(/<[^>]*>/g, '').trim();
    const calculatedWordCount = textContent ? textContent.split(/\s+/).length : 0;

    // Save the existing content as a previous version
    // Use metadata if provided, otherwise use defaults
    await this.beatHistoryService.saveVersion(beatId, storyId, {
      content,
      prompt: metadata?.prompt || '(previous content)',
      model: metadata?.model || 'manual',
      beatType,
      wordCount: metadata?.wordCount || calculatedWordCount,
      generatedAt: new Date(),
      characterCount: content.length,
      isCurrent: false,
      action: metadata?.action || 'generate',
      rewriteInstruction: metadata?.rewriteInstruction,
      stagingNotes: metadata?.stagingNotes,
      selectedScenes: metadata?.selectedScenes,
      includeStoryOutline: metadata?.includeStoryOutline
    });
  }
}
