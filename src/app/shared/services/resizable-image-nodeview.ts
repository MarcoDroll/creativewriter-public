import { Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorView, NodeView } from 'prosemirror-view';
import { StoryImageService } from './story-image.service';

/**
 * Resizable image NodeView for ProseMirror.
 *
 * NOTE: Image deletion tracking is handled via the imageDeletionTracking plugin
 * in ProseMirrorPluginsService, NOT in this NodeView's destroy() method.
 * This ensures images are only deleted when actually removed from the document,
 * not when the editor is destroyed (e.g., navigation away).
 */
export class ResizableImageNodeView implements NodeView {
  dom!: HTMLElement;
  contentDOM?: HTMLElement;

  private img!: HTMLImageElement;
  private wrapper!: HTMLDivElement;
  private resizeHandles: HTMLDivElement[] = [];
  private isResizing = false;
  private startX = 0;
  private startY = 0;
  private startWidth = 0;
  private startHeight = 0;
  private aspectRatio = 1;
  private currentImageId: string | null = null; // Track current imageId for video association
  private currentStoryId: string | null = null; // Track current storyId for per-story storage
  private isDestroyed = false; // Flag for async operation safety

  // Event handler references for proper cleanup
  private handleMouseEnter: (() => void) | null = null;
  private handleMouseLeave: (() => void) | null = null;
  private handleDragStart: ((e: Event) => void) | null = null;
  private activeResizeMove: ((e: MouseEvent | TouchEvent) => void) | null = null;
  private activeResizeEnd: (() => void) | null = null;

  constructor(
    private node: ProseMirrorNode,
    private view: EditorView,
    private getPos: () => number,
    private storyImageService?: StoryImageService  // Optional for blob URL resolution
  ) {
    this.createDOM();
    // Resolve stale blob URLs after DOM is created
    void this.resolveImageIfNeeded();
  }

  private createDOM(): void {
    // Create wrapper div
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'resizable-image-wrapper';
    this.wrapper.style.cssText = `
      position: relative;
      display: inline-block;
      margin: 1rem auto;
      max-width: 100%;
    `;

    // Create image element
    this.img = document.createElement('img');
    this.img.src = this.node.attrs['src'];
    this.img.alt = this.node.attrs['alt'] || '';
    
    if (this.node.attrs['title']) {
      this.img.title = this.node.attrs['title'];
    }

    // Track imageId and storyId for video association and deletion handling
    const imageId = this.node.attrs['imageId'] as string | null;
    const storyId = this.node.attrs['storyId'] as string | null;

    if (imageId) {
      this.currentImageId = imageId;
      this.img.setAttribute('data-image-id', imageId);
      this.img.classList.add('image-id-' + imageId);
    }

    if (storyId) {
      this.currentStoryId = storyId;
      this.img.setAttribute('data-story-id', storyId);
    }

    // Set initial dimensions with responsive scaling for mobile (Issue A fix)
    if (this.node.attrs['width'] && this.node.attrs['height']) {
      // Use max-width and aspect-ratio instead of explicit width/height
      // This allows images to scale down on mobile while preserving aspect ratio
      this.img.style.maxWidth = this.node.attrs['width'] + 'px';
      this.img.style.width = '100%';
      this.img.style.height = 'auto';
      this.img.style.aspectRatio = `${this.node.attrs['width']} / ${this.node.attrs['height']}`;
    } else {
      this.img.style.maxWidth = '100%';
      this.img.style.height = 'auto';
    }

    this.img.style.cssText += `
      display: block;
      user-select: none;
      pointer-events: auto;
    `;

    // Calculate aspect ratio when image loads
    this.img.onload = () => {
      this.aspectRatio = this.img.naturalWidth / this.img.naturalHeight;
      if (!this.node.attrs['width'] || !this.node.attrs['height']) {
        this.updateNodeSize(this.img.offsetWidth, this.img.offsetHeight);
      }
    };

    // Create resize handles
    this.createResizeHandles();
    
    // Add image to wrapper
    this.wrapper.appendChild(this.img);
    
    // Add resize handles to wrapper
    this.resizeHandles.forEach(handle => {
      this.wrapper.appendChild(handle);
    });

    // Add event listeners
    this.addEventListeners();
    
    this.dom = this.wrapper;
  }

  private createResizeHandles(): void {
    const positions = [
      { class: 'nw', cursor: 'nw-resize', position: 'top: -4px; left: -4px;' },
      { class: 'ne', cursor: 'ne-resize', position: 'top: -4px; right: -4px;' },
      { class: 'sw', cursor: 'sw-resize', position: 'bottom: -4px; left: -4px;' },
      { class: 'se', cursor: 'se-resize', position: 'bottom: -4px; right: -4px;' }
    ];

    positions.forEach(pos => {
      const handle = document.createElement('div');
      handle.className = `resize-handle resize-handle-${pos.class}`;
      handle.style.cssText = `
        position: absolute;
        width: 8px;
        height: 8px;
        background: #007cff;
        border: 1px solid #fff;
        border-radius: 2px;
        cursor: ${pos.cursor};
        opacity: 0;
        transition: opacity 0.2s;
        z-index: 10;
        ${pos.position}
      `;
      
      handle.addEventListener('mousedown', (e) => this.startResize(e, pos.class));
      handle.addEventListener('touchstart', (e) => this.startResize(e, pos.class), { passive: false });
      
      this.resizeHandles.push(handle);
    });
  }

