import { Injectable, inject } from '@angular/core';
import { v4 as uuidv4 } from 'uuid';
import JSZip from '@progress/jszip-esm';
import { Story, Chapter, Scene } from '../models/story.interface';
import { Codex, CodexCategory, CodexEntry, PortraitGalleryItem } from '../models/codex.interface';
import { StoryService } from './story.service';
import { CodexService } from './codex.service';
import { DatabaseBackupService } from '../../shared/services/database-backup.service';
import { DatabaseService } from '../../core/services/database.service';
import {
  StoryImageDoc,
  StoryVideoDoc,
  STORY_IMAGE_PREFIX,
  STORY_VIDEO_PREFIX,
  ATTACHMENT_NAME_IMAGE,
  ATTACHMENT_NAME_VIDEO
} from '../../shared/models/story-media.interface';

/**
 * Reference to an image file stored in the archive.
 */
export interface MediaFileReference {
  imageId: string;
  filename: string;      // e.g., "abc123.png"
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: string;
  videoId?: string;      // Link to associated video
}

/**
 * Reference to a video file stored in the archive.
 */
export interface VideoFileReference {
  videoId: string;
  filename: string;      // e.g., "def456.mp4"
  mimeType: string;
  size: number;
  createdAt: string;
}

/**
 * Manifest of all media files in the archive.
 */
export interface StoryMediaManifest {
  images: MediaFileReference[];
  videos: VideoFileReference[];
}

export interface StoryExportData {
  version: number;
  exportDate: string;
  story: Story;
  codex?: Codex;
  media?: StoryMediaManifest;
  metadata: {
    appVersion: string;
    originalStoryId: string;
    originalCodexId?: string;
    mediaStats?: {
      imageCount: number;
      videoCount: number;
      totalMediaSize: number;
    };
  };
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface ImportResult {
  storyId: string;
  codexId?: string;
  finalTitle: string;
}

@Injectable({
  providedIn: 'root'
})
export class StoryExportImportService {
  private readonly storyService = inject(StoryService);
  private readonly codexService = inject(CodexService);
  private readonly databaseBackupService = inject(DatabaseBackupService);
  private readonly databaseService = inject(DatabaseService);

  private readonly CURRENT_VERSION = 2;
  private readonly APP_VERSION = '1.0.0';
  private readonly MAX_IMPORT_FILE_SIZE = 500 * 1024 * 1024; // 500MB for archives with media
  private readonly EXPORT_EXTENSION = '.cwx';

