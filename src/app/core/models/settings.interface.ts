import { environment } from '../../../environments/environment';

export interface FavoriteModelLists {
  beatInput: string[];
  sceneSummary: string[];
  rewrite: string[];
  characterChat: string[];
}

export type PortraitModel = 'flux' | 'seedream';

export interface PortraitModelSettings {
  selectedModel: PortraitModel;
}

// Image generation provider type
export type ImageGenerationProvider = 'openrouter' | 'fal' | 'replicate';

// fal.ai settings
export interface FalAiSettings {
  apiKey: string;
  enabled: boolean;
}

// Image generation settings
export interface ImageGenerationSettings {
  lastUsedModel: string;
  defaultAspectRatio: string;
  preferredProvider: ImageGenerationProvider;
}

export interface ServerGenerationSettings {
  enabled: boolean;  // Whether to use server-side generation (prevents browser minimization issues)
}

export interface ResearchSettings {
  skipConfirmation: boolean;  // Whether to skip the token usage confirmation dialog
}

export interface Settings {
  openRouter: OpenRouterSettings;
  replicate: ReplicateSettings;
  falAi: FalAiSettings;
  googleGemini: GoogleGeminiSettings;
  ollama: OllamaSettings;
  claude: ClaudeSettings;
  openAICompatible: OpenAICompatibleSettings;
  sceneTitleGeneration: SceneTitleGenerationSettings;
  sceneSummaryGeneration: SceneSummaryGenerationSettings;
  stagingNotesGeneration: StagingNotesGenerationSettings;
  sceneGenerationFromOutline: SceneGenerationFromOutlineSettings;
  imageGeneration: ImageGenerationSettings;
  serverGeneration: ServerGenerationSettings;
  research: ResearchSettings;
  selectedModel: string; // Global selected model (format: "provider:model_id")
  favoriteModels: string[]; // Legacy list of favorite model IDs for quick access (mirrors favoriteModelLists.beatInput)
  favoriteModelLists: FavoriteModelLists; // Structured favorite model lists by feature
  appearance: AppearanceSettings;
  premium: PremiumSettings; // Premium subscription settings
  portraitModel: PortraitModelSettings; // Portrait generation model settings
  updatedAt: Date;
}

export interface PremiumSettings {
  email: string;                    // Email used for subscription verification
  apiUrl: string;                   // Subscription API URL (Cloudflare Worker)
  authToken?: string;               // Auth token from portal verification
  authTokenCreatedAt?: number;      // When auth token was created (for refresh)
  // Cached status (updated when verified)
  cachedStatus: {
    active: boolean;
    plan?: 'monthly' | 'yearly';
    expiresAt?: number;             // Unix timestamp in milliseconds
    lastVerified?: number;          // When we last checked
  };
}

export interface AppearanceSettings {
  textColor: string; // Hex color code for text in editor and beat AI
  backgroundImage: string; // Background image filename or 'none' for no background
  directSpeechColor: string | null; // Hex color code for direct speech (dialogue in quotes), or null to derive from textColor
  thinkingColor: string | null; // Hex color code for thinking text (in asterisks *like this*), or null to derive from textColor
}

export interface OpenRouterSettings {
  apiKey: string;
  model: string;
  temperature: number;
  topP: number;
  enabled: boolean;
  zeroDataRetention: boolean;   // Only route to providers that don't store prompts
  denyDataCollection: boolean;  // Block providers that may collect user data
  ignoredProviders: string[];   // Provider slugs to exclude from routing
}

export interface OpenRouterProviderPrefs {
  zdr?: boolean;
  data_collection?: 'allow' | 'deny';
  ignore?: string[];
}

/** Build the provider preferences object from OpenRouter settings. Returns undefined if empty. */
export function buildOpenRouterProviderPrefs(
  settings: OpenRouterSettings
): OpenRouterProviderPrefs | undefined {
  const prefs: OpenRouterProviderPrefs = {};
  if (settings.zeroDataRetention) {
    prefs.zdr = true;
  }
  if (settings.denyDataCollection) {
    prefs.data_collection = 'deny';
  }
  if (settings.ignoredProviders?.length) {
    prefs.ignore = settings.ignoredProviders;
  }
  return Object.keys(prefs).length > 0 ? prefs : undefined;
}

export interface ReplicateSettings {
  apiKey: string;
  model: string;
  version: string;
  enabled: boolean;
}

export interface GoogleGeminiSettings {
  apiKey: string;
  model: string;
  temperature: number;
  topP: number;
  enabled: boolean;
  contentFilter: {
    harassment: 'BLOCK_NONE' | 'BLOCK_ONLY_HIGH' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_LOW_AND_ABOVE';
    hateSpeech: 'BLOCK_NONE' | 'BLOCK_ONLY_HIGH' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_LOW_AND_ABOVE';
    sexuallyExplicit: 'BLOCK_NONE' | 'BLOCK_ONLY_HIGH' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_LOW_AND_ABOVE';
    dangerousContent: 'BLOCK_NONE' | 'BLOCK_ONLY_HIGH' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_LOW_AND_ABOVE';
    civicIntegrity: 'BLOCK_NONE' | 'BLOCK_ONLY_HIGH' | 'BLOCK_MEDIUM_AND_ABOVE' | 'BLOCK_LOW_AND_ABOVE';
  };
}

export interface OllamaSettings {
  baseUrl: string;
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  enabled: boolean;
}

export interface ClaudeSettings {
  apiKey: string;
  model: string;
  temperature: number;
  topP: number;
  topK: number;
  enabled: boolean;
}

export interface OpenAICompatibleSettings {
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  enabled: boolean;
}

