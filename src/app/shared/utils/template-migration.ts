/**
 * Template Migration Utilities
 *
 * TODO: Remove this file after 31.10.2026 - all users should have migrated by then.
 * After removal, also clean up:
 * - migrateSettingsToSections() call in story-settings.component.ts
 * - isLegacyTemplate, parseTemplateToSections exports
 * - TemplateMode type in story.interface.ts (keep only 'sections')
 */

import {
  StorySettings,
  BeatTemplateSections,
  SceneBeatTemplateSections,
  SceneFromOutlineTemplateSections,
  DEFAULT_BEAT_TEMPLATE_SECTIONS,
  DEFAULT_SCENE_BEAT_TEMPLATE_SECTIONS,
  DEFAULT_ENVISION_BEAT_TEMPLATE_SECTIONS
} from '../../stories/models/story.interface';

/**
 * Check if story settings use the legacy template format (no sections defined)
 */
export function isLegacyTemplate(settings: StorySettings): boolean {
  return !settings.beatTemplateSections && !!settings.beatGenerationTemplate;
}

/**
 * Check if story settings have valid section-based templates
 */
export function hasSectionTemplates(settings: StorySettings): boolean {
  return !!settings.beatTemplateSections && settings.templateMode === 'sections';
}

/**
 * Parse a legacy XML template string into BeatTemplateSections
 * Returns null if parsing fails (template is too customized or malformed)
 */
export function parseTemplateToSections(template: string): BeatTemplateSections | null {
  try {
    // Extract user message preamble (text after <message role="user"> before first XML block)
    const userMessageMatch = template.match(/<message role="user">\s*([\s\S]*?)\s*<story_title>/);
    const userMessagePreamble = userMessageMatch ? userMessageMatch[1].trim() : DEFAULT_BEAT_TEMPLATE_SECTIONS.userMessagePreamble;

    // Extract objective from <objective> tags
    const objectiveMatch = template.match(/<objective>\s*([\s\S]*?)\s*<\/objective>/);
    const objective = objectiveMatch ? objectiveMatch[1].trim() : DEFAULT_BEAT_TEMPLATE_SECTIONS.objective;

    // Extract narrative_parameters content
    const narrativeMatch = template.match(/<narrative_parameters>\s*([\s\S]*?)\s*<\/narrative_parameters>/);
    const narrativeParameters = narrativeMatch ? narrativeMatch[1].trim() : DEFAULT_BEAT_TEMPLATE_SECTIONS.narrativeParameters;

    // Extract staging_notes instruction (if present)
    const stagingNotesMatch = template.match(/<staging_notes>\s*<instruction>\s*([\s\S]*?)\s*<\/instruction>/);
    const stagingNotes = stagingNotesMatch ? stagingNotesMatch[1].trim() : DEFAULT_BEAT_TEMPLATE_SECTIONS.stagingNotes;

    // Extract beat_requirements content
    const requirementsMatch = template.match(/<beat_requirements>\s*([\s\S]*?)\s*<\/beat_requirements>/);
    const beatRequirements = requirementsMatch ? requirementsMatch[1].trim() : DEFAULT_BEAT_TEMPLATE_SECTIONS.beatRequirements;

    // Extract style_guidance content
    const styleMatch = template.match(/<style_guidance>\s*([\s\S]*?)\s*<\/style_guidance>/);
    const styleGuidance = styleMatch ? styleMatch[1].trim() : DEFAULT_BEAT_TEMPLATE_SECTIONS.styleGuidance;

    // Extract constraints content
    const constraintsMatch = template.match(/<constraints>\s*([\s\S]*?)\s*<\/constraints>/);
    const constraints = constraintsMatch ? constraintsMatch[1].trim() : DEFAULT_BEAT_TEMPLATE_SECTIONS.constraints;

    // Extract output_format content
    const outputMatch = template.match(/<output_format>\s*([\s\S]*?)\s*<\/output_format>/);
    const outputFormat = outputMatch ? outputMatch[1].trim() : DEFAULT_BEAT_TEMPLATE_SECTIONS.outputFormat;

    // Extract generate prompt (text after </beat_generation_task>)
    const generateMatch = template.match(/<\/beat_generation_task>\s*([\s\S]*?)<\/message>/);
    const generatePrompt = generateMatch ? generateMatch[1].trim() : DEFAULT_BEAT_TEMPLATE_SECTIONS.generatePrompt;

    return {
      userMessagePreamble,
      objective,
      narrativeParameters,
      stagingNotes,
      beatRequirements,
      styleGuidance,
      constraints,
      outputFormat,
      generatePrompt
    };
  } catch {
    console.warn('[template-migration] Failed to parse template to sections');
    return null;
  }
}

