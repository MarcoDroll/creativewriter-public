import { Injectable } from '@angular/core';
import { Schema, Node as ProseMirrorNode } from 'prosemirror-model';
import { schema } from 'prosemirror-schema-basic';
import { addListNodes } from 'prosemirror-schema-list';

@Injectable({
  providedIn: 'root'
})
export class ProseMirrorSchemaService {
  private editorSchema: Schema;
  private simpleSchema: Schema;

  constructor() {
    // Create schema with basic nodes, list support, and custom nodes
    this.editorSchema = this.createEditorSchema();
    this.simpleSchema = this.createSimpleSchema();
  }

  getEditorSchema(): Schema {
    return this.editorSchema;
  }

  getSimpleSchema(): Schema {
    return this.simpleSchema;
  }

  private createEditorSchema(): Schema {
    const baseNodes = addListNodes(schema.spec.nodes, 'paragraph block*', 'block');

    // Add image and beat AI nodes to schema
    const extendedNodes = baseNodes.append({
      image: {
        attrs: {
          src: { default: '' },
          alt: { default: '' },
          title: { default: null },
          imageId: { default: null },
          storyId: { default: null },  // Required for per-story image storage
          width: { default: null },
          height: { default: null }
        },
        inline: false,
        group: 'block',
        draggable: true,
        parseDOM: [{
          tag: 'img[src]',
          getAttrs: (dom: Element) => ({
            src: dom.getAttribute('src'),
            alt: dom.getAttribute('alt') || '',
            title: dom.getAttribute('title') || null,
            imageId: dom.getAttribute('data-image-id') || null,
            storyId: dom.getAttribute('data-story-id') || null,
            width: dom.getAttribute('width') ? (parseInt(dom.getAttribute('width')!, 10) || null) : null,
            height: dom.getAttribute('height') ? (parseInt(dom.getAttribute('height')!, 10) || null) : null
          })
        }],
        toDOM: (node: ProseMirrorNode) => {
          const attrs: Record<string, string> = {
            src: node.attrs['src'],
            alt: node.attrs['alt']
          };

          // Build style string
          let style = 'display: block; margin: 1rem auto;';

          if (node.attrs['width'] && node.attrs['height']) {
            style += ` width: ${node.attrs['width']}px; height: ${node.attrs['height']}px;`;
          } else {
            style += ' max-width: 100%; height: auto;';
          }

          attrs['style'] = style;

          if (node.attrs['title']) {
            attrs['title'] = node.attrs['title'];
          }

          if (node.attrs['imageId']) {
            attrs['data-image-id'] = node.attrs['imageId'];
            attrs['class'] = 'image-id-' + node.attrs['imageId'];
          }

          if (node.attrs['storyId']) {
            attrs['data-story-id'] = node.attrs['storyId'];
          }

          if (node.attrs['width']) {
            attrs['width'] = node.attrs['width'];
          }

          if (node.attrs['height']) {
            attrs['height'] = node.attrs['height'];
          }

          return ['img', attrs];
        }
      },
      beatAI: {
        attrs: {
          id: { default: '' },
          prompt: { default: '' },
          generatedContent: { default: '' },
          isGenerating: { default: false },
          isCollapsed: { default: false },
          createdAt: { default: '' },
          updatedAt: { default: '' },
          wordCount: { default: 400 },
          beatType: { default: 'story' },
          model: { default: '' },
          selectedScenes: { default: '' },
          includeStoryOutline: { default: true },
          currentVersionId: { default: '' },
          hasHistory: { default: false },
          stagingNotes: { default: '' },
          lastAction: { default: '' },
          rewriteContext: { default: '' }
        },
        group: 'block',
        atom: true,
        toDOM: (node: ProseMirrorNode) => {
          const attrs = {
            class: 'beat-ai-node',
            'data-beat-id': node.attrs['id'] || '',
            'data-prompt': node.attrs['prompt'] || '',
            'data-content': node.attrs['generatedContent'] || '',
            'data-generating': node.attrs['isGenerating'] ? 'true' : 'false',
            'data-collapsed': node.attrs['isCollapsed'] ? 'true' : 'false',
            'data-created': node.attrs['createdAt'] || '',
            'data-updated': node.attrs['updatedAt'] || '',
            'data-word-count': node.attrs['wordCount'] || 400,
            'data-beat-type': node.attrs['beatType'] || 'story',
            'data-model': node.attrs['model'] || '',
            'data-selected-scenes': node.attrs['selectedScenes'] || '',
            'data-include-story-outline': node.attrs['includeStoryOutline'] !== undefined ? node.attrs['includeStoryOutline'] : 'true',
            'data-current-version-id': node.attrs['currentVersionId'] || '',
            'data-has-history': node.attrs['hasHistory'] ? 'true' : 'false',
            'data-staging-notes': node.attrs['stagingNotes'] || '',
            'data-last-action': node.attrs['lastAction'] || '',
            'data-rewrite-context': node.attrs['rewriteContext'] || ''
          };

          // Create content to make the beat visible in saved HTML
          const content = [];
          if (node.attrs['prompt']) {
            content.push(['div', { style: 'border: 1px solid #404040; padding: 0.5rem; margin: 0.5rem 0; background: #3a3a3a; border-radius: 4px;' },
              ['strong', '🎭 Beat AI'],
              ['div', { style: 'color: #adb5bd; font-style: italic; margin-top: 0.25rem;' }, 'Prompt: ' + node.attrs['prompt']]
            ]);
          }

          return ['div', attrs, ...content] as const;
        },
        parseDOM: [{
          tag: 'div.beat-ai-node',
          getAttrs: (dom: HTMLElement) => {
            const selectedScenesStr = dom.getAttribute('data-selected-scenes') || '';
            const includeStoryOutlineStr = dom.getAttribute('data-include-story-outline') || '';
            const collapsedAttr = dom.getAttribute('data-collapsed');
            const legacyEditingAttr = dom.getAttribute('data-editing');
            let isCollapsed = false;
            if (collapsedAttr !== null) {
              isCollapsed = collapsedAttr === 'true';
            } else if (legacyEditingAttr !== null) {
              isCollapsed = legacyEditingAttr === 'false';
            }

            const attrs = {
              // Support both new (data-beat-id) and legacy (data-id) attributes for backward compatibility
              // Generate ID if neither attribute exists
              id: dom.getAttribute('data-beat-id') || dom.getAttribute('data-id') || `beat-${Date.now().toString(36)}${Math.random().toString(36).substring(2)}`,
              prompt: dom.getAttribute('data-prompt') || '',
              generatedContent: dom.getAttribute('data-content') || '',
              isGenerating: dom.getAttribute('data-generating') === 'true',
              isCollapsed,
              createdAt: dom.getAttribute('data-created') || '',
              updatedAt: dom.getAttribute('data-updated') || '',
              wordCount: parseInt(dom.getAttribute('data-word-count') || '400', 10),
              beatType: dom.getAttribute('data-beat-type') || 'story',
              model: dom.getAttribute('data-model') || '',
              selectedScenes: selectedScenesStr || '',
              includeStoryOutline: includeStoryOutlineStr !== '' ? (includeStoryOutlineStr === 'true') : true,
              currentVersionId: dom.getAttribute('data-current-version-id') || '',
              hasHistory: dom.getAttribute('data-has-history') === 'true',
              stagingNotes: dom.getAttribute('data-staging-notes') || '',
              lastAction: dom.getAttribute('data-last-action') || '',
              rewriteContext: dom.getAttribute('data-rewrite-context') || ''
            };

            return attrs;
          }
        }]
      },
      // Invisible marker node to track the boundary between generated content and pre-existing text
      // Used to preserve remainder text when regenerating beat content
      // Must be a block node to sit between beat content paragraphs and pre-existing text
      beatEndMarker: {
        group: 'block',
        atom: true,
        selectable: false,
        attrs: {
          beatId: { default: '' }
        },
        toDOM: (node: ProseMirrorNode) => [
          'div',
          {
            class: 'beat-end-marker',
            'data-beat-id': node.attrs['beatId'],
            style: 'height: 1px; margin: 0.5rem 2rem; background: linear-gradient(90deg, transparent 0%, rgba(128, 128, 128, 0.3) 20%, rgba(128, 128, 128, 0.3) 80%, transparent 100%);'
          }
        ],
        parseDOM: [{
          tag: 'div.beat-end-marker',
          getAttrs: (dom: HTMLElement) => ({
            beatId: dom.getAttribute('data-beat-id') || ''
          })
        }]
      }
    });

    return new Schema({
      nodes: extendedNodes,
      marks: schema.spec.marks
    });
  }

  private createSimpleSchema(): Schema {
    return new Schema({
      nodes: {
        doc: schema.spec.nodes.get('doc')!,
        paragraph: schema.spec.nodes.get('paragraph')!,
        text: schema.spec.nodes.get('text')!,
        hard_break: schema.spec.nodes.get('hard_break')!
      },
      marks: schema.spec.marks
    });
  }
}
