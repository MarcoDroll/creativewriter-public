import { TestBed } from '@angular/core/testing';
import { CodexContextService } from './codex-context.service';
import { CodexRelevanceService, CodexEntry as CodexRelevanceEntry } from '../../core/services/codex-relevance.service';
import { CodexService } from '../../stories/services/codex.service';
import { CodexEntry } from '../../stories/models/codex.interface';

describe('CodexContextService', () => {
  let service: CodexContextService;
  let mockCodexService: jasmine.SpyObj<CodexService>;
  let mockRelevanceService: jasmine.SpyObj<CodexRelevanceService>;

  const makeCodexEntry = (overrides: Partial<CodexEntry> = {}): CodexEntry => ({
    id: 'e1',
    categoryId: 'cat1',
    title: 'Test Entry',
    content: 'Test content',
    order: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  });

  const makeRelevanceEntry = (overrides: Partial<CodexRelevanceEntry> = {}): CodexRelevanceEntry => ({
    id: 'e1',
    title: 'Test Entry',
    category: 'character',
    content: 'Test content',
    tags: [],
    aliases: [],
    importance: 'minor',
    ...overrides
  });

  beforeEach(() => {
    mockCodexService = jasmine.createSpyObj('CodexService', ['getAllCodexEntries']);
    mockRelevanceService = jasmine.createSpyObj('CodexRelevanceService', [
      'convertFromStoryFormat',
      'filterRelevantEntries'
    ]);

    TestBed.configureTestingModule({
      providers: [
        CodexContextService,
        { provide: CodexService, useValue: mockCodexService },
        { provide: CodexRelevanceService, useValue: mockRelevanceService }
      ]
    });

    service = TestBed.inject(CodexContextService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('buildCodexXml', () => {
    it('should return empty result when no codex entries exist', async () => {
      mockCodexService.getAllCodexEntries.and.returnValue([]);

      const result = await service.buildCodexXml('story1', 'prompt', '', 'scene text');

      expect(result.xml).toBe('');
      expect(result.categories).toEqual([]);
    });

    it('should call relevance service with new signature when not skipped', async () => {
      const entry = makeCodexEntry({ id: 'c1', title: 'Elena' });
      const allEntries = [{ category: 'Characters', entries: [entry] }];
      mockCodexService.getAllCodexEntries.and.returnValue(allEntries);

      const relevanceEntry = makeRelevanceEntry({ id: 'c1', title: 'Elena' });
      mockRelevanceService.convertFromStoryFormat.and.returnValue([relevanceEntry]);
      mockRelevanceService.filterRelevantEntries.and.returnValue([relevanceEntry]);

      const result = await service.buildCodexXml('story1', 'write more', 'staging', 'Elena walked');

      expect(mockRelevanceService.convertFromStoryFormat).toHaveBeenCalledWith(allEntries);
      expect(mockRelevanceService.filterRelevantEntries).toHaveBeenCalledWith(
        [relevanceEntry], 'write more', 'staging', 'Elena walked'
      );
      expect(result.categories.length).toBe(1);
      expect(result.xml).toContain('Elena');
    });

    it('should not call relevance service when skipRelevanceFiltering is true', async () => {
      const entry = makeCodexEntry({ id: 'c1', title: 'Elena', content: 'A knight' });
      const allEntries = [{ category: 'Characters', entries: [entry] }];
      mockCodexService.getAllCodexEntries.and.returnValue(allEntries);

      const result = await service.buildCodexXml('story1', 'prompt', '', 'scene', 1000, true);

      expect(mockRelevanceService.convertFromStoryFormat).not.toHaveBeenCalled();
      expect(mockRelevanceService.filterRelevantEntries).not.toHaveBeenCalled();
      expect(result.categories.length).toBe(1);
    });

    it('should always include Notes category', async () => {
      const charEntry = makeCodexEntry({ id: 'c1', title: 'Elena' });
      const noteEntry = makeCodexEntry({ id: 'n1', title: 'Plot Notes' });
      const allEntries = [
        { category: 'Characters', entries: [charEntry] },
        { category: 'Notes', entries: [noteEntry] }
      ];
      mockCodexService.getAllCodexEntries.and.returnValue(allEntries);

      mockRelevanceService.convertFromStoryFormat.and.returnValue([]);
      mockRelevanceService.filterRelevantEntries.and.returnValue([]);

      const result = await service.buildCodexXml('story1', 'unrelated prompt', '', 'unrelated text');

      expect(result.categories.length).toBe(1);
      expect(result.categories[0].category).toBe('Notes');
    });

    it('should generate valid XML with character entries', async () => {
      const entry = makeCodexEntry({
        id: 'c1',
        title: 'Elena Blackwood',
        content: 'A brave knight.',
        metadata: {
          storyRole: 'Protagonist',
          aliases: 'The Knight'
        }
      });
      const allEntries = [{ category: 'Characters', entries: [entry] }];
      mockCodexService.getAllCodexEntries.and.returnValue(allEntries);

      const relevanceEntry = makeRelevanceEntry({ id: 'c1' });
      mockRelevanceService.convertFromStoryFormat.and.returnValue([relevanceEntry]);
      mockRelevanceService.filterRelevantEntries.and.returnValue([relevanceEntry]);

      const result = await service.buildCodexXml('story1', 'write', '', 'Elena Blackwood');

      expect(result.xml).toContain('<character name="Elena Blackwood"');
      expect(result.xml).toContain('storyRole="Protagonist"');
      expect(result.xml).toContain('aliases="The Knight"');
      expect(result.xml).toContain('<description>A brave knight.</description>');
      expect(result.xml).toContain('</character>');
    });

    it('should escape XML special characters', async () => {
      const entry = makeCodexEntry({
        id: 'c1',
        title: 'Tom & Jerry',
        content: 'Uses <weapons> & "quotes"'
      });
      const allEntries = [{ category: 'Characters', entries: [entry] }];
      mockCodexService.getAllCodexEntries.and.returnValue(allEntries);

      const relevanceEntry = makeRelevanceEntry({ id: 'c1' });
      mockRelevanceService.convertFromStoryFormat.and.returnValue([relevanceEntry]);
      mockRelevanceService.filterRelevantEntries.and.returnValue([relevanceEntry]);

      const result = await service.buildCodexXml('story1', 'write', '', 'Tom & Jerry');

      expect(result.xml).toContain('Tom &amp; Jerry');
      expect(result.xml).toContain('&lt;weapons&gt;');
      expect(result.xml).toContain('&amp;');
      expect(result.xml).toContain('&quot;quotes&quot;');
    });

    it('should map location category to correct XML type', async () => {
      const entry = makeCodexEntry({ id: 'l1', title: 'Dark Forest', content: 'A scary place.' });
      const allEntries = [{ category: 'Locations', entries: [entry] }];
      mockCodexService.getAllCodexEntries.and.returnValue(allEntries);

      const relevanceEntry = makeRelevanceEntry({ id: 'l1' });
      mockRelevanceService.convertFromStoryFormat.and.returnValue([relevanceEntry]);
      mockRelevanceService.filterRelevantEntries.and.returnValue([relevanceEntry]);

      const result = await service.buildCodexXml('story1', 'write', '', 'Dark Forest');

      expect(result.xml).toContain('<location name="Dark Forest"');
      expect(result.xml).toContain('</location>');
    });

    it('should map object category to item XML type', async () => {
      const entry = makeCodexEntry({ id: 'o1', title: 'Magic Sword', content: 'A powerful weapon.' });
      const allEntries = [{ category: 'Objects', entries: [entry] }];
      mockCodexService.getAllCodexEntries.and.returnValue(allEntries);

      const relevanceEntry = makeRelevanceEntry({ id: 'o1' });
      mockRelevanceService.convertFromStoryFormat.and.returnValue([relevanceEntry]);
      mockRelevanceService.filterRelevantEntries.and.returnValue([relevanceEntry]);

      const result = await service.buildCodexXml('story1', 'write', '', 'Magic Sword');

      expect(result.xml).toContain('<item name="Magic Sword"');
      expect(result.xml).toContain('</item>');
    });

    it('should include custom fields in XML output', async () => {
      const entry = makeCodexEntry({
        id: 'c1',
        title: 'Elena',
        content: '',
        metadata: {
          customFields: [
            { id: 'f1', name: 'Hair Color', value: 'Black' },
            { id: 'f2', name: 'Eye Color', value: 'Green' }
          ]
        }
      });
      const allEntries = [{ category: 'Characters', entries: [entry] }];
      mockCodexService.getAllCodexEntries.and.returnValue(allEntries);

      const relevanceEntry = makeRelevanceEntry({ id: 'c1' });
      mockRelevanceService.convertFromStoryFormat.and.returnValue([relevanceEntry]);
      mockRelevanceService.filterRelevantEntries.and.returnValue([relevanceEntry]);

      const result = await service.buildCodexXml('story1', 'write', '', 'Elena');

      expect(result.xml).toContain('<hairColor>Black</hairColor>');
      expect(result.xml).toContain('<eyeColor>Green</eyeColor>');
    });

    it('should report dropped entries when skipRelevanceFiltering is true and budget exceeded', async () => {
      const bigContent = 'x'.repeat(35000);
      const entries = [
        makeCodexEntry({ id: 'c1', title: 'Entry 1', content: bigContent }),
        makeCodexEntry({ id: 'c2', title: 'Entry 2', content: 'short' })
      ];
      const allEntries = [{ category: 'Characters', entries }];
      mockCodexService.getAllCodexEntries.and.returnValue(allEntries);

      const result = await service.buildCodexXml('story1', '', '', '', 1000, true);

      expect(result.totalEntries).toBe(2);
      expect(result.entriesDropped).toBe(1);
    });
  });
});
