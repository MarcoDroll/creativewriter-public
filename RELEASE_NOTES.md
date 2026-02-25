# Release Notes

> **Per-user database security, Stripe portal fixes for self-hosters, and UX improvements**

## 📋 Release Information
- **Commits**: 8 commits since last release
- **Key Areas**: Database Security, Premium Portal, Beat Navigation, User Authentication

## 🎯 New Features

### Per-User Database Authentication
- 🔐 **Per-user CouchDB credentials** - Each user now gets their own CouchDB account with isolated database access, replacing the shared admin credentials model
- 🔄 **Automatic credential provisioning** - User credentials are created on first login and securely stored for subsequent sync sessions
- 🛡️ **Proxy-mediated auth flow** - The proxy service manages CouchDB user lifecycle, ensuring credentials are validated and rotated properly
- 📝 **Migration hint for existing users** - Users with pre-password sync setups see a helpful prompt guiding them through the transition

### Signup Error Handling
- ⚠️ **Duplicate username detection** - Signup now shows a clear error when a username is already taken, instead of a generic failure message

## ✨ Improvements

### Beat Navigation
- 📱 **Improved touch scrolling** - The beat navigation panel now handles touch gestures natively for smoother scrolling on mobile and tablet devices
- ⚡ **Simplified scroll architecture** - Moved scroll management directly into the navigation panel component for more reliable behavior

## 🔧 Bug Fixes

### Stripe Premium Portal (Self-Hosted)
- 🔧 **Fixed portal redirect for self-hosters** - Users on custom domains (e.g. `qw05.de`) were being redirected to `localhost:3080` after Stripe email verification. The portal now uses a cookie-based redirect proxy that works with any domain
- 🌐 **Scales to unlimited origins** - Instead of creating per-domain Stripe portal configurations (limited to 25), the Worker acts as a redirect proxy using first-party cookies, supporting any number of self-hosted deployments
- 🛡️ **Open redirect protection** - The return URL is validated against the browser's Origin header to prevent redirect-based attacks

## 🏗️ Technical Improvements
- **Database Security**: Per-user CouchDB authentication replaces shared admin credentials across the entire sync stack (proxy, nginx, database service)
- **Portal Architecture**: Single Stripe portal configuration with Worker-based redirect proxy (`/api/portal/start` → cookie → `/api/portal/return`) replaces per-origin config approach
- **Token-Based Handoff**: One-time KV tokens with 1-hour TTL link the portal initiation to the redirect flow securely

---
*Release prepared with [Claude Code](https://claude.com/claude-code)*