  /**
   * Export a story with its codex and media to a .cwx archive (ZIP format).
   * Returns a Blob containing the archive.
   */
  async exportStory(storyId: string): Promise<Blob> {
    // Get the story
    const story = await this.storyService.getStory(storyId);
    if (!story) {
      throw new Error('Story not found');
    }

    // Get the codex if it exists
    const codex = this.codexService.getCodex(storyId);

    // Create ZIP archive
    const zip = new JSZip();

    // Collect and add media to ZIP
    const [imageManifest, videoManifest] = await Promise.all([
      this.collectAndAddImages(zip, storyId),
      this.collectAndAddVideos(zip, storyId)
    ]);

    // Calculate media stats
    const imageSize = imageManifest.reduce((sum, img) => sum + img.size, 0);
    const videoSize = videoManifest.reduce((sum, vid) => sum + vid.size, 0);

    // Create export data (cover image stays base64 in story object)
    const exportData: StoryExportData = {
      version: this.CURRENT_VERSION,
      exportDate: new Date().toISOString(),
      story: this.cleanStoryForExport(story),
      codex: codex ? this.cleanCodexForExport(codex) : undefined,
      media: {
        images: imageManifest,
        videos: videoManifest
      },
      metadata: {
        appVersion: this.APP_VERSION,
        originalStoryId: story.id,
        originalCodexId: codex?.id,
        mediaStats: {
          imageCount: imageManifest.length,
          videoCount: videoManifest.length,
          totalMediaSize: imageSize + videoSize
        }
      }
    };

    // Add story.json to the archive
    zip.file('story.json', JSON.stringify(exportData, null, 2));

    // Generate the ZIP blob with light compression
    // Using level 1 since images/videos are already compressed formats
    return await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 1 }
    });
  }

  /**
   * Collect all images for a story and add them to the ZIP archive.
   * Returns the manifest of image references.
   */
  private async collectAndAddImages(zip: JSZip, storyId: string): Promise<MediaFileReference[]> {
    const manifest: MediaFileReference[] = [];
    const db = await this.databaseService.getDatabase();

    try {
      // Query for all images belonging to this story
      const result = await db.find({
        selector: {
          type: 'story-image',
          storyId: storyId
        }
      });

      // Create images folder in ZIP
      const imagesFolder = zip.folder('images');
      if (!imagesFolder) return manifest;

      for (const doc of result.docs as StoryImageDoc[]) {
        try {
          // Get the attachment blob
          const blob = await db.getAttachment(doc._id, ATTACHMENT_NAME_IMAGE) as Blob;
          if (!blob) continue;

          // Determine file extension from mime type
          const ext = this.getExtensionFromMimeType(doc.mimeType);
          const filename = `${doc.imageId}.${ext}`;

          // Add to ZIP as ArrayBuffer
          const arrayBuffer = await blob.arrayBuffer();
          imagesFolder.file(filename, arrayBuffer);

          // Add to manifest
          manifest.push({
            imageId: doc.imageId,
            filename,
            mimeType: doc.mimeType,
            size: doc.size,
            width: doc.width,
            height: doc.height,
            createdAt: new Date(doc.createdAt).toISOString(),
            videoId: doc.videoId
          });
        } catch (err) {
          console.warn(`Failed to export image ${doc.imageId}:`, err);
        }
      }
    } catch (err) {
      console.warn('Failed to query images for export:', err);
    }

    return manifest;
  }

  /**
   * Collect all videos for a story and add them to the ZIP archive.
   * Returns the manifest of video references.
   */
  private async collectAndAddVideos(zip: JSZip, storyId: string): Promise<VideoFileReference[]> {
    const manifest: VideoFileReference[] = [];
    const db = await this.databaseService.getDatabase();

    try {
      // Query for all videos belonging to this story
      const result = await db.find({
        selector: {
          type: 'story-video',
          storyId: storyId
        }
      });

      // Create videos folder in ZIP
      const videosFolder = zip.folder('videos');
      if (!videosFolder) return manifest;

      for (const doc of result.docs as StoryVideoDoc[]) {
        try {
          // Get the attachment blob
          const blob = await db.getAttachment(doc._id, ATTACHMENT_NAME_VIDEO) as Blob;
          if (!blob) continue;

          // Determine file extension from mime type
          const ext = this.getExtensionFromMimeType(doc.mimeType);
          const filename = `${doc.videoId}.${ext}`;

          // Add to ZIP as ArrayBuffer
          const arrayBuffer = await blob.arrayBuffer();
          videosFolder.file(filename, arrayBuffer);

          // Add to manifest
          manifest.push({
            videoId: doc.videoId,
            filename,
            mimeType: doc.mimeType,
            size: doc.size,
            createdAt: new Date(doc.createdAt).toISOString()
          });
        } catch (err) {
          console.warn(`Failed to export video ${doc.videoId}:`, err);
        }
      }
    } catch (err) {
      console.warn('Failed to query videos for export:', err);
    }

    return manifest;
  }

  /**
   * Get file extension from MIME type.
   */
  private getExtensionFromMimeType(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/jpg': 'jpg',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/ogg': 'ogg',
      'video/quicktime': 'mov'
    };
    return mimeToExt[mimeType] || 'bin';
  }

  /**
   * Validate import data structure from parsed JSON.
   */
  validateImportData(jsonData: string): ValidationResult {
    const errors: string[] = [];

    try {
      const data = JSON.parse(jsonData);
      errors.push(...this.validateExportDataObject(data));
    } catch {
      errors.push('Invalid JSON format');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Validate the export data object structure.
   */
  private validateExportDataObject(data: StoryExportData): string[] {
    const errors: string[] = [];

    // Check version
    if (typeof data.version !== 'number') {
      errors.push('Missing or invalid version field');
    } else if (data.version > this.CURRENT_VERSION) {
      errors.push(`Unsupported version ${data.version}. Maximum supported: ${this.CURRENT_VERSION}`);
    }

    // Check story
    if (!data.story) {
      errors.push('Missing story data');
    } else {
      if (!data.story.title) {
        errors.push('Story is missing title');
      }
      if (!Array.isArray(data.story.chapters)) {
        errors.push('Story is missing chapters array');
      }
    }

    // Check metadata
    if (!data.metadata) {
      errors.push('Missing metadata');
    }

    return errors;
  }

  /**
   * Parse import data for preview (without saving).
   * Works with both JSON string (legacy v1) and parsed data.
   */
  parseImportData(jsonData: string): StoryExportData {
    const validation = this.validateImportData(jsonData);
    if (!validation.valid) {
      throw new Error(`Invalid import data: ${validation.errors.join(', ')}`);
    }

    return JSON.parse(jsonData) as StoryExportData;
  }

  /**
   * Parse a .cwx archive file for preview.
   * Returns the parsed export data without importing.
   */
  async parseArchiveForPreview(file: File): Promise<StoryExportData> {
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(file);

    // Read story.json from archive
    const storyJsonFile = zipContent.file('story.json');
    if (!storyJsonFile) {
      throw new Error('Invalid archive: story.json not found');
    }

    const jsonData = await storyJsonFile.async('string');
    const data = JSON.parse(jsonData) as StoryExportData;

    // Validate the data
    const errors = this.validateExportDataObject(data);
    if (errors.length > 0) {
      throw new Error(`Invalid archive data: ${errors.join(', ')}`);
    }

    return data;
  }

  /**
   * Check if a file is a .cwx archive or legacy JSON.
   */
  isArchiveFile(file: File): boolean {
    return file.name.endsWith('.cwx') || file.type === 'application/zip';
  }

  /**
   * Import a story from JSON data (legacy v1 format).
   */
  async importStory(jsonData: string): Promise<ImportResult> {
    const exportData = this.parseImportData(jsonData);
    return this.importFromExportData(exportData, null);
  }

  /**
   * Import a story from a .cwx archive file.
   */
  async importStoryFromArchive(file: File): Promise<ImportResult> {
    const zip = new JSZip();
    const zipContent = await zip.loadAsync(file);

    // Read story.json from archive
    const storyJsonFile = zipContent.file('story.json');
    if (!storyJsonFile) {
      throw new Error('Invalid archive: story.json not found');
    }

    const jsonData = await storyJsonFile.async('string');
    const exportData = JSON.parse(jsonData) as StoryExportData;

    // Validate the data
    const errors = this.validateExportDataObject(exportData);
    if (errors.length > 0) {
      throw new Error(`Invalid archive data: ${errors.join(', ')}`);
    }

    return this.importFromExportData(exportData, zipContent);
  }

  /**
   * Internal import logic shared between JSON and archive imports.
   */
  private async importFromExportData(
    exportData: StoryExportData,
    zipContent: JSZip | null
  ): Promise<ImportResult> {
    // Regenerate all IDs
    const newStoryId = uuidv4();

    // Import videos first (images may reference them)
    const videoIdMapping = new Map<string, string>();
    if (zipContent && exportData.media?.videos) {
      await this.importVideosFromZip(zipContent, newStoryId, exportData.media.videos, videoIdMapping);
    }

    // Import images with video ID mapping
    const imageIdMapping = new Map<string, string>();
    if (zipContent && exportData.media?.images) {
      await this.importImagesFromZip(zipContent, newStoryId, exportData.media.images, videoIdMapping, imageIdMapping);
    }

    // Regenerate story IDs and update content references
    const story = this.regenerateStoryIds(exportData.story, newStoryId, imageIdMapping);

    // Ensure unique title
    story.title = await this.ensureUniqueTitle(story.title);

    // Reset timestamps
    const now = new Date();
    story.createdAt = now;
    story.updatedAt = now;

    // Remove PouchDB-specific fields
    delete story._rev;
    story._id = newStoryId;

    // Save the story
    await this.saveImportedStory(story);

    let codexId: string | undefined;

    // Import codex if present
    if (exportData.codex) {
      const newCodexId = uuidv4();
      const codex = this.regenerateCodexIds(exportData.codex, newStoryId, newCodexId);
      codex.createdAt = now;
      codex.updatedAt = now;

      await this.saveImportedCodex(codex, newStoryId);
      codexId = newCodexId;

      // Update story with codex reference
      story.codexId = newCodexId;
      await this.storyService.updateStory(story);
    }

    return {
      storyId: newStoryId,
      codexId,
      finalTitle: story.title
    };
  }

  /**
   * Import videos from ZIP archive into PouchDB.
   * Uses Blob directly with putAttachment to minimize memory usage.
   */
  private async importVideosFromZip(
    zip: JSZip,
    newStoryId: string,
    manifest: VideoFileReference[],
    videoIdMapping: Map<string, string>
  ): Promise<void> {
    const db = await this.databaseService.getDatabase();

    for (const videoRef of manifest) {
      try {
        const videoFile = zip.file(`videos/${videoRef.filename}`);
        if (!videoFile) {
          console.warn(`Video file not found in archive: ${videoRef.filename}`);
          continue;
        }

        // Generate new video ID
        const newVideoId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        videoIdMapping.set(videoRef.videoId, newVideoId);

        // Read video data as Blob (more memory efficient than base64)
        const blob = await videoFile.async('blob');

        // Create PouchDB document without attachment first
        const docId = `${STORY_VIDEO_PREFIX}${newStoryId}_${newVideoId}`;
        const videoDoc: Omit<StoryVideoDoc, '_attachments'> = {
          _id: docId,
          type: 'story-video',
          storyId: newStoryId,
          videoId: newVideoId,
          name: videoRef.filename,
          mimeType: videoRef.mimeType,
          size: videoRef.size,
          createdAt: new Date()
        };

        // Put document then attach blob separately (avoids base64 encoding)
        const result = await db.put(videoDoc);
        await db.putAttachment(docId, ATTACHMENT_NAME_VIDEO, result.rev, blob, videoRef.mimeType);

        // Yield to event loop to prevent UI freezing
        await new Promise(resolve => setTimeout(resolve, 0));
      } catch (err) {
        console.warn(`Failed to import video ${videoRef.videoId}:`, err);
      }
    }
  }

  /**
   * Import images from ZIP archive into PouchDB.
   * Uses Blob directly with putAttachment to minimize memory usage.
   */
  private async importImagesFromZip(
    zip: JSZip,
    newStoryId: string,
    manifest: MediaFileReference[],
    videoIdMapping: Map<string, string>,
    imageIdMapping: Map<string, string>
  ): Promise<void> {
    const db = await this.databaseService.getDatabase();

    for (const imageRef of manifest) {
      try {
        const imageFile = zip.file(`images/${imageRef.filename}`);
        if (!imageFile) {
          console.warn(`Image file not found in archive: ${imageRef.filename}`);
          continue;
        }

        // Generate new image ID
        const newImageId = `img_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        imageIdMapping.set(imageRef.imageId, newImageId);

        // Read image data as Blob (more memory efficient than base64)
        const blob = await imageFile.async('blob');

        // Map video ID if present
        const newVideoId = imageRef.videoId ? videoIdMapping.get(imageRef.videoId) : undefined;

        // Create PouchDB document without attachment first
        const docId = `${STORY_IMAGE_PREFIX}${newStoryId}_${newImageId}`;
        const imageDoc: Omit<StoryImageDoc, '_attachments'> = {
          _id: docId,
          type: 'story-image',
          storyId: newStoryId,
          imageId: newImageId,
          name: imageRef.filename,
          mimeType: imageRef.mimeType,
          size: imageRef.size,
          width: imageRef.width,
          height: imageRef.height,
          createdAt: new Date(),
          videoId: newVideoId
        };

        // Put document then attach blob separately (avoids base64 encoding)
        const result = await db.put(imageDoc);
        await db.putAttachment(docId, ATTACHMENT_NAME_IMAGE, result.rev, blob, imageRef.mimeType);

        // Yield to event loop to prevent UI freezing
        await new Promise(resolve => setTimeout(resolve, 0));
      } catch (err) {
        console.warn(`Failed to import image ${imageRef.imageId}:`, err);
      }
    }
  }

  /**
   * Download the export archive.
   */
  downloadExport(blob: Blob, storyTitle: string): void {
    const safeTitle = storyTitle
      .replace(/[^a-z0-9]/gi, '-')
      .replace(/-+/g, '-')
      .toLowerCase();
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `${safeTitle}-export-${timestamp}${this.EXPORT_EXTENSION}`;

    // Create download link
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Remove PouchDB-specific fields for clean export
   */
  private cleanStoryForExport(story: Story): Story {
    const cleaned = { ...story };
    delete cleaned._rev;
    delete cleaned._id;
    return cleaned;
  }

  /**
   * Remove PouchDB-specific fields from codex
   */
  private cleanCodexForExport(codex: Codex): Codex {
    return { ...codex };
  }

  /**
   * Regenerate all IDs in a story.
   * Also updates content references for images when imageIdMapping is provided.
   */
  private regenerateStoryIds(
    story: Story,
    newStoryId: string,
    imageIdMapping?: Map<string, string>
  ): Story {
    const idMap = new Map<string, string>();

    const newStory: Story = {
      ...story,
      id: newStoryId,
      _id: newStoryId,
      chapters: story.chapters.map(chapter => {
        const newChapterId = uuidv4();
        idMap.set(chapter.id, newChapterId);

        return {
          ...chapter,
          id: newChapterId,
          scenes: chapter.scenes.map(scene => {
            const newSceneId = uuidv4();
            idMap.set(scene.id, newSceneId);

            // Regenerate beat IDs and update image references in content
            let newContent = this.regenerateBeatIds(scene.content);
            newContent = this.updateContentImageReferences(newContent, newStoryId, imageIdMapping);

            return {
              ...scene,
              id: newSceneId,
              content: newContent,
              createdAt: this.safeParseDate(scene.createdAt),
              updatedAt: this.safeParseDate(scene.updatedAt)
            } as Scene;
          }),
          createdAt: this.safeParseDate(chapter.createdAt),
          updatedAt: this.safeParseDate(chapter.updatedAt)
        } as Chapter;
      }),
      createdAt: this.safeParseDate(story.createdAt),
      updatedAt: this.safeParseDate(story.updatedAt)
    };

    // Clear lastModifiedBy as this is a new import
    delete newStory.lastModifiedBy;

    return newStory;
  }

  /**
   * Regenerate beat IDs in scene content HTML.
   */
  private regenerateBeatIds(content: string): string {
    if (!content) return content;

    // Match data-beat-id="..." and replace with new UUIDs
    return content.replace(/data-beat-id="[^"]+"/g, () => {
      return `data-beat-id="${uuidv4()}"`;
    });
  }

  /**
   * Update image references in HTML content.
   * Updates:
   * - data-image-id attribute
   * - image-id-{id} CSS class
   * - data-story-id attribute
   */
  private updateContentImageReferences(
    content: string,
    newStoryId: string,
    imageIdMapping?: Map<string, string>
  ): string {
    if (!content) return content;

    let updated = content;

    // Update data-story-id attributes to the new story ID
    updated = updated.replace(/data-story-id="[^"]+"/g, `data-story-id="${newStoryId}"`);

    if (imageIdMapping && imageIdMapping.size > 0) {
      // Update data-image-id attributes
      updated = updated.replace(/data-image-id="([^"]+)"/g, (match, oldId) => {
        const newId = imageIdMapping.get(oldId);
        return newId ? `data-image-id="${newId}"` : match;
      });

      // Update image-id-{id} CSS classes
      updated = updated.replace(/image-id-([a-zA-Z0-9_-]+)/g, (match, oldId) => {
        const newId = imageIdMapping.get(oldId);
        return newId ? `image-id-${newId}` : match;
      });
    }

    return updated;
  }

  /**
   * Regenerate all IDs in a codex
   */
  private regenerateCodexIds(codex: Codex, newStoryId: string, newCodexId: string): Codex {
    return {
      ...codex,
      id: newCodexId,
      storyId: newStoryId,
      categories: codex.categories.map(category => {
        const newCategoryId = uuidv4();

        return {
          ...category,
          id: newCategoryId,
          entries: category.entries.map(entry => {
            const newEntryId = uuidv4();

            // Regenerate portrait gallery IDs and remap activePortraitId
            let newActivePortraitId = entry.activePortraitId;
            const newGallery = entry.portraitGallery?.map((portrait: PortraitGalleryItem) => {
              const newId = uuidv4();
              if (portrait.id === entry.activePortraitId) {
                newActivePortraitId = newId;
              }
              return {
                ...portrait,
                id: newId,
                createdAt: this.safeParseDate(portrait.createdAt)
              };
            });

            return {
              ...entry,
              id: newEntryId,
              categoryId: newCategoryId,
              portraitGallery: newGallery,
              activePortraitId: newActivePortraitId,
              createdAt: this.safeParseDate(entry.createdAt),
              updatedAt: this.safeParseDate(entry.updatedAt)
            } as CodexEntry;
          }),
          createdAt: this.safeParseDate(category.createdAt),
          updatedAt: this.safeParseDate(category.updatedAt)
        } as CodexCategory;
      }),
      createdAt: this.safeParseDate(codex.createdAt),
      updatedAt: this.safeParseDate(codex.updatedAt)
    };
  }

  /**
   * Ensure the story title is unique by appending " (imported)" if needed
   */
  private async ensureUniqueTitle(title: string): Promise<string> {
    const allStories = await this.storyService.getAllStories();
    const existingTitles = new Set(allStories.map(s => s.title.toLowerCase()));

    let newTitle = title;
    let counter = 0;

    while (existingTitles.has(newTitle.toLowerCase())) {
      counter++;
      newTitle = counter === 1
        ? `${title} (imported)`
        : `${title} (imported ${counter})`;
    }

    return newTitle;
  }

  /**
   * Save imported story directly to database using db.put()
   */
  private async saveImportedStory(story: Story): Promise<void> {
    const db = await this.databaseService.getDatabase();
    // Ensure schema version is set
    if (!story.schemaVersion) {
      story.schemaVersion = 1;
    }
    // Insert directly into database (not update - this is a new document)
    await db.put(story);
  }

  /**
   * Save imported codex directly to database
   */
  private async saveImportedCodex(codex: Codex, storyId: string): Promise<void> {
    const db = await this.databaseService.getDatabase();

    // Create the codex document with PouchDB _id
    const codexDoc = {
      ...codex,
      _id: `codex_${storyId}`,
      type: 'codex' as const
    };

    // Insert directly into database
    await db.put(codexDoc);

    // Update the in-memory cache in CodexService
    this.codexService.setCodexCache(storyId, codex);
  }

  /**
   * Get the maximum allowed import file size
   */
  getMaxImportFileSize(): number {
    return this.MAX_IMPORT_FILE_SIZE;
  }

  /**
   * Helper to safely parse dates, returning current date if invalid
   */
  private safeParseDate(dateValue: Date | string | undefined): Date {
    if (!dateValue) return new Date();
    const parsed = new Date(dateValue);
    return isNaN(parsed.getTime()) ? new Date() : parsed;
  }
}
