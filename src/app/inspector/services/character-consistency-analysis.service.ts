import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SettingsService } from '../../core/services/settings.service';
import { OpenRouterApiService } from '../../core/services/openrouter-api.service';
import { ClaudeApiService } from '../../core/services/claude-api.service';
import { GoogleGeminiApiService } from '../../core/services/google-gemini-api.service';
import { OllamaApiService, OllamaResponse, OllamaChatResponse } from '../../core/services/ollama-api.service';
import { OpenAICompatibleApiService } from '../../core/services/openai-compatible-api.service';
import {
  CharacterConsistencyIssue,
  SceneCharacterConsistencyResult,
  CharacterInconsistencyType
} from '../models/character-consistency.interface';
import { CodexEntry } from '../../stories/models/codex.interface';

@Injectable({ providedIn: 'root' })
export class CharacterConsistencyAnalysisService {
  private settings = inject(SettingsService);
  private openrouter = inject(OpenRouterApiService);
  private claude = inject(ClaudeApiService);
  private gemini = inject(GoogleGeminiApiService);
  private ollama = inject(OllamaApiService);
  private openAICompatible = inject(OpenAICompatibleApiService);

  async analyzeScene(params: {
    modelId?: string; // provider:model
    sceneId: string;
    sceneTitle: string;
    sceneText: string;
    codexCharacters?: CodexEntry[]; // optional character entries to check against
  }): Promise<SceneCharacterConsistencyResult> {
    const { modelId, sceneId, sceneTitle, sceneText, codexCharacters = [] } = params;

    const selected = modelId || this.settings.getSettings().selectedModel;
    if (!selected) {
      return {
        sceneId,
        sceneTitle,
        issues: [],
        summary: { counts: this.emptyCounts() },
        error: 'No model selected. Choose a model in the selector.'
      };
    }

    const { provider, model } = this.parseModel(selected);
    const prompt = this.buildPrompt(sceneId, sceneTitle, sceneText, codexCharacters);

    try {
      let content = '';
      if (provider === 'openrouter') {
        const res = await firstValueFrom(
          this.openrouter.generateText(prompt, {
            model,
            maxTokens: 4000,
            temperature: 0.1,
            topP: 0.9
          })
        );
        content = res.choices?.[0]?.message?.content || '';
      } else if (provider === 'claude') {
        const res = await firstValueFrom(
          this.claude.generateText(prompt, {
            model,
            maxTokens: 6000,
            temperature: 0.1,
            topP: 0.9
          })
        );
        content = res.content?.[0]?.text || '';
      } else if (provider === 'gemini') {
        const res = await firstValueFrom(
          this.gemini.generateText(prompt, {
            model,
            maxTokens: 6000,
            temperature: 0.1,
            topP: 0.9
          })
        );
        content = res.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else if (provider === 'ollama') {
        const res = await firstValueFrom(
          this.ollama.generateText(prompt, {
            model,
            maxTokens: 4000,
            temperature: 0.1,
            topP: 0.9
          })
        );
        const maybeGen = res as OllamaResponse;
        const maybeChat = res as OllamaChatResponse;
        if (typeof maybeGen.response === 'string') {
          content = maybeGen.response;
        } else if (maybeChat.message && typeof maybeChat.message.content === 'string') {
          content = maybeChat.message.content;
        } else {
          content = '';
        }
      } else if (provider === 'openaiCompatible') {
        const res = await firstValueFrom(
          this.openAICompatible.generateText(prompt, {
            model,
            maxTokens: 4000,
            temperature: 0.1,
            topP: 0.9
          })
        );
        content = res.choices?.[0]?.message?.content || '';
      } else {
        return {
          sceneId,
          sceneTitle,
          issues: [],
          summary: { counts: this.emptyCounts() },
          error: `Unsupported provider: ${provider}`
        };
      }

      const parsed = this.parseJson(content);
      if (!parsed) {
        return {
          sceneId,
          sceneTitle,
          issues: [],
          summary: { counts: this.emptyCounts() },
          error: 'Model did not return valid JSON.'
        };
      }

      const rawIssues = (parsed as { issues?: unknown }).issues;
      const issues: CharacterConsistencyIssue[] = Array.isArray(rawIssues)
        ? rawIssues.map((i: unknown) => this.normalizeIssue(i)).filter(Boolean)
        : [];

      const counts = this.countByType(issues);
      return {
        sceneId,
        sceneTitle,
        issues,
        summary: { counts }
      };
    } catch (error: unknown) {
      return {
        sceneId,
        sceneTitle,
        issues: [],
        summary: { counts: this.emptyCounts() },
        error: (error && typeof error === 'object' && 'message' in error) ? String((error as { message: unknown }).message) : 'Request failed'
      };
    }
  }

  private parseModel(selected: string): { provider: string; model: string } {
    const [provider, ...rest] = selected.split(':');
    return { provider, model: rest.join(':') };
  }

  private buildPrompt(sceneId: string, sceneTitle: string, sceneText: string, codexCharacters: CodexEntry[]): string {
    const charSummaries = codexCharacters.map((c) => {
      const role = c.storyRole ? ` role="${c.storyRole}"` : '';
      const tags = Array.isArray(c.tags) && c.tags.length ? ` tags="${c.tags.join(', ')}"` : '';
      return `<character name="${this.escapeXml(c.title)}"${role}${tags}>\n${this.escapeXml((c.content || '').trim()).slice(0, 2000)}\n</character>`;
    }).join('\n');

    return [
      'You are a multilingual story consistency analyst.',
      'Task: Analyze the scene for character consistency issues versus the provided character glossary. Do NOT translate the text.',
      'Return ONLY JSON that matches the schema exactly.',
      '',
      'Schema:',
      '{',
      '  "sceneId": "string",',
      '  "sceneTitle": "string",',
      '  "issues": [',
      '    {',
      '      "character": "string",',
      '      "type": "name|trait|relationship|timeline|pov|other",',
      '      "snippet": "string",',
      '      "start": 0,',
      '      "end": 0,',
      '      "why": "string",',
      '      "suggestion": "string",',
      '      "confidence": 0.0',
      '    }',
      '  ],',
      '  "summary": {',
      '    "counts": { "name": 0, "trait": 0, "relationship": 0, "timeline": 0, "pov": 0, "other": 0 }',
      '  }',
      '}',
      '',
      '<glossary>',
      charSummaries || '<!-- no characters provided -->',
      '</glossary>',
      '',
      `Scene (${sceneId} — ${sceneTitle}):`,
      sceneText
    ].join('\n');
  }

  private escapeXml(s: string): string {
    return (s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  private parseJson(text: string): unknown | null {
    if (!text) return null;
    const cleaned = this.stripCodeFences(text).trim();
    try { return JSON.parse(cleaned); } catch { /* ignore */ }
    const obj = this.extractFirstJsonObject(cleaned);
    if (obj) { try { return JSON.parse(obj); } catch { /* ignore */ } }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = cleaned.slice(start, end + 1);
      try { return JSON.parse(slice); } catch { /* ignore */ }
    }
    return null;
  }

  private stripCodeFences(s: string): string {
    return s.replace(/```[a-zA-Z]*\n([\s\S]*?)```/g, '$1');
  }

  private extractFirstJsonObject(s: string): string | null {
    const start = s.indexOf('{');
    if (start < 0) return null;
    let depth = 0;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return s.slice(start, i + 1);
      }
    }
    return null;
  }