  private addEventListeners(): void {
    // Show/hide resize handles on hover - store references for cleanup
    this.handleMouseEnter = () => {
      if (!this.isResizing) {
        this.resizeHandles.forEach(handle => {
          handle.style.opacity = '1';
        });
      }
    };
    this.wrapper.addEventListener('mouseenter', this.handleMouseEnter);

    this.handleMouseLeave = () => {
      if (!this.isResizing) {
        this.resizeHandles.forEach(handle => {
          handle.style.opacity = '0';
        });
      }
    };
    this.wrapper.addEventListener('mouseleave', this.handleMouseLeave);

    // Prevent default drag behavior on image - store reference for cleanup
    this.handleDragStart = (e: Event) => {
      e.preventDefault();
    };
    this.img.addEventListener('dragstart', this.handleDragStart);
  }

  private startResize(e: MouseEvent | TouchEvent, handleClass: string): void {
    e.preventDefault();
    e.stopPropagation();

    this.isResizing = true;

    const clientX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
    const clientY = e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;

    this.startX = clientX;
    this.startY = clientY;
    this.startWidth = this.img.offsetWidth;
    this.startHeight = this.img.offsetHeight;

    // Show all handles during resize
    this.resizeHandles.forEach(handle => {
      handle.style.opacity = '1';
    });

    // Add document event listeners - store references for cleanup
    this.activeResizeMove = (e: MouseEvent | TouchEvent) => this.handleResize(e, handleClass);
    this.activeResizeEnd = () => this.endResize();

    document.addEventListener('mousemove', this.activeResizeMove);
    document.addEventListener('mouseup', this.activeResizeEnd);
    document.addEventListener('touchmove', this.activeResizeMove, { passive: false });
    document.addEventListener('touchend', this.activeResizeEnd);
  }

  private handleResize(e: MouseEvent | TouchEvent, handleClass: string): void {
    if (!this.isResizing) return;
    
    e.preventDefault();
    
    const clientX = e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
    const clientY = e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;
    
    const deltaX = clientX - this.startX;
    const deltaY = clientY - this.startY;
    
    let newWidth = this.startWidth;
    let newHeight = this.startHeight;
    
    // Calculate new dimensions based on handle position
    switch (handleClass) {
      case 'se': // Southeast - most common case
        newWidth = this.startWidth + deltaX;
        newHeight = this.startHeight + deltaY;
        break;
      case 'sw': // Southwest
        newWidth = this.startWidth - deltaX;
        newHeight = this.startHeight + deltaY;
        break;
      case 'ne': // Northeast
        newWidth = this.startWidth + deltaX;
        newHeight = this.startHeight - deltaY;
        break;
      case 'nw': // Northwest
        newWidth = this.startWidth - deltaX;
        newHeight = this.startHeight - deltaY;
        break;
    }
    
    // Maintain aspect ratio (hold Shift to disable)
    const maintainAspectRatio = !(e instanceof MouseEvent && e.shiftKey);
    
    if (maintainAspectRatio && this.aspectRatio) {
      const avgScale = Math.max(newWidth / this.startWidth, newHeight / this.startHeight);
      newWidth = this.startWidth * avgScale;
      newHeight = this.startHeight * avgScale;
    }
    
    // Apply minimum constraints
    const minSize = 50;
    newWidth = Math.max(minSize, Math.min(newWidth, this.wrapper.parentElement?.offsetWidth || 800));
    newHeight = Math.max(minSize, newHeight);
    
    // Update image size
    this.img.style.width = newWidth + 'px';
    this.img.style.height = newHeight + 'px';
  }

  private endResize(): void {
    if (!this.isResizing) return;

    this.isResizing = false;

    // Remove event listeners using stored references
    if (this.activeResizeMove) {
      document.removeEventListener('mousemove', this.activeResizeMove);
      document.removeEventListener('touchmove', this.activeResizeMove);
    }
    if (this.activeResizeEnd) {
      document.removeEventListener('mouseup', this.activeResizeEnd);
      document.removeEventListener('touchend', this.activeResizeEnd);
    }
    this.activeResizeMove = null;
    this.activeResizeEnd = null;

    // Hide handles
    this.resizeHandles.forEach(handle => {
      handle.style.opacity = '0';
    });

    // Update the ProseMirror node with new dimensions
    const finalWidth = this.img.offsetWidth;
    const finalHeight = this.img.offsetHeight;

    this.updateNodeSize(finalWidth, finalHeight);
  }

  private updateNodeSize(width: number, height: number): void {
    const pos = this.getPos();
    if (pos === null || pos === undefined) return;
    
    const { tr } = this.view.state;
    const newAttrs = {
      ...this.node.attrs,
      width: Math.round(width),
      height: Math.round(height)
    };
    
    tr.setNodeMarkup(pos, null, newAttrs);
    this.view.dispatch(tr);
  }

