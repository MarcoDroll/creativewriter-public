import { Injectable, inject } from '@angular/core';
import { SettingsService } from '../../core/services/settings.service';
import { OpenRouterApiService } from '../../core/services/openrouter-api.service';
import { ClaudeApiService } from '../../core/services/claude-api.service';
import { GoogleGeminiApiService } from '../../core/services/google-gemini-api.service';
import { OllamaApiService, OllamaResponse, OllamaChatResponse } from '../../core/services/ollama-api.service';
import { OpenAICompatibleApiService } from '../../core/services/openai-compatible-api.service';
import { firstValueFrom } from 'rxjs';
import { ClicheFinding, SceneClicheResult, ClicheFindingType } from '../models/cliche-analysis.interface';

@Injectable({ providedIn: 'root' })
export class ClicheAnalysisService {
  private settings = inject(SettingsService);
  private openrouter = inject(OpenRouterApiService);
  private claude = inject(ClaudeApiService);
  private gemini = inject(GoogleGeminiApiService);
  private ollama = inject(OllamaApiService);
  private openAICompatible = inject(OpenAICompatibleApiService);

  async analyzeScene(params: {
    modelId?: string; // format: provider:model
    sceneId: string;
    sceneTitle: string;
    sceneText: string;
  }): Promise<SceneClicheResult> {
    const { modelId, sceneId, sceneTitle, sceneText } = params;

    const selected = modelId || this.settings.getSettings().selectedModel;
    if (!selected) {
      return {
        sceneId,
        sceneTitle,
        findings: [],
        summary: { counts: this.emptyCounts() },
        error: 'No model selected. Choose a model in the selector.'
      };
    }

    const { provider, model } = this.parseModel(selected);
    const prompt = this.buildPrompt(sceneId, sceneTitle, sceneText);

    try {
      let content = '';
      if (provider === 'openrouter') {
        const res = await firstValueFrom(
          this.openrouter.generateText(prompt, {
            model,
            maxTokens: 2000,
            temperature: 0.1,
            topP: 0.9
          })
        );
        content = res.choices?.[0]?.message?.content || '';
      } else if (provider === 'claude') {
        const res = await firstValueFrom(
          this.claude.generateText(prompt, {
            model,
            maxTokens: 4000,
            temperature: 0.1,
            topP: 0.9
          })
        );
        content = res.content?.[0]?.text || '';
      } else if (provider === 'gemini') {
        const res = await firstValueFrom(
          this.gemini.generateText(prompt, {
            model,
            maxTokens: 4000,
            temperature: 0.1,
            topP: 0.9
          })
        );
        content = res.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else if (provider === 'ollama') {
        const res = await firstValueFrom(
          this.ollama.generateText(prompt, {
            model,
            maxTokens: 2000,
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
        } else { content = ''; }
      } else if (provider === 'openaiCompatible') {
        const res = await firstValueFrom(
          this.openAICompatible.generateText(prompt, {
            model,
            maxTokens: 2000,
            temperature: 0.1,
            topP: 0.9
          })
        );
        content = res.choices?.[0]?.message?.content || '';
      } else {
        return {
          sceneId,
          sceneTitle,
          findings: [],
          summary: { counts: this.emptyCounts() },
          error: `Unsupported provider: ${provider}`
        };
      }

      const parsed = this.parseJson(content);
      if (!parsed) {
        return {
          sceneId,
          sceneTitle,
          findings: [],
          summary: { counts: this.emptyCounts() },
          error: 'Model did not return valid JSON.'
        };
      }

      // Coerce to our types safely
      const rawFindings = (parsed as { findings?: unknown }).findings;
      const findings: ClicheFinding[] = Array.isArray(rawFindings)
        ? rawFindings.map((f: unknown) => this.normalizeFinding(f)).filter(Boolean)
        : [];

      const counts = this.countByType(findings);

      return {
        sceneId,
        sceneTitle,
        findings,
        summary: { counts }
      };
    } catch (error: unknown) {
      return {
        sceneId,
        sceneTitle,
        findings: [],
        summary: { counts: this.emptyCounts() },
        error: (error && typeof error === 'object' && 'message' in error) ? String((error as { message: unknown }).message) : 'Request failed'
      };
    }
  }

  private parseModel(selected: string): { provider: string; model: string } {
    const [provider, ...rest] = selected.split(':');
    return { provider, model: rest.join(':') };
  }

  private buildPrompt(sceneId: string, sceneTitle: string, sceneText: string): string {
    return [
      'You are a multilingual writing analyst. Identify clichés, idioms, redundancies, buzzwords, and stereotypical tropes. Do NOT translate the text. Respond with JSON only matching the schema exactly.',
      '',
      'Schema:',
      '{',
      '  "sceneId": "string",',
      '  "sceneTitle": "string",',
      '  "findings": [',
      '    {',
      '      "type": "cliche|idiom|redundancy|buzzword|stereotype",',
      '      "phrase": "string",',
      '      "start": 0,',
      '      "end": 0,',
      '      "language": "string",',
      '      "confidence": 0.0,',
      '      "why": "string",',
      '      "suggestion": "string"',
      '    }',
      '  ],',
      '  "summary": {',
      '    "counts": { "cliche": 0, "idiom": 0, "redundancy": 0, "buzzword": 0, "stereotype": 0 }',
      '  }',
      '}',
      '',
      `Scene (${sceneId} — ${sceneTitle}):`,
      sceneText
    ].join('\n');
  }

  private parseJson(text: string): unknown | null {
    if (!text) return null;
    const cleaned = this.stripCodeFences(text).trim();
    // 1) Try direct parse
    try { return JSON.parse(cleaned); } catch { /* ignore: try fallbacks */ }
    // 2) Balanced braces extraction (first object)
    const obj = this.extractFirstJsonObject(cleaned);
    if (obj) {
      try { return JSON.parse(obj); } catch { /* ignore: try next */ }
    }
    // 3) Fallback: first-to-last brace slice
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const slice = cleaned.slice(start, end + 1);
      try { return JSON.parse(slice); } catch { /* give up */ }
    }
    return null;
  }

  private stripCodeFences(s: string): string {
    // Remove ```json ... ``` or ``` ... ``` fences
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
        if (depth === 0) {
          return s.slice(start, i + 1);
        }
      }
    }
    return null;
  }

