/**
 * Beat Version History Interfaces
 *
 * Defines the structure for storing beat generation version history.
 * Each beat can have multiple versions stored in a separate database,
 * allowing users to browse and restore previous generations.
 */

/**
 * Individual version of a beat generation
 */
export interface BeatVersion {
  /** Unique identifier for this version (format: 'v-{timestamp}-{random}') */
  versionId: string;

  /** Full HTML content of the generated text */
  content: string;

  /** User prompt used for this generation */
  prompt: string;

  /** AI model used (e.g., 'claude-opus-4', 'gpt-4-turbo') */
  model: string;

  /** Beat type: 'story' (full context), 'scene' (minimal context), or 'envision' (creative expansion) */
  beatType: 'story' | 'scene' | 'envision';

  /** Target word count for generation */
  wordCount: number;

  /** Timestamp when this version was generated */
  generatedAt: Date;

  /** Actual character count of generated content */
  characterCount: number;

  /** Whether this is the currently active version */
  isCurrent: boolean;

  /** Selected scenes included in generation context */
  selectedScenes?: {
    sceneId: string;
    chapterId: string;
  }[];

  /** Whether story outline was included in context */
  includeStoryOutline?: boolean;

  /** Action type: 'generate' (new), 'regenerate' (redo), 'rewrite' (modified existing), or 'polish' (expression refinement) */
  action?: 'generate' | 'regenerate' | 'rewrite' | 'polish';

  /** For rewrite actions: the original text that was rewritten */
  existingText?: string;

  /** Staging notes for physical/positional consistency */
  stagingNotes?: string;

  /** For rewrite actions: the instruction used to rewrite */
  rewriteInstruction?: string;
}

/**
 * Complete version history for a single beat
 *
 * Stored in separate 'beat-histories' database with ID format: 'history-{beatId}'
 */
export interface BeatVersionHistory {
  /** PouchDB document ID (format: 'history-{beatId}') */
  _id: string;

  /** PouchDB revision for conflict resolution */
  _rev?: string;

  /** Document type identifier for querying */
  type: 'beat-history';

  /** Reference to the beat this history belongs to */
  beatId: string;

  /** Parent story ID for bulk operations */
  storyId: string;

  /** User ID for future multi-user sync support */
  userId?: string;

  /** Array of all versions (max 10, auto-pruned) */
  versions: BeatVersion[];

  /** Timestamp when first version was created */
  createdAt: Date;

  /** Timestamp when last version was added */
  updatedAt: Date;
}

/**
 * Statistics about beat version history storage
 */
export interface BeatHistoryStats {
  /** Total number of beats with history */
  totalHistories: number;

  /** Total number of versions across all beats */
  totalVersions: number;

  /** Estimated storage size in bytes */
  totalSize: number;
}