/**
 * Convert plain text lines to Markdown list format
 */
function formatAsList(text: string): string {
  return text.split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => `- ${line}`)
    .join('\n');
}

/**
 * Build a complete Markdown template string from BeatTemplateSections
 * Uses ---SYSTEM--- and ---USER--- delimiters for message role separation
 */
export function sectionsToTemplate(sections: BeatTemplateSections, systemMessage?: string): string {
  const sysMsg = systemMessage || '{systemMessage}';

  return `---SYSTEM---
${sysMsg}

---USER---
${sections.userMessagePreamble}

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
${sections.objective}

## Narrative Parameters
${formatAsList(sections.narrativeParameters)}

## Staging Notes
${sections.stagingNotes}

{stagingNotes}

## Beat Requirements
${sections.beatRequirements}

## Style Guidance
${formatAsList(sections.styleGuidance)}

## Constraints
${formatAsList(sections.constraints)}

## Rules
{rules}

## Output Format
${sections.outputFormat}

---

${sections.generatePrompt}`;
}

/**
 * Build a complete Markdown template string from SceneBeatTemplateSections
 * Includes focus_areas and optional bridging_context
 * Uses ---SYSTEM--- and ---USER--- delimiters for message role separation
 */
export function sceneBeatSectionsToTemplate(
  sections: SceneBeatTemplateSections,
  systemMessage?: string,
  textAfterBeat?: string
): string {
  const sysMsg = systemMessage || '{systemMessage}';

  // Build bridging context if textAfterBeat is provided
  let bridgingSection = '';
  if (textAfterBeat && textAfterBeat.trim().length > 0) {
    bridgingSection = `

## Bridging Context
${sections.bridgingInstructions}

**Text that follows:**
${escapeXml(textAfterBeat.trim())}`;
  }

  return `---SYSTEM---
${sysMsg}

---USER---
${sections.userMessagePreamble}

## Story Title
{storyTitle}

## Glossary
{codexEntries}

## Story So Far
{storySoFar}

## Current Scene
{sceneFullText}

---

# Scene Beat Generation Task

## Objective
${sections.objective}

## Narrative Parameters
${formatAsList(sections.narrativeParameters)}

## Staging Notes
${sections.stagingNotes}

{stagingNotes}

## Focus Areas
${formatAsList(sections.focusAreas)}

## Beat Requirements
${sections.beatRequirements}
${bridgingSection}

## Style Guidance
${formatAsList(sections.styleGuidance)}

## Constraints
${formatAsList(sections.constraints)}

## Rules
{rules}

## Output Format
${sections.outputFormat}

---

${sections.generatePrompt}`;
}

/**
 * Build a complete Markdown template string from SceneFromOutlineTemplateSections
 * Used for generating complete scenes from an outline description
 * Uses ---SYSTEM--- and ---USER--- delimiters for message role separation
 */
export function sceneFromOutlineSectionsToTemplate(
  sections: SceneFromOutlineTemplateSections,
  systemMessage?: string
): string {
  const sysMsg = systemMessage || '{systemMessage}';

  return `---SYSTEM---
${sysMsg}

---USER---
${sections.userMessagePreamble}

## Story Title
{storyTitle}

## Glossary
{codexEntries}

## Story So Far
{storySoFar}

---

# Scene Generation Task

## Objective
${sections.objective}

## Scene Outline
${sections.sceneOutline}

## Narrative Parameters
${formatAsList(sections.narrativeParameters)}

{languageInstruction}

## Style Guidance
${formatAsList(sections.styleGuidance)}

{customInstruction}

## Output Format
${sections.outputFormat}

---

${sections.generatePrompt}`;
}

/**
 * Merge scene from outline template sections, preferring non-empty values over defaults.
 */
export function mergeSceneFromOutlineSections(
  defaults: SceneFromOutlineTemplateSections,
  stored: Partial<SceneFromOutlineTemplateSections> | undefined
): SceneFromOutlineTemplateSections {
  if (!stored) {
    return { ...defaults };
  }

  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof SceneFromOutlineTemplateSections)[]) {
    const storedValue = stored[key];
    // Only use stored value if it's a non-empty string
    if (typeof storedValue === 'string' && storedValue.trim().length > 0) {
      result[key] = storedValue;
    }
  }
  return result;
}

