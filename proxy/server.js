const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3001;

const COUCHDB_HOST = process.env.COUCHDB_HOST || 'couchdb';
const COUCHDB_PORT = process.env.COUCHDB_PORT || '5984';
const COUCHDB_ADMIN_USER = process.env.COUCHDB_ADMIN_USER || process.env.COUCHDB_USER || 'admin';
const COUCHDB_ADMIN_PASSWORD = process.env.COUCHDB_ADMIN_PASSWORD || process.env.COUCHDB_PASSWORD || 'password';
const COUCHDB_TIMEOUT_MS = Number(process.env.COUCHDB_TIMEOUT_MS || 15000);
const COUCHDB_BASE_URL = `http://${COUCHDB_HOST}:${COUCHDB_PORT}`;

const couchAdminClient = axios.create({
  baseURL: COUCHDB_BASE_URL,
  auth: {
    username: COUCHDB_ADMIN_USER,
    password: COUCHDB_ADMIN_PASSWORD
  },
  timeout: COUCHDB_TIMEOUT_MS
});

// Middleware
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

function sanitizeUsername(rawUsername) {
  if (typeof rawUsername !== 'string') return '';
  return rawUsername
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 20);
}

function getUserDbName(username) {
  return `creative-writer-stories-${username}`;
}

function getUserDocId(username) {
  return `org.couchdb.user:${username}`;
}

function getCookieHeaders(headers) {
  const cookies = headers['set-cookie'];
  if (!cookies) return [];
  return Array.isArray(cookies) ? cookies : [cookies];
}

function validatePassword(password) {
  return typeof password === 'string' && password.length >= 8 && password.length <= 128;
}

async function ensureUserDatabase(username) {
  const dbName = getUserDbName(username);
  const encodedDbName = encodeURIComponent(dbName);

  try {
    await couchAdminClient.put(`/${encodedDbName}`);
  } catch (error) {
    const status = error.response?.status;
    if (status !== 412 && status !== 409) {
      throw error;
    }
  }

  const securityDoc = {
    admins: {
      names: [COUCHDB_ADMIN_USER],
      roles: []
    },
    members: {
      names: [username],
      roles: []
    }
  };

  await couchAdminClient.put(`/${encodedDbName}/_security`, securityDoc);
  return dbName;
}

async function createUserSession(username, password, requestCookies = '') {
  return axios({
    method: 'POST',
    url: `${COUCHDB_BASE_URL}/_session`,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(requestCookies ? { Cookie: requestCookies } : {})
    },
    data: new URLSearchParams({ name: username, password }).toString(),
    timeout: COUCHDB_TIMEOUT_MS,
    validateStatus: () => true
  });
}

function relaySessionCookies(sourceHeaders, response) {
  const cookies = getCookieHeaders(sourceHeaders);
  if (cookies.length > 0) {
    response.setHeader('set-cookie', cookies);
  }
}

