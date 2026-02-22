/**
 * Snapshot creation logic
 */

const logger = require('./logger');
const config = require('./config');
const { DatabaseClient, getAllUserDatabases } = require('./couchdb-client');

/**
 * Create snapshots for all stories in all user databases
 */
async function createSnapshotsForAllDatabases(tier) {
  const startTime = Date.now();
  logger.info(`Starting ${tier} snapshot creation across all databases`);

  try {
    const databases = await getAllUserDatabases();
    let totalSnapshots = 0;

    for (const dbName of databases) {
      try {
        const count = await createSnapshotsForDatabase(dbName, tier);
        totalSnapshots += count;
      } catch (error) {
        logger.error(`Failed to create snapshots for database ${dbName}:`, error);
        // Continue with other databases
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`Created ${totalSnapshots} ${tier} snapshots across ${databases.length} databases in ${duration}ms`);

    return totalSnapshots;
  } catch (error) {
    logger.error(`Failed to create ${tier} snapshots:`, error);
    throw error;
  }
}

/**
 * Create snapshots for stories in a specific database
 */
async function createSnapshotsForDatabase(dbName, tier) {
  const db = new DatabaseClient(dbName);
  await db.init();

  // Get document IDs only (without content) to avoid memory issues
  const result = await db.allDocs({ include_docs: false });

  if (!result || !result.rows) {
    logger.warn(`Invalid response from allDocs for database ${dbName}`);
    return 0;
  }

  logger.debug(`Database ${dbName}: Found ${result.rows.length} total documents`);

  // Filter for potential story IDs (exclude known non-story prefixes)
  const potentialStoryIds = result.rows
    .map(row => row.id)
    .filter(id => {
      if (!id) return false;
      if (id.startsWith('_design')) return false;
      if (id.startsWith('snapshot-')) return false;
      if (id.startsWith('codex_')) return false;
      if (id.startsWith('character-chat_')) return false;
      if (id.startsWith('scene-chat_')) return false;
      if (id.startsWith('story-research_')) return false;
      if (id.startsWith('story-image_')) return false;
      if (id.startsWith('story-video_')) return false;
      return true;
    });

  logger.debug(`Database ${dbName}: ${potentialStoryIds.length} potential story IDs`);

  // Fetch stories in batches using bulk operations (avoids N+1 query problem)
  const stories = [];
  const batchSize = config.BATCH_SIZE;

  for (let i = 0; i < potentialStoryIds.length; i += batchSize) {
    const batch = potentialStoryIds.slice(i, i + batchSize);

    try {
      // Bulk fetch using allDocs with keys parameter
      const batchResult = await db.allDocs({
        keys: batch,
        include_docs: true
      });

      for (const row of batchResult.rows) {
        // Skip errors (404s) and deleted docs
        if (row.error || !row.doc) continue;
        // Validate it's a story (has chapters array, no type field)
        if (row.doc && !row.doc.type && row.doc.chapters && Array.isArray(row.doc.chapters)) {
          stories.push(row.doc);
        }
      }
    } catch (error) {
      logger.warn(`Batch fetch failed for ${dbName}, falling back to individual fetches:`, error.message);
      // Fallback to individual fetches for this batch
      for (const storyId of batch) {
        try {
          const doc = await db.get(storyId);
          if (doc && !doc.type && doc.chapters && Array.isArray(doc.chapters)) {
            stories.push(doc);
          }
        } catch (e) {
          if (e.statusCode !== 404) {
            logger.warn(`Failed to fetch document ${storyId}:`, e.message);
          }
        }
      }
    }
  }

  if (stories.length === 0) {
    logger.debug(`No stories found in database ${dbName}`);
    return 0;
  }

  logger.debug(`Database ${dbName}: Found ${stories.length} valid stories`);

  const snapshots = [];

  for (const story of stories) {
    // Check if story has changed since last snapshot of this tier
    const shouldSnapshot = await shouldCreateSnapshot(db, story, tier);

    if (!shouldSnapshot) {
      logger.debug(`Skipping ${story._id} - no changes since last ${tier} snapshot`);
      continue;
    }

    // Fetch related documents using targeted queries
    const storyId = story._id || story.id;
    const relatedDocs = await fetchRelatedDocuments(db, storyId);

    // Log related document counts
    logger.debug(`Story ${storyId}: codex=${!!relatedDocs.codex}, ` +
      `chats=${relatedDocs.characterChats.length + relatedDocs.sceneChats.length}, ` +
      `research=${relatedDocs.storyResearch.length}, ` +
      `images=${relatedDocs.storyImages.length}, ` +
      `videos=${relatedDocs.storyVideos.length}`);

    // Create snapshot with related documents
    const snapshot = createSnapshotDocument(story, tier, dbName, relatedDocs);
    snapshots.push(snapshot);
  }

  if (snapshots.length === 0) {
    logger.debug(`No new ${tier} snapshots needed for database ${dbName}`);
    return 0;
  }

  // Bulk insert for performance
  const bulkResult = await db.bulk({ docs: snapshots });
  const successful = bulkResult.filter(r => r.ok).length;
  const failed = bulkResult.filter(r => !r.ok).length;

  logger.info(`Created ${successful} ${tier} snapshots in ${dbName}${failed > 0 ? ` (${failed} failed)` : ''}`);

  return successful;
}

/**
 * Check if snapshot should be created
 */
async function shouldCreateSnapshot(db, story, tier) {
  try {
    // Get last snapshot of this tier for this story
    const result = await db.view('snapshots', 'by_story_and_date', {
      startkey: [story._id || story.id],
      endkey: [story._id || story.id, {}],
      descending: true,
      limit: 1,
      include_docs: true
    });

    if (result.rows.length === 0) {
      // No previous snapshot - create one
      return true;
    }

    const lastSnapshot = result.rows[0].doc;

    // Check if story has been modified since last snapshot
    const storyUpdated = new Date(story.updatedAt);
    const snapshotCreated = new Date(lastSnapshot.snapshot.updatedAt);

    if (storyUpdated <= snapshotCreated) {
      return false; // No changes
    }

    // Check if story has been idle (no edits in last N minutes)
    const now = new Date();
    const timeSinceEdit = (now - storyUpdated) / (1000 * 60); // minutes

    if (timeSinceEdit < config.IDLE_THRESHOLD_MINUTES) {
      logger.debug(`Story ${story._id} edited ${timeSinceEdit.toFixed(1)} minutes ago - waiting for idle`);
      return false; // Still being actively edited
    }

    return true;
  } catch (error) {
    // View might not exist yet
    logger.debug(`Error checking last snapshot for ${story._id}:`, error.message);
    return true; // Create snapshot anyway
  }
}

/**
 * Create snapshot document structure
 * @param {Object} story - The story document
 * @param {string} tier - Retention tier
 * @param {string} dbName - Database name
 * @param {Object} relatedDocs - Related documents (optional for backward compatibility)
 */
function createSnapshotDocument(story, tier, dbName, relatedDocs = null) {
  const now = new Date();
  const expiresAt = calculateExpiration(now, tier);

  // Prepare related documents if provided
  const relatedDocuments = relatedDocs ? {
    codex: relatedDocs.codex ? stripRevision(relatedDocs.codex) : null,
    characterChats: (relatedDocs.characterChats || []).map(stripRevision),
    sceneChats: (relatedDocs.sceneChats || []).map(stripRevision),
    storyResearch: (relatedDocs.storyResearch || []).map(stripRevision),
    storyImages: (relatedDocs.storyImages || []).map(stripRevision),
    storyVideos: (relatedDocs.storyVideos || []).map(stripRevision)
  } : null;

  // Prepare metadata with related document counts
  const metadata = {
    wordCount: calculateWordCount(story),
    chapterCount: story.chapters?.length || 0,
    sceneCount: countScenes(story)
  };

  // Add related document counts to metadata if available
  if (relatedDocs) {
    metadata.hasCodex = !!relatedDocs.codex;
    metadata.characterChatCount = relatedDocs.characterChats?.length || 0;
    metadata.sceneChatCount = relatedDocs.sceneChats?.length || 0;
    metadata.researchCount = relatedDocs.storyResearch?.length || 0;
    metadata.imageCount = relatedDocs.storyImages?.length || 0;
    metadata.videoCount = relatedDocs.storyVideos?.length || 0;
  }

  const snapshotDoc = {
    _id: `snapshot-${story._id || story.id}-${now.getTime()}`,
    type: 'story-snapshot',
    storyId: story._id || story.id,
    userId: extractUserId(dbName),
    createdAt: now.toISOString(),
    retentionTier: tier,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    snapshotType: 'auto',
    triggeredBy: 'scheduler',

    snapshot: {
      title: story.title,
      chapters: story.chapters,
      settings: story.settings,
      updatedAt: story.updatedAt
    },

    metadata
  };

  // Add related documents if available
  if (relatedDocuments) {
    snapshotDoc.relatedDocuments = relatedDocuments;
  }

  return snapshotDoc;
}

/**
 * Calculate expiration date based on retention tier
 */
function calculateExpiration(createdAt, tier) {
  const expiresAt = new Date(createdAt);

  switch (tier) {
    case 'granular':
      expiresAt.setHours(expiresAt.getHours() + 4);
      break;
    case 'hourly':
      expiresAt.setHours(expiresAt.getHours() + 24);
      break;
    case 'daily':
      expiresAt.setDate(expiresAt.getDate() + 30);
      break;
    case 'weekly':
      expiresAt.setDate(expiresAt.getDate() + 84); // 12 weeks
      break;
    case 'monthly':
      expiresAt.setDate(expiresAt.getDate() + 365); // 12 months
      break;
    default:
      // Manual snapshots don't expire
      return null;
  }

  return expiresAt;
}

/**
 * Extract user ID from database name
 */
function extractUserId(dbName) {
  // Extract from pattern like 'creative-writer-stories-username'
  const prefix = config.DATABASE_PATTERN + '-';
  if (dbName.startsWith(prefix)) {
    return dbName.substring(prefix.length);
  }
  return 'anonymous';
}

/**
 * Calculate word count for a story
 * Optimized: uses single regex pass instead of split + filter
 */
function calculateWordCount(story) {
  let total = 0;

  if (!story.chapters) return 0;

  for (const chapter of story.chapters) {
    if (chapter.scenes) {
      for (const scene of chapter.scenes) {
        const text = stripHtml(scene.content || '');
        // Single regex pass instead of split + filter
        const words = text.match(/\S+/g);
        total += words ? words.length : 0;
      }
    }
  }

  return total;
}

/**
 * Count total scenes in a story
 */
function countScenes(story) {
  if (!story.chapters) return 0;
  return story.chapters.reduce((sum, chapter) => {
    return sum + (chapter.scenes?.length || 0);
  }, 0);
}

/**
 * Strip HTML tags from content
 */
function stripHtml(html) {
  if (!html) return '';

  // Remove Beat AI nodes
  let clean = html.replace(/<div[^>]*class="beat-ai-node"[^>]*>.*?<\/div>/gs, '');

  // Remove HTML tags
  clean = clean.replace(/<[^>]*>/g, ' ');

  // Remove Beat AI artifacts
  clean = clean.replace(/🎭\s*Beat\s*AI/gi, '');
  clean = clean.replace(/Prompt:\s*/gi, '');
  clean = clean.replace(/BeatAIPrompt/gi, '');

  // Normalize whitespace
  clean = clean.trim().replace(/\s+/g, ' ');

  return clean;
}

/**
 * Find all documents related to a story
 * @param {Array} allDocs - All documents in the database
 * @param {string} storyId - The story ID
 * @returns {Object} Related documents grouped by type
 */
function findRelatedDocuments(allDocs, storyId) {
  const related = {
    codex: null,
    characterChats: [],
    sceneChats: [],
    storyResearch: [],
    storyImages: [],
    storyVideos: []
  };

  // Validate inputs
  if (!Array.isArray(allDocs)) {
    logger.warn('findRelatedDocuments: allDocs is not an array');
    return related;
  }
  if (!storyId) {
    logger.warn('findRelatedDocuments: storyId is empty');
    return related;
  }

  for (const doc of allDocs) {
    if (!doc || !doc._id) continue;

    // Codex: codex_{storyId}
    if (doc._id === `codex_${storyId}`) {
      related.codex = doc;
    }
    // Character chats: character-chat_{storyId}_*
    else if (doc._id.startsWith(`character-chat_${storyId}_`)) {
      related.characterChats.push(doc);
    }
    // Scene chats: scene-chat_{storyId}_*
    else if (doc._id.startsWith(`scene-chat_${storyId}_`)) {
      related.sceneChats.push(doc);
    }
    // Story research: story-research_{storyId}_*
    else if (doc._id.startsWith(`story-research_${storyId}_`)) {
      related.storyResearch.push(doc);
    }
    // Story images: story-image_{storyId}_*
    else if (doc._id.startsWith(`story-image_${storyId}_`)) {
      related.storyImages.push(doc);
    }
    // Story videos: story-video_{storyId}_*
    else if (doc._id.startsWith(`story-video_${storyId}_`)) {
      related.storyVideos.push(doc);
    }
  }

  return related;
}

/**
 * Remove _rev field from document to reduce snapshot size
 * @param {Object} doc - Document to strip
 * @returns {Object|null} Document without _rev field, or null if doc is falsy/invalid
 */
function stripRevision(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const { _rev, ...rest } = doc;
  return rest;
}

/**
 * Fetch related documents for a story using targeted queries
 * @param {DatabaseClient} db - Database client
 * @param {string} storyId - The story ID
 * @returns {Object} Related documents grouped by type
 */
async function fetchRelatedDocuments(db, storyId) {
  const related = {
    codex: null,
    characterChats: [],
    sceneChats: [],
    storyResearch: [],
    storyImages: [],
    storyVideos: []
  };

  // Helper to fetch documents by prefix using _all_docs with startkey/endkey
  async function fetchByPrefix(prefix) {
    try {
      const result = await db.allDocs({
        startkey: prefix,
        endkey: prefix + '\ufff0',
        include_docs: true
      });
      return (result.rows || [])
        .map(row => row.doc)
        .filter(doc => doc && !doc._deleted);
    } catch (error) {
      logger.warn(`Failed to fetch documents with prefix ${prefix}:`, error.message);
      return [];
    }
  }

  // Fetch codex directly by ID
  try {
    related.codex = await db.get(`codex_${storyId}`);
  } catch (error) {
    if (error.statusCode !== 404) {
      logger.warn(`Failed to fetch codex for ${storyId}:`, error.message);
    }
    // 404 is expected if no codex exists
  }

  // Fetch related documents by prefix in parallel
  const [characterChats, sceneChats, storyResearch, storyImages, storyVideos] = await Promise.all([
    fetchByPrefix(`character-chat_${storyId}_`),
    fetchByPrefix(`scene-chat_${storyId}_`),
    fetchByPrefix(`story-research_${storyId}_`),
    fetchByPrefix(`story-image_${storyId}_`),
    fetchByPrefix(`story-video_${storyId}_`)
  ]);

  related.characterChats = characterChats;
  related.sceneChats = sceneChats;
  related.storyResearch = storyResearch;
  related.storyImages = storyImages;
  related.storyVideos = storyVideos;

  return related;
}

/**
 * Create a snapshot for a single story on-demand (for API calls)
 * Unlike scheduled snapshots, this:
 * - Does NOT check if story has changed (always creates snapshot)
 * - Does NOT check idle threshold (immediate creation)
 * - Sets snapshotType to 'manual' and retentionTier to 'manual'
 * - Manual snapshots don't expire
 *
 * @param {string} dbName - Database name
 * @param {string} storyId - Story ID to snapshot
 * @param {Object} options - Options for snapshot creation
 * @returns {Object} Result with snapshotId and metadata
 */
async function createSnapshotForStory(dbName, storyId, options = {}) {
  const {
    triggeredBy = 'user',
    reason = 'Manual snapshot'
  } = options;

  logger.info(`Creating on-demand snapshot for story ${storyId} in ${dbName}`);

  const db = new DatabaseClient(dbName);
  await db.init();

  // Fetch the story document directly by ID
  let story;
  try {
    story = await db.get(storyId);
  } catch (error) {
    if (error.statusCode === 404) {
      throw new Error(`Story ${storyId} not found in database ${dbName}`);
    }
    throw error;
  }

  // Validate it's actually a story document
  if (!story || story.type || !story.chapters || !Array.isArray(story.chapters)) {
    throw new Error(`Document ${storyId} is not a valid story in database ${dbName}`);
  }

  // Fetch related documents using targeted queries
  const relatedDocs = await fetchRelatedDocuments(db, storyId);

  logger.debug(`Story ${storyId}: codex=${!!relatedDocs.codex}, ` +
    `chats=${relatedDocs.characterChats.length + relatedDocs.sceneChats.length}, ` +
    `research=${relatedDocs.storyResearch.length}, ` +
    `images=${relatedDocs.storyImages.length}, ` +
    `videos=${relatedDocs.storyVideos.length}`);

  // Create snapshot document with 'manual' tier (no expiration)
  const snapshot = createSnapshotDocument(story, 'manual', dbName, relatedDocs);

  // Override some fields for manual API-triggered snapshots
  snapshot.triggeredBy = triggeredBy;
  snapshot.reason = reason;
  snapshot.snapshotType = 'manual';
  // Use consistent -manual suffix with random component to avoid race conditions
  const randomSuffix = Math.random().toString(36).substring(2, 8);
  snapshot._id = `snapshot-${storyId}-${Date.now()}-manual-${randomSuffix}`;
  // Remove expiresAt for manual snapshots (they don't expire)
  delete snapshot.expiresAt;

  // Write to database
  const writeResult = await db.insert(snapshot);

  if (!writeResult.ok) {
    throw new Error(`Failed to write snapshot: ${writeResult.error || 'Unknown error'}`);
  }

  logger.info(`Created manual snapshot ${snapshot._id} for story ${storyId}`);

  return {
    success: true,
    snapshotId: snapshot._id,
    storyId: storyId,
    metadata: snapshot.metadata,
    relatedDocuments: {
      hasCodex: !!relatedDocs.codex,
      characterChatCount: relatedDocs.characterChats.length,
      sceneChatCount: relatedDocs.sceneChats.length,
      researchCount: relatedDocs.storyResearch.length,
      imageCount: relatedDocs.storyImages.length,
      videoCount: relatedDocs.storyVideos.length
    }
  };
}

module.exports = {
  createSnapshotsForAllDatabases,
  createSnapshotsForDatabase,
  createSnapshotForStory
};
