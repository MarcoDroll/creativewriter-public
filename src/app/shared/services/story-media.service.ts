import { Injectable, inject, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { DatabaseService } from '../../core/services/database.service';
import {
  StoryVideoDoc,
  StoryVideoMeta,
  StoryVideoResult,
  ImageClickEvent,
  STORY_VIDEO_PREFIX,
  ATTACHMENT_NAME_VIDEO,
  MAX_VIDEO_SIZE,
  MAX_VIDEOS_PER_STORY
} from '../models/story-media.interface';

/**
 * Service for managing per-story videos and media UI interactions.
 *
 * Key features:
 * - Videos stored as separate documents linked by storyId
 * - Binary data stored via PouchDB _attachments (efficient, sync-friendly)
 * - Blob URL cache with proper cleanup to prevent memory leaks
 * - Image click event handling for video modal triggering
 * - Video indicator management for images
 */
@Injectable({
  providedIn: 'root'
})
export class StoryMediaService implements OnDestroy {
  private readonly databaseService = inject(DatabaseService);

  // Blob URL cache - CRITICAL: must be cleaned up to prevent memory leaks
  // Structure: Map<storyId, Map<videoId, blobUrl>> for per-story isolation
  private blobUrlCache = new Map<string, Map<string, string>>();

  // Subject for image click events (triggers video modal)
  private imageClickedSubject = new Subject<ImageClickEvent>();
  imageClicked$ = this.imageClickedSubject.asObservable();

  // Track click handler for cleanup
  private boundHandleImageClick = this.handleImageClick.bind(this);

  ngOnDestroy(): void {
    this.cleanupAllBlobUrls();
  }

  // ============================================================================
  // Video CRUD Operations
  // ============================================================================

  /**
   * Add a new video to a story.
   * Stores the video as a PouchDB attachment for efficient sync.
   */
  async addVideo(storyId: string, file: File, name?: string): Promise<StoryVideoResult> {
    // Validate file size
    if (file.size > MAX_VIDEO_SIZE) {
      throw new Error(`Video too large. Maximum size: ${this.formatFileSize(MAX_VIDEO_SIZE)}`);
    }

    // Validate file type
    if (!file.type.startsWith('video/')) {
      throw new Error('Only video files are allowed');
    }

    // Check video count limit
    const existingVideos = await this.getVideosForStory(storyId);
    if (existingVideos.length >= MAX_VIDEOS_PER_STORY) {
      throw new Error(`Maximum ${MAX_VIDEOS_PER_STORY} videos per story reached`);
    }

    const videoId = this.generateVideoId();
    const docId = `${STORY_VIDEO_PREFIX}${storyId}_${videoId}`;

    // Read file as ArrayBuffer and convert to base64 for PouchDB
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = this.arrayBufferToBase64(arrayBuffer);

    const videoDoc: StoryVideoDoc = {
      _id: docId,
      type: 'story-video',
      storyId,
      videoId,
      name: name || file.name,
      mimeType: file.type,
      size: file.size,
      createdAt: new Date(),
      _attachments: {
        [ATTACHMENT_NAME_VIDEO]: {
          content_type: file.type,
          data: base64Data
        }
      }
    };

    const db = await this.databaseService.getDatabase();
    await db.put(videoDoc);

    // Create blob URL for immediate use
    const blob = new Blob([arrayBuffer], { type: file.type });
    const blobUrl = URL.createObjectURL(blob);
    this.setCachedBlobUrl(storyId, videoId, blobUrl);

    return {
      meta: {
        id: videoId,
        storyId,
        name: videoDoc.name,
        mimeType: file.type,
        size: file.size,
        createdAt: videoDoc.createdAt
      },
      blobUrl
    };
  }

  /**
   * Remove a video from a story.
   * Deletes the entire document including the attachment.
   */
  async removeVideo(storyId: string, videoId: string): Promise<void> {
    const docId = `${STORY_VIDEO_PREFIX}${storyId}_${videoId}`;

    try {
      const db = await this.databaseService.getDatabase();
      const doc = await db.get(docId);
      await db.remove(doc);
    } catch (error) {
      // Ignore 404 errors (document already deleted)
      if ((error as { status?: number }).status !== 404) {
        console.error('Error removing video:', error);
        throw new Error('Failed to delete video');
      }
    }

    // Clean up blob URL from cache
    this.revokeBlobUrl(storyId, videoId);
  }

  /**
   * Get all videos for a story (metadata only, no binary data).
   */
  async getVideosForStory(storyId: string): Promise<StoryVideoMeta[]> {
    try {
      const db = await this.databaseService.getDatabase();

      // Use compound index for efficient query
      const result = await db.find({
        selector: {
          type: 'story-video',
          storyId: storyId
        }
      });

      return result.docs.map((doc: unknown) => {
        const typedDoc = doc as StoryVideoDoc;
        return {
          id: typedDoc.videoId,
          storyId: typedDoc.storyId,
          name: typedDoc.name,
          mimeType: typedDoc.mimeType,
          size: typedDoc.size,
          createdAt: new Date(typedDoc.createdAt)
        };
      }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error) {
      console.error('Error loading videos for story:', error);
      return [];
    }
  }

  /**
   * Get video binary data as a Blob.
   */
  async getVideoBlob(storyId: string, videoId: string): Promise<Blob | null> {
    const docId = `${STORY_VIDEO_PREFIX}${storyId}_${videoId}`;

    try {
      const db = await this.databaseService.getDatabase();
      const attachment = await db.getAttachment(docId, ATTACHMENT_NAME_VIDEO);
      return attachment as Blob;
    } catch (error) {
      console.error('Error getting video blob:', error);
      return null;
    }
  }

  /**
   * Get video as a blob URL (for use in video src).
   * Caches blob URLs to prevent memory issues from repeated creation.
   */
  async getVideoBlobUrl(storyId: string, videoId: string): Promise<string | null> {
    // Check cache first
    const cached = this.getCachedBlobUrl(storyId, videoId);
    if (cached) {
      return cached;
    }

    const blob = await this.getVideoBlob(storyId, videoId);
    if (!blob) {
      return null;
    }

    const blobUrl = URL.createObjectURL(blob);
    this.setCachedBlobUrl(storyId, videoId, blobUrl);
    return blobUrl;
  }

  /**
   * Get video as a data URL (base64 encoded).
   * Use sparingly - blob URLs are more memory efficient.
   */
  async getVideoDataUrl(storyId: string, videoId: string): Promise<string | null> {
    const blob = await this.getVideoBlob(storyId, videoId);
    if (!blob) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read video'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Get video metadata (without binary data).
   */
  async getVideoMeta(storyId: string, videoId: string): Promise<StoryVideoMeta | null> {
    const docId = `${STORY_VIDEO_PREFIX}${storyId}_${videoId}`;

    try {
      const db = await this.databaseService.getDatabase();
      const doc = await db.get(docId) as StoryVideoDoc;

      return {
        id: doc.videoId,
        storyId: doc.storyId,
        name: doc.name,
        mimeType: doc.mimeType,
        size: doc.size,
        createdAt: new Date(doc.createdAt)
      };
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        return null;
      }
      console.error('Error getting video meta:', error);
      return null;
    }
  }

  /**
   * Check if a video exists in the database.
   */
  async videoExists(storyId: string, videoId: string): Promise<boolean> {
    const docId = `${STORY_VIDEO_PREFIX}${storyId}_${videoId}`;

    try {
      const db = await this.databaseService.getDatabase();
      await db.get(docId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get storage usage for a story's videos.
   */
  async getStorageUsage(storyId: string): Promise<{ count: number; totalSize: number; formattedSize: string }> {
    const videos = await this.getVideosForStory(storyId);
    const totalSize = videos.reduce((sum, vid) => sum + vid.size, 0);

    return {
      count: videos.length,
      totalSize,
      formattedSize: this.formatFileSize(totalSize)
    };
  }

  // ============================================================================
  // Image Click Handling (for video modal triggering)
  // ============================================================================

  /**
   * Initialize image click handlers for a container element.
   * Uses event delegation for efficiency.
   */
  initializeImageClickHandlers(container: HTMLElement): void {
    // Remove any existing listeners first
    this.removeImageClickHandlers(container);

    // Add click event listener to the container (event delegation)
    container.addEventListener('click', this.boundHandleImageClick);
  }

  /**
   * Remove image click handlers from a container element.
   */
  removeImageClickHandlers(container: HTMLElement): void {
    container.removeEventListener('click', this.boundHandleImageClick);
  }

  /**
   * Handle click events on images.
   */
  private handleImageClick(event: Event): void {
    const target = event.target as HTMLElement;

    // Check if the clicked element is an image
    if (target.tagName.toLowerCase() === 'img') {
      const imageElement = target as HTMLImageElement;

      // Extract image ID and story ID from various possible sources
      const imageId = this.extractImageId(imageElement);
      const storyId = this.extractStoryId(imageElement);

      if (!storyId) {
        console.warn('Image click: could not determine storyId');
        return;
      }

      // Get click position for modal positioning
      const rect = imageElement.getBoundingClientRect();
      const position = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };

      // Emit the image click event
      this.imageClickedSubject.next({
        element: imageElement,
        imageId: imageId || '',
        storyId,
        position
      });

      // Prevent default behavior
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /**
   * Extract image ID from element attributes.
   */
  private extractImageId(imageElement: HTMLImageElement): string | null {
    // Try to extract ID from data attributes
    const dataId = imageElement.getAttribute('data-image-id');
    if (dataId) {
      return dataId;
    }

    // Try to extract ID from CSS classes
    const classes = imageElement.className;
    const idMatch = classes.match(/image-id-([a-zA-Z0-9_-]+)/);
    if (idMatch) {
      return idMatch[1];
    }

    return null;
  }

  /**
   * Extract story ID from element attributes.
   */
  private extractStoryId(imageElement: HTMLImageElement): string | null {
    // Try to extract from data attributes
    const dataId = imageElement.getAttribute('data-story-id');
    if (dataId) {
      return dataId;
    }

    // Try to find story ID from parent element
    const parent = imageElement.closest('[data-story-id]');
    if (parent) {
      return parent.getAttribute('data-story-id');
    }

    return null;
  }

  // ============================================================================
  // Video Indicator Management
  // ============================================================================

  /**
   * Add visual indicator that an image has an associated video.
   */
  addVideoIndicator(imageElement: HTMLElement): void {
    imageElement.classList.add('has-video');
    imageElement.style.cursor = 'pointer';

    // Add title attribute for user guidance
    const currentTitle = (imageElement as HTMLImageElement).title || '';
    const videoTitle = 'Click to view the associated video';
    (imageElement as HTMLImageElement).title = currentTitle
      ? `${currentTitle} - ${videoTitle}`
      : videoTitle;
  }

  /**
   * Remove video indicator from an image.
   */
  removeVideoIndicator(imageElement: HTMLElement): void {
    imageElement.classList.remove('has-video');
    imageElement.style.cursor = '';

    // Remove video-related title
    const img = imageElement as HTMLImageElement;
    if (img.title && img.title.includes('Click to view the associated video')) {
      img.title = img.title.replace(/ - Click to view the associated video/, '');
    }
  }

  /**
   * Add image ID and story ID to an image element for tracking.
   */
  addMediaIdsToElement(imageElement: HTMLImageElement, imageId: string, storyId: string): void {
    imageElement.setAttribute('data-image-id', imageId);
    imageElement.setAttribute('data-story-id', storyId);

    // Add CSS class for additional identification
    const existingClasses = imageElement.className;
    if (!existingClasses.includes(`image-id-${imageId}`)) {
      imageElement.className = `${existingClasses} image-id-${imageId}`.trim();
    }
  }

  // ============================================================================
  // Blob URL Management
  // ============================================================================

  /**
   * Revoke a specific blob URL from cache.
   */
  revokeBlobUrl(storyId: string, videoId: string): void {
    const storyCache = this.blobUrlCache.get(storyId);
    if (storyCache) {
      const url = storyCache.get(videoId);
      if (url) {
        URL.revokeObjectURL(url);
        storyCache.delete(videoId);
        // Clean up empty story cache
        if (storyCache.size === 0) {
          this.blobUrlCache.delete(storyId);
        }
      }
    }
  }

  /**
   * Clean up all cached blob URLs.
   * Should be called when leaving a story or on service destroy.
   */
  cleanupAllBlobUrls(): void {
    for (const storyCache of this.blobUrlCache.values()) {
      for (const url of storyCache.values()) {
        URL.revokeObjectURL(url);
      }
    }
    this.blobUrlCache.clear();
  }

  /**
   * Clean up blob URLs for videos of a specific story.
   * Call when leaving the story editor.
   */
  cleanupStoryBlobUrls(storyId: string): void {
    const storyCache = this.blobUrlCache.get(storyId);
    if (storyCache) {
      for (const url of storyCache.values()) {
        URL.revokeObjectURL(url);
      }
      this.blobUrlCache.delete(storyId);
    }
  }

  // ============================================================================
  // Blob URL Cache Helpers
  // ============================================================================

  private getCachedBlobUrl(storyId: string, videoId: string): string | null {
    const storyCache = this.blobUrlCache.get(storyId);
    return storyCache?.get(videoId) ?? null;
  }

  private setCachedBlobUrl(storyId: string, videoId: string, blobUrl: string): void {
    let storyCache = this.blobUrlCache.get(storyId);
    if (!storyCache) {
      storyCache = new Map<string, string>();
      this.blobUrlCache.set(storyId, storyCache);
    }
    storyCache.set(videoId, blobUrl);
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private generateVideoId(): string {
    return `vid_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    const chunkSize = 0x8000;
    let binary = '';

    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }

    return btoa(binary);
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
}
