import { describe, it, expect } from 'vitest';
import { getTaloxTools, getToolNames } from '../../src/core/TaloxTools';

describe('TaloxTools', () => {
  describe('getTaloxTools', () => {
    it('returns a non-empty array of tool definitions', () => {
      const tools = getTaloxTools();
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
    });

    it('every tool has type "function"', () => {
      const tools = getTaloxTools();
      for (const tool of tools) {
        expect(tool.type).toBe('function');
      }
    });

    it('every tool has required function metadata', () => {
      const tools = getTaloxTools();
      for (const tool of tools) {
        expect(tool.function).toBeDefined();
        expect(typeof tool.function.name).toBe('string');
        expect(typeof tool.function.description).toBe('string');
        expect(tool.function.parameters).toBeDefined();
        expect(tool.function.parameters.type).toBe('object');
        expect(tool.function.parameters.properties).toBeDefined();
      }
    });

    it('includes all expected tool names', () => {
      const tools = getTaloxTools();
      const names = tools.map(t => t.function.name);
      const expected = [
        'talox_navigate',
        'talox_click',
        'talox_type',
        'talox_get_state',
        'talox_describe_page',
        'talox_get_intent_state',
        'talox_screenshot',
        'talox_scroll_to',
        'talox_extract_table',
        'talox_wait_for_load_state',
        'talox_set_mode',
        'talox_verify_visual',
        'talox_find_element',
        'talox_evaluate',
      ];
      for (const name of expected) {
        expect(names).toContain(name);
      }
    });

    it('tools with required fields declare them correctly', () => {
      const tools = getTaloxTools();
      const taloxNavigate = tools.find(t => t.function.name === 'talox_navigate');
      expect(taloxNavigate?.function.parameters.required).toContain('url');

      const taloxClick = tools.find(t => t.function.name === 'talox_click');
      expect(taloxClick?.function.parameters.required).toContain('selector');

      const taloxType = tools.find(t => t.function.name === 'talox_type');
      expect(taloxType?.function.parameters.required).toContain('selector');
      expect(taloxType?.function.parameters.required).toContain('text');
    });

    it('tools with enum parameters define the enum array', () => {
      const tools = getTaloxTools();
      const navigate = tools.find(t => t.function.name === 'talox_navigate')!;
      const modeParam = navigate.function.parameters.properties['mode'];
      expect(modeParam.enum).toBeDefined();
      expect(modeParam.enum).toContain('adaptive');

      const wait = tools.find(t => t.function.name === 'talox_wait_for_load_state')!;
      const stateParam = wait.function.parameters.properties['state'];
      expect(stateParam.enum).toBeDefined();
      expect(stateParam.enum).toContain('networkidle');
    });

    it('returns new arrays on each call (no shared references)', () => {
      const a = getTaloxTools();
      const b = getTaloxTools();
      expect(a).not.toBe(b);
    });
  });

  describe('getToolNames', () => {
    it('returns array of function name strings', () => {
      const names = getToolNames();
      expect(Array.isArray(names)).toBe(true);
      for (const name of names) {
        expect(typeof name).toBe('string');
      }
    });

    it('matches the tools from getTaloxTools', () => {
      const tools = getTaloxTools();
      const names = getToolNames();
      const toolNames = tools.map(t => t.function.name);
      expect(names).toEqual(toolNames);
    });
  });
});
