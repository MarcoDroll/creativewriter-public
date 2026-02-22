export interface ChatHistoryMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isPresetPrompt?: boolean;
  extractionType?: 'characters' | 'locations' | 'objects';
}

export interface ChatHistoryContextSceneRef {
  chapterId: string;
  sceneId: string;
  chapterTitle?: string;
  sceneTitle?: string;
}

export interface ChatHistoryDoc {
  _id: string;
  _rev?: string;
  type: 'scene-chat';
  storyId: string;
  historyId: string;
  title?: string;
  messages: ChatHistoryMessage[];
  selectedScenes?: ChatHistoryContextSceneRef[];
  includeStoryOutline?: boolean;
  includeCodexContext?: boolean;
  selectedModel?: string;
  createdAt: Date;
  updatedAt: Date;
}

// Character Chat History types
export interface CharacterChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface CharacterChatHistoryDoc {
  _id: string;
  _rev?: string;
  type: 'character-chat';
  storyId: string;
  characterId: string;
  characterName: string;
  historyId: string;
  title?: string;
  messages: CharacterChatMessage[];
  selectedModel?: string;
  knowledgeCutoff?: {
    chapterOrder: number;
    sceneOrder?: number;
  };
  createdAt: Date;
  updatedAt: Date;
}