  update(node: ProseMirrorNode): boolean {
    if (node.type !== this.node.type) return false;

    this.node = node;

    // Update image attributes
    this.img.src = node.attrs['src'];
    this.img.alt = node.attrs['alt'] || '';

    if (node.attrs['title']) {
      this.img.title = node.attrs['title'];
    }

    // Update imageId for video association tracking
    const newImageId = node.attrs['imageId'] as string | null;
    if (newImageId !== this.currentImageId) {
      // Clean up old imageId class and attribute
      if (this.currentImageId) {
        this.img.classList.remove('image-id-' + this.currentImageId);
        if (!newImageId) {
          this.img.removeAttribute('data-image-id');
        }
      }
      // Set new imageId
      if (newImageId) {
        this.img.setAttribute('data-image-id', newImageId);
        this.img.classList.add('image-id-' + newImageId);
      }
      this.currentImageId = newImageId;
    }

    // Update storyId for per-story storage
    const newStoryId = node.attrs['storyId'] as string | null;
    if (newStoryId !== this.currentStoryId) {
      if (newStoryId) {
        this.img.setAttribute('data-story-id', newStoryId);
      } else {
        this.img.removeAttribute('data-story-id');
      }
      this.currentStoryId = newStoryId;
    }

    // Update dimensions with responsive scaling for mobile (Issue A fix)
    // Skip if currently resizing to prevent race condition
    if (!this.isResizing && node.attrs['width'] && node.attrs['height']) {
      // Use max-width and aspect-ratio instead of explicit width/height
      // This allows images to scale down on mobile while preserving aspect ratio
      this.img.style.maxWidth = node.attrs['width'] + 'px';
      this.img.style.width = '100%';
      this.img.style.height = 'auto';
      this.img.style.aspectRatio = `${node.attrs['width']} / ${node.attrs['height']}`;
    }

    // Re-check if URL needs resolution (handles undo/redo restoring stale blob URLs)
    void this.resolveImageIfNeeded();

    return true;
  }

  destroy(): void {
    // Mark as destroyed to prevent async operations from modifying destroyed DOM
    this.isDestroyed = true;

    // NOTE: Image deletion tracking is handled via the imageDeletionTracking plugin
    // in ProseMirrorPluginsService, NOT here. This ensures images are only deleted
    // when actually removed from the document, not when the editor is destroyed.

    // Clean up img.onload handler to prevent callback on destroyed view
    this.img.onload = null;

    // Clean up wrapper event listeners
    if (this.handleMouseEnter) {
      this.wrapper.removeEventListener('mouseenter', this.handleMouseEnter);
      this.handleMouseEnter = null;
    }
    if (this.handleMouseLeave) {
      this.wrapper.removeEventListener('mouseleave', this.handleMouseLeave);
      this.handleMouseLeave = null;
    }

    // Clean up image event listener
    if (this.handleDragStart) {
      this.img.removeEventListener('dragstart', this.handleDragStart);
      this.handleDragStart = null;
    }

    // Clean up any active resize handlers from document (in case destroyed while resizing)
    if (this.activeResizeMove) {
      document.removeEventListener('mousemove', this.activeResizeMove);
      document.removeEventListener('touchmove', this.activeResizeMove);
      this.activeResizeMove = null;
    }
    if (this.activeResizeEnd) {
      document.removeEventListener('mouseup', this.activeResizeEnd);
      document.removeEventListener('touchend', this.activeResizeEnd);
      this.activeResizeEnd = null;
    }

    // Clean up resize handles
    this.resizeHandles.forEach(handle => {
      handle.remove();
    });
    this.resizeHandles = [];
  }

  // ===== Blob URL Resolution =====

  /**
   * Check if the image src needs resolution (stale blob URL from previous session)
   */
  private needsUrlResolution(): boolean {
    if (!this.currentImageId || !this.storyImageService) return false;
    const src = this.node.attrs['src'] as string;
    // Blob URLs from previous sessions are invalid after page reload
    return !!src && src.startsWith('blob:');
  }

  /**
   * Resolve stale blob URL to fresh one from database.
   * Called after DOM creation to fix images that were saved with volatile blob URLs.
   */
  private async resolveImageIfNeeded(): Promise<void> {
    if (!this.needsUrlResolution() || !this.currentStoryId || !this.currentImageId) {
      return;
    }

    this.img.classList.add('image-resolving');

    try {
      const freshBlobUrl = await this.storyImageService!.getImageBlobUrl(
        this.currentStoryId,
        this.currentImageId
      );

      // Check if destroyed during async operation
      if (this.isDestroyed) return;

      if (freshBlobUrl && this.img) {
        this.img.src = freshBlobUrl;
        this.img.classList.remove('image-resolving');
      } else {
        this.showImageNotFound();
      }
    } catch (error) {
      console.error('Failed to resolve image:', this.currentImageId, error);
      this.showImageNotFound();
    }
  }

  /**
   * Show error state when image cannot be found in database
   */
  private showImageNotFound(): void {
    if (this.img) {
      this.img.classList.remove('image-resolving');
      this.img.classList.add('image-not-found');
    }
  }
}