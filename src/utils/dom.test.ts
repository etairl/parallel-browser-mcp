import type { Page } from 'playwright-core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractPageSnapshot, formatPageStructure, generateLocatorCandidates } from './dom.js';

// Minimal fake DOM element — only the properties buildNode actually touches.
const fakeEl = (
  tag: string,
  attrs: Record<string, string> = {},
  children: object[] = [],
  text = '',
) => ({
  tagName: tag.toUpperCase(),
  innerText: text,
  textContent: text,
  attributes: Object.entries(attrs).map(([name, value]) => ({ name, value })),
  children,
});

// Stubs page.evaluate to call the passed function directly in Node.js and
// sets up global.document and global.window so the callback's document/window
// references resolve (vitest runs in node environment where window is undefined).
const stubPage = (doc: object, url = 'https://test.com') => {
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { location: { href: url } });
  return {
    evaluate: vi.fn(async (fn: (args: unknown) => unknown, args: unknown) => fn(args)),
    title: vi.fn(async () => 'Test'),
    url: vi.fn(() => url),
  } as unknown as Page;
};

describe('dom utils', () => {
  it('formats a readable page structure', () => {
    const output = formatPageStructure({
      title: 'Example',
      url: 'https://example.com',
      tree: [
        {
          tag: 'button',
          text: 'Submit',
          attributes: { role: 'button', name: 'submit' },
          children: [],
        },
      ],
      params: { maxDepth: 4, maxChildren: 20, selector: null },
    });

    expect(output).toContain('Title: Example');
    expect(output).toContain('button');
    expect(output).toContain('Submit');
  });

  it('delegates snapshot extraction to page.evaluate', async () => {
    const page = {
      evaluate: vi.fn(async () => ({ tree: [], hiddenTopLevelCount: 0, title: 'Snapshot', url: 'https://example.com' })),
    } as unknown as Page;

    const result = await extractPageSnapshot(page);

    expect(result.title).toBe('Snapshot');
    expect(result.url).toBe('https://example.com');
    expect(result.params).toEqual({ maxDepth: 4, maxChildren: 20, selector: null });
    expect(page.evaluate).toHaveBeenCalledTimes(1);
  });

  it('url is captured inside the same evaluate call as title and tree', async () => {
    const page = {
      evaluate: vi.fn(async () => ({ tree: [], hiddenTopLevelCount: 0, title: 'T', url: 'https://spa-page.com' })),
    } as unknown as Page;

    const result = await extractPageSnapshot(page);

    expect(result.url).toBe('https://spa-page.com');
    // page.url() must NOT be called — url comes from inside evaluate atomically.
    expect('url' in page).toBe(false);
  });

  it('passes options to page.evaluate and records them in params', async () => {
    const page = {
      evaluate: vi.fn(async () => ({ tree: [], hiddenTopLevelCount: 0, title: 'Options Test', url: 'https://example.com' })),
    } as unknown as Page;

    const result = await extractPageSnapshot(page, { maxDepth: 2, maxChildren: 5, selector: '#main' });

    expect(result.params).toEqual({ maxDepth: 2, maxChildren: 5, selector: '#main' });
    expect(page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      maxDepth: 2,
      maxChildren: 5,
      selector: '#main',
    });
  });

  it('renders hiddenAttrCount in formatted output', () => {
    const output = formatPageStructure({
      title: 'T',
      url: 'https://example.com',
      tree: [
        {
          tag: 'div',
          text: '',
          attributes: { id: 'main' },
          hiddenAttrCount: 5,
          children: [],
        },
      ],
      params: { maxDepth: 4, maxChildren: 20, selector: null },
    });

    expect(output).toContain('[…5 more attrs]');
  });

  it('renders hiddenTopLevelCount in formatted output', () => {
    const output = formatPageStructure({
      title: 'T',
      url: 'https://example.com',
      tree: [{ tag: 'div', text: '', attributes: {}, children: [] }],
      hiddenTopLevelCount: 8,
      params: { maxDepth: 4, maxChildren: 20, selector: null },
    });

    expect(output).toContain('[…8 more top-level elements]');
  });

  it('renders hiddenByCount in formatted output with maxChildren hint', () => {
    const output = formatPageStructure({
      title: 'T',
      url: 'https://example.com',
      tree: [
        {
          tag: 'ul',
          text: '',
          attributes: {},
          hiddenByCount: 12,
          children: [{ tag: 'li', text: 'first', attributes: {}, children: [] }],
        },
      ],
      params: { maxDepth: 4, maxChildren: 20, selector: null },
    });

    expect(output).toContain('li');
    expect(output).toContain('[…12 more children — increase maxChildren to expand]');
  });

  it('renders hiddenByDepth in formatted output with maxDepth hint', () => {
    const output = formatPageStructure({
      title: 'T',
      url: 'https://example.com',
      tree: [
        {
          tag: 'div',
          text: '',
          attributes: {},
          hiddenByDepth: 3,
          children: [],
        },
      ],
      params: { maxDepth: 4, maxChildren: 20, selector: null },
    });

    expect(output).toContain('[…3 more children — increase maxDepth to expand]');
  });

  it('renders hiddenByNodeCap in formatted output', () => {
    const output = formatPageStructure({
      title: 'T',
      url: 'https://example.com',
      tree: [
        {
          tag: 'div',
          text: '',
          attributes: {},
          hiddenByNodeCap: 7,
          children: [],
        },
      ],
      params: { maxDepth: 4, maxChildren: 20, selector: null },
    });

    expect(output).toContain('[…7 more children — node cap reached]');
  });

  describe('buildNode', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('filters out SKIP_TAGS at every level', async () => {
      const body = fakeEl('body', {}, [
        fakeEl('div'),
        fakeEl('script'),
        fakeEl('style'),
        fakeEl('noscript'),
        fakeEl('p'),
      ]);
      const page = stubPage({ body, documentElement: body });

      const result = await extractPageSnapshot(page);

      const tags = result.tree.map((n) => n.tag);
      expect(tags).toEqual(['div', 'p']);
    });

    it('caps top-level nodes at maxChildren and reports hiddenTopLevelCount', async () => {
      const body = fakeEl('body', {}, Array.from({ length: 25 }, () => fakeEl('div')));
      const page = stubPage({ body, documentElement: body });

      const result = await extractPageSnapshot(page, { maxChildren: 5 });

      expect(result.tree).toHaveLength(5);
      expect(result.hiddenTopLevelCount).toBe(20);
    });

    it('stops recursing at maxDepth and sets hiddenByDepth', async () => {
      const inner = fakeEl('span', {}, [], 'deep');
      const middle = fakeEl('p', {}, [inner]);
      const outer = fakeEl('div', {}, [middle]);
      const body = fakeEl('body', {}, [outer]);
      const page = stubPage({ body, documentElement: body });

      // depth 0 = outer(div), depth 1 = middle(p) which hits the limit
      const result = await extractPageSnapshot(page, { maxDepth: 1 });

      const p = result.tree[0].children[0];
      expect(p.tag).toBe('p');
      expect(p.children).toHaveLength(0);
      expect(p.hiddenByDepth).toBe(1);
      expect(p.hiddenByCount).toBeUndefined();
    });

    it('caps visible children per node at maxChildren and sets hiddenByCount', async () => {
      const body = fakeEl('body', {}, [
        fakeEl('ul', {}, Array.from({ length: 10 }, () => fakeEl('li'))),
      ]);
      const page = stubPage({ body, documentElement: body });

      const result = await extractPageSnapshot(page, { maxChildren: 3 });

      const ul = result.tree[0];
      expect(ul.children).toHaveLength(3);
      expect(ul.hiddenByCount).toBe(7);
      expect(ul.hiddenByDepth).toBeUndefined();
    });

    it('enforces the 500-node global cap and sets hiddenByNodeCap', async () => {
      // Build a tree: 1 ul with 600 li children — far exceeds the 500-node cap.
      // nodesBuilt starts at 0; the ul itself is node 1, so budget left for children
      // is 499. The first 499 li nodes are shown; the remaining 101 are capped.
      const body = fakeEl('body', {}, [
        fakeEl('ul', {}, Array.from({ length: 600 }, () => fakeEl('li'))),
      ]);
      const page = stubPage({ body, documentElement: body });

      const result = await extractPageSnapshot(page, { maxChildren: 600 });

      const ul = result.tree[0];
      expect(ul.children.length).toBeLessThanOrEqual(499);
      expect(ul.hiddenByNodeCap).toBeGreaterThan(0);
      expect(ul.hiddenByNodeCap! + ul.children.length).toBe(600);
    });

    it('sets hiddenAttrCount when attributes exceed the 8-attr cap', async () => {
      const attrs = Object.fromEntries(
        Array.from({ length: 12 }, (_, i) => [`data-x${i}`, `v${i}`]),
      );
      const body = fakeEl('body', {}, [fakeEl('div', attrs)]);
      const page = stubPage({ body, documentElement: body });

      const result = await extractPageSnapshot(page);

      const node = result.tree[0];
      expect(Object.keys(node.attributes)).toHaveLength(8);
      expect(node.hiddenAttrCount).toBe(4);
    });

    it('orders priority attrs (role, aria-label, name, id) before the rest', async () => {
      const attrs = { 'data-a': 'a', 'data-b': 'b', role: 'button', name: 'submit' };
      const body = fakeEl('body', {}, [fakeEl('button', attrs)]);
      const page = stubPage({ body, documentElement: body });

      const result = await extractPageSnapshot(page);

      const keys = Object.keys(result.tree[0].attributes);
      expect(keys.indexOf('role')).toBeLessThan(keys.indexOf('data-a'));
      expect(keys.indexOf('name')).toBeLessThan(keys.indexOf('data-b'));
    });

    it('truncates text to 120 characters', async () => {
      const body = fakeEl('body', {}, [fakeEl('p', {}, [], 'a'.repeat(200))]);
      const page = stubPage({ body, documentElement: body });

      const result = await extractPageSnapshot(page);

      expect(result.tree[0].text).toHaveLength(120);
    });

    it('normalises internal whitespace in text', async () => {
      const body = fakeEl('body', {}, [fakeEl('p', {}, [], '  hello   world  ')]);
      const page = stubPage({ body, documentElement: body });

      const result = await extractPageSnapshot(page);

      expect(result.tree[0].text).toBe('hello world');
    });

    it('falls back to textContent when innerText is undefined', async () => {
      const el = { ...fakeEl('p', {}, [], ''), innerText: undefined, textContent: 'fallback' };
      const body = fakeEl('body', {}, [el]);
      const page = stubPage({ body, documentElement: body });

      const result = await extractPageSnapshot(page);

      expect(result.tree[0].text).toBe('fallback');
    });

    it('scopes tree to the element matched by selector', async () => {
      const target = fakeEl('section', { id: 'content' }, [fakeEl('p', {}, [], 'hello')]);
      const page = stubPage({
        body: fakeEl('body', {}, [fakeEl('div'), target]),
        documentElement: fakeEl('body'),
        querySelector: vi.fn((sel: string) => (sel === '#content' ? target : null)),
      });

      const result = await extractPageSnapshot(page, { selector: '#content' });

      expect(result.tree).toHaveLength(1);
      expect(result.tree[0].tag).toBe('section');
      expect(result.tree[0].children[0].tag).toBe('p');
    });

    it('returns empty tree when selector matches nothing', async () => {
      const page = stubPage({
        body: fakeEl('body', {}, [fakeEl('div')]),
        documentElement: fakeEl('body'),
        querySelector: vi.fn(() => null),
      });

      const result = await extractPageSnapshot(page, { selector: '.nonexistent' });

      expect(result.tree).toHaveLength(0);
    });
  });

  it('delegates locator generation to locator.evaluate', async () => {
    const evaluate = vi.fn(async () => ['#login', '[name="email"]']);
    const page = {
      locator: vi.fn(() => ({
        count: vi.fn(async () => 1),
        first: vi.fn(() => ({ evaluate })),
      })),
    } as unknown as Page;

    const result = await generateLocatorCandidates(page, '#email');

    expect(result).toEqual(['#login', '[name="email"]']);
  });

  it('returns empty array from generateLocatorCandidates when selector matches nothing', async () => {
    const page = {
      locator: vi.fn(() => ({
        count: vi.fn(async () => 0),
        first: vi.fn(),
      })),
    } as unknown as Page;

    const result = await generateLocatorCandidates(page, '.nonexistent');

    expect(result).toEqual([]);
  });
});
