#!/bin/bash
set -e

# Start CouchDB in the background using the original entrypoint
/docker-entrypoint.sh /opt/couchdb/bin/couchdb &
COUCHDB_PID=$!

# Forward signals to CouchDB for clean shutdown (prevents data corruption)
trap 'kill -TERM "$COUCHDB_PID" 2>/dev/null; wait "$COUCHDB_PID"' SIGTERM SIGINT SIGQUIT

# Wait for CouchDB to become available
echo "Waiting for CouchDB to start..."
MAX_TRIES=30
COUNT=0
until curl -sf http://localhost:5984/_up > /dev/null 2>&1; do
  COUNT=$((COUNT + 1))
  if [ "$COUNT" -ge "$MAX_TRIES" ]; then
    echo "ERROR: CouchDB did not start within ${MAX_TRIES} seconds"
    exit 1
  fi
  sleep 1
done
echo "CouchDB is up."

# Create system databases (idempotent — PUT returns 412 if they already exist)
for DB in _users _replicator _global_changes; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X PUT \
    -u "${COUCHDB_USER}:${COUCHDB_PASSWORD}" \
    "http://localhost:5984/${DB}")
  if [ "$STATUS" = "201" ]; then
    echo "Created system database: ${DB}"
  elif [ "$STATUS" = "412" ]; then
    echo "System database already exists: ${DB}"
  else
    echo "WARNING: Unexpected status ${STATUS} creating ${DB}"
  fi
done

echo "System database initialization complete."

# Keep running — wait for CouchDB process
wait "$COUCHDB_PID"
