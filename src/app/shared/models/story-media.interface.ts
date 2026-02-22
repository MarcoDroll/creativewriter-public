/**
 * Story Media Interfaces
 *
 * Per-story image and video storage using PouchDB attachments.
 * Images/videos are stored as separate documents linked by storyId.
 */

// ============================================================================
// PouchDB Document Types (internal storage structure)
// ============================================================================

/**
 * PouchDB document for storing story images with binary attachment.
 * Document ID format: story-image_{storyId}_{imageId}
 */
export interface StoryImageDoc {
  _id: string;              // "story-image_{storyId}_{imageId}"
  _rev?: string;
  type: 'story-image';
  storyId: string;
  imageId: string;
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: Date;
  videoId?: string;         // Link to video in same story
  _attachments?: Record<string, {
    content_type: string;
    digest?: string;
    length?: number;
    stub?: boolean;
    data?: string;          // Base64 encoded when creating
  }>;
}

/**
 * PouchDB document for storing story videos with binary attachment.
 * Document ID format: story-video_{storyId}_{videoId}
 */
export interface StoryVideoDoc {
  _id: string;              // "story-video_{storyId}_{videoId}"
  _rev?: string;
  type: 'story-video';
  storyId: string;
  videoId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: Date;
  _attachments?: Record<string, {
    content_type: string;
    digest?: string;
    length?: number;
    stub?: boolean;
    data?: string;          // Base64 encoded when creating
  }>;
}

// ============================================================================
// Metadata Types (for service APIs - no binary data)
// ============================================================================

/**
 * Image metadata returned by StoryImageService.
 * Does not include binary data - use getImageBlob() or getImageDataUrl() for that.
 */
export interface StoryImageMeta {
  id: string;
  storyId: string;
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  createdAt: Date;
  videoId?: string;
}

/**
 * Video metadata returned by StoryMediaService.
 * Does not include binary data - use getVideoBlob() or getVideoDataUrl() for that.
 */
export interface StoryVideoMeta {
  id: string;
  storyId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: Date;
}

// ============================================================================
// Helper Types
// ============================================================================

/**
 * Result when adding a new image to a story.
 */
export interface StoryImageResult {
  meta: StoryImageMeta;
  blobUrl: string;
}

/**
 * Result when adding a new video to a story.
 */
export interface StoryVideoResult {
  meta: StoryVideoMeta;
  blobUrl: string;
}

/**
 * Event emitted when an image is clicked in the editor.
 */
export interface ImageClickEvent {
  element: HTMLImageElement;
  imageId: string;
  storyId: string;
  position: { x: number; y: number };
}

// ============================================================================
// Constants
// ============================================================================

export const STORY_IMAGE_PREFIX = 'story-image_';
export const STORY_VIDEO_PREFIX = 'story-video_';
export const ATTACHMENT_NAME_IMAGE = 'image';
export const ATTACHMENT_NAME_VIDEO = 'video';

// Storage limits (per story)
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;      // 5MB
export const MAX_VIDEO_SIZE = 50 * 1024 * 1024;     // 50MB
export const MAX_IMAGES_PER_STORY = 100;
export const MAX_VIDEOS_PER_STORY = 50;
