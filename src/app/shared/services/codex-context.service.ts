import { Injectable, inject } from '@angular/core';

import { CodexRelevanceService, CodexEntry as CodexRelevanceEntry } from '../../core/services/codex-relevance.service';
import { CodexService } from '../../stories/services/codex.service';
import { CodexEntry, CustomField } from '../../stories/models/codex.interface';

@Injectable({ providedIn: 'root' })
export class CodexContextService {
  private codexService = inject(CodexService);
  private codexRelevanceService = inject(CodexRelevanceService);

  /** Minimum token budget for scene summaries to ensure comprehensive context */
  private static readonly SCENE_SUMMARY_MIN_TOKEN_BUDGET = 8000;
  /** Approximate token-to-character ratio (based on typical tokenization, ~4 chars per token) */
  private static readonly TOKENS_PER_CHAR = 0.25;

  async buildCodexXml(
    storyId: string,
    promptText: string,
    stagingNotes: string,
    sceneText: string,
    maxTokens = 1000,
    skipRelevanceFiltering = false
  ): Promise<{
    xml: string;
    categories: { category: string; entries: CodexEntry[]; icon?: string }[];
    entriesDropped?: number;
    totalEntries?: number;
  }> {
    const allCodexEntries = this.codexService.getAllCodexEntries(storyId);
    if (allCodexEntries.length === 0) {
      return { xml: '', categories: [] };
    }

    let filteredCodexEntries: { category: string; entries: CodexEntry[]; icon?: string }[];
    let entriesDropped: number | undefined;
    let totalEntries: number | undefined;

    if (skipRelevanceFiltering) {
      // Include all codex entries without relevance filtering, but still respect token limits
      const result = this.limitEntriesByTokenBudget(allCodexEntries, maxTokens);
      filteredCodexEntries = result.categories;
      entriesDropped = result.droppedCount;
      totalEntries = result.totalCount;
    } else {
      const convertedEntries = this.codexRelevanceService.convertFromStoryFormat(allCodexEntries);
      const relevantEntries = this.codexRelevanceService.filterRelevantEntries(
        convertedEntries,
        promptText,
        stagingNotes,
        sceneText
      );

      filteredCodexEntries = this.ensureNotesCategory(
        allCodexEntries,
        this.filterCodexEntriesByRelevance(allCodexEntries, relevantEntries)
      );
    }

    const xml = filteredCodexEntries.length > 0
      ? this.buildCodexXmlString(filteredCodexEntries)
      : '';

    return {
      xml,
      categories: filteredCodexEntries,
      entriesDropped,
      totalEntries
    };
  }

  private filterCodexEntriesByRelevance(
    allCodexEntries: { category: string; entries: CodexEntry[]; icon?: string }[],
    relevantEntries: CodexRelevanceEntry[]
  ): { category: string; entries: CodexEntry[]; icon?: string }[] {
    if (relevantEntries.length === 0) {
      return [];
    }

    const relevantIds = new Set(relevantEntries.map(entry => entry.id));
    return allCodexEntries
      .map(categoryData => ({
        ...categoryData,
        entries: categoryData.entries.filter(entry => relevantIds.has(entry.id))
      }))
      .filter(categoryData => categoryData.entries.length > 0);
  }

  private ensureNotesCategory(
    allCodexEntries: { category: string; entries: CodexEntry[]; icon?: string }[],
    filteredCodexEntries: { category: string; entries: CodexEntry[]; icon?: string }[]
  ): { category: string; entries: CodexEntry[]; icon?: string }[] {
    const result = [...filteredCodexEntries];
    const noteKeywords = ['notizen', 'notes', 'note'];

    const notesCategory = allCodexEntries.find(category =>
      noteKeywords.some(keyword => category.category.toLowerCase().includes(keyword))
    );

    if (notesCategory && notesCategory.entries.length > 0) {
      const existingNotesIndex = result.findIndex(category => category.category === notesCategory.category);
      if (existingNotesIndex >= 0) {
        result[existingNotesIndex] = notesCategory;
      } else {
        result.push(notesCategory);
      }
    }

    return result;
  }

