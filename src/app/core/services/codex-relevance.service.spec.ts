import { TestBed } from '@angular/core/testing';
import { CodexRelevanceService, CodexEntry } from './codex-relevance.service';

describe('CodexRelevanceService', () => {
  let service: CodexRelevanceService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CodexRelevanceService]
    });
    service = TestBed.inject(CodexRelevanceService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('filterRelevantEntries', () => {
    const makeEntry = (overrides: Partial<CodexEntry> = {}): CodexEntry => ({
      id: 'e1',
      title: 'Elena Blackwood',
      category: 'character',
      content: 'A brave knight.',
      tags: [],
      aliases: [],
      importance: 'minor',
      globalInclude: false,
      ...overrides
    });

    // --- Tier 0: globalInclude ---

    it('should always include globalInclude entries regardless of context', () => {
      const entries = [
        makeEntry({ id: 'g1', title: 'World Lore', globalInclude: true })
      ];

      const result = service.filterRelevantEntries(entries, '', '', '');
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('g1');
    });

    // --- Tier 1: beat prompt and staging notes ---

    it('should include entries whose title is mentioned in beat prompt', () => {
      const entries = [
        makeEntry({ id: 'e1', title: 'Elena Blackwood', importance: 'background' })
      ];

      const result = service.filterRelevantEntries(
        entries,
        'Write a scene where Elena Blackwood fights the dragon.',
        '',
        ''
      );
      expect(result.length).toBe(1);
    });

    it('should include entries whose title is mentioned in staging notes', () => {
      const entries = [
        makeEntry({ id: 'e1', title: 'Elena Blackwood', importance: 'background' })
      ];

      const result = service.filterRelevantEntries(
        entries,
        '',
        'Elena Blackwood is standing near the door.',
        ''
      );
      expect(result.length).toBe(1);
    });

    it('should include background characters via staging notes (Tier 1)', () => {
      const entries = [
        makeEntry({ id: 'e1', title: 'Innkeeper', importance: 'background' })
      ];

      const result = service.filterRelevantEntries(
        entries,
        '',
        'The Innkeeper serves drinks.',
        'The tavern was busy.'
      );
      expect(result.length).toBe(1);
    });

    // --- Tier 2: importance-tiered text matching ---

    it('should include major entries mentioned anywhere in scene text', () => {
      const entries = [
        makeEntry({ id: 'e1', title: 'Elena Blackwood', importance: 'major' })
      ];

      const result = service.filterRelevantEntries(
        entries,
        '',
        '',
        'Long ago, Elena Blackwood was born in a small village.' + 'x'.repeat(2000)
      );
      expect(result.length).toBe(1);
    });

    it('should include minor entries mentioned in recent text', () => {
      const entries = [
        makeEntry({ id: 'e1', title: 'Elena Blackwood', importance: 'minor' })
      ];

      // Place the name within the last 1500 chars (use spaces to ensure word boundaries)
      const result = service.filterRelevantEntries(
        entries,
        '',
        '',
        'Other text here. '.repeat(120) + 'Elena Blackwood walked in.'
      );
      expect(result.length).toBe(1);
    });

    it('should NOT include minor entries mentioned only once in distant text', () => {
      const entries = [
        makeEntry({ id: 'e1', title: 'Elena Blackwood', importance: 'minor' })
      ];

      // One mention early in text, outside recent window
      const result = service.filterRelevantEntries(
        entries,
        '',
        '',
        'Elena Blackwood appeared. ' + 'x'.repeat(3000)
      );
      expect(result.length).toBe(0);
    });

    it('should include minor entries with 2+ mentions in full scene text', () => {
      const entries = [
        makeEntry({ id: 'e1', title: 'Elena Blackwood', importance: 'minor' })
      ];

      // Two mentions, both outside recent text window
      const result = service.filterRelevantEntries(
        entries,
        '',
        '',
        'Elena Blackwood appeared. Elena Blackwood spoke. ' + 'x'.repeat(3000)
      );
      expect(result.length).toBe(1);
    });

    it('should NOT include background entries via scene text matching', () => {
      const entries = [
        makeEntry({ id: 'e1', title: 'Elena Blackwood', importance: 'background' })
      ];

      const result = service.filterRelevantEntries(
        entries,
        '',
        '',
        'Elena Blackwood walked in. Elena Blackwood spoke. Elena Blackwood left.'
      );
      expect(result.length).toBe(0);
    });

    // --- Edge cases ---

    it('should skip title matching for titles shorter than 4 characters', () => {
      const entries = [
        makeEntry({ id: 'e1', title: 'Elf', importance: 'major' })
      ];

      const result = service.filterRelevantEntries(
        entries,
        'The Elf walked through the forest.',
        '',
        'The Elf was there.'
      );
      expect(result.length).toBe(0);
    });

    it('should include entries matched by alias', () => {
      const entries = [
        makeEntry({
          id: 'e1',
          title: 'Elena Blackwood',
          aliases: ['The Knight', 'Lady Elena'],
          importance: 'major'
        })
      ];

      const result = service.filterRelevantEntries(
        entries,
        '',
        '',
        'The Knight rode into battle.'
      );
      expect(result.length).toBe(1);
    });

    it('should skip alias matching for aliases shorter than 4 characters', () => {
      const entries = [
        makeEntry({
          id: 'e1',
          title: 'Elena Blackwood',
          aliases: ['Eli'],
          importance: 'major'
        })
      ];

      const result = service.filterRelevantEntries(
        entries,
        '',
        '',
        'Eli walked through the forest.'
      );
      expect(result.length).toBe(0);
    });

    it('should not duplicate entries that match multiple criteria', () => {
      const entries = [
        makeEntry({
          id: 'e1',
          title: 'Elena Blackwood',
          aliases: ['Lady Elena'],
          importance: 'major',
          globalInclude: true
        })
      ];

      const result = service.filterRelevantEntries(
        entries,
        'Write about Elena Blackwood.',
        'Elena Blackwood is nearby.',
        'Elena Blackwood the warrior was there. Lady Elena drew her sword.'
      );
      expect(result.length).toBe(1);
    });

    it('should return empty array when no entries match', () => {
      const entries = [
        makeEntry({ id: 'e1', title: 'Elena Blackwood', importance: 'minor' })
      ];

      const result = service.filterRelevantEntries(
        entries,
        'Write about cooking recipes.',
        '',
        'The cat sat on the mat.'
      );
      expect(result.length).toBe(0);
    });

    it('should return empty array for empty entries', () => {
      const result = service.filterRelevantEntries([], 'some prompt', '', 'some text');
      expect(result.length).toBe(0);
    });

    it('should return empty array when all context strings are empty', () => {
      const entries = [makeEntry({ id: 'e1', importance: 'major' })];
      const result = service.filterRelevantEntries(entries, '', '', '');
      expect(result.length).toBe(0);
    });

    it('should handle scene text shorter than recent text window', () => {
      const entries = [makeEntry({ id: 'e1', title: 'Elena Blackwood', importance: 'minor' })];
      const result = service.filterRelevantEntries(entries, '', '', 'Elena Blackwood appeared.');
      expect(result.length).toBe(1);
    });

    it('should handle regex special characters in title', () => {
      const entries = [makeEntry({ id: 'e1', title: 'Dr. Strange', importance: 'major' })];
      const result = service.filterRelevantEntries(entries, '', '', 'Dr. Strange arrived.');
      expect(result.length).toBe(1);
    });

    it('should use word-boundary matching to avoid partial matches', () => {
      const entries = [
        makeEntry({ id: 'e1', title: 'Elena', importance: 'major' })
      ];

      const result1 = service.filterRelevantEntries(
        entries, '', '', 'Elena walked through the forest.'
      );
      expect(result1.length).toBe(1);

      const result2 = service.filterRelevantEntries(
        entries, '', '', 'The Elenation crumbled.'
      );
      expect(result2.length).toBe(0);
    });

    it('should be case-insensitive', () => {
      const entries = [
        makeEntry({ id: 'e1', title: 'Elena Blackwood', importance: 'major' })
      ];

      const result = service.filterRelevantEntries(
        entries, '', '', 'ELENA BLACKWOOD was here.'
      );
      expect(result.length).toBe(1);
    });

    it('should handle multiple entries with mixed tiers', () => {
      const entries = [
        makeEntry({ id: 'g1', title: 'World Rules', globalInclude: true }),
        makeEntry({ id: 'e1', title: 'Elena Blackwood', importance: 'major' }),
        makeEntry({ id: 'e2', title: 'Dark Forest', category: 'location', importance: 'major' }),
        makeEntry({ id: 'e3', title: 'Old Sword', category: 'object', importance: 'major' })
      ];

      const result = service.filterRelevantEntries(
        entries,
        '',
        '',
        'Elena Blackwood sensed something in the air.'
      );
      expect(result.length).toBe(2);
      expect(result.map(e => e.id)).toContain('g1');
      expect(result.map(e => e.id)).toContain('e1');
    });

    it('should count alias mentions toward frequency threshold for minor entries', () => {
      const entries = [
        makeEntry({
          id: 'e1',
          title: 'Elena Blackwood',
          aliases: ['Lady Elena'],
          importance: 'minor'
        })
      ];

      // One title mention + one alias mention = 2 total, meets threshold
      const result = service.filterRelevantEntries(
        entries,
        '',
        '',
        'Elena Blackwood appeared. Later, Lady Elena spoke. ' + 'x'.repeat(3000)
      );
      expect(result.length).toBe(1);
    });

    // --- Tag matching ---

    it('should include entries matched by tag in scene text', () => {
      const entries = [
        makeEntry({
          id: 'e1',
          title: 'Elena Blackwood',
          tags: ['warrior', 'hero'],
          importance: 'major'
        })
      ];

      const result = service.filterRelevantEntries(
        entries,
        '',
        '',
        'The warrior drew her sword.'
      );
      expect(result.length).toBe(1);
    });

    it('should include entries matched by tag in beat prompt (Tier 1)', () => {
      const entries = [
        makeEntry({
          id: 'e1',
          title: 'Elena Blackwood',
          tags: ['warrior'],
          importance: 'background'
        })
      ];

      const result = service.filterRelevantEntries(
        entries,
        'The warrior faces a challenge.',
        '',
        ''
      );
      expect(result.length).toBe(1);
    });

    it('should count tag mentions toward frequency threshold for minor entries', () => {
      const entries = [
        makeEntry({
          id: 'e1',
          title: 'Elena Blackwood',
          tags: ['warrior'],
          importance: 'minor'
        })
      ];

      // One title mention + one tag mention = 2 total, meets threshold
      const result = service.filterRelevantEntries(
        entries,
        '',
        '',
        'Elena Blackwood appeared. The warrior spoke. ' + 'x'.repeat(3000)
      );
      expect(result.length).toBe(1);
    });

    it('should skip tag matching for tags shorter than 4 characters', () => {
      const entries = [
        makeEntry({
          id: 'e1',
          title: 'Elena Blackwood',
          tags: ['elf'],
          importance: 'major'
        })
      ];

      const result = service.filterRelevantEntries(
        entries,
        'The elf cast a spell.',
        '',
        'The elf was there.'
      );
      expect(result.length).toBe(0);
    });
  });

  describe('convertFromStoryFormat', () => {
    it('should convert story codex entries to flat format with tags preserved', () => {
      const storyEntries = [{
        category: 'Characters',
        entries: [{
          id: 'c1',
          categoryId: 'cat1',
          title: 'Elena Blackwood',
          content: 'A brave knight.',
          tags: ['warrior', 'hero'],
          order: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {
            aliases: 'The Knight, Lady Elena',
            storyRole: 'Protagonist'
          }
        }]
      }];

      const result = service.convertFromStoryFormat(storyEntries);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('c1');
      expect(result[0].category).toBe('character');
      expect(result[0].tags).toEqual(['warrior', 'hero']);
      expect(result[0].aliases).toEqual(['The Knight', 'Lady Elena']);
      expect(result[0].importance).toBe('major');
      expect(result[0].globalInclude).toBe(false);
      // keywords field no longer exists on the interface
      expect('keywords' in result[0]).toBeFalse();
    });

    it('should map category names correctly', () => {
      const categories = [
        { category: 'Characters', expected: 'character' },
        { category: 'Charaktere', expected: 'character' },
        { category: 'Figuren', expected: 'character' },
        { category: 'Locations', expected: 'location' },
        { category: 'Orte', expected: 'location' },
        { category: 'Objects', expected: 'object' },
        { category: 'Items', expected: 'object' },
        { category: 'Lore', expected: 'lore' },
        { category: 'Wissen', expected: 'lore' },
        { category: 'Notes', expected: 'other' },
        { category: 'Custom Category', expected: 'other' }
      ];

      for (const { category, expected } of categories) {
        const result = service.convertFromStoryFormat([{
          category,
          entries: [{
            id: 'e1',
            categoryId: 'cat1',
            title: 'Test Entry',
            content: '',
            order: 0,
            createdAt: new Date(),
            updatedAt: new Date()
          }]
        }]);
        expect(result[0].category).toBe(expected, `Category "${category}" should map to "${expected}"`);
      }
    });

    it('should set importance based on category and story role', () => {
      const makeStoryEntry = (category: string, storyRole?: string) => [{
        category,
        entries: [{
          id: 'e1', categoryId: 'cat1', title: 'Test', content: '',
          order: 0, createdAt: new Date(), updatedAt: new Date(),
          metadata: storyRole ? { storyRole } : undefined
        }]
      }];

      // Characters use role-based importance
      expect(service.convertFromStoryFormat(makeStoryEntry('Characters', 'Protagonist'))[0].importance).toBe('major');
      expect(service.convertFromStoryFormat(makeStoryEntry('Characters', 'Antagonist'))[0].importance).toBe('major');
      expect(service.convertFromStoryFormat(makeStoryEntry('Characters', 'Love Interest'))[0].importance).toBe('major');
      expect(service.convertFromStoryFormat(makeStoryEntry('Characters', 'Supporting Character'))[0].importance).toBe('minor');
      expect(service.convertFromStoryFormat(makeStoryEntry('Characters', 'Background Character'))[0].importance).toBe('background');
      expect(service.convertFromStoryFormat(makeStoryEntry('Characters', 'Hintergrundcharakter'))[0].importance).toBe('background');

      // Locations and objects are always major
      expect(service.convertFromStoryFormat(makeStoryEntry('Locations'))[0].importance).toBe('major');
      expect(service.convertFromStoryFormat(makeStoryEntry('Objects'))[0].importance).toBe('major');

      // Lore and other are minor by default
      expect(service.convertFromStoryFormat(makeStoryEntry('Lore'))[0].importance).toBe('minor');
      expect(service.convertFromStoryFormat(makeStoryEntry('Custom'))[0].importance).toBe('minor');
    });

    it('should set globalInclude from metadata or alwaysInclude', () => {
      const entries = [{
        category: 'Characters',
        entries: [
          {
            id: 'e1', categoryId: 'cat1', title: 'Always Included', content: '',
            order: 0, createdAt: new Date(), updatedAt: new Date(),
            alwaysInclude: true
          },
          {
            id: 'e2', categoryId: 'cat1', title: 'Global Include', content: '',
            order: 1, createdAt: new Date(), updatedAt: new Date(),
            metadata: { globalInclude: true }
          },
          {
            id: 'e3', categoryId: 'cat1', title: 'Not Included', content: '',
            order: 2, createdAt: new Date(), updatedAt: new Date()
          }
        ]
      }];

      const result = service.convertFromStoryFormat(entries);
      expect(result[0].globalInclude).toBe(true);
      expect(result[1].globalInclude).toBe(true);
      expect(result[2].globalInclude).toBe(false);
    });

    it('should handle entries with no tags or metadata', () => {
      const entries = [{
        category: 'Characters',
        entries: [{
          id: 'e1', categoryId: 'cat1', title: 'Simple Entry', content: 'Basic content.',
          order: 0, createdAt: new Date(), updatedAt: new Date()
        }]
      }];

      const result = service.convertFromStoryFormat(entries);
      expect(result.length).toBe(1);
      expect(result[0].tags).toEqual([]);
      expect(result[0].aliases).toEqual([]);
      expect(result[0].importance).toBe('minor');
      expect(result[0].globalInclude).toBe(false);
    });

    it('should handle empty categories', () => {
      const result = service.convertFromStoryFormat([]);
      expect(result).toEqual([]);
    });
  });
});
