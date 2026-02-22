/**
 * Test helpers for image integration feature tests.
 * Provides mock factories for files, PouchDB documents, and database setup.
 */

import {
  StoryImageDoc,
  StoryVideoDoc,
  StoryImageMeta,
  StoryVideoMeta,
  StoryImageResult,
  StoryVideoResult,
  ImageClickEvent,
  STORY_IMAGE_PREFIX,
  STORY_VIDEO_PREFIX,
  ATTACHMENT_NAME_IMAGE,
  ATTACHMENT_NAME_VIDEO
} from '../models/story-media.interface';

// ============================================================================
// Mock File Factories
// ============================================================================

/**
 * Create a mock image file for testing.
 */
export function createMockImageFile(
  name = 'test.png',
  size = 1024,
  type = 'image/png'
): File {
  const content = new Array(size).fill('x').join('');
  return new File([content], name, { type });
}

/**
 * Create a mock video file for testing.
 */
export function createMockVideoFile(
  name = 'test.mp4',
  size = 1024 * 1024,
  type = 'video/mp4'
): File {
  const content = new Array(size).fill('x').join('');
  return new File([content], name, { type });
}

/**
 * Create a mock Blob for testing.
 */
export function createMockBlob(
  size = 1024,
  type = 'image/png'
): Blob {
  const content = new Array(size).fill('x').join('');
  return new Blob([content], { type });
}

// ============================================================================
// Mock PouchDB Document Factories
// ============================================================================

/**
 * Create a mock StoryImageDoc for testing.
 */
export function createMockImageDoc(
  overrides: Partial<StoryImageDoc> = {}
): StoryImageDoc {
  const storyId = overrides.storyId || 'story1';
  const imageId = overrides.imageId || 'img_123';

  return {
    _id: `${STORY_IMAGE_PREFIX}${storyId}_${imageId}`,
    type: 'story-image',
    storyId,
    imageId,
    name: 'test.png',
    mimeType: 'image/png',
    size: 1024,
    width: 800,
    height: 600,
    createdAt: new Date(),
    _attachments: {
      [ATTACHMENT_NAME_IMAGE]: {
        content_type: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      }
    },
    ...overrides
  };
}

/**
 * Create a mock StoryVideoDoc for testing.
 */
export function createMockVideoDoc(
  overrides: Partial<StoryVideoDoc> = {}
): StoryVideoDoc {
  const storyId = overrides.storyId || 'story1';
  const videoId = overrides.videoId || 'vid_456';

  return {
    _id: `${STORY_VIDEO_PREFIX}${storyId}_${videoId}`,
    type: 'story-video',
    storyId,
    videoId,
    name: 'test.mp4',
    mimeType: 'video/mp4',
    size: 1024 * 1024,
    createdAt: new Date(),
    _attachments: {
      [ATTACHMENT_NAME_VIDEO]: {
        content_type: 'video/mp4',
        data: 'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE='
      }
    },
    ...overrides
  };
}

// ============================================================================
// Mock Metadata Factories
// ============================================================================

/**
 * Create a mock StoryImageMeta for testing.
 */
export function createMockImageMeta(
  overrides: Partial<StoryImageMeta> = {}
): StoryImageMeta {
  return {
    id: 'img_123',
    storyId: 'story1',
    name: 'test.png',
    mimeType: 'image/png',
    size: 1024,
    width: 800,
    height: 600,
    createdAt: new Date(),
    ...overrides
  };
}

/**
 * Create a mock StoryVideoMeta for testing.
 */
export function createMockVideoMeta(
  overrides: Partial<StoryVideoMeta> = {}
): StoryVideoMeta {
  return {
    id: 'vid_456',
    storyId: 'story1',
    name: 'test.mp4',
    mimeType: 'video/mp4',
    size: 1024 * 1024,
    createdAt: new Date(),
    ...overrides
  };
}

// ============================================================================
// Mock Result Factories
// ============================================================================