  /**
   * Limits codex entries to fit within a token budget while prioritizing important entries.
   * Ensures scene summaries have comprehensive context by using a minimum token budget.
   * Returns the filtered categories along with counts of total and dropped entries.
   */
  private limitEntriesByTokenBudget(
    allCodexEntries: { category: string; entries: CodexEntry[]; icon?: string }[],
    maxTokens: number
  ): {
    categories: { category: string; entries: CodexEntry[]; icon?: string }[];
    droppedCount: number;
    totalCount: number;
  } {
    const effectiveMaxTokens = Math.max(maxTokens, CodexContextService.SCENE_SUMMARY_MIN_TOKEN_BUDGET);
    let currentTokens = 0;

    // Flatten all entries with their category info for prioritization
    const allEntries: { entry: CodexEntry; category: string; icon?: string }[] = [];
    for (const categoryData of allCodexEntries) {
      for (const entry of categoryData.entries) {
        allEntries.push({
          entry,
          category: categoryData.category,
          icon: categoryData.icon
        });
      }
    }

    const totalCount = allEntries.length;

    // Prioritize: always-include entries first, then by story role importance
    // Use spread to avoid mutating the original array
    const prioritized = [...allEntries].sort((a, b) => {
      // Global include / always include first
      const aGlobal = a.entry.alwaysInclude || a.entry.metadata?.['globalInclude'];
      const bGlobal = b.entry.alwaysInclude || b.entry.metadata?.['globalInclude'];
      if (aGlobal && !bGlobal) return -1;
      if (!aGlobal && bGlobal) return 1;

      // Then by story role importance (higher = more important)
      const roleOrder: Record<string, number> = {
        'Protagonist': 5,
        'Antagonist': 4,
        'Love Interest': 3,
        'Supporting Character': 2,
        'Background Character': 1,
        'Hintergrundcharakter': 1  // German equivalent
      };
      const aRole = typeof a.entry.metadata?.['storyRole'] === 'string' ? a.entry.metadata['storyRole'] : '';
      const bRole = typeof b.entry.metadata?.['storyRole'] === 'string' ? b.entry.metadata['storyRole'] : '';
      const aRoleWeight = roleOrder[aRole] || 0;
      const bRoleWeight = roleOrder[bRole] || 0;
      return bRoleWeight - aRoleWeight;
    });

    // Select entries within token budget
    const selectedEntryIds = new Set<string>();
    for (const { entry } of prioritized) {
      const entryTokens = (entry.content?.length || 0) * CodexContextService.TOKENS_PER_CHAR;
      if (currentTokens + entryTokens <= effectiveMaxTokens) {
        selectedEntryIds.add(entry.id);
        currentTokens += entryTokens;
      }
    }

    const droppedCount = totalCount - selectedEntryIds.size;

    // Rebuild category structure with selected entries
    const categories = allCodexEntries
      .map(categoryData => ({
        ...categoryData,
        entries: categoryData.entries.filter(entry => selectedEntryIds.has(entry.id))
      }))
      .filter(categoryData => categoryData.entries.length > 0);

    return { categories, droppedCount, totalCount };
  }

  private buildCodexXmlString(
    categories: { category: string; entries: CodexEntry[]; icon?: string }[]
  ): string {
    const content = categories.map(categoryData => {
      const categoryType = this.getCategoryXmlType(categoryData.category);

      return categoryData.entries.map((entry: CodexEntry) => {
        let entryXml = `<${categoryType} name="${this.escapeXml(entry.title)}"`;

        if (entry.metadata?.['aliases']) {
          entryXml += ` aliases="${this.escapeXml(entry.metadata['aliases'])}"`;
        }

        if (entry.metadata?.['storyRole'] && categoryType === 'character') {
          entryXml += ` storyRole="${this.escapeXml(entry.metadata['storyRole'])}"`;
        }

        entryXml += '>\n';

        if (entry.content) {
          entryXml += `  <description>${this.escapeXml(entry.content)}</description>\n`;
        }

        const customFields = entry.metadata?.['customFields'] || [];
        if (Array.isArray(customFields)) {
          customFields.forEach((field: CustomField) => {
            const fieldName = this.sanitizeXmlTagName(field.name);
            entryXml += `  <${fieldName}>${this.escapeXml(field.value)}</${fieldName}>\n`;
          });
        }

        if (entry.metadata) {
          // Fields to exclude from prompt context (internal/import metadata)
          const excludedFields = new Set([
            'storyRole',
            'customFields',
            'aliases',
            'originalid',
            'alwaysincludeincontext',
            'noautoinclude',
            'originaltype'
          ]);
          Object.entries(entry.metadata)
            .filter(([key]) => !excludedFields.has(key))
            .filter(([, value]) => value !== null && value !== undefined && value !== '')
            .forEach(([key, value]) => {
              const tagName = this.sanitizeXmlTagName(key);
              entryXml += `  <${tagName}>${this.escapeXml(String(value))}</${tagName}>\n`;
            });
        }

        entryXml += `</${categoryType}>`;
        return entryXml;
      }).join('\n');
    }).join('\n');

    return content;
  }

  private getCategoryXmlType(category: string): string {
    const title = category.toLowerCase();
    if (title.includes('character') || title.includes('charakter') || title.includes('figur')) return 'character';
    if (title.includes('location') || title.includes('ort') || title.includes('place')) return 'location';
    if (title.includes('object') || title.includes('gegenstand') || title.includes('item')) return 'item';
    if (title.includes('note') || title.includes('notiz')) return 'other';
    return 'other';
  }

  private sanitizeXmlTagName(name: string | unknown): string {
    const str = String(name || '');
    return str
      .toLowerCase()
      .replace(/[^a-z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
      .replace(/[^a-zA-Z0-9]/g, '');
  }

  private escapeXml(text: string | unknown): string {
    const str = String(text || '');
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }
}