function getErrorMessage(error, fallback) {
  if (error?.response?.data) {
    if (typeof error.response.data.reason === 'string') return error.response.data.reason;
    if (typeof error.response.data.error === 'string') return error.response.data.error;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Auth API: Create account + per-user DB
app.post('/api/auth/signup', async (req, res) => {
  const sanitizedUsername = sanitizeUsername(req.body?.username);
  const displayName = typeof req.body?.displayName === 'string' && req.body.displayName.trim()
    ? req.body.displayName.trim().slice(0, 50)
    : sanitizedUsername;
  const password = req.body?.password;

  if (!sanitizedUsername || sanitizedUsername.length < 2) {
    return res.status(400).json({
      error: 'invalid_username',
      message: 'Username must contain at least 2 valid characters (a-z, 0-9, _, -).'
    });
  }

  if (!validatePassword(password)) {
    return res.status(400).json({
      error: 'invalid_password',
      message: 'Password must be between 8 and 128 characters.'
    });
  }

  try {
    const userDocId = encodeURIComponent(getUserDocId(sanitizedUsername));
    await couchAdminClient.put(`/_users/${userDocId}`, {
      _id: getUserDocId(sanitizedUsername),
      name: sanitizedUsername,
      type: 'user',
      roles: [],
      password
    });

    await ensureUserDatabase(sanitizedUsername);

    const sessionResponse = await createUserSession(sanitizedUsername, password);
    relaySessionCookies(sessionResponse.headers, res);

    if (sessionResponse.status !== 200 || !sessionResponse.data?.ok) {
      return res.status(500).json({
        error: 'session_creation_failed',
        message: 'Account created, but automatic sign-in failed. Please sign in manually.'
      });
    }

    return res.status(201).json({
      username: sanitizedUsername,
      displayName
    });
  } catch (error) {
    const status = error.response?.status;

    if (status === 409) {
      return res.status(409).json({
        error: 'username_exists',
        message: 'This username is already in use.'
      });
    }

    console.error('[Auth] Signup failed:', getErrorMessage(error, 'Unknown error'));
    return res.status(500).json({
      error: 'signup_failed',
      message: 'Could not create account.'
    });
  }
});

// Auth API: Sign in
app.post('/api/auth/login', async (req, res) => {
  const sanitizedUsername = sanitizeUsername(req.body?.username);
  const displayName = typeof req.body?.displayName === 'string' && req.body.displayName.trim()
    ? req.body.displayName.trim().slice(0, 50)
    : sanitizedUsername;
  const password = req.body?.password;

  if (!sanitizedUsername || !password) {
    return res.status(400).json({
      error: 'missing_credentials',
      message: 'Username and password are required.'
    });
  }

  try {
    const sessionResponse = await createUserSession(sanitizedUsername, password, req.headers.cookie || '');
    relaySessionCookies(sessionResponse.headers, res);

    if (sessionResponse.status !== 200 || !sessionResponse.data?.ok || sessionResponse.data.name !== sanitizedUsername) {
      return res.status(401).json({
        error: 'invalid_credentials',
        message: 'Invalid username or password.'
      });
    }

    // Ensure legacy/public database is protected for this user.
    await ensureUserDatabase(sanitizedUsername);

    return res.json({
      username: sanitizedUsername,
      displayName
    });
  } catch (error) {
    console.error('[Auth] Login failed:', getErrorMessage(error, 'Unknown error'));
    return res.status(500).json({
      error: 'login_failed',
      message: 'Could not sign in.'
    });
  }
});

// Auth API: Session info
app.get('/api/auth/me', async (req, res) => {
  try {
    const response = await axios({
      method: 'GET',
      url: `${COUCHDB_BASE_URL}/_session`,
      headers: {
        ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {})
      },
      timeout: COUCHDB_TIMEOUT_MS,
      validateStatus: () => true
    });

    if (response.status !== 200 || !response.data?.userCtx?.name) {
      return res.status(401).json({
        authenticated: false
      });
    }

    return res.json({
      authenticated: true,
      username: response.data.userCtx.name
    });
  } catch (error) {
    console.error('[Auth] Session lookup failed:', getErrorMessage(error, 'Unknown error'));
    return res.status(500).json({
      error: 'session_lookup_failed',
      message: 'Could not read session status.'
    });
  }
});

// Auth API: Sign out
app.post('/api/auth/logout', async (req, res) => {
  try {
    const response = await axios({
      method: 'DELETE',
      url: `${COUCHDB_BASE_URL}/_session`,
      headers: {
        ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {})
      },
      timeout: COUCHDB_TIMEOUT_MS,
      validateStatus: () => true
    });

    relaySessionCookies(response.headers, res);

    return res.json({
      ok: true
    });
  } catch (error) {
    console.error('[Auth] Logout failed:', getErrorMessage(error, 'Unknown error'));
    return res.status(500).json({
      error: 'logout_failed',
      message: 'Could not sign out cleanly.'
    });
  }
});

