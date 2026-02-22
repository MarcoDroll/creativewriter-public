import { Plugin, PluginKey } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { Node } from 'prosemirror-model';

const thinkingHighlightingKey = new PluginKey<DecorationSet>('thinkingHighlighting');

/**
 * Creates a ProseMirror plugin that highlights thinking/internal monologue text (text in asterisks).
 * Highlights appear immediately as text is typed or streamed - no debounce.
 * Processes per-paragraph, correctly handling formatted text (bold/italic).
 * Handles incomplete markers (open * without close) by highlighting to end of paragraph.
 *
 * Detection rules to avoid false positives:
 * - Opening *: NOT followed by another * or whitespace
 * - Closing *: NOT preceded by another * or whitespace
 * - This avoids matching **bold**, * list items, or isolated asterisks
 */
export function createThinkingHighlightingPlugin(): Plugin<DecorationSet> {
  return new Plugin<DecorationSet>({
    key: thinkingHighlightingKey,
    state: {
      init: (_config, editorState) => findThinkingMatches(editorState.doc),
      apply: (tr, oldDecorations) => {
        // Check for metadata updates
        const newDecorations = tr.getMeta(thinkingHighlightingKey);
        if (newDecorations) return newDecorations;

        // Recalculate immediately on document changes (no debounce)
        if (tr.docChanged) {
          return findThinkingMatches(tr.doc);
        }

        return oldDecorations;
      }
    },
    props: {
      decorations: (state) => thinkingHighlightingKey.getState(state)
    }
  });
}

/**
 * Check if position i in text is a valid opening asterisk for thinking text.
 * Must be: asterisk NOT followed by another asterisk or whitespace.
 */
function isOpeningAsterisk(text: string, i: number): boolean {
  if (text[i] !== '*') return false;
  const next = text[i + 1];
  // Must have a next character, and it can't be another asterisk or whitespace
  return next !== undefined && next !== '*' && !/\s/.test(next);
}

/**
 * Check if position i in text is a valid closing asterisk for thinking text.
 * Must be: asterisk NOT preceded by another asterisk or whitespace.
 */
function isClosingAsterisk(text: string, i: number): boolean {
  if (text[i] !== '*') return false;
  const prev = text[i - 1];
  // Must have a previous character, and it can't be another asterisk or whitespace
  return prev !== undefined && prev !== '*' && !/\s/.test(prev);
}

/**
 * Find the next opening asterisk in text starting from startIndex.
 * Returns the index or -1 if not found.
 */
function findNextOpeningAsterisk(text: string, startIndex: number): number {
  for (let i = startIndex; i < text.length; i++) {
    if (isOpeningAsterisk(text, i)) {
      return i;
    }
  }
  return -1;
}

/**
 * Find the next closing asterisk in text starting from startIndex.
 * Returns the index or -1 if not found.
 */
function findNextClosingAsterisk(text: string, startIndex: number): number {
  for (let i = startIndex; i < text.length; i++) {
    if (isClosingAsterisk(text, i)) {
      return i;
    }
  }
  return -1;
}

/**
 * Represents a text segment within a paragraph with its document position.
 */
interface TextSegment {
  text: string;
  pos: number;  // Document position where this text starts
}

/**
 * Convert a text offset within combined paragraph text to a document position.
 * Returns the absolute document position for the given offset.
 */
function textOffsetToDocPos(segments: TextSegment[], offset: number): number {
  let accumulated = 0;
  for (const segment of segments) {
    if (offset < accumulated + segment.text.length) {
      return segment.pos + (offset - accumulated);
    }
    accumulated += segment.text.length;
  }
  // If offset is at the very end, return end of last segment
  const lastSegment = segments[segments.length - 1];
  return lastSegment.pos + lastSegment.text.length;
}

/**
 * Find all thinking text spans, including incomplete markers (open without close).
 * Pattern matches:
 *   - Complete thinking: *thinking here*
 *   - Incomplete thinking: *thinking without closing (highlighted to end of paragraph)
 *
 * Thinking markers are matched per-paragraph, handling formatted text (bold/italic) that
 * splits text into multiple nodes.
 */
function findThinkingMatches(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];

  // Process each top-level block (paragraph) in the document
  doc.forEach((block: Node, blockOffset: number) => {
    // Skip non-text blocks (images, beat AI nodes, etc.)
    if (!block.isTextblock) return;

    // Collect all text segments in this paragraph with their positions
    const segments: TextSegment[] = [];
    let combinedText = '';

    // blockOffset is relative to doc start, +1 to get inside the paragraph
    const blockStartPos = blockOffset + 1;

    block.forEach((child: Node, childOffset: number) => {
      if (child.isText && child.text) {
        segments.push({
          text: child.text,
          pos: blockStartPos + childOffset
        });
        combinedText += child.text;
      }
    });

    // Skip empty paragraphs
    if (combinedText.length === 0) return;

    // Find thinking markers in the combined paragraph text
    let i = 0;
    while (i < combinedText.length) {
      const openAsterisk = findNextOpeningAsterisk(combinedText, i);
      if (openAsterisk === -1) break;

      const closeAsterisk = findNextClosingAsterisk(combinedText, openAsterisk + 1);

      if (closeAsterisk !== -1) {
        // Complete thinking: highlight from open to close (inclusive)
        const fromPos = textOffsetToDocPos(segments, openAsterisk);
        const toPos = textOffsetToDocPos(segments, closeAsterisk + 1);
        decorations.push(
          Decoration.inline(fromPos, toPos, {
            class: 'thinking-highlight'
          })
        );
        i = closeAsterisk + 1;
      } else {
        // Incomplete thinking: highlight from open to end of paragraph
        const fromPos = textOffsetToDocPos(segments, openAsterisk);
        const toPos = textOffsetToDocPos(segments, combinedText.length);
        decorations.push(
          Decoration.inline(fromPos, toPos, {
            class: 'thinking-highlight'
          })
        );
        break;
      }
    }
  });

  return DecorationSet.create(doc, decorations);
}
