# Release Notes

> **Fix CouchDB fresh install errors — self-hosted setup now works out of the box**

## 📋 Release Information
- **Commits**: 1 commit since last release
- **Key Areas**: CouchDB Docker Setup, Snapshot Service, Self-Hosted Deployment

## 🔧 Bug Fixes

### CouchDB Fresh Install (Closes #23)
- 🐛 **Fixed health check 401 errors** - CouchDB container was stuck in "unhealthy" state on fresh `docker compose up -d` because the health check endpoint required authentication. Switched to `require_valid_user_except_for_up` (CouchDB 3.2+ feature) so the `/_up` endpoint works without credentials while all other endpoints remain protected
- 🐛 **Fixed missing system databases** - CouchDB 3.x single-node mode does not auto-create `_users`, `_replicator`, and `_global_changes`. Added an init script that creates these databases automatically on first start (idempotent — safe on restarts)
- 🐛 **Fixed 400 errors on snapshot statistics** - The `by_tier` view was missing a reduce function, causing `group` queries to fail. Added `_count` reduce and corrected the query to use `group_level: 1` for proper per-tier aggregation

### Container Stability
- ⚡ **Clean container shutdown** - Added signal forwarding (SIGTERM/SIGINT/SIGQUIT) in the init script and preserved `tini` as PID 1, preventing potential CouchDB data corruption on `docker stop`
- 🔧 **Increased health check start period** - Extended from 5s to 15s to allow the init script time to create system databases before Docker marks the container as unhealthy

## 🏗️ Technical Improvements
- **New entrypoint script**: `couchdb/docker-entrypoint-initdb.sh` wraps the original CouchDB entrypoint, waits for readiness, then creates system databases via authenticated PUT requests
- **Idempotent initialization**: The init script handles 412 (already exists) responses gracefully, making it safe for both fresh installs and container restarts
- **View index auto-update**: The snapshot service's `ensureViews()` detects the new reduce function and updates the design document automatically on first run after upgrade

---
*Release prepared with [Claude Code](https://claude.com/claude-code)*
