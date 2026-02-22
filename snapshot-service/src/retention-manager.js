/**
 * Retention management and snapshot pruning
 */

const logger = require('./logger');
const config = require('./config');
const { DatabaseClient, getAllUserDatabases, withRetry } = require('./couchdb-client');

/**
 * Prune expired snapshots across all databases
 */
async function pruneExpiredSnapshotsForAllDatabases() {
  const startTime = Date.now();
  logger.info('Starting snapshot retention cleanup across all databases');

  try {
    const databases = await getAllUserDatabases();
    let totalDeleted = 0;

    for (const dbName of databases) {
      try {
        const deleted = await pruneExpiredSnapshots(dbName);
        totalDeleted += deleted;
      } catch (error) {
        logger.error(`Failed to prune snapshots for database ${dbName}:`, error);
        // Continue with other databases
      }
    }

    const duration = Date.now() - startTime;
    logger.info(`Deleted ${totalDeleted} expired snapshots across ${databases.length} databases in ${duration}ms`);

    return totalDeleted;
  } catch (error) {
    logger.error('Failed to prune expired snapshots:', error);
    throw error;
  }
}

/**
 * Prune expired snapshots in a specific database
 */
async function pruneExpiredSnapshots(dbName) {
  const db = new DatabaseClient(dbName);
  await db.init();

  const now = new Date();

  try {
    // Find expired snapshots using view
    const result = await db.view('snapshots', 'by_expiration', {
      endkey: now.toISOString(),
      include_docs: true
    });

    if (result.rows.length === 0) {
      logger.debug(`No expired snapshots to delete in ${dbName}`);
      return 0;
    }

    // Mark for deletion
    const toDelete = result.rows.map(row => ({
      ...row.doc,
      _deleted: true
    }));

    // Bulk delete
    const bulkResult = await db.bulk({ docs: toDelete });

    const deleted = bulkResult.filter(r => r.ok).length;
    const failed = bulkResult.filter(r => !r.ok).length;

    logger.info(`Deleted ${deleted} expired snapshots in ${dbName}${failed > 0 ? ` (${failed} failed)` : ''}`);

    return deleted;
  } catch (error) {
    // View might not exist yet
    logger.debug(`Error querying expired snapshots in ${dbName}:`, error.message);
    return 0;
  }
}

/**
 * Prune excess snapshots for a specific story (safety limit)
 */
async function pruneExcessSnapshotsForStory(db, storyId, maxSnapshots = config.MAX_SNAPSHOTS_PER_STORY) {
  try {
    // Get all snapshots for this story
    const result = await db.view('snapshots', 'by_story_and_date', {
      startkey: [storyId],
      endkey: [storyId, {}],
      include_docs: true
    });

    if (result.rows.length <= maxSnapshots) {
      return 0; // Within limit
    }

    // Sort by date (oldest first) and delete excess
    const sorted = result.rows.sort((a, b) =>
      new Date(a.key[1]) - new Date(b.key[1])
    );

    const excess = sorted.slice(0, sorted.length - maxSnapshots);
    const toDelete = excess.map(row => ({
      ...row.doc,
      _deleted: true
    }));

    await db.bulk({ docs: toDelete });

    logger.info(`Pruned ${toDelete.length} excess snapshots for story ${storyId}`);

    return toDelete.length;
  } catch (error) {
    logger.error(`Error pruning excess snapshots for story ${storyId}:`, error);
    return 0;
  }
}

/**
 * Get snapshot statistics for a database
 */
async function getSnapshotStats(dbName) {
  return withRetry(async () => {
    const db = new DatabaseClient(dbName);
    await db.init();

    try {
      const result = await db.view('snapshots', 'by_tier', {
        group: true
      });

      const stats = {
        total: 0,
        byTier: {}
      };

      result.rows.forEach(row => {
        const tier = row.key[0];
        const count = row.value;
        stats.byTier[tier] = count;
        stats.total += count;
      });

      return stats;
    } catch (error) {
      logger.debug(`Error getting snapshot stats for ${dbName}:`, error.message);
      return { total: 0, byTier: {} };
    }
  }, `getSnapshotStats(${dbName})`);
}

/**
 * Get overall snapshot statistics across all databases
 */
async function getAllSnapshotStats() {
  try {
    const databases = await getAllUserDatabases();
    const allStats = {
      totalDatabases: databases.length,
      totalSnapshots: 0,
      byTier: {
        granular: 0,
        hourly: 0,
        daily: 0,
        weekly: 0,
        monthly: 0,
        manual: 0
      },
      byDatabase: {}
    };

    for (const dbName of databases) {
      try {
        const stats = await getSnapshotStats(dbName);
        allStats.totalSnapshots += stats.total;
        allStats.byDatabase[dbName] = stats;

        // Aggregate by tier
        Object.entries(stats.byTier).forEach(([tier, count]) => {
          allStats.byTier[tier] = (allStats.byTier[tier] || 0) + count;
        });
      } catch (error) {
        logger.error(`Failed to get stats for ${dbName}:`, error);
      }
    }

    return allStats;
  } catch (error) {
    logger.error('Failed to get overall snapshot stats:', error);
    throw error;
  }
}

module.exports = {
  pruneExpiredSnapshotsForAllDatabases,
  pruneExpiredSnapshots,
  pruneExcessSnapshotsForStory,
  getSnapshotStats,
  getAllSnapshotStats
};