// Test endpoint for Replicate
app.get('/api/replicate/test', (req, res) => {
  const apiTokenFromHeader = req.headers['x-api-token'];
  res.json({
    status: 'ok',
    message: 'Replicate proxy is running',
    apiTokenConfigured: !!apiTokenFromHeader,
    apiTokenSource: apiTokenFromHeader ? 'header' : 'none',
    timestamp: new Date().toISOString()
  });
});

// Test endpoint for fal.ai
app.get('/api/fal/test', (req, res) => {
  const apiTokenFromHeader = req.headers['x-api-token'];
  res.json({
    status: 'ok',
    message: 'fal.ai proxy is running',
    apiTokenConfigured: !!apiTokenFromHeader,
    apiTokenSource: apiTokenFromHeader ? 'header' : 'none',
    timestamp: new Date().toISOString()
  });
});

// Proxy fal.ai models discovery API
app.get('/api/fal-models', async (req, res) => {
  try {
    const apiToken = req.headers['x-api-token'];

    if (!apiToken) {
      console.error('No API token provided for fal.ai models in X-API-Token header');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'API token is required. Please provide it in X-API-Token header'
      });
    }

    // Build query string from request query params
    const queryParams = new URLSearchParams(req.query).toString();
    // Use the official Platform API endpoint which properly supports category filtering
    const url = `https://api.fal.ai/v1/models${queryParams ? '?' + queryParams : ''}`;

    console.log(`Fetching fal.ai models: ${url}`);

    const config = {
      method: 'GET',
      url,
      headers: {
        'Authorization': `Key ${apiToken}`,
        'Content-Type': 'application/json'
      }
    };

    const response = await axios(config);
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error('fal.ai models API error:', error.message);
    if (error.response) {
      console.error('fal.ai models API error response:', JSON.stringify(error.response.data, null, 2));
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: 'Proxy error', message: error.message });
    }
  }
});

// Proxy all requests to fal.ai
app.all('/api/fal/*', async (req, res) => {
  try {
    const path = req.params[0];
    const url = `https://fal.run/${path}`;

    // Get API token from header
    const apiToken = req.headers['x-api-token'];

    if (!apiToken) {
      console.error('No API token provided for fal.ai in X-API-Token header');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'API token is required. Please provide it in X-API-Token header'
      });
    }

    console.log(`Proxying ${req.method} request to fal.ai: ${url}`);

    const config = {
      method: req.method,
      url,
      headers: {
        'Authorization': `Key ${apiToken}`,
        'Content-Type': 'application/json'
      },
      data: req.body
    };

    const response = await axios(config);

    // Forward response
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error('fal.ai proxy error:', error.message);
    if (error.response) {
      console.error('fal.ai API error response:', JSON.stringify(error.response.data, null, 2));
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: 'Proxy error', message: error.message });
    }
  }
});

// Proxy all requests to Replicate
app.all('/api/replicate/*', async (req, res) => {
  try {
    const path = req.params[0];
    const url = `https://api.replicate.com/v1/${path}`;

    // Get API token from header only
    const apiToken = req.headers['x-api-token'];

    if (!apiToken) {
      console.error('No API token provided in X-API-Token header');
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'API token is required. Please provide it in X-API-Token header'
      });
    }

    console.log(`Proxying ${req.method} request to: ${url}`);
    console.log('API Token source: header');

    const config = {
      method: req.method,
      url,
      headers: {
        'Authorization': `Token ${apiToken}`,
        'Content-Type': 'application/json',
        // Only add Accept header if present, avoid spreading all headers for security
        ...(req.headers.accept && { 'Accept': req.headers.accept })
      },
      data: req.body
    };

    const response = await axios(config);

    // Forward response
    res.status(response.status).json(response.data);
  } catch (error) {
    console.error('Proxy error:', error.message);
    if (error.response) {
      console.error('Replicate API error response:', JSON.stringify(error.response.data, null, 2));
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: 'Proxy error', message: error.message });
    }
  }
});

app.listen(PORT, () => {
  console.log(`Unified proxy server running on port ${PORT}`);
  console.log(`CouchDB admin endpoint: ${COUCHDB_BASE_URL}`);
});
