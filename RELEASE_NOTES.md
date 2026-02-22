# Release Notes

> **Massive update: Server-side AI generation, OpenAI-compatible providers, per-story media architecture, snapshot system overhaul, and 50+ UX improvements**

## 📋 Release Information
- **Commits**: 215 commits since last release
- **Key Areas**: Server-Side Generation, OpenAI-Compatible Providers, Media & Image System, Snapshot System, Beat AI, Codex, Mobile UX, Design Tokens, Sync Reliability

## 🎯 New Features

### Server-Side AI Generation
- 🚀 **Generation Service** - New Express backend for server-side AI generation, enabling generation without exposing API keys to the client
- 🔄 **Story Research Migration** - Story research now uses server-side generation for improved reliability
- 📊 **Generation Status Persistence** - Active generation status survives page refreshes — no more lost progress
- ⚡ **Streaming Scene Generation** - Scene-from-outline generation now streams results in real-time
- ⚙️ **Experimental Label** - Server-side generation clearly marked as experimental in settings

### OpenAI-Compatible Provider Support
- 🌐 **Custom Provider Integration** - Connect any OpenAI-compatible API endpoint as an AI provider
- 🔑 **Optional API Key** - Supports both authenticated and open endpoints with automatic URL normalization
- 🔄 **Full Pipeline Support** - Works across beat generation, story research, and all AI features

### Beat AI Enhancements
- ✨ **Envision Beat Type** - New creative beat type that fills word count targets with vivid, expressive prose
- ✏️ **Polish Expression** - New split button option to refine prose style while preserving content and meaning
- ❌ **Cancel Staging Notes** - Cancel button for staging notes generation when it's taking too long
- 🎨 **Animated Gradient Border** - Rotating gradient border effect provides visual feedback during AI generation
- 🔄 **Unified Rewrite/Polish** - Deduplicated rewrite and polish execution into a single streamlined method

### Codex Improvements
- 🎨 **Portrait Style Selection** - Choose between different AI art styles when generating character portraits
- 💬 **Codex Context in Scene Chat** - Toggle to include codex entries in scene chat for AI-enriched conversations
- 👤 **Protagonist Name in Staging Notes** - AI staging notes now reference the protagonist by name from the Codex
- 🏷️ **Tiered Relevance Filter** - Smarter codex filtering reduces over-inclusion of irrelevant entries
- 🔍 **Restored Tag Matching** - Fixed tag-based relevance matching that was accidentally broken

### Snapshot System Overhaul
- 📦 **Related Document Snapshots** - Story snapshots now include related documents (codex entries, research, etc.)
- 🔄 **Related Document Restoration** - Restore related documents alongside the main story
- 📊 **Metadata Display** - Snapshot timeline shows related document metadata and restore results
- 🌐 **HTTP API** - New HTTP API for programmatic on-demand snapshot creation

### OpenRouter Enhancements
- 🛡️ **Privacy Settings** - Configure zero data retention and data collection preferences per-provider
- 🚫 **Provider Exclusion** - Exclude specific inference providers and centralize provider preferences
- 🧠 **Beta Model Variants** - Added self-moderated beta variants for Anthropic models
- 🔬 **Beta + Reasoning Combos** - Combined beta and reasoning variants available

### Story & Editor Features
- 🔒 **Editor Lock During Generation** - Editor automatically locks during AI generation to prevent conflicts
- 📁 **Collapsible Story Structure** - Desktop sidebar for story structure is now collapsible
- 📋 **Story Reordering** - Drag-and-drop story reordering with CSS Grid layout support
- 🏷️ **Scope Badges** - Visual badges differentiate shared vs type-specific story settings with tooltips

### Media & Image System
- 📦 **Media Export/Import** - Embedded pictures and videos are now included in story exports
- 🖼️ **Jump to Image** - Click an image in the gallery to jump to its position in the story
- 🔄 **Per-Story Architecture** - Completely refactored from global image services to per-story architecture
- 🗑️ **Legacy Media Cleanup** - Database maintenance utility to clean up orphaned legacy media

### UI & Notifications
- 🔔 **Global AI Error Toasts** - Unified error notifications across all AI features with a Details button for debugging
- 🎨 **Thinking Text Colors** - Customize highlighting colors for AI thinking text (*text*)
- 💳 **Premium Portal Flow** - Improved hybrid portal flow for subscription management
- 👋 **Redesigned User Greeting** - Replaced emoji-based greeting with Ionicons for a cleaner look
- 📊 **Sync History** - New sync logging with glassmorphism design showing all stories

## ✨ Improvements

