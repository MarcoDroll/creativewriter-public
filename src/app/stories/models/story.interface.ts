import { FavoriteModelLists } from '../../core/models/settings.interface';

export type NarrativePerspective = 'first-person' | 'third-person-limited' | 'third-person-omniscient' | 'second-person';
export type StoryLanguage = 'en' | 'de' | 'fr' | 'es' | 'custom';
export type StoryTense = 'past' | 'present';
export type TemplateMode = 'sections' | 'advanced';

// Section-based template for Story Beats
export interface BeatTemplateSections {
  userMessagePreamble: string;    // Opening text before context blocks
  objective: string;              // Task objective
  narrativeParameters: string;    // POV, word count, tense settings
  stagingNotes: string;           // Instruction for staging notes (physical/positional context)
  beatRequirements: string;       // Where {prompt} placeholder goes
  styleGuidance: string;          // Writing style direction
  constraints: string;            // What NOT to do
  outputFormat: string;           // Format requirements
  generatePrompt: string;         // Final instruction (e.g., "Generate the beat now:")
}

// Section-based template for Scene Beats (extends Story Beat with scene-specific fields)
export interface SceneBeatTemplateSections extends BeatTemplateSections {
  focusAreas: string;             // Scene-specific focus areas (sensory details, emotions, etc.)
  bridgingInstructions: string;   // Instructions for when textAfterBeat is present
}

// Section-based template for Scene Generation from Outline
export interface SceneFromOutlineTemplateSections {
  userMessagePreamble: string;    // Opening text before context blocks
  objective: string;              // Task objective for full scene generation
  narrativeParameters: string;    // POV, word count, tense placeholders
  sceneOutline: string;           // Where {sceneOutline} placeholder goes
  styleGuidance: string;          // Writing style instructions
  outputFormat: string;           // Output format rules
  generatePrompt: string;         // Final prompt text
}

// Metadata for rendering section editor UI
export interface BeatTemplateSectionMeta {
  key: keyof BeatTemplateSections | keyof SceneBeatTemplateSections | keyof SceneFromOutlineTemplateSections;
  label: string;
  description: string;
  placeholders: string[];
  rows: number;
  required: boolean;
  sceneBeatOnly?: boolean;        // Only shown for scene beat template
  isCommon?: boolean;             // false for type-specific sections (focusAreas, bridgingInstructions, sceneOutline)
}

