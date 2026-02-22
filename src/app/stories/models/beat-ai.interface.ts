export interface BeatAI {
  id: string;
  prompt: string;
  generatedContent: string;
  isGenerating: boolean;
  isCollapsed: boolean;
  createdAt: Date;
  updatedAt: Date;
  wordCount?: number;
  beatType?: 'story' | 'scene' | 'envision'; // Default is 'story' for backwards compatibility
  model?: string; // AI model used for generation
  selectedScenes?: { sceneId: string; chapterId: string; }[]; // Persisted selected scene contexts
  includeStoryOutline?: boolean; // Persisted story outline setting
  currentVersionId?: string; // ID of the currently active version in history
  hasHistory?: boolean; // Quick flag to check if version history exists
  lastAction?: 'generate' | 'rewrite' | 'polish'; // Track the last action performed on this beat
  rewriteContext?: { // Context for rewrite operations to enable proper regeneration
    originalText: string; // The text that was rewritten
    instruction: string; // The user's rewrite instruction
  };
  stagingNotes?: string; // Meta-context for physical/positional consistency (character positions, scene setup)
}

export interface BeatAIGenerationEvent {
  beatId: string;
  chunk: string;
  isComplete: boolean;
}

export interface BeatAIPromptEvent {
  beatId: string;
  prompt?: string;
  rewriteInstruction?: string;  // Rewrite instruction for AI (rewrite action only)
  action: 'generate' | 'deleteAfter' | 'regenerate' | 'rewrite' | 'polish';
  wordCount?: number;
  model?: string;
  storyId?: string;
  chapterId?: string;
  sceneId?: string;
  beatType?: 'story' | 'scene' | 'envision';
  customContext?: {
    selectedScenes: string[];
    includeStoryOutline: boolean;
    selectedSceneContexts: { sceneId: string; chapterId: string; content: string; }[];
  };
  existingText?: string; // Text to be rewritten (for rewrite action)
  textAfterBeat?: string; // Text after beat for scene beat bridging context
  stagingNotes?: string; // Staging notes for physical/positional consistency
}

export interface BeatContentInsertEvent {
  beatId: string;
  content: string;
  isComplete: boolean;
}