/**
 * Create a mock StoryImageResult for testing.
 */
export function createMockImageResult(
  overrides: Partial<StoryImageResult> = {}
): StoryImageResult {
  return {
    meta: createMockImageMeta(overrides.meta),
    blobUrl: 'blob:http://localhost/mock-image-url',
    ...overrides
  };
}

/**
 * Create a mock StoryVideoResult for testing.
 */
export function createMockVideoResult(
  overrides: Partial<StoryVideoResult> = {}
): StoryVideoResult {
  return {
    meta: createMockVideoMeta(overrides.meta),
    blobUrl: 'blob:http://localhost/mock-video-url',
    ...overrides
  };
}

// ============================================================================
// Mock Event Factories
// ============================================================================

/**
 * Create a mock ImageClickEvent for testing.
 */
export function createMockImageClickEvent(
  overrides: Partial<ImageClickEvent> = {}
): ImageClickEvent {
  const mockImage = document.createElement('img');
  mockImage.src = 'blob:http://localhost/mock-image';
  mockImage.setAttribute('data-image-id', overrides.imageId || 'img_123');
  mockImage.setAttribute('data-story-id', overrides.storyId || 'story1');

  return {
    element: mockImage,
    imageId: 'img_123',
    storyId: 'story1',
    position: { x: 100, y: 100 },
    ...overrides
  };
}

// ============================================================================
// Mock Database Setup
// ============================================================================

/**
 * Create a mock PouchDB database with common methods.
 */
export function createMockDatabase(): jasmine.SpyObj<PouchDB.Database> {
  return jasmine.createSpyObj('PouchDB.Database', [
    'get',
    'put',
    'remove',
    'find',
    'getAttachment',
    'bulkDocs',
    'allDocs'
  ]);
}

/**
 * Setup mock database with default return values.
 * Uses 'any' to avoid complex PouchDB type constraints in tests.
 */
export function setupMockDatabaseDefaults(
  mockDb: jasmine.SpyObj<PouchDB.Database>
): void {
  // Default to empty results - cast to any to avoid strict type issues
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockDb.find.and.returnValue(Promise.resolve({ docs: [] }) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockDb.put.and.returnValue(Promise.resolve({ ok: true, id: 'test-id', rev: '1-abc' }) as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mockDb.remove.and.returnValue(Promise.resolve({ ok: true, id: 'test-id', rev: '2-def' }) as any);
}

// ============================================================================
// URL API Mocking Helpers
// ============================================================================

/**
 * Setup URL.createObjectURL and URL.revokeObjectURL spies.
 * Returns cleanup function to restore original methods.
 */
export function setupUrlMocks(): {
  createObjectURLSpy: jasmine.Spy;
  revokeObjectURLSpy: jasmine.Spy;
  cleanup: () => void;
} {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  let urlCounter = 0;
  const createObjectURLSpy = spyOn(URL, 'createObjectURL').and.callFake(
    () => `blob:http://localhost/mock-${++urlCounter}`
  );
  const revokeObjectURLSpy = spyOn(URL, 'revokeObjectURL').and.callFake(() => { /* no-op for test */ });

  return {
    createObjectURLSpy,
    revokeObjectURLSpy,
    cleanup: () => {
      URL.createObjectURL = originalCreateObjectURL;
      URL.revokeObjectURL = originalRevokeObjectURL;
    }
  };
}

// ============================================================================
// Test Assertion Helpers
// ============================================================================

/**
 * Helper to wait for async operations in tests.
 */
export function flushPromises(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Create a mock HTMLImageElement for testing dimension loading.
 */
export function createMockHTMLImageElement(): HTMLImageElement {
  const img = document.createElement('img');
  Object.defineProperty(img, 'naturalWidth', { value: 800, writable: true });
  Object.defineProperty(img, 'naturalHeight', { value: 600, writable: true });
  return img;
}