### Design Token Migration
- 🎨 **Comprehensive Token System** - Migrated 20+ components from hardcoded colors to design tokens
- 💨 **Centralized Blur Values** - All backdrop-filter blur values now use design tokens
- 🎯 **Glass Morphism** - Consistent glassmorphism applied to story research cards and sync history
- ✏️ **Slash Command Redesign** - Dropdown redesigned with design system, simplified to single Beat option

### Story Research UX
- 📋 **Collapsible Cards** - Research results in accordion cards with glass morphism styling
- ⚡ **4 Quick Wins** - Multiple UX improvements to the research interface

### Sync Improvements
- ☁️ **Cloud Icons** - Replaced emoji arrows with cloud upload/download icons for sync status
- 🏷️ **Unified Badge Sizing** - Consistent sizing across user, version, and sync badges
- 🔄 **Manual Push Support** - Chat and research services now manually push to remote after saves

## 🔧 Bug Fixes

### Mobile & Keyboard
- 📱 **Unified Keyboard Handling** - New shared KeyboardService replaces fragmented keyboard logic
- 📱 **Scroll Position Preservation** - Fixed scroll position loss when keyboard appears
- 📱 **Header Restoration** - Header reliably reappears after keyboard dismiss
- 📱 **Text Selection Prevention** - No more accidental text selection in beat input during generation
- 📱 **Hidden Header Badges** - Badges hidden on mobile to prevent logo overlap

### Codex Fixes
- 🔧 **Change Detection** - Fixed missing change detection after entry creation, category operations, and save/delete
- 🗑️ **Portrait Delete** - Delete button now removes only the active portrait, not all portraits
- 🔄 **Import ID Remapping** - Active portrait IDs correctly remapped during import
- 📝 **Custom Fields UX** - Add Field button moved inline for better discoverability
- 📱 **Android Textarea** - Replaced ion-textarea autoGrow with CSS Grid mirroring for Android compatibility
- 🏷️ **Tag Help Text** - Clarified tag descriptions and added minimum length notes

### Sync & Database
- 🔒 **Race Condition Fix** - Serialized forceReplicateDocument calls to prevent data races
- ♾️ **Infinite Loading Fix** - Fixed infinite loading when story not found on remote
- 📊 **Zero Docs Disambiguation** - Properly handle docs_written === 0 in force replication
- 🔄 **Pending Doc ID Migration** - Migrated pendingDocId to Set<string> for consistency

### Editor & Content
- 📄 **Paragraph Structure** - Preserved paragraph structure in scene-from-outline streaming
- 📊 **Outline Accordion** - Fixed accordion collapse on summary save; let Ionic manage state
- ⚡ **Generate Button** - Enabled generate button while typing prompt
- 🔄 **Beat Version Restore** - Fixed generatedContent not updating when restoring beat versions
- 📝 **Rewrite/Regenerate Buttons** - Now shown for all content after a beat, not just the latest

### Image & Media
- 🖼️ **Blob URL Resolution** - Fixed stale blob URLs after page reload
- 💾 **Memory Optimizations** - Improved gallery memory management and blob URL caching
- 📐 **Lightbox Sizing** - Fixed image sizing, header overlap, and double scrollbar issues
- 🔄 **Image Sync** - Force replicate images when opening a story

### Infrastructure
- 🌐 **Nginx Proxy Fixes** - Multiple fixes for path preservation, catch-all server names, and LAN access
- 🐳 **Docker Health Checks** - Proper IPv4-based health checks for all containers
- 📦 **SSE Buffer Flush** - Fixed content truncation by flushing SSE buffer on stream end
- 🔌 **Stale Connection Handling** - New streams properly replace stale SSE connections

### Snapshots
- 🔧 **CouchDB Client Workarounds** - Bypassed nano bugs with native fetch for reliable snapshot creation
- 📅 **Null ExpiresAt Handling** - Fixed crash for manual snapshots without expiration
- 🔐 **Auth Header Fix** - Switched to Authorization header instead of URL credentials

## 🏗️ Technical Improvements
- **Architecture**: Per-story image services replace global singletons; generation service extracted to backend
- **Refactoring**: Unified rewrite/polish methods; removed legacy codex service; cleaned up unused code
- **Performance**: Snapshot service batching with mutex; story order batch saves; mobile blur optimization with trackBy
- **Testing**: Comprehensive tests for image integration, export/import with media, AI error toasts, metadata comparison, and image upload sizing
- **CI/CD**: GitHub Actions workflow for generation-service Docker builds; added to public Docker images
- **Infrastructure**: Generation service added to Docker Compose; Watchtower labels for auto-updates
- **Developer Tools**: Claude Code skills migrated to rules-based auto-loading; added cw-debug skill
- **Code Quality**: LF line endings enforced via .gitattributes; design token system established

---
*Release prepared with [Claude Code](https://claude.com/claude-code)*