export interface SceneTitleGenerationSettings {
  maxWords: number;
  style: 'descriptive' | 'concise' | 'action' | 'emotional';
  language: 'german' | 'english';
  includeGenre: boolean;
  temperature: number;
  customInstruction: string;
  customPrompt: string;
  useCustomPrompt: boolean;
  selectedModel: string;
}

export interface SceneSummaryGenerationSettings {
  temperature: number;
  customInstruction: string;
  customPrompt: string;
  useCustomPrompt: boolean;
  selectedModel: string;
}

export interface StagingNotesGenerationSettings {
  temperature: number;
  customInstruction: string;
  customPrompt: string;
  useCustomPrompt: boolean;
  selectedModel: string;
}

export interface SceneGenerationFromOutlineSettings {
  wordCount: number; // default target length
  temperature: number;
  includeStoryOutline: boolean; // include story context by default
  useFullStoryContext: boolean; // when true, full text; false => summaries
  includeCodex: boolean; // include codex items
  customInstruction: string; // appended to prompt
  useCustomPrompt: boolean; // use custom template
  customPrompt: string; // template with placeholders
  selectedModel: string; // optional specific model override (provider:id)
}

export const DEFAULT_SETTINGS: Settings = {
  openRouter: {
    apiKey: '',
    model: '',
    temperature: 0.7,
    topP: 1.0,
    enabled: false,
    zeroDataRetention: true,
    denyDataCollection: true,
    ignoredProviders: []
  },
  replicate: {
    apiKey: '',
    model: '',
    version: '',
    enabled: false
  },
  falAi: {
    apiKey: '',
    enabled: false
  },
  googleGemini: {
    apiKey: '',
    model: 'gemini-2.5-flash',
    temperature: 0.7,
    topP: 1.0,
    enabled: false,
    contentFilter: {
      harassment: 'BLOCK_NONE',
      hateSpeech: 'BLOCK_NONE',
      sexuallyExplicit: 'BLOCK_NONE',
      dangerousContent: 'BLOCK_NONE',
      civicIntegrity: 'BLOCK_NONE'
    }
  },
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: '',
    temperature: 0.7,
    topP: 1.0,
    maxTokens: 2000,
    enabled: false
  },
  claude: {
    apiKey: '',
    model: 'claude-3-5-sonnet-20241022',
    temperature: 0.7,
    topP: 1.0,
    topK: 0,
    enabled: false
  },
  openAICompatible: {
    baseUrl: 'http://localhost:1234',
    apiKey: '',
    model: '',
    temperature: 0.7,
    topP: 1.0,
    maxTokens: 2000,
    enabled: false
  },
  sceneTitleGeneration: {
    maxWords: 5,
    style: 'concise',
    language: 'german',
    includeGenre: false,
    temperature: 0.3,
    customInstruction: '',
    customPrompt: 'Create a title for the following scene. The title should be up to {maxWords} words long and capture the essence of the scene.\n\n{styleInstruction}\n{genreInstruction}\n{languageInstruction}{customInstruction}\n\nScene content (only this one scene):\n{sceneContent}\n\nRespond only with the title, without further explanations or quotation marks.',
    useCustomPrompt: false,
    selectedModel: ''
  },
  sceneSummaryGeneration: {
    temperature: 0.7,
    customInstruction: '',
    customPrompt: 'Create a summary of the following scene:\n\nTitle: {sceneTitle}\n\nContent:\n{sceneContent}\n\nWrite a focused, comprehensive summary that captures the most important plot points and character developments.\n\n{languageInstruction}',
    useCustomPrompt: false,
    selectedModel: ''
  },
  stagingNotesGeneration: {
    temperature: 0.5,
    customInstruction: '',
    customPrompt: '',
    useCustomPrompt: false,
    selectedModel: ''
  },
  sceneGenerationFromOutline: {
    wordCount: 600,
    temperature: 0.7,
    includeStoryOutline: true,
    useFullStoryContext: false,
    includeCodex: true,
    customInstruction: '',
    useCustomPrompt: false,
    customPrompt: '<messages>\n<message role="system">{systemMessage}</message>\n<message role="user">You are writing a complete scene for a story.\n\n<story_title>{storyTitle}</story_title>\n\n<glossary>\n{codexEntries}\n</glossary>\n\n<story_context>\n{storySoFar}\n</story_context>\n\n<scene_outline>\n{sceneOutline}\n</scene_outline>\n\n<instructions>\nWrite a complete, coherent scene based strictly on the outline. Aim for about {wordCount} words.\n{languageInstruction}{customInstruction}\nDo not include meta comments or headings. Output only the scene prose.\n</instructions>\n</message>\n</messages>',
    selectedModel: ''
  },
  imageGeneration: {
    lastUsedModel: '',
    defaultAspectRatio: '1:1',
    preferredProvider: 'openrouter'
  },
  serverGeneration: {
    enabled: false  // Disabled by default, user must opt-in
  },
  research: {
    skipConfirmation: false  // Show confirmation dialog by default
  },
  appearance: {
    textColor: '#e0e0e0', // Default light gray color for dark theme
    backgroundImage: 'none', // No background image by default
    directSpeechColor: null, // Derive from textColor by default
    thinkingColor: null // Derive from textColor by default (cyan shift)
  },
  premium: {
    email: '',
    apiUrl: environment.premiumApiUrl,
    cachedStatus: {
      active: false
    }
  },
  portraitModel: {
    selectedModel: 'flux'
  },
  selectedModel: '',
  favoriteModels: [],
  favoriteModelLists: {
    beatInput: [],
    sceneSummary: [],
    rewrite: [],
    characterChat: []
  },
  updatedAt: new Date()
};
