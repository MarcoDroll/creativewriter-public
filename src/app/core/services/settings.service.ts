import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Settings, DEFAULT_SETTINGS } from '../models/settings.interface';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private readonly STORAGE_KEY = 'creative-writer-settings';
  private settingsSubject = new BehaviorSubject<Settings>(this.loadSettings());
  
  public settings$ = this.settingsSubject.asObservable();

  constructor() {
    // Initialize with saved settings or defaults
    this.settingsSubject.next(this.loadSettings());
  }

  private loadSettings(): Settings {
    try {
      const savedSettings = localStorage.getItem(this.STORAGE_KEY);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        // Merge with defaults to ensure all properties exist
        const beatInputFavorites = Array.isArray(parsed.favoriteModelLists?.beatInput)
          ? parsed.favoriteModelLists.beatInput
          : Array.isArray(parsed.favoriteModels)
            ? parsed.favoriteModels
            : DEFAULT_SETTINGS.favoriteModelLists.beatInput;

        const sceneSummaryFavorites = Array.isArray(parsed.favoriteModelLists?.sceneSummary)
          ? parsed.favoriteModelLists.sceneSummary
          : DEFAULT_SETTINGS.favoriteModelLists.sceneSummary;

        const rewriteFavorites = Array.isArray(parsed.favoriteModelLists?.rewrite)
          ? parsed.favoriteModelLists.rewrite
          : DEFAULT_SETTINGS.favoriteModelLists.rewrite;

        const favoriteModelLists = {
          ...DEFAULT_SETTINGS.favoriteModelLists,
          ...(parsed.favoriteModelLists ?? {}),
          beatInput: [...beatInputFavorites],
          sceneSummary: [...sceneSummaryFavorites],
          rewrite: [...rewriteFavorites]
        };

        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          openRouter: {
            ...DEFAULT_SETTINGS.openRouter,
            ...parsed.openRouter
          },
          replicate: {
            ...DEFAULT_SETTINGS.replicate,
            ...parsed.replicate
          },
          googleGemini: {
            ...DEFAULT_SETTINGS.googleGemini,
            ...parsed.googleGemini,
            contentFilter: {
              ...DEFAULT_SETTINGS.googleGemini.contentFilter,
              ...parsed.googleGemini?.contentFilter
            }
          },
          ollama: {
            ...DEFAULT_SETTINGS.ollama,
            ...parsed.ollama
          },
          claude: {
            ...DEFAULT_SETTINGS.claude,
            ...parsed.claude
          },
          openAICompatible: {
            ...DEFAULT_SETTINGS.openAICompatible,
            ...parsed.openAICompatible
          },
          sceneTitleGeneration: {
            ...DEFAULT_SETTINGS.sceneTitleGeneration,
            ...parsed.sceneTitleGeneration
          },
          sceneSummaryGeneration: {
            ...DEFAULT_SETTINGS.sceneSummaryGeneration,
            ...parsed.sceneSummaryGeneration
          },
          stagingNotesGeneration: {
            ...DEFAULT_SETTINGS.stagingNotesGeneration,
            ...parsed.stagingNotesGeneration
          },
          sceneGenerationFromOutline: {
            ...DEFAULT_SETTINGS.sceneGenerationFromOutline,
            ...parsed.sceneGenerationFromOutline
          },
          appearance: {
            ...DEFAULT_SETTINGS.appearance,
            ...parsed.appearance
          },
          premium: {
            ...DEFAULT_SETTINGS.premium,
            ...parsed.premium,
            cachedStatus: {
              ...DEFAULT_SETTINGS.premium.cachedStatus,
              ...parsed.premium?.cachedStatus
            }
          },
          portraitModel: {
            ...DEFAULT_SETTINGS.portraitModel,
            ...parsed.portraitModel
          },
          falAi: {
            ...DEFAULT_SETTINGS.falAi,
            ...parsed.falAi
          },
          imageGeneration: {
            ...DEFAULT_SETTINGS.imageGeneration,
            ...parsed.imageGeneration
          },
          serverGeneration: {
            ...DEFAULT_SETTINGS.serverGeneration,
            ...parsed.serverGeneration
          },
          research: {
            ...DEFAULT_SETTINGS.research,
            ...parsed.research
          },
          favoriteModelLists,
          favoriteModels: [...favoriteModelLists.beatInput],
          updatedAt: new Date(parsed.updatedAt || new Date())
        };
      }
    } catch (error) {
      console.error('Failed to load settings:', error);
    }
    return { ...DEFAULT_SETTINGS };
  }

  private saveSettings(settings: Settings): void {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.error('Failed to save settings:', error);
    }
  }

  getSettings(): Settings {
    return this.settingsSubject.value;
  }

  updateSettings(settings: Partial<Settings>): void {
    const currentSettings = this.settingsSubject.value;
    const mergedFavoriteLists = {
      ...currentSettings.favoriteModelLists,
      ...(settings.favoriteModelLists ?? {})
    } as Settings['favoriteModelLists'];

    const favoriteListsKeys: (keyof Settings['favoriteModelLists'])[] = ['beatInput', 'sceneSummary', 'rewrite'];
    for (const key of favoriteListsKeys) {
      if (settings.favoriteModelLists?.[key]) {
        mergedFavoriteLists[key] = [...settings.favoriteModelLists[key]];
      } else {
        mergedFavoriteLists[key] = [...(mergedFavoriteLists[key] ?? [])];
      }
    }

    const updatedSettings: Settings = {
      ...currentSettings,
      ...settings,
      favoriteModelLists: mergedFavoriteLists,
      updatedAt: new Date()
    };

    if (settings.favoriteModelLists?.beatInput) {
      updatedSettings.favoriteModels = [...settings.favoriteModelLists.beatInput];
    } else if (settings.favoriteModels) {
      updatedSettings.favoriteModels = [...settings.favoriteModels];
      updatedSettings.favoriteModelLists = {
        ...updatedSettings.favoriteModelLists,
        beatInput: [...settings.favoriteModels]
      };
    } else {
      updatedSettings.favoriteModels = [...updatedSettings.favoriteModelLists.beatInput];
    }

    this.saveSettings(updatedSettings);
    this.settingsSubject.next(updatedSettings);
  }

  updateOpenRouterSettings(settings: Partial<Settings['openRouter']>): void {
    const currentSettings = this.settingsSubject.value;
    const updatedSettings = {
      ...currentSettings,
      openRouter: {
        ...currentSettings.openRouter,
        ...settings
      },
      // If OpenRouter is being enabled, disable Gemini
      googleGemini: settings.enabled ? {
        ...currentSettings.googleGemini,
        enabled: false
      } : currentSettings.googleGemini,
      updatedAt: new Date()
    };
    
    this.saveSettings(updatedSettings);
    this.settingsSubject.next(updatedSettings);
  }

  updateReplicateSettings(settings: Partial<Settings['replicate']>): void {
    const currentSettings = this.settingsSubject.value;
    const updatedSettings = {
      ...currentSettings,
      replicate: {
        ...currentSettings.replicate,
        ...settings
      },
      updatedAt: new Date()
    };

    this.saveSettings(updatedSettings);
    this.settingsSubject.next(updatedSettings);
  }

  updateFalAiSettings(settings: Partial<Settings['falAi']>): void {
    const currentSettings = this.settingsSubject.value;
    const updatedSettings = {
      ...currentSettings,
      falAi: {
        ...currentSettings.falAi,
        ...settings
      },
      updatedAt: new Date()
    };

    this.saveSettings(updatedSettings);
    this.settingsSubject.next(updatedSettings);
  }

  updateImageGenerationSettings(settings: Partial<Settings['imageGeneration']>): void {
    const currentSettings = this.settingsSubject.value;
    const updatedSettings = {
      ...currentSettings,
      imageGeneration: {
        ...currentSettings.imageGeneration,
        ...settings
      },
      updatedAt: new Date()
    };

    this.saveSettings(updatedSettings);
    this.settingsSubject.next(updatedSettings);
  }

  updateSceneTitleGenerationSettings(settings: Partial<Settings['sceneTitleGeneration']>): void {
    const currentSettings = this.settingsSubject.value;
    const updatedSettings = {
      ...currentSettings,
      sceneTitleGeneration: {
        ...currentSettings.sceneTitleGeneration,
        ...settings
      },
      updatedAt: new Date()
    };
    
    this.saveSettings(updatedSettings);
    this.settingsSubject.next(updatedSettings);
  }

  clearSettings(): void {
    localStorage.removeItem(this.STORAGE_KEY);
    const resetBeatFavorites = [...DEFAULT_SETTINGS.favoriteModelLists.beatInput];
    const resetSummaryFavorites = [...DEFAULT_SETTINGS.favoriteModelLists.sceneSummary];
    const resetRewriteFavorites = [...DEFAULT_SETTINGS.favoriteModelLists.rewrite];
    this.settingsSubject.next({
      ...DEFAULT_SETTINGS,
      favoriteModelLists: {
        ...DEFAULT_SETTINGS.favoriteModelLists,
        beatInput: resetBeatFavorites,
        sceneSummary: resetSummaryFavorites,
        rewrite: resetRewriteFavorites
      },
      favoriteModels: [...resetBeatFavorites],
      updatedAt: new Date()
    });
  }

  // Utility methods for checking API availability
  isOpenRouterConfigured(): boolean {
    const settings = this.getSettings();
    return settings.openRouter.enabled && !!settings.openRouter.apiKey;
  }

  isReplicateConfigured(): boolean {
    const settings = this.getSettings();
    return settings.replicate.enabled && !!settings.replicate.apiKey;
  }

  updateGoogleGeminiSettings(settings: Partial<Settings['googleGemini']>): void {
    const currentSettings = this.settingsSubject.value;
    const updatedSettings = {
      ...currentSettings,
      googleGemini: {
        ...currentSettings.googleGemini,
        ...settings
      },
      // If Gemini is being enabled, disable OpenRouter
      openRouter: settings.enabled ? {
        ...currentSettings.openRouter,
        enabled: false
      } : currentSettings.openRouter,
      updatedAt: new Date()
    };
    
    this.saveSettings(updatedSettings);
    this.settingsSubject.next(updatedSettings);
  }

  isGoogleGeminiConfigured(): boolean {
    const settings = this.getSettings();
    return settings.googleGemini.enabled && !!settings.googleGemini.apiKey;
  }

  updateAppearanceSettings(settings: Partial<Settings['appearance']>): void {
    const currentSettings = this.settingsSubject.value;
    const updatedSettings = {
      ...currentSettings,
      appearance: {
        ...currentSettings.appearance,
        ...settings
      },
      updatedAt: new Date()
    };
    
    
    this.saveSettings(updatedSettings);
    this.settingsSubject.next(updatedSettings);
    
  }
}
