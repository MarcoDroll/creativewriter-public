export interface PortraitGalleryItem {
  id: string;
  base64: string;
  createdAt: Date;
  source: 'generated' | 'uploaded';
}

export interface CodexEntry {
  id: string;
  categoryId: string;
  title: string;
  content: string;
  tags?: string[];
  portraitGallery?: PortraitGalleryItem[];
  activePortraitId?: string;
  metadata?: Record<string, unknown>;
  storyRole?: StoryRole | '';
  alwaysInclude?: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export type StoryRole = 'Protagonist' | 'Supporting Character' | 'Antagonist' | 'Love Interest' | 'Background Character';

export const STORY_ROLES: { value: StoryRole; label: string }[] = [
  { value: 'Protagonist', label: 'Protagonist' },
  { value: 'Supporting Character', label: 'Supporting Character' },
  { value: 'Antagonist', label: 'Antagonist' },
  { value: 'Love Interest', label: 'Love Interest' },
  { value: 'Background Character', label: 'Background Character' }
];

export interface CustomField {
  id: string;
  name: string;
  value: string;
}

export interface CodexCategory {
  id: string;
  title: string;
  description?: string;
  icon?: string;
  entries: CodexEntry[];
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface Codex {
  id: string;
  storyId: string;
  title: string;
  categories: CodexCategory[];
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_CODEX_CATEGORIES: Partial<CodexCategory>[] = [
  {
    title: 'Characters',
    description: 'Main characters and supporting characters of the story',
    icon: '👤',
    entries: []
  },
  {
    title: 'Locations',
    description: 'Places and settings in the story',
    icon: '🏰',
    entries: []
  },
  {
    title: 'Objects',
    description: 'Important objects and artifacts',
    icon: '⚔️',
    entries: []
  },
  {
    title: 'Notes',
    description: 'General notes and ideas',
    icon: '📝',
    entries: []
  }
];