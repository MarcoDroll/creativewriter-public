import { Injectable } from '@angular/core';
import { CodexEntry as StoryCodexEntry } from '../../stories/models/codex.interface';

export interface CodexEntry {
  id: string;
  title: string;
  category: 'character' | 'location' | 'object' | 'lore' | 'other';
  content: string;
  tags: string[];
  aliases: string[];
  importance: 'major' | 'minor' | 'background';
  globalInclude?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class CodexRelevanceService {
  private regexCache = new Map<string, RegExp>();

  private static readonly RECENT_TEXT_CHARS = 1500;
  private static readonly FREQUENCY_THRESHOLD = 2;

  /**
   * Returns codex entries relevant to the current context using tiered inclusion:
   * - Tier 0: globalInclude entries always included
   * - Tier 1: name/alias/tag in beat prompt or staging notes (definite context)
   * - Tier 2: importance-tiered text matching against scene text
   *   - Major (protagonist/antagonist/love interest + locations + objects): any mention in scene
   *   - Minor (supporting characters): mention in recent text or 2+ mentions in full scene
   *   - Background: only via Tier 0 or Tier 1
   */
  filterRelevantEntries(
    allEntries: CodexEntry[],
    beatPrompt: string,
    stagingNotes: string,
    sceneText: string
  ): CodexEntry[] {
    const definiteContext = (beatPrompt + ' ' + stagingNotes).toLowerCase();
    const fullText = sceneText.toLowerCase();
    const recentText = fullText.slice(-CodexRelevanceService.RECENT_TEXT_CHARS);

    const seen = new Set<string>();
    const result: CodexEntry[] = [];

    const add = (entry: CodexEntry) => {
      if (!seen.has(entry.id)) {
        seen.add(entry.id);
        result.push(entry);
      }
    };

    for (const entry of allEntries) {
      // Tier 0: Global entries always included
      if (entry.globalInclude) {
        add(entry);
        continue;
      }

      // Tier 1: Name/alias/tag in definite context (beat prompt + staging notes)
      if (this.matchesNameAliasOrTag(entry, definiteContext)) {
        add(entry);
        continue;
      }

      // Tier 2: Importance-tiered text matching
      if (entry.importance === 'major') {
        // Major entries: include if mentioned anywhere in scene text
        if (this.matchesNameAliasOrTag(entry, fullText)) {
          add(entry);
        }
      } else if (entry.importance === 'minor') {
        // Minor entries: include if in recent text or 2+ mentions in full text
        if (this.matchesNameAliasOrTag(entry, recentText)) {
          add(entry);
        } else if (this.countNameAliasOrTagMatches(entry, fullText) >= CodexRelevanceService.FREQUENCY_THRESHOLD) {
          add(entry);
        }
      }
      // Background: only via Tier 0 or Tier 1 — no text matching
    }

    return result;
  }

  /**
   * Converts story codex format to the flat CodexEntry format used by relevance filtering.
   */
  convertFromStoryFormat(
    codexEntries: { category: string; entries: StoryCodexEntry[]; icon?: string }[]
  ): CodexEntry[] {
    const converted: CodexEntry[] = [];

    for (const categoryData of codexEntries) {
      const category = this.getCategoryType(categoryData.category);

      for (const entry of categoryData.entries) {
        const aliases: string[] = [];
        if (entry.metadata?.['aliases']) {
          const aliasValue = entry.metadata['aliases'];
          if (typeof aliasValue === 'string' && aliasValue) {
            for (const part of aliasValue.split(',')) {
              const trimmed = part.trim();
              if (trimmed) aliases.push(trimmed);
            }
          }
        }

        const tags: string[] = entry.tags ? [...entry.tags] : [];

        const importance = this.determineImportance(category, entry.metadata?.['storyRole'] as string);

        converted.push({
          id: entry.id,
          title: entry.title,
          category,
          content: entry.content || '',
          tags,
          aliases,
          importance,
          globalInclude: !!(entry.metadata?.['globalInclude']) || entry.alwaysInclude || false
        });
      }
    }

    return converted;
  }

  /**
   * Determines importance based on category and story role.
   * - Characters: role-dependent (protagonist/antagonist/love interest → major, background → background, else minor)
   * - Locations, Objects: always major
   * - Lore, Other: minor by default
   */
  private determineImportance(
    category: 'character' | 'location' | 'object' | 'lore' | 'other',
    storyRole?: string
  ): 'major' | 'minor' | 'background' {
    // Locations and objects are always major
    if (category === 'location' || category === 'object') {
      return 'major';
    }

    // Characters use role-based importance
    if (category === 'character' && storyRole) {
      if (storyRole === 'Protagonist' || storyRole === 'Antagonist' || storyRole === 'Love Interest') {
        return 'major';
      }
      if (storyRole === 'Background Character' || storyRole === 'Hintergrundcharakter') {
        return 'background';
      }
    }

    return 'minor';
  }

  private matchesNameAliasOrTag(entry: CodexEntry, text: string): boolean {
    if (entry.title.length >= 4 && this.testMatch(text, entry.title.toLowerCase())) {
      return true;
    }
    for (const alias of entry.aliases) {
      if (alias.length >= 4 && this.testMatch(text, alias.toLowerCase())) {
        return true;
      }
    }
    for (const tag of entry.tags) {
      if (tag.length >= 4 && this.testMatch(text, tag.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  private countNameAliasOrTagMatches(entry: CodexEntry, text: string): number {
    let total = 0;
    if (entry.title.length >= 4) {
      total += this.countMatches(text, entry.title.toLowerCase());
    }
    for (const alias of entry.aliases) {
      if (alias.length >= 4) {
        total += this.countMatches(text, alias.toLowerCase());
      }
    }
    for (const tag of entry.tags) {
      if (tag.length >= 4) {
        total += this.countMatches(text, tag.toLowerCase());
      }
    }
    return total;
  }

  private getCategoryType(categoryTitle: string): 'character' | 'location' | 'object' | 'lore' | 'other' {
    const title = categoryTitle.toLowerCase();
    if (title.includes('character') || title.includes('charakter') || title.includes('figur')) return 'character';
    if (title.includes('location') || title.includes('ort') || title.includes('place')) return 'location';
    if (title.includes('object') || title.includes('gegenstand') || title.includes('item')) return 'object';
    if (title.includes('lore') || title.includes('wissen')) return 'lore';
    return 'other';
  }

  private getRegex(searchTerm: string): RegExp {
    let regex = this.regexCache.get(searchTerm);
    if (!regex) {
      regex = new RegExp(`\\b${this.escapeRegex(searchTerm)}\\b`, 'gi');
      this.regexCache.set(searchTerm, regex);
    }
    regex.lastIndex = 0;
    return regex;
  }

  private testMatch(text: string, searchTerm: string): boolean {
    return this.getRegex(searchTerm).test(text);
  }

  private countMatches(text: string, searchTerm: string): number {
    const matches = text.match(this.getRegex(searchTerm));
    return matches ? matches.length : 0;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