  private normalizeFinding(f: unknown): ClicheFinding {
    const obj = (typeof f === 'object' && f !== null) ? (f as Record<string, unknown>) : {};
    const type = String(obj['type'] || '').toLowerCase();
    const validTypes: ClicheFindingType[] = ['cliche', 'idiom', 'redundancy', 'buzzword', 'stereotype'];
    const coercedType = validTypes.includes(type as ClicheFindingType) ? type as ClicheFindingType : 'cliche';
    const phrase = String(obj['phrase'] || '').slice(0, 500);
    const startVal = typeof obj['start'] === 'number' ? (obj['start'] as number) : NaN;
    const endVal = typeof obj['end'] === 'number' ? (obj['end'] as number) : NaN;
    const start = Number.isFinite(startVal) ? Math.max(0, Math.floor(startVal)) : 0;
    const end = Number.isFinite(endVal) ? Math.max(start, Math.floor(endVal)) : start + phrase.length;
    const language = String(obj['language'] || '');
    const confVal = typeof obj['confidence'] === 'number' ? (obj['confidence'] as number) : NaN;
    const confidence = Number.isFinite(confVal) ? Math.max(0, Math.min(1, Number(confVal))) : 0.5;
    const why = String(obj['why'] || '');
    const suggestion = String(obj['suggestion'] || '');
    return { type: coercedType, phrase, start, end, language, confidence, why, suggestion };
  }

  private emptyCounts(): Record<ClicheFindingType, number> {
    return { cliche: 0, idiom: 0, redundancy: 0, buzzword: 0, stereotype: 0 };
  }

  private countByType(findings: ClicheFinding[]): Record<ClicheFindingType, number> {
    const counts = this.emptyCounts();
    for (const f of findings) {
      counts[f.type] = (counts[f.type] || 0) + 1;
    }
    return counts;
  }
}
