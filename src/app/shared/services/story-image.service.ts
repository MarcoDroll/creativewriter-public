import { Injectable, inject, OnDestroy } from '@angular/core';
import { Subject } from 'rxjs';
import { DatabaseService } from '../../core/services/database.service';
import {
  StoryImageDoc,
  StoryImageMeta,
  StoryImageResult,
  STORY_IMAGE_PREFIX,
  ATTACHMENT_NAME_IMAGE,
  MAX_IMAGE_SIZE,
  MAX_IMAGES_PER_STORY
} from '../models/story-media.interface';

/**
 * Service for managing per-story images using PouchDB attachments.
 *
 * Key features:
 * - Images stored as separate documents linked by storyId
 * - Binary data stored via PouchDB _attachments (efficient, sync-friendly)
 * - Blob URL cache with proper cleanup to prevent memory leaks
 * - Video association support
 */
@Injectable({
  providedIn: 'root'
})
export class StoryImageService implements OnDestroy {
  private readonly databaseService = inject(DatabaseService);

  // Blob URL cache - CRITICAL: must be cleaned up to prevent memory leaks
  // Structure: Map<storyId, Map<imageId, blobUrl>> for per-story isolation
  private blobUrlCache = new Map<string, Map<string, string>>();

  // Event emitted when an image is removed from content (for permanent deletion)
  private imageRemovedSubject = new Subject<{ storyId: string; imageId: string }>();
  imageRemoved$ = this.imageRemovedSubject.asObservable();

  ngOnDestroy(): void {
    this.cleanupAllBlobUrls();
  }

  /**
   * Add a new image to a story.
   * Stores the image as a PouchDB attachment for efficient sync.
   */
  async addImage(storyId: string, file: File, name?: string): Promise<StoryImageResult> {
    // Validate file size
    if (file.size > MAX_IMAGE_SIZE) {
      throw new Error(`Image too large. Maximum size: ${this.formatFileSize(MAX_IMAGE_SIZE)}`);
    }

    // Validate file type
    if (!file.type.startsWith('image/')) {
      throw new Error('Only image files are allowed');
    }

    // Check image count limit
    const existingImages = await this.getImagesForStory(storyId);
    if (existingImages.length >= MAX_IMAGES_PER_STORY) {
      throw new Error(`Maximum ${MAX_IMAGES_PER_STORY} images per story reached`);
    }

    const imageId = this.generateImageId();
    const docId = `${STORY_IMAGE_PREFIX}${storyId}_${imageId}`;

    // Get image dimensions if possible
    const dimensions = await this.getImageDimensions(file);

    // Read file as ArrayBuffer and convert to base64 for PouchDB
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = this.arrayBufferToBase64(arrayBuffer);

    const imageDoc: StoryImageDoc = {
      _id: docId,
      type: 'story-image',
      storyId,
      imageId,
      name: name || file.name,
      mimeType: file.type,
      size: file.size,
      width: dimensions?.width,
      height: dimensions?.height,
      createdAt: new Date(),
      _attachments: {
        [ATTACHMENT_NAME_IMAGE]: {
          content_type: file.type,
          data: base64Data
        }
      }
    };

    const db = await this.databaseService.getDatabase();
    await db.put(imageDoc);

    // Create blob URL for immediate use
    const blob = new Blob([arrayBuffer], { type: file.type });
    const blobUrl = URL.createObjectURL(blob);
    this.setCachedBlobUrl(storyId, imageId, blobUrl);

    return {
      meta: {
        id: imageId,
        storyId,
        name: imageDoc.name,
        mimeType: file.type,
        size: file.size,
        width: dimensions?.width,
        height: dimensions?.height,
        createdAt: imageDoc.createdAt
      },
      blobUrl
    };
  }

  /**
   * Remove an image from a story.
   * Deletes the entire document including the attachment.
   */
  async removeImage(storyId: string, imageId: string): Promise<void> {
    const docId = `${STORY_IMAGE_PREFIX}${storyId}_${imageId}`;

    try {
      const db = await this.databaseService.getDatabase();
      const doc = await db.get(docId);
      await db.remove(doc);
    } catch (error) {
      // Ignore 404 errors (document already deleted)
      if ((error as { status?: number }).status !== 404) {
        console.error('Error removing image:', error);
        throw new Error('Failed to delete image');
      }
    }

    // Clean up blob URL from cache
    this.revokeBlobUrl(storyId, imageId);
  }

