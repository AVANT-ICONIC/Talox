import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticMapper, createSemanticMapper } from '../../src/core/SemanticMapper';
import type { TaloxNode } from '../../src/types/index';
import type { KnowledgeProfile, SemanticEntityType } from '../../src/core/SemanticMapper';

function makeNode(overrides: Partial<TaloxNode> = {}): TaloxNode {
  return {
    id: 'node-1',
    role: 'button',
    name: 'Submit',
    boundingBox: { x: 0, y: 0, width: 100, height: 40 },
    ...overrides,
  };
}

describe('SemanticMapper', () => {
  let mapper: SemanticMapper;

  beforeEach(() => {
    mapper = new SemanticMapper();
  });

  describe('constructor + factory', () => {
    it('creates instance with defaults', () => {
      expect(mapper).toBeInstanceOf(SemanticMapper);
    });

    it('factory creates instance', () => {
      const m = createSemanticMapper({ defaultConfidence: 0.8 });
      expect(m).toBeInstanceOf(SemanticMapper);
    });
  });

  describe('mapNode', () => {
    it('maps a button node correctly', () => {
      const node = makeNode({ role: 'button', name: 'Login' });
      const entity = mapper.mapNode(node);

      expect(entity.id).toBe('node-1');
      expect(entity.type).toBe('button');
      expect(entity.role).toBe('button');
      expect(entity.name).toBe('Login');
      expect(entity.confidence).toBeGreaterThan(0);
    });

    it('maps a navigation node', () => {
      const node = makeNode({ role: 'navigation', name: 'Main Nav' });
      const entity = mapper.mapNode(node);
      expect(entity.type).toBe('navigation');
    });

    it('maps a textbox to input type', () => {
      const node = makeNode({ role: 'textbox', name: 'Email' });
      const entity = mapper.mapNode(node);
      expect(entity.type).toBe('input');
    });

    it('maps a link node', () => {
      const node = makeNode({ role: 'link', name: 'Click here' });
      const entity = mapper.mapNode(node);
      expect(entity.type).toBe('link');
    });

    it('maps unknown role to unknown type', () => {
      const node = makeNode({ role: 'custom-widget', name: '' });
      const entity = mapper.mapNode(node);
      expect(entity.type).toBe('unknown');
    });

    it('includes bounding box from node', () => {
      const node = makeNode();
      const entity = mapper.mapNode(node);
      expect(entity.boundingBox).toEqual({ x: 0, y: 0, width: 100, height: 40 });
    });

    it('extracts metadata including isInteractive', () => {
      const btn = makeNode({ role: 'button', name: 'Go' });
      const entity = mapper.mapNode(btn);
      expect(entity.metadata.isInteractive).toBe(true);

      const heading = makeNode({ role: 'heading', name: 'Title' });
      const hEntity = mapper.mapNode(heading);
      expect(hEntity.metadata.isInteractive).toBe(false);
    });
  });

  describe('mapNodes', () => {
    it('maps multiple nodes', () => {
      const nodes = [
        makeNode({ id: 'n1', role: 'button', name: 'A' }),
        makeNode({ id: 'n2', role: 'link', name: 'B' }),
        makeNode({ id: 'n3', role: 'heading', name: 'Title' }),
      ];
      const entities = mapper.mapNodes(nodes);
      expect(entities).toHaveLength(3);
      expect(entities[0]!.type).toBe('button');
      expect(entities[1]!.type).toBe('link');
      expect(entities[2]!.type).toBe('heading');
    });
  });

  describe('label generation', () => {
    it('uses node name as label when non-generic', () => {
      const node = makeNode({ name: 'Login' });
      const entity = mapper.mapNode(node);
      expect(entity.label).toBe('login');
    });

    it('uses data-testid when name is empty', () => {
      const node = makeNode({
        name: '',
        attributes: { 'data-testid': 'submit-form' },
      });
      const entity = mapper.mapNode(node);
      expect(entity.label).toBe('submit-form');
    });

    it('generates type-based label when name is generic', () => {
      const node = makeNode({
        role: 'button',
        name: 'button', // generic name
      });
      const entity = mapper.mapNode(node);
      // "button" is in the generic list, so it falls back to type-based label
      expect(entity.label).toBe('button');
    });

    it('uses aria-label when name is empty', () => {
      const node = makeNode({
        name: '',
        attributes: { 'aria-label': 'Close Dialog' },
      });
      const entity = mapper.mapNode(node);
      expect(entity.label).toBe('close-dialog');
    });

    it('falls back to type-based label', () => {
      const node = makeNode({ role: 'button', name: '' });
      const entity = mapper.mapNode(node);
      expect(entity.label).toBe('button');
    });
  });

  describe('confidence calculation', () => {
    it('unknown types get lower confidence', () => {
      const node = makeNode({ role: 'custom-widget', name: '' });
      const entity = mapper.mapNode(node);
      expect(entity.confidence).toBeLessThan(0.5);
    });

    it('non-generic named nodes get higher confidence', () => {
      // "Submit" IS generic, so use a non-generic name like "Login"
      const named = makeNode({ role: 'button', name: 'Login' });
      const unnamed = makeNode({ role: 'button', name: '' });
      const eNamed = mapper.mapNode(named);
      const eUnnamed = mapper.mapNode(unnamed);
      expect(eNamed.confidence).toBeGreaterThan(eUnnamed.confidence);
    });

    it('data-testid boosts confidence', () => {
      const withTestId = makeNode({
        role: 'button', name: 'Go',
        attributes: { 'data-testid': 'go-btn' },
      });
      const withoutTestId = makeNode({ role: 'button', name: 'Go' });
      const eWith = mapper.mapNode(withTestId);
      const eWithout = mapper.mapNode(withoutTestId);
      expect(eWith.confidence).toBeGreaterThan(eWithout.confidence);
    });

    it('confidence is clamped between 0 and 1', () => {
      const node = makeNode({
        role: 'button', name: 'Submit',
        attributes: { 'data-testid': 'btn', 'aria-label': 'submit', 'aria-labelledby': 'lbl' },
      });
      const entity = mapper.mapNode(node);
      expect(entity.confidence).toBeLessThanOrEqual(1.0);
      expect(entity.confidence).toBeGreaterThanOrEqual(0.0);
    });
  });

  describe('knowledge profiles', () => {
    it('uses built-in knowledge profile for github.com', () => {
      const node = makeNode({
        id: 'login-field',
        role: 'textbox',
        name: 'Username',
        attributes: { 'data-testid': 'login-field' },
      });
      const entity = mapper.mapNode(node, 'https://github.com/login');
      expect(entity.type).toBe('input');
      expect(entity.confidence).toBeGreaterThan(0.5);
    });

    it('addKnowledgeProfile adds a custom profile', () => {
      const profile: KnowledgeProfile = {
        domain: 'custom-site.com',
        version: '1.0.0',
        mappings: [
          { selector: '#search', semanticType: 'search', label: 'custom-search', priority: 10 },
        ],
      };
      mapper.addKnowledgeProfile(profile);
      const found = mapper.getKnowledgeProfile('custom-site.com');
      expect(found).toBeDefined();
      expect(found!.domain).toBe('custom-site.com');
    });

    it('addKnowledgeProfile replaces existing profile for same domain', () => {
      const p1: KnowledgeProfile = {
        domain: 'test.com', version: '1.0.0',
        mappings: [{ selector: '#a', semanticType: 'button', label: 'A', priority: 5 }],
      };
      const p2: KnowledgeProfile = {
        domain: 'test.com', version: '2.0.0',
        mappings: [{ selector: '#b', semanticType: 'link', label: 'B', priority: 5 }],
      };
      mapper.addKnowledgeProfile(p1);
      mapper.addKnowledgeProfile(p2);
      const found = mapper.getKnowledgeProfile('test.com');
      expect(found!.version).toBe('2.0.0');
    });

    it('getKnowledgeProfile returns undefined for unknown domain', () => {
      expect(mapper.getKnowledgeProfile('unknown-site.xyz')).toBeUndefined();
    });

    it('getKnowledgeProfile matches partial domain', () => {
      // Built-in profile for 'github.com' should match 'https://github.com/user'
      const found = mapper.getKnowledgeProfile('https://github.com/user');
      expect(found).toBeDefined();
    });
  });

  describe('heuristic role mapping', () => {
    it.each([
      ['navigation', 'navigation'],
      ['menubar', 'navigation'],
      ['textbox', 'input'],
      ['searchbox', 'input'], // searchbox heuristic goes to search only with search keywords
      ['combobox', 'combobox'],
      ['button', 'button'],
      ['link', 'link'],
      ['checkbox', 'checkbox'],
      ['radio', 'radio'],
      ['img', 'image'],
      ['heading', 'heading'],
      ['list', 'list'],
      ['listitem', 'listItem'],
      ['dialog', 'dialog'],
      ['toolbar', 'toolbar'],
      ['menu', 'menu'],
      ['article', 'article'],
      ['form', 'form'],
    ] as [string, SemanticEntityType][])(
      'maps role "%s" to type "%s"',
      (role, expectedType) => {
        const node = makeNode({ role, name: '' });
        const entity = mapper.mapNode(node);
        expect(entity.type).toBe(expectedType);
      }
    );

    it('maps searchbox with search keyword to search type', () => {
      const node = makeNode({ role: 'searchbox', name: 'Search' });
      const entity = mapper.mapNode(node);
      expect(entity.type).toBe('search');
    });

    it('maps region with header keywords to header type', () => {
      const node = makeNode({ role: 'region', name: 'Header banner' });
      const entity = mapper.mapNode(node);
      expect(entity.type).toBe('header');
    });

    it('maps region with footer keywords to footer type', () => {
      const node = makeNode({ role: 'region', name: 'Footer links' });
      const entity = mapper.mapNode(node);
      expect(entity.type).toBe('footer');
    });
  });

  describe('filtering and sorting', () => {
    const entities = () => [
      mapper.mapNode(makeNode({ id: 'n1', role: 'button', name: 'A', boundingBox: { x: 0, y: 100, width: 50, height: 20 } })),
      mapper.mapNode(makeNode({ id: 'n2', role: 'link', name: 'B', boundingBox: { x: 0, y: 50, width: 50, height: 20 } })),
      mapper.mapNode(makeNode({ id: 'n3', role: 'heading', name: 'C', boundingBox: { x: 0, y: 0, width: 50, height: 20 } })),
    ];

    it('filterByType returns only matching types', () => {
      const result = mapper.filterByType(entities(), ['button']);
      expect(result).toHaveLength(1);
      expect(result[0]!.type).toBe('button');
    });

    it('filterInteractive returns only interactive types', () => {
      const result = mapper.filterInteractive(entities());
      expect(result.length).toBeGreaterThan(0);
      for (const e of result) {
        expect(e.metadata.isInteractive).toBe(true);
      }
    });

    it('findByLabel matches pattern', () => {
      const result = mapper.findByLabel(entities(), 'a');
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('getEntitiesByConfidence filters by minimum', () => {
      const all = entities();
      const result = mapper.getEntitiesByConfidence(all, 1.0);
      // No entity should have confidence >= 1.0 with basic setup
      expect(result.length).toBeLessThan(all.length);
    });

    it('sortByPosition sorts by y then x', () => {
      const sorted = mapper.sortByPosition(entities());
      const ys = sorted.map((e) => e.boundingBox.y);
      expect(ys).toEqual([...ys].sort((a, b) => a - b));
    });

    it('groupByType groups entities', () => {
      const groups = mapper.groupByType(entities());
      expect(groups.size).toBeGreaterThan(0);
      // Verify each entity is in the correct group
      for (const entity of entities()) {
        const group = groups.get(entity.type);
        expect(group).toBeDefined();
        expect(group!.some((e) => e.id === entity.id)).toBe(true);
      }
    });
  });

  describe('disabled heuristics fallback', () => {
    it('falls back to role mapping when heuristics disabled', () => {
      const m = new SemanticMapper({ enableHeuristics: false });
      const node = makeNode({ role: 'textbox', name: '' });
      const entity = m.mapNode(node);
      expect(entity.type).toBe('input');
    });

    it('searchbox role maps to search via roleToSemanticType', () => {
      const m = new SemanticMapper({ enableHeuristics: false });
      const node = makeNode({ role: 'searchbox', name: '' });
      const entity = m.mapNode(node);
      expect(entity.type).toBe('search');
    });
  });
});
