/**
 * Snapshot Service - Main Entry Point
 *
 * Automated snapshot creation and retention management for Creative Writer stories
 * Includes HTTP API for on-demand snapshot creation
 */

const express = require('express');
const cors = require('cors');
const logger = require('./logger');
const config = require('./config');
const { initializeScheduler } = require('./scheduler');
const { getConnection, getAllUserDatabases } = require('./couchdb-client');
const { getAllSnapshotStats } = require('./retention-manager');
const { createSnapshotForStory } = require('./snapshot-creator');

// Reference to HTTP server for graceful shutdown
let httpServer = null;

/**
 * Startup initialization
 */
async function startup() {
  logger.info('=== Creative Writer Snapshot Service ===');
  logger.info(`Version: ${require('../package.json').version}`);
  logger.info(`Node: ${process.version}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

  // Log configuration (without sensitive data)
  logger.info('Configuration:', {
    couchdb: {
      host: config.COUCHDB_HOST,
      port: config.COUCHDB_PORT,
      user: config.COUCHDB_USER
    },
    snapshots: {
      enabled: config.SNAPSHOT_ENABLED,
      maxPerStory: config.MAX_SNAPSHOTS_PER_STORY,
      idleThresholdMinutes: config.IDLE_THRESHOLD_MINUTES,
      batchSize: config.BATCH_SIZE
    },
    timezone: config.TZ,
    logLevel: config.LOG_LEVEL
  });

  try {
    // Test CouchDB connection
    logger.info('Testing CouchDB connection...');
    const couch = getConnection();
    const info = await couch.db.list();
    logger.info(`Connected to CouchDB successfully (${info.length} databases found)`);

    // Discover user databases
    const databases = await getAllUserDatabases();
    logger.info(`Found ${databases.length} user databases to monitor`);

    // Get initial snapshot statistics
    logger.info('Loading initial snapshot statistics...');
    const stats = await getAllSnapshotStats();
    logger.info('Initial snapshot statistics:', stats);

    // Initialize scheduler
    initializeScheduler();

    // Initialize HTTP API server
    initializeApiServer();

    logger.info('=== Snapshot Service Ready ===');
    logger.info('Service is running and waiting for scheduled tasks');
  } catch (error) {
    logger.error('Failed to start snapshot service:', error);
    process.exit(1);
  }
}

/**
 * Initialize HTTP API server for on-demand snapshot creation
 */
function initializeApiServer() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'snapshot-service',
      version: require('../package.json').version,
      timestamp: new Date().toISOString()
    });
  });

  // Debug endpoint to list all databases
  app.get('/api/debug/databases', async (req, res) => {
    try {
      const { getConnection, getAllUserDatabases } = require('./couchdb-client');
      const couch = getConnection();
      const allDbs = await couch.db.list();
      const userDbs = await getAllUserDatabases();

      res.json({
        totalDatabases: allDbs.length,
        allDatabases: allDbs,
        userDatabases: userDbs,
        couchdbHost: config.COUCHDB_HOST,
        couchdbPort: config.COUCHDB_PORT,
        couchdbUser: config.COUCHDB_USER,
        couchdbPasswordSet: !!config.COUCHDB_PASSWORD,
        envUser: process.env.COUCHDB_USER || '(not set)',
        envPassword: process.env.COUCHDB_PASSWORD ? '(set)' : '(not set)'
      });
    } catch (error) {
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  // Debug endpoint to inspect database contents
  app.get('/api/debug/:dbName/:storyId', async (req, res) => {
    const { dbName, storyId } = req.params;

    try {
      const { DatabaseClient, getConnection } = require('./couchdb-client');

      // FIRST: Try via DatabaseClient (before any other calls that might affect state)
      const dbClient = new DatabaseClient(dbName);
      await dbClient.init();

      const result = await dbClient.allDocs({ include_docs: true });
      const allDocs = result.rows.map(row => row.doc).filter(Boolean);

      // Check db state after init
      const dbState = {
        hasDb: !!dbClient.db,
        dbName: dbClient.dbName
      };

      // AFTER: Try direct nano access to the database
      const couch = getConnection();
      const directDb = couch.use(dbName);
      const directResult = await directDb.list({ include_docs: true, limit: 5 });

      // Try list directly on the client's db reference
      let clientDirectList = null;
      if (dbClient.db) {
        try {
          clientDirectList = await dbClient.db.list({ include_docs: true, limit: 3 });
        } catch (e) {
          clientDirectList = { error: e.message };
        }
      }

      // Find the specific document
      const targetDoc = allDocs.find(doc => doc._id === storyId);

      // Find potential story matches
      const stories = allDocs.filter(doc =>
        doc &&
        !doc._id?.startsWith('_design') &&
        !doc.type &&
        doc.chapters && Array.isArray(doc.chapters)
      );

      res.json({
        dbName,
        storyId,
        directAccess: {
          totalRows: directResult.total_rows,
          rowCount: directResult.rows?.length || 0,
          firstRowId: directResult.rows?.[0]?.id,
          firstRowHasDoc: !!directResult.rows?.[0]?.doc
        },
        dbClientState: dbState,
        clientDirectList: clientDirectList ? {
          totalRows: clientDirectList.total_rows,
          rowCount: clientDirectList.rows?.length || 0,
          error: clientDirectList.error
        } : null,
        viaAllDocs: {
          totalDocs: allDocs.length,
          resultRowCount: result.rows?.length || 0,
          resultTotalRows: result.total_rows,
          debug: dbClient._lastAllDocsDebug
        },
        storiesFound: stories.length,
        storyIds: stories.map(s => s._id),
        targetDocExists: !!targetDoc,
        targetDocInfo: targetDoc ? {
          _id: targetDoc._id,
          hasType: !!targetDoc.type,
          type: targetDoc.type,
          hasChapters: !!targetDoc.chapters,
          chaptersIsArray: Array.isArray(targetDoc.chapters),
          keys: Object.keys(targetDoc)
        } : null
      });
    } catch (error) {
      res.status(500).json({ error: error.message, stack: error.stack });
    }
  });

  // Create snapshot for a specific story
  app.post('/api/snapshot', async (req, res) => {
    const { dbName, storyId, reason } = req.body;

    // Validate required parameters
    if (!dbName || typeof dbName !== 'string') {
      return res.status(400).json({
        error: 'dbName is required and must be a string'
      });
    }

    if (!storyId || typeof storyId !== 'string') {
      return res.status(400).json({
        error: 'storyId is required and must be a string'
      });
    }

    // Validate database name pattern for security
    if (!dbName.startsWith(config.DATABASE_PATTERN)) {
      return res.status(400).json({
        error: `Invalid database name. Must start with '${config.DATABASE_PATTERN}'`
      });
    }

    logger.info(`API request: Create snapshot for ${storyId} in ${dbName}`);

    try {
      const result = await createSnapshotForStory(dbName, storyId, {
        triggeredBy: 'user',
        reason: reason || 'Manual snapshot via API'
      });

      logger.info(`API response: Snapshot created successfully - ${result.snapshotId}`);
      res.json(result);
    } catch (error) {
      logger.error(`API error: Failed to create snapshot for ${storyId}:`, error);

      // Return appropriate HTTP status based on error type
      const isNotFound = error.message && error.message.includes('not found');
      const statusCode = isNotFound ? 404 : 500;

      res.status(statusCode).json({
        error: error.message || 'Failed to create snapshot'
      });
    }
  });

  // Start the server and store reference for graceful shutdown
  const API_PORT = process.env.API_PORT || 3003;
  httpServer = app.listen(API_PORT, () => {
    logger.info(`Snapshot API server listening on port ${API_PORT}`);
  });

  // Handle server errors
  httpServer.on('error', (error) => {
    logger.error('HTTP server error:', error);
  });
}

/**
 * Graceful shutdown
 */
async function shutdown(signal) {
  logger.info(`Received ${signal}, shutting down gracefully...`);

  try {
    // Close HTTP server first to stop accepting new connections
    if (httpServer) {
      await new Promise((resolve, reject) => {
        httpServer.close((err) => {
          if (err) {
            logger.warn('Error closing HTTP server:', err);
            reject(err);
          } else {
            logger.info('HTTP server closed');
            resolve();
          }
        });
      });
    }

    // Get final statistics
    const stats = await getAllSnapshotStats();
    logger.info('Final snapshot statistics:', stats);

    logger.info('Snapshot service stopped');
    process.exit(0);
  } catch (error) {
    logger.error('Error during shutdown:', error);
    process.exit(1);
  }
}

// Handle shutdown signals
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled promise rejection:', reason);
  process.exit(1);
});

// Start the service
startup().catch((error) => {
  logger.error('Startup failed:', error);
  process.exit(1);
});