  /**
   * Get all images for a story (metadata only, no binary data).
   */
  async getImagesForStory(storyId: string): Promise<StoryImageMeta[]> {
    try {
      const db = await this.databaseService.getDatabase();

      // Use compound index for efficient query
      const result = await db.find({
        selector: {
          type: 'story-image',
          storyId: storyId
        }
      });

      return result.docs.map((doc: unknown) => {
        const typedDoc = doc as StoryImageDoc;
        return {
          id: typedDoc.imageId,
          storyId: typedDoc.storyId,
          name: typedDoc.name,
          mimeType: typedDoc.mimeType,
          size: typedDoc.size,
          width: typedDoc.width,
          height: typedDoc.height,
          createdAt: new Date(typedDoc.createdAt),
          videoId: typedDoc.videoId
        };
      }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    } catch (error) {
      console.error('Error loading images for story:', error);
      return [];
    }
  }

  /**
   * Get image binary data as a Blob.
   */
  async getImageBlob(storyId: string, imageId: string): Promise<Blob | null> {
    const docId = `${STORY_IMAGE_PREFIX}${storyId}_${imageId}`;

    try {
      const db = await this.databaseService.getDatabase();
      const attachment = await db.getAttachment(docId, ATTACHMENT_NAME_IMAGE);
      return attachment as Blob;
    } catch (error) {
      console.error('Error getting image blob:', error);
      return null;
    }
  }

  /**
   * Get image as a blob URL (for use in img src).
   * Caches blob URLs to prevent memory issues from repeated creation.
   */
  async getImageBlobUrl(storyId: string, imageId: string): Promise<string | null> {
    // Check cache first
    const cached = this.getCachedBlobUrl(storyId, imageId);
    if (cached) {
      return cached;
    }

    const blob = await this.getImageBlob(storyId, imageId);
    if (!blob) {
      return null;
    }

    const blobUrl = URL.createObjectURL(blob);
    this.setCachedBlobUrl(storyId, imageId, blobUrl);
    return blobUrl;
  }

  /**
   * Get image as a data URL (base64 encoded).
   * Use sparingly - blob URLs are more memory efficient.
   */
  async getImageDataUrl(storyId: string, imageId: string): Promise<string | null> {
    const blob = await this.getImageBlob(storyId, imageId);
    if (!blob) {
      return null;
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('Failed to read image'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Get image metadata (without binary data).
   */
  async getImageMeta(storyId: string, imageId: string): Promise<StoryImageMeta | null> {
    const docId = `${STORY_IMAGE_PREFIX}${storyId}_${imageId}`;

    try {
      const db = await this.databaseService.getDatabase();
      const doc = await db.get(docId) as StoryImageDoc;

      return {
        id: doc.imageId,
        storyId: doc.storyId,
        name: doc.name,
        mimeType: doc.mimeType,
        size: doc.size,
        width: doc.width,
        height: doc.height,
        createdAt: new Date(doc.createdAt),
        videoId: doc.videoId
      };
    } catch (error) {
      if ((error as { status?: number }).status === 404) {
        return null;
      }
      console.error('Error getting image meta:', error);
      return null;
    }
  }

  /**
   * Set or remove video association for an image.
   * @throws Error if the image document doesn't exist or update fails
   */
  async setVideoAssociation(storyId: string, imageId: string, videoId: string | null): Promise<void> {
    const docId = `${STORY_IMAGE_PREFIX}${storyId}_${imageId}`;

    try {
      const db = await this.databaseService.getDatabase();
      const doc = await db.get(docId) as StoryImageDoc;

      if (videoId) {
        doc.videoId = videoId;
      } else {
        delete doc.videoId;
      }

      await db.put(doc);
    } catch (error) {
      console.error(`Error setting video association for image ${imageId} in story ${storyId}:`, error);
      throw error;
    }
  }

  /**
   * Get all images associated with a specific video.
   */
  async getImagesForVideo(storyId: string, videoId: string): Promise<StoryImageMeta[]> {
    const allImages = await this.getImagesForStory(storyId);
    return allImages.filter(img => img.videoId === videoId);
  }

  /**
   * Called when an image is removed from the editor content.
   * This triggers permanent deletion of the image.
   */
  async onImageRemovedFromContent(storyId: string, imageId: string): Promise<void> {
    // Emit event for any listeners
    this.imageRemovedSubject.next({ storyId, imageId });

    // Permanently delete the image
    await this.removeImage(storyId, imageId);
  }

  /**
   * Check if an image exists in the database.
   */
  async imageExists(storyId: string, imageId: string): Promise<boolean> {
    const docId = `${STORY_IMAGE_PREFIX}${storyId}_${imageId}`;

    try {
      const db = await this.databaseService.getDatabase();
      await db.get(docId);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get storage usage for a story's images.
   */
  async getStorageUsage(storyId: string): Promise<{ count: number; totalSize: number; formattedSize: string }> {
    const images = await this.getImagesForStory(storyId);
    const totalSize = images.reduce((sum, img) => sum + img.size, 0);

    return {
      count: images.length,
      totalSize,
      formattedSize: this.formatFileSize(totalSize)
    };
  }

  /**
   * Revoke a specific blob URL from cache.
   */
  revokeBlobUrl(storyId: string, imageId: string): void {
    const storyCache = this.blobUrlCache.get(storyId);
    if (storyCache) {
      const url = storyCache.get(imageId);
      if (url) {
        URL.revokeObjectURL(url);
        storyCache.delete(imageId);
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
   * Clean up blob URLs for images of a specific story.
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

  private getCachedBlobUrl(storyId: string, imageId: string): string | null {
    const storyCache = this.blobUrlCache.get(storyId);
    return storyCache?.get(imageId) ?? null;
  }

  private setCachedBlobUrl(storyId: string, imageId: string, blobUrl: string): void {
    let storyCache = this.blobUrlCache.get(storyId);
    if (!storyCache) {
      storyCache = new Map<string, string>();
      this.blobUrlCache.set(storyId, storyCache);
    }
    storyCache.set(imageId, blobUrl);
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  private generateImageId(): string {
    return `img_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  }

  private async getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
    return new Promise((resolve) => {
      const img = new Image();
      const url = URL.createObjectURL(file);

      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
      };

      img.onerror = (error) => {
        console.debug(`Failed to parse dimensions for image "${file.name}" (${file.type}, ${file.size} bytes):`, error);
        URL.revokeObjectURL(url);
        resolve(null);
      };

      img.src = url;
    });
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