/**
 * Migrate legacy story settings to use section-based templates
 * Returns a new settings object with sections populated
 */
export function migrateSettingsToSections(settings: StorySettings): StorySettings {
  // If already has sections, return as-is
  if (settings.beatTemplateSections && settings.sceneBeatTemplateSections) {
    return settings;
  }

  // Try to parse existing template
  const parsedSections = settings.beatGenerationTemplate
    ? parseTemplateToSections(settings.beatGenerationTemplate)
    : null;

  // Use parsed sections or defaults
  const beatTemplateSections = parsedSections || { ...DEFAULT_BEAT_TEMPLATE_SECTIONS };

  // Scene beat sections use defaults (can't easily parse from legacy since they were hardcoded)
  const sceneBeatTemplateSections = { ...DEFAULT_SCENE_BEAT_TEMPLATE_SECTIONS };

  return {
    ...settings,
    templateMode: parsedSections ? 'sections' : 'advanced', // Use advanced if parsing failed
    beatTemplateSections,
    sceneBeatTemplateSections
  };
}

/**
 * Initialize default sections for a new story
 */
export function initializeDefaultSections(): {
  beatTemplateSections: BeatTemplateSections;
  sceneBeatTemplateSections: SceneBeatTemplateSections;
} {
  return {
    beatTemplateSections: { ...DEFAULT_BEAT_TEMPLATE_SECTIONS },
    sceneBeatTemplateSections: { ...DEFAULT_SCENE_BEAT_TEMPLATE_SECTIONS }
  };
}

/**
 * Validate that required placeholders are present in a section
 */
export function validateSectionPlaceholders(
  sectionKey: string,
  sectionValue: string,
  requiredPlaceholders: string[]
): string[] {
  const missing: string[] = [];
  for (const placeholder of requiredPlaceholders) {
    if (!sectionValue.includes(placeholder)) {
      missing.push(placeholder);
    }
  }
  return missing;
}

/**
 * Validate entire sections object for required placeholders
 */
export function validateBeatTemplateSections(sections: BeatTemplateSections): {
  valid: boolean;
  errors: { section: string; missingPlaceholders: string[] }[];
} {
  const errors: { section: string; missingPlaceholders: string[] }[] = [];

  // Check beatRequirements has {prompt}
  if (!sections.beatRequirements.includes('{prompt}')) {
    errors.push({
      section: 'beatRequirements',
      missingPlaceholders: ['{prompt}']
    });
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Merge beat template sections, preferring non-empty values over defaults.
 * Empty strings in stored sections are replaced with default values.
 */
export function mergeBeatSections(
  defaults: BeatTemplateSections,
  stored: Partial<BeatTemplateSections> | undefined
): BeatTemplateSections {
  if (!stored) {
    return { ...defaults };
  }

  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof BeatTemplateSections)[]) {
    const storedValue = stored[key];
    // Only use stored value if it's a non-empty string
    if (typeof storedValue === 'string' && storedValue.trim().length > 0) {
      result[key] = storedValue;
    }
  }
  return result;
}

/**
 * Merge scene beat template sections, preferring non-empty values over defaults.
 * Empty strings in stored sections are replaced with default values.
 */
export function mergeSceneBeatSections(
  defaults: SceneBeatTemplateSections,
  stored: Partial<SceneBeatTemplateSections> | undefined
): SceneBeatTemplateSections {
  if (!stored) {
    return { ...defaults };
  }

  const result = { ...defaults };
  for (const key of Object.keys(defaults) as (keyof SceneBeatTemplateSections)[]) {
    const storedValue = stored[key];
    // Only use stored value if it's a non-empty string
    if (typeof storedValue === 'string' && storedValue.trim().length > 0) {
      result[key] = storedValue;
    }
  }
  return result;
}

/**
 * Merge envision beat template sections, preferring non-empty values over defaults.
 * Empty strings in stored sections are replaced with default values.
 * Envision beats use the same interface as Story Beats (BeatTemplateSections).
 */
export function mergeEnvisionBeatSections(
  stored: Partial<BeatTemplateSections> | undefined
): BeatTemplateSections {
  return mergeBeatSections(DEFAULT_ENVISION_BEAT_TEMPLATE_SECTIONS, stored);
}
