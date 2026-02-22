/**
 * CouchDB client wrapper
 * Handles connection and common operations
 */

const nano = require('nano');
const http = require('http');
const config = require('./config');
const logger = require('./logger');

const COUCHDB_URL = `http://${config.COUCHDB_USER}:${config.COUCHDB_PASSWORD}@${config.COUCHDB_HOST}:${config.COUCHDB_PORT}`;

// Reusable HTTP agent with connection pooling to prevent DNS resolution overload
const agent = new http.Agent({
  keepAlive: true,
  maxSockets: 50,           // Increased from 10 for better parallel query handling
  keepAliveMsecs: 30000
});

// Request timeout in ms (applied via nano requestDefaults)
const REQUEST_TIMEOUT = 30000;

let connection = null;

// Transient error codes that should trigger retry
const TRANSIENT_ERRORS = ['EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'];
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

/**
 * Retry wrapper for operations that may fail due to transient network errors
 * Uses exponential backoff
 */
async function withRetry(operation, operationName) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const isTransient = TRANSIENT_ERRORS.some(code =>
        error.message?.includes(code) || error.code === code
      );

      if (!isTransient || attempt === MAX_RETRIES) {
        throw error;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      logger.warn(`${operationName} failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function getConnection() {
  if (!connection) {
    connection = nano({
      url: COUCHDB_URL,
      requestDefaults: {
        agent,
        timeout: REQUEST_TIMEOUT  // Request timeout to prevent hanging connections
      }
    });
    logger.info(`Connected to CouchDB at ${config.COUCHDB_HOST}:${config.COUCHDB_PORT}`);
  }
  return connection;
}

/**
 * Get all user databases (those matching the pattern)
 */
async function getAllUserDatabases() {
  return withRetry(async () => {
    const couch = getConnection();
    const allDbs = await couch.db.list();

    // Filter for story databases
    const userDbs = allDbs.filter(db =>
      db.startsWith(config.DATABASE_PATTERN) &&
      !db.includes('_replicator') &&
      !db.includes('_users')
    );

    logger.debug(`Found ${userDbs.length} user databases: ${userDbs.join(', ')}`);
    return userDbs;
  }, 'getAllUserDatabases');
}

/**
 * Database client for a specific database
 */
class DatabaseClient {
  constructor(dbName) {
    this.dbName = dbName;
    this.db = null;
  }

  async init() {
    return withRetry(async () => {
      const couch = getConnection();

      try {
        // Check if database exists
        await couch.db.get(this.dbName);
        this.db = couch.use(this.dbName);
      } catch (error) {
        if (error.statusCode === 404) {
          // Database doesn't exist, create it
          await couch.db.create(this.dbName);
          logger.info(`Created database: ${this.dbName}`);
          this.db = couch.use(this.dbName);
        } else {
          throw error;
        }
      }

      await this.ensureViews();
    }, `DatabaseClient.init(${this.dbName})`);
  }

  /**
   * Create design documents for views if they don't exist or need updating
   */
  async ensureViews() {
    const viewDefinitions = {
      by_story_and_date: {
        map: function(doc) {
          if (doc.type === 'story-snapshot') {
            emit([doc.storyId, doc.createdAt], {
              tier: doc.retentionTier,
              wordCount: doc.metadata ? doc.metadata.wordCount : 0
            });
          }
        }.toString()
      },
      by_expiration: {
        map: function(doc) {
          if (doc.type === 'story-snapshot' && doc.expiresAt) {
            emit(doc.expiresAt, doc.storyId);
          }
        }.toString()
      },
      by_tier: {
        map: function(doc) {
          if (doc.type === 'story-snapshot') {
            emit([doc.retentionTier, doc.createdAt], doc.storyId);
          }
        }.toString()
      }
    };

    try {
      // Try to get existing design document
      const existing = await this.db.get('_design/snapshots');

      // Check if views are already up-to-date (compare stringified versions)
      const existingViews = JSON.stringify(existing.views);
      const newViews = JSON.stringify(viewDefinitions);

      if (existingViews === newViews) {
        logger.debug(`Views already up-to-date for database: ${this.dbName}`);
        return;
      }

      // Views need updating
      const designDoc = {
        _id: '_design/snapshots',
        _rev: existing._rev,
        views: viewDefinitions
      };

      await this.db.insert(designDoc);
      logger.info(`Updated views for database: ${this.dbName}`);
    } catch (error) {
      if (error.statusCode === 404) {
        // Design doc doesn't exist, create it
        try {
          const designDoc = {
            _id: '_design/snapshots',
            views: viewDefinitions
          };
          await this.db.insert(designDoc);
          logger.info(`Created views for database: ${this.dbName}`);
        } catch (insertError) {
          // Handle race condition - another process may have created it
          if (insertError.statusCode === 409) {
            logger.debug(`Views already created by another process for: ${this.dbName}`);
          } else {
            throw insertError;
          }
        }
      } else if (error.statusCode === 409) {
        // Conflict - another process updated the design doc, that's fine
        logger.debug(`Views update conflict (another process updated): ${this.dbName}`);
      } else {
        logger.error(`Failed to ensure views for ${this.dbName}:`, error);
      }
    }
  }

  /**
   * Query a view
   */
  async view(designDoc, viewName, options = {}) {
    return this.db.view(designDoc, viewName, options);
  }

  /**
   * Bulk operations
   */
  async bulk(docs) {
    return this.db.bulk(docs);
  }

  /**
   * Get a document
   */
  async get(id) {
    return this.db.get(id);
  }

  /**
   * Insert or update a document
   */
  async insert(doc) {
    return this.db.insert(doc);
  }

  /**
   * Get all documents
   * Note: nano's list() function may not include docs by default.
   * We use the _all_docs endpoint with include_docs=true.
   */
  /**
   * Get all documents - returns the raw db reference for direct access
   */
  getDb() {
    return this.db;
  }

  async allDocs(options = {}) {
    // Store debug info that can be accessed externally
    this._lastAllDocsDebug = { started: true, options };

    try {
      // Check this.db before calling
      this._lastAllDocsDebug.hasDb = !!this.db;
      this._lastAllDocsDebug.dbType = typeof this.db;

      // Get a fresh db reference from the connection
      const couch = getConnection();
      const freshDb = couch.use(this.dbName);
      this._lastAllDocsDebug.usingFreshDb = true;

      // WORKAROUND: nano methods return undefined for include_docs
      // Use native fetch to make direct HTTP request to CouchDB
      let result;

      if (options.include_docs) {
        // Build query string with all supported parameters
        const params = new URLSearchParams();
        params.append('include_docs', 'true');
        if (options.startkey !== undefined) {
          params.append('startkey', JSON.stringify(options.startkey));
        }
        if (options.endkey !== undefined) {
          params.append('endkey', JSON.stringify(options.endkey));
        }
        if (options.limit !== undefined) {
          params.append('limit', options.limit.toString());
        }
        if (options.descending !== undefined) {
          params.append('descending', options.descending.toString());
        }

        const url = `http://${config.COUCHDB_HOST}:${config.COUCHDB_PORT}/${this.dbName}/_all_docs?${params.toString()}`;
        const authHeader = 'Basic ' + Buffer.from(`${config.COUCHDB_USER}:${config.COUCHDB_PASSWORD}`).toString('base64');
        this._lastAllDocsDebug.fetchUrl = url;

        // When using 'keys' parameter, CouchDB requires a POST request with keys in body
        const fetchOptions = {
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/json'
          }
        };

        if (options.keys && Array.isArray(options.keys)) {
          fetchOptions.method = 'POST';
          fetchOptions.body = JSON.stringify({ keys: options.keys });
          this._lastAllDocsDebug.usingKeysPost = true;
        }

        const response = await fetch(url, fetchOptions);
        this._lastAllDocsDebug.fetchStatus = response.status;
        this._lastAllDocsDebug.fetchOk = response.ok;

        if (response.ok) {
          result = await response.json();
          this._lastAllDocsDebug.parsedJson = true;
        } else {
          const errorText = await response.text();
          this._lastAllDocsDebug.fetchError = errorText;
          throw new Error(`CouchDB request failed: ${response.status} ${errorText}`);
        }
      } else {
        result = await freshDb.list(options);
      }

      this._lastAllDocsDebug.gotResult = true;
      this._lastAllDocsDebug.resultType = typeof result;
      this._lastAllDocsDebug.resultKeys = result ? Object.keys(result) : [];
      this._lastAllDocsDebug.totalRows = result?.total_rows;
      this._lastAllDocsDebug.rowsLength = result?.rows?.length;
      this._lastAllDocsDebug.rowsIsArray = Array.isArray(result?.rows);

      // Debug: log the structure we got back
      logger.debug(`allDocs for ${this.dbName}: got ${result?.rows?.length || 0} rows, total_rows=${result?.total_rows || 'undefined'}`);

      // Ensure result has expected structure
      if (!result || typeof result !== 'object') {
        logger.warn(`Unexpected allDocs result type for ${this.dbName}: ${typeof result}`);
        this._lastAllDocsDebug.earlyReturn = 'not object';
        return { rows: [], total_rows: 0, offset: 0 };
      }
      if (!Array.isArray(result.rows)) {
        logger.warn(`allDocs result missing rows array for ${this.dbName}`);
        this._lastAllDocsDebug.earlyReturn = 'rows not array';
        return { rows: [], total_rows: 0, offset: 0 };
      }

      // Debug: Check first row structure
      if (result.rows.length > 0) {
        const firstRow = result.rows[0];
        logger.debug(`First row structure: id=${firstRow.id}, hasDoc=${firstRow.doc !== undefined}, keys=${Object.keys(firstRow).join(',')}`);
      }

      this._lastAllDocsDebug.success = true;
      return result;
    } catch (error) {
      this._lastAllDocsDebug.error = error.message;
      logger.error(`Error fetching allDocs for ${this.dbName}:`, error);
      throw error;
    }
  }
}

module.exports = {
  getConnection,
  getAllUserDatabases,
  DatabaseClient,
  withRetry
};
