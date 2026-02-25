<div align="center">
  <img src="src/assets/logo.png" alt="CreativeWriter Logo" width="300">
  
  # CreativeWriter
</div>

> **⚠️ Early Development Version:** This is a very early version in active development. Expect bugs, missing features, and frequent changes. Use at your own risk and consider it experimental software.

> **🔗 Self-Hosters: Looking for the public version? Visit [creativewriter-public](https://github.com/MarcoDroll/creativewriter-public) for easy deployment!**

A powerful, AI-enhanced creative writing application that helps authors craft compelling stories with intelligent assistance for plot development, character creation, narrative structure, and **rich media integration including images within text**.

> **🤖 Built with AI:** This entire application was developed using AI-powered pair programming with [Claude Code](https://claude.ai/code), demonstrating the power of human-AI collaboration in modern software development. While AI accelerates development, it still requires significant human expertise, effort, and a paid Claude subscription to guide the AI, make architectural decisions, and ensure quality.

![Angular](https://img.shields.io/badge/Angular-20-red)
![Ionic](https://img.shields.io/badge/Ionic-8-blue)
![Docker](https://img.shields.io/badge/Docker-Ready-brightgreen)
![License](https://img.shields.io/badge/License-MIT-yellow)

## 📚 Table of Contents

- [☕ Support the Project](#-support-the-project)
- [🎯 What is CreativeWriter?](#-what-is-creativewriter)
- [📷 Screenshots](#-screenshots)
- [✨ Features](#-features)
- [🏗️ Architecture](#️-architecture)
- [🚀 Getting Started](#-getting-started)
- [🐳 Docker Deployment](#-docker-deployment)
- [📦 Docker Images](#-docker-images)
- [🛠️ Development](#️-development)
- [📝 Usage Tips](#-usage-tips)
- [🤝 Contributing](#-contributing)
- [📄 License](#-license)
- [🙏 Acknowledgments](#-acknowledgments)
- [📚 Documentation](#-documentation)

## ☕ Support the Project

If you find CreativeWriter helpful and want to support its development:

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support%20development-orange?style=for-the-badge&logo=buy-me-a-coffee)](https://www.buymeacoffee.com/nostramo83)

Your support helps maintain and improve CreativeWriter for the community!

## 🎯 What is CreativeWriter?

CreativeWriter is a modern web-based writing tool designed for fiction authors who want to leverage AI technology to enhance their creative process. It combines traditional story structuring techniques with cutting-edge AI capabilities to help writers overcome creative blocks, develop rich narratives, and maintain consistency throughout their work.

## 📷 Screenshots

### Main Writing Interface
![Main Interface](docs/screenshots/Screenshot%202025-08-10%20173755.png)
*The main writing interface with AI-powered beat assistance and rich text editor*

### Story Structure Management
![Story Structure](docs/screenshots/Screenshot%202025-08-11%20083614.png)
*Organize your narrative with chapters and scenes in a hierarchical structure*

### Dynamic Codex System
![Codex System](docs/screenshots/Screenshot%202025-08-11%20083221.png)
*Intelligent character and world-building database with automatic context awareness*

### AI Configuration
![AI Settings](docs/screenshots/Screenshot%202025-08-11%20083512.png)
*Configure multiple AI providers including OpenRouter and Google Gemini*

### Custom Backgrounds
![Background Selection](docs/screenshots/Screenshot%202025-08-11%20083536.png)
*Choose from various atmospheric backgrounds to enhance your writing environment*

### Story Statistics
![Story Statistics](docs/screenshots/Screenshot%202025-08-11%20085427.png)
*Track your progress with detailed writing statistics and analytics*

### Beat Generation Templates
![Beat Templates](docs/screenshots/Screenshot%202025-08-11%20083657.png)
*Customize AI prompt templates for consistent story development*

## ✨ Features

> **🎉 Update:** All Docker images are now being published automatically!

### 📝 Story Management
- **Multi-Story Support**: Manage multiple writing projects simultaneously
- **Rich Text Editor**: Full-featured ProseMirror-based editor with formatting tools and **inline image support**
- **Story Structure**: Organize your narrative with acts, chapters, scenes, and beats
- **Auto-Save**: Never lose your work with automatic saving to local database
- **📸 Images Within Text**: Seamlessly embed images directly within your story text for enhanced storytelling

### 🤖 AI Integration
- **Multiple AI Providers**: Support for OpenRouter, Google Gemini, and **Ollama (Local LLMs)**
- **Local AI Support**: Connect to self-hosted models via Ollama for complete privacy
- **Real-time Streaming**: Live text generation with streaming responses
- **Beat AI Assistant**: Get intelligent suggestions for plot development
- **Beat Version History**: Automatically save and restore previous beat generations (up to 10 versions per beat)
- **Scene Enhancement**: AI-powered scene expansion and refinement
- **Character Consistency**: Maintain character voice and traits with AI assistance
- **Custom Prompts**: Fine-tune AI behavior with customizable prompt templates

#### How CreativeWriter Feeds Context to AI
CreativeWriter uses a sophisticated context-building system when generating AI suggestions for beats. The system includes a standard prompt that defines the AI's role as a "creative writing assistant". Then it incorporates scene summaries (to reduce context size) from all previous scenes you've already written. You can either write the scene summary on your own, or let the AI create one for you. Additionally, you can choose to include the full text of specific scenes instead of the summary if you want; for example when you write a retrospective on a specific scene.

After the "story context", it includes the "codex" - all of your characters, items, and lore. The final part is the particular task for the next beat with additional instructions.

AI tends to "understand" XML-tags better than simple text as context structuring, so the system creates a pseudo-XML structure with this information in the prompt.

### 📚 Codex System
- **Dynamic Knowledge Base**: Automatically track characters, locations, and plot elements
- **Smart Context Awareness**: AI understands your story's universe
- **Relevance Scoring**: Intelligent filtering of relevant codex entries for each scene
- **Tag Management**: Organize codex entries with custom tags

### 🎨 Customization
- **Theme Support**: Dark and light modes
- **Custom Backgrounds**: Upload and manage custom backgrounds for your writing environment
- **Flexible Layouts**: Adjustable editor and panel configurations
- **Font Options**: Multiple font choices for comfortable reading and writing

### 🔄 Data Management
- **Local Database**: PouchDB/CouchDB for offline-first functionality
- **Import/Export**: Support for various formats including NovelCrafter projects
- **PDF Export**: Generate formatted PDFs of your stories
- **Beat Version History**: Automatically track and restore previous AI generations for each beat
- **Database Maintenance**: Clean up version history to free storage space

### 🖼️ Rich Media Support
- **📸 Images Within Text**: **Embed images directly within your story text** - perfect for visual storytelling, character references, or scene inspiration
- **Image Generation**: Integration with Replicate for AI image generation
- **Image Management**: Upload and manage story-related images with full editor integration
- **Video Support**: Embed and manage video content
- **Visual Storytelling**: Enhance your narrative with inline media that flows naturally with your text

## 🏗️ Architecture

CreativeWriter is built with modern web technologies:

- **Frontend**: Angular 20 with Ionic 8 for responsive UI
- **Editor**: ProseMirror for rich text editing
- **Database**: PouchDB with CouchDB sync capability
- **AI Services**: Modular integration with multiple AI providers
- **Deployment**: Docker containers with nginx reverse proxy

## 🚀 Getting Started

### ⚠️ CRITICAL: Persistent Storage Required!

> **WARNING: Without persistent volume mounting, you WILL lose ALL your stories when the Docker container restarts!**
> 
> The database MUST be mounted to a persistent directory on your host system. The default configuration uses `./data` for storage.
> 
> **Never run CreativeWriter without ensuring the data directory exists and is properly mounted!**

### Quick Start with Docker

```bash
# Create directory AND persistent storage
mkdir creativewriter && cd creativewriter

# CRITICAL: Create data directory for database persistence
mkdir -p data
chmod 755 data

# Download docker-compose configuration
curl -O https://raw.githubusercontent.com/MarcoDroll/creativewriter-public/main/docker-compose.yml

# Start with persistent storage
docker compose up -d

# Verify data persistence is working
ls -la ./data/couchdb-data/  # Should contain database files after first run

# Access at http://localhost:3080
```

### Environment Variables

The Docker Compose setup supports several environment variables that can be configured via a `.env` file in the project root:

- `PORT`: The port on which the application will be accessible (default: `3080`)
- `TZ`: Timezone setting for the containers (default: `Europe/Berlin`)
- `DATA_PATH`: Custom path for persistent data storage (default: `./data`)
- `COUCHDB_USER`: CouchDB admin username (default: `admin`)
  Used by CouchDB itself and by the internal auth proxy for account/user-db management.
- `COUCHDB_PASSWORD`: CouchDB admin password (default: `password` - **change in production!**)
- `COUCHDB_SECRET`: CouchDB secret key (default: `mysecret` - **change in production!**)

Create a `.env` file to customize these values:
```bash
PORT=3080
TZ=America/New_York
DATA_PATH=/custom/path/to/data
COUCHDB_USER=admin
COUCHDB_PASSWORD=your_secure_password
COUCHDB_SECRET=your_secure_secret
```

### Configuration

#### AI Providers
Configure your AI providers in the application settings:
- **OpenRouter**: Add your API key for access to multiple models
- **Google Gemini**: Direct integration with Gemini models
- **Ollama (New!)**: Connect to local LLMs for complete privacy and offline usage
- **Custom Endpoints**: Support for self-hosted models

##### Ollama Setup (Local AI)
1. **Install Ollama**: https://ollama.com/
2. **Configure CORS** (required for web access):
   ```bash
   # Set environment variable to allow web access
   export OLLAMA_ORIGINS="*"
   # Or for more security, specify your CreativeWriter URL:
   # export OLLAMA_ORIGINS="http://localhost:3080"
   ```
   
   **Alternative methods:**
   - **Linux/macOS**: Add to `~/.bashrc` or `~/.zshrc`
   - **Windows**: Set via System Properties → Environment Variables
   - **Docker**: Add `-e OLLAMA_ORIGINS="*"` to your Ollama container
   - **Systemd**: Edit `/etc/systemd/system/ollama.service` and add `Environment="OLLAMA_ORIGINS=*"`

3. **Start Ollama** and run a model:
   ```bash
   ollama serve  # Start the server (if not auto-started)
   ollama run llama3.2  # Download and run a model
   ```

4. **Configure in CreativeWriter**:
   - Go to Settings → AI Providers → Ollama
   - Set URL (default: `http://localhost:11434`)
   - Test connection and select your model

**⚠️ CORS Troubleshooting:**
If you see "CORS" errors in browser console, ensure `OLLAMA_ORIGINS` is set correctly and restart Ollama.

#### Database
The application uses PouchDB for local storage with optional CouchDB sync:
- Local-only mode works out of the box
- For sync, sign in or create an account in the login modal
- Each sync account gets its own CouchDB database (`creative-writer-stories-<username>`)
- Sync authentication now uses per-user credentials (no shared admin sync account)

## 🐳 Docker Deployment

> **⚠️ IMPORTANT - Data Persistence:** The database requires a persistent volume mount to preserve your stories across container restarts. **Without proper volume mounting, you WILL lose all your data when the container stops!** The default docker-compose.yml already includes this configuration, but make sure the `./data` directory exists and has proper permissions.

### Prerequisites
- Docker and Docker Compose installed
- Git (for cloning the repository)
- ~500MB-1GB RAM per instance
- Port 3080 available (or configure a different port)
- **Persistent storage location for database** (default: `./data` directory)

### 📁 Data Persistence & Backup

**Critical: Your stories are stored in CouchDB within the Docker container.** The docker-compose.yml file maps the following volumes:

```yaml
volumes:
  - ./data/couchdb-data:/opt/couchdb/data     # Database files
  - ./data/log/couchdb_log:/opt/couchdb/var/log  # Log files
```

#### To ensure data safety:

1. **Never run without volumes:** Always use the provided docker-compose.yml
2. **Backup regularly:** Copy the `./data` directory to a safe location
3. **Custom data location:** Set a different path via environment variable:
   ```bash
   echo "DATA_PATH=/path/to/your/storage" >> .env
   docker compose up -d
   ```
4. **Verify persistence:** Check that `./data/couchdb-data` contains files after first run
5. **Use the built-in backup feature:** Go to Settings → Backup & Restore to create downloadable backups

## 📝 Usage Tips

1. **Start with Story Structure**: Define your acts and chapters before diving into scenes
2. **Build Your Codex**: Add characters and locations early for better AI context
3. **Use Beat AI**: Let AI help with writer's block on individual beats
4. **📸 Leverage Visual Storytelling**: Embed images directly within your text to enhance scenes, character descriptions, or provide visual inspiration
5. **Experiment with Beat Versions**: Try different AI generations and restore previous versions using the version history feature
6. **Customize Prompts**: Tailor AI responses to your writing style
7. **Regular Exports**: Backup your work regularly using export features

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- Built with Angular and Ionic frameworks
- AI integrations powered by OpenRouter, Google Gemini, and Ollama
- ProseMirror for the editing experience
- Developed using AI-powered pair programming with [Claude Code](https://claude.ai/code) (paid subscription)
- Significant human expertise and effort guiding the AI development
- Community contributors and testers

## 🔗 Links

- [GitHub Repository](https://github.com/MarcoDroll/creativewriter-public)
- [Issue Tracker](https://github.com/MarcoDroll/creativewriter-public/issues)
- [Docker Images](https://github.com/MarcoDroll/creativewriter-public/pkgs/container/creativewriter-public)