  private normalizeIssue(x: unknown): CharacterConsistencyIssue {
    const obj = (typeof x === 'object' && x !== null) ? (x as Record<string, unknown>) : {};
    const type = String(obj['type'] || '').toLowerCase();
    const valid: CharacterInconsistencyType[] = ['name', 'trait', 'relationship', 'timeline', 'pov', 'other'];
    const coercedType = valid.includes(type as CharacterInconsistencyType) ? (type as CharacterInconsistencyType) : 'other';
    const character = String(obj['character'] || '').slice(0, 200);
    const snippet = String(obj['snippet'] || '').slice(0, 500);
    const startVal = typeof obj['start'] === 'number' ? obj['start'] as number : NaN;
    const endVal = typeof obj['end'] === 'number' ? obj['end'] as number : NaN;
    const start = Number.isFinite(startVal) ? Math.max(0, Math.floor(startVal)) : 0;
    const end = Number.isFinite(endVal) ? Math.max(start, Math.floor(endVal)) : start + snippet.length;
    const why = String(obj['why'] || '');
    const suggestion = String(obj['suggestion'] || '');
    const confVal = typeof obj['confidence'] === 'number' ? obj['confidence'] as number : NaN;
    const confidence = Number.isFinite(confVal) ? Math.max(0, Math.min(1, Number(confVal))) : 0.5;
    return { character, type: coercedType, snippet, start, end, why, suggestion, confidence };
  }

  private emptyCounts(): Record<CharacterInconsistencyType, number> {
    return { name: 0, trait: 0, relationship: 0, timeline: 0, pov: 0, other: 0 };
  }

  private countByType(issues: CharacterConsistencyIssue[]): Record<CharacterInconsistencyType, number> {
    const counts = this.emptyCounts();
    for (const i of issues) counts[i.type] = (counts[i.type] || 0) + 1;
    return counts;
  }
}