export interface Scene {
  id: string;
  title: string;
  content: string;
  summary?: string;
  summaryGeneratedAt?: Date;
  order: number;
  sceneNumber: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Chapter {
  id: string;
  title: string;
  order: number;
  chapterNumber: number;
  scenes: Scene[];
  createdAt: Date;
  updatedAt: Date;
}

export interface StorySettings {
  systemMessage: string;
  beatGenerationTemplate: string; // Advanced template for beat generation (legacy/advanced mode)
  useFullStoryContext: boolean; // true = full story, false = summaries only
  narrativePerspective?: NarrativePerspective; // POV for AI-generated content
  tense?: StoryTense; // Grammatical tense for AI-generated content
  language?: StoryLanguage; // Story language setting
  beatRules?: string; // Custom rules for beat generation (markdown text)
  favoriteModels: string[]; // Legacy quick access
  favoriteModelLists: FavoriteModelLists; // Structured favorites per story feature
  // Section-based template fields (new)
  templateMode?: TemplateMode; // 'sections' for section-based editing, 'advanced' for raw XML
  beatTemplateSections?: BeatTemplateSections; // Story beat template sections
  sceneBeatTemplateSections?: SceneBeatTemplateSections; // Scene beat template sections
  envisionBeatTemplateSections?: BeatTemplateSections; // Envision beat template sections
  sceneFromOutlineTemplateSections?: SceneFromOutlineTemplateSections; // Scene from outline template sections
}

export interface Story {
  _id?: string;
  _rev?: string;
  id: string;
  title: string;
  chapters: Chapter[];
  settings?: StorySettings;
  codexId?: string;
  coverImage?: string; // Base64 encoded image data or URL
  /**
   * @deprecated Story order is now stored only in the metadata index (StoryMetadataIndex).
   * Use StoryMetadataIndexService.updateStoryOrder() instead. This field is ignored during
   * metadata extraction. Existing values on old stories are harmless but not used.
   */
  order?: number;
  schemaVersion?: number; // Schema version for migration tracking
  createdAt: Date;
  updatedAt: Date;
  lastModifiedBy?: {
    deviceId: string;
    deviceName: string;
    timestamp: Date;
  };
  // Legacy support for old stories
  content?: string;
}

export const DEFAULT_STORY_SETTINGS: StorySettings = {
  systemMessage: 'You are a creative writing assistant that helps with writing stories. Maintain the style and tone of the existing story.',
  beatGenerationTemplate: `---SYSTEM---
{systemMessage}

---USER---
You are continuing a story. Here is the context:

## Story Title
{storyTitle}

## Glossary
{codexEntries}

## Story So Far
{storySoFar}

## Current Scene
{sceneFullText}

---

# Beat Generation Task

## Objective
Generate the next story beat that advances the narrative from the current scene's ending point.

## Narrative Parameters
- {pointOfView}
- {wordCount} words (±50 words acceptable)
- {tense}

## Beat Requirements
{prompt}

## Style Guidance
- Match the exact tone and narrative voice of the current scene
- Maintain the established balance of dialogue, action, and introspection
- End on a moment of significance, decision point, or natural transition

## Constraints
- Do NOT resolve major plot threads or conflicts
- Do NOT have characters act inconsistently with their established personalities
- Do NOT introduce unrelated subplots or major new story elements
- Do NOT write beyond what is specifically requested in the beat requirements

## Rules
{rules}

## Output Format
Pure narrative prose. No meta-commentary, scene markers, chapter headings, or author notes.

---

Generate the beat now:`,
  useFullStoryContext: false,
  narrativePerspective: 'third-person-limited',
  tense: 'past',
  beatRules: '',
  favoriteModels: [],
  favoriteModelLists: {
    beatInput: [],
    sceneSummary: [],
    rewrite: [],
    characterChat: []
  }
};

// Default sections for Story Beat template
// NOTE: Section content is plain text only - no XML or Markdown formatting.
// The template builder (sectionsToTemplate) applies formatting when building the prompt.
export const DEFAULT_BEAT_TEMPLATE_SECTIONS: BeatTemplateSections = {
  userMessagePreamble: 'You are continuing a story. Here is the context:',
  objective: 'Generate the next story beat that advances the narrative from the current scene\'s ending point.',
  narrativeParameters: `{pointOfView}
{wordCount} words (±50 words acceptable)
{tense}`,
  stagingNotes: 'Consider these staging notes for physical and contextual consistency:',
  beatRequirements: '{prompt}',
  styleGuidance: `Match the exact tone and narrative voice of the current scene
Maintain the established balance of dialogue, action, and introspection
End on a moment of significance, decision point, or natural transition`,
  constraints: `Do NOT resolve major plot threads or conflicts
Do NOT have characters act inconsistently with their established personalities
Do NOT introduce unrelated subplots or major new story elements
Do NOT write beyond what is specifically requested in the beat requirements`,
  outputFormat: 'Pure narrative prose. No meta-commentary, scene markers, chapter headings, or author notes.',
  generatePrompt: 'Generate the beat now:'
};

// Default sections for Scene Beat template
// NOTE: Section content is plain text only - no XML or Markdown formatting.
// The template builder (sceneBeatSectionsToTemplate) applies formatting when building the prompt.
export const DEFAULT_SCENE_BEAT_TEMPLATE_SECTIONS: SceneBeatTemplateSections = {
  userMessagePreamble: 'You are continuing a story. Here is the context:',
  objective: `Expand this moment with rich detail, deepening the reader's immersion in the scene.
Focus on the immediate experience rather than advancing the plot.`,
  narrativeParameters: `{pointOfView}
{wordCount} words (±50 words acceptable)
{tense}`,
  stagingNotes: 'Consider these staging notes for physical and contextual consistency:',
  beatRequirements: '{prompt}',
  focusAreas: `Internal character thoughts and emotional reactions
Sensory details - sight, sound, touch, smell, taste
Micro-actions and body language
Atmosphere and mood of the moment
Subtext in dialogue (if present)`,
  bridgingInstructions: 'Your generation must seamlessly connect to the existing text that follows. End in a way that flows naturally into this text.',
  styleGuidance: `Match the exact tone and narrative voice of the current scene
Maintain the established balance of dialogue, action, and introspection
Deepen the reader's connection to the viewpoint character`,
  constraints: `Stay within this moment - do NOT advance to new scenes or time jumps
Do NOT resolve conflicts or make major plot progress
Do NOT have characters act inconsistently with their established personalities
Do NOT introduce major new story elements
Match the exact tone and narrative voice`,
  outputFormat: 'Pure narrative prose. No meta-commentary, scene markers, chapter headings, or author notes.',
  generatePrompt: 'Generate the beat now:'
};

// Default sections for Envision Beat template
// NOTE: Section content is plain text only - no XML or Markdown formatting.
// The template builder (sectionsToTemplate) applies formatting when building the prompt.
// Envision beats use the same interface as Story Beats (BeatTemplateSections).
export const DEFAULT_ENVISION_BEAT_TEMPLATE_SECTIONS: BeatTemplateSections = {
  userMessagePreamble: 'You are continuing a story. Here is the context:',
  objective: `Use the beat prompt as a creative direction and envision rich, detailed content.
Your goal is to fill the targeted word count with compelling narrative that flows from this direction.
Do not limit yourself to the literal prompt - expand and develop the content creatively while staying true to the story's characters and world.`,
  narrativeParameters: `{pointOfView}
{wordCount} words - fill this word count target with quality, detailed content
{tense}`,
  stagingNotes: 'Consider these staging notes for physical and contextual consistency:',
  beatRequirements: '{prompt}',
  styleGuidance: `Match the exact tone and narrative voice of the current scene
Maintain the established balance of dialogue, action, and introspection
Create vivid, immersive prose that naturally fills the word count
Develop scenes, moments, and character interactions fully`,
  constraints: `Do NOT have characters act inconsistently with their established personalities
Do NOT introduce elements that contradict established story facts
Maintain narrative coherence with the existing story`,
  outputFormat: 'Pure narrative prose. No meta-commentary, scene markers, chapter headings, or author notes.',
  generatePrompt: 'Generate the beat now:'
};

// Metadata for Story Beat section editor UI
export const BEAT_TEMPLATE_SECTION_META: BeatTemplateSectionMeta[] = [
  {
    key: 'userMessagePreamble',
    label: 'User Message Preamble',
    description: 'Opening text before context blocks (story_title, glossary, etc.)',
    placeholders: [],
    rows: 4,
    required: true
  },
  {
    key: 'objective',
    label: 'Task Objective',
    description: 'What the AI should accomplish with this beat',
    placeholders: [],
    rows: 5,
    required: true
  },
  {
    key: 'narrativeParameters',
    label: 'Narrative Parameters',
    description: 'POV, word count, and tense settings',
    placeholders: ['{pointOfView}', '{wordCount}', '{tense}'],
    rows: 6,
    required: true
  },
  {
    key: 'stagingNotes',
    label: 'Staging Notes Instruction',
    description: 'Instruction shown before staging notes (character positions, object placements)',
    placeholders: ['{stagingNotes}'],
    rows: 3,
    required: false
  },
  {
    key: 'beatRequirements',
    label: 'Beat Requirements',
    description: 'Where the user\'s beat prompt is inserted',
    placeholders: ['{prompt}'],
    rows: 4,
    required: true
  },
  {
    key: 'styleGuidance',
    label: 'Style Guidance',
    description: 'Writing style and tone direction',
    placeholders: [],
    rows: 8,
    required: false
  },
  {
    key: 'constraints',
    label: 'Constraints',
    description: 'What the AI should NOT do',
    placeholders: [],
    rows: 8,
    required: false
  },
  {
    key: 'outputFormat',
    label: 'Output Format',
    description: 'Format requirements for generated content',
    placeholders: [],
    rows: 4,
    required: false
  },
  {
    key: 'generatePrompt',
    label: 'Generate Prompt',
    description: 'Final instruction to trigger generation',
    placeholders: [],
    rows: 2,
    required: true
  }
];

// Metadata for Scene Beat section editor UI (includes focusAreas and bridgingInstructions)
export const SCENE_BEAT_TEMPLATE_SECTION_META: BeatTemplateSectionMeta[] = [
  {
    key: 'userMessagePreamble',
    label: 'User Message Preamble',
    description: 'Opening text before context blocks (story_title, glossary, etc.)',
    placeholders: [],
    rows: 4,
    required: true
  },
  {
    key: 'objective',
    label: 'Task Objective',
    description: 'What the AI should accomplish - typically focuses on immersion rather than plot advancement',
    placeholders: [],
    rows: 6,
    required: true
  },
  {
    key: 'narrativeParameters',
    label: 'Narrative Parameters',
    description: 'POV, word count, and tense settings',
    placeholders: ['{pointOfView}', '{wordCount}', '{tense}'],
    rows: 6,
    required: true
  },
  {
    key: 'stagingNotes',
    label: 'Staging Notes Instruction',
    description: 'Instruction shown before staging notes (character positions, object placements)',
    placeholders: ['{stagingNotes}'],
    rows: 3,
    required: false
  },
  {
    key: 'focusAreas',
    label: 'Focus Areas',
    description: 'Areas the AI should emphasize (sensory details, emotions, atmosphere)',
    placeholders: [],
    rows: 8,
    required: false,
    sceneBeatOnly: true,
    isCommon: false
  },
  {
    key: 'beatRequirements',
    label: 'Beat Requirements',
    description: 'Where the user\'s beat prompt is inserted',
    placeholders: ['{prompt}'],
    rows: 4,
    required: true
  },
  {
    key: 'bridgingInstructions',
    label: 'Bridging Instructions',
    description: 'Instructions for when there is text after the beat that needs to be connected to',
    placeholders: [],
    rows: 5,
    required: false,
    sceneBeatOnly: true,
    isCommon: false
  },
  {
    key: 'styleGuidance',
    label: 'Style Guidance',
    description: 'Writing style and tone direction',
    placeholders: [],
    rows: 8,
    required: false
  },
  {
    key: 'constraints',
    label: 'Constraints',
    description: 'What the AI should NOT do - scene beats typically stay in the moment',
    placeholders: [],
    rows: 8,
    required: false
  },
  {
    key: 'outputFormat',
    label: 'Output Format',
    description: 'Format requirements for generated content',
    placeholders: [],
    rows: 4,
    required: false
  },
  {
    key: 'generatePrompt',
    label: 'Generate Prompt',
    description: 'Final instruction to trigger generation',
    placeholders: [],
    rows: 2,
    required: true
  }
];

// Default sections for Scene from Outline template
// NOTE: Section content is plain text only - no XML or Markdown formatting.
// The template builder (sceneFromOutlineSectionsToTemplate) applies formatting when building the prompt.
export const DEFAULT_SCENE_FROM_OUTLINE_TEMPLATE_SECTIONS: SceneFromOutlineTemplateSections = {
  userMessagePreamble: 'You are writing a complete scene for a story.',
  objective: 'Write a complete, self-contained scene based on the provided outline. This is a full scene generation, not a continuation of existing content.',
  narrativeParameters: `{pointOfView}
Approximately {wordCount} words
{tense}`,
  sceneOutline: '{sceneOutline}',
  styleGuidance: `Create a complete narrative arc within the scene
Balance dialogue, action, and introspection appropriately
Establish setting and atmosphere early
End with a sense of completion or meaningful transition
Match the tone and voice established in the story context`,
  outputFormat: 'Pure narrative prose. No meta-commentary, scene markers, chapter headings, or author notes.',
  generatePrompt: 'Generate the complete scene now:'
};

// Metadata for Scene from Outline section editor UI
export const SCENE_FROM_OUTLINE_TEMPLATE_SECTION_META: BeatTemplateSectionMeta[] = [
  {
    key: 'userMessagePreamble',
    label: 'User Message Preamble',
    description: 'Opening text that sets the context for the AI',
    placeholders: [],
    rows: 4,
    required: false
  },
  {
    key: 'objective',
    label: 'Task Objective',
    description: 'The main task objective for generating the complete scene',
    placeholders: [],
    rows: 6,
    required: true
  },
  {
    key: 'narrativeParameters',
    label: 'Narrative Parameters',
    description: 'POV, word count, and tense settings',
    placeholders: ['{pointOfView}', '{wordCount}', '{tense}'],
    rows: 6,
    required: true
  },
  {
    key: 'sceneOutline',
    label: 'Scene Outline',
    description: 'Placeholder for the user-provided scene outline',
    placeholders: ['{sceneOutline}'],
    rows: 3,
    required: true,
    isCommon: false
  },
  {
    key: 'styleGuidance',
    label: 'Style Guidance',
    description: 'Writing style and tone instructions',
    placeholders: [],
    rows: 8,
    required: false
  },
  {
    key: 'outputFormat',
    label: 'Output Format',
    description: 'Format requirements for the generated scene',
    placeholders: [],
    rows: 4,
    required: false
  },
  {
    key: 'generatePrompt',
    label: 'Generate Prompt',
    description: 'Final instruction before generation',
    placeholders: [],
    rows: 2,
    required: false
  }
];
