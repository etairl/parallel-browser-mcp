import type { Page } from 'playwright-core';

interface PageSnapshotNode {
  tag: string;
  text: string;
  attributes: Record<string, string>;
  children: PageSnapshotNode[];
  hiddenChildCount?: number;  // children omitted due to maxChildren or maxDepth limits
  hiddenAttrCount?: number;   // attributes omitted due to MAX_ATTRS limit
}

export interface PageSnapshotResult {
  title: string;
  url: string;
  tree: PageSnapshotNode[];
  hiddenTopLevelCount?: number;
  params: { maxDepth: number; maxChildren: number; selector: string | null };
}

// node.text is already truncated to 120 chars by buildNode in extractPageSnapshot
const formatNode = (node: PageSnapshotNode, depth: number): string => {
  const indent = '  '.repeat(depth);
  const parts = [node.tag];

  for (const [k, v] of Object.entries(node.attributes)) {
    parts.push(`${k}="${v}"`);
  }

  if (node.hiddenAttrCount) {
    parts.push(`[…${node.hiddenAttrCount} more attrs]`);
  }

  if (node.text.length > 0) {
    parts.push(`text="${node.text}"`);
  }

  const currentLine = `${indent}- ${parts.join(' | ')}`;
  const childLines = node.children.map((child) => formatNode(child, depth + 1));

  if (node.hiddenChildCount) {
    childLines.push(`${indent}  - […${node.hiddenChildCount} more children]`);
  }

  return [currentLine, ...childLines].join('\n');
};

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_CHILDREN = 20;

export const extractPageSnapshot = async (
  page: Page,
  options?: { maxDepth?: number; maxChildren?: number; selector?: string },
): Promise<PageSnapshotResult> => {
  const maxDepth = options?.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxChildren = options?.maxChildren ?? DEFAULT_MAX_CHILDREN;
  const selector = options?.selector ?? null;

  // Read title inside evaluate so it and the tree are captured in the same CDP call —
  // a concurrent page.title() could race a client-side navigation and describe a different page.
  const { tree, hiddenTopLevelCount, title } = await page.evaluate(
    ({ maxDepth, maxChildren, selector }) => {
      const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'link', 'meta', 'head']);
      const MAX_ATTRS = 8;
      const MAX_ATTR_VALUE_LEN = 80;
      const PRIORITY_ATTRS = new Set(['role', 'aria-label', 'name', 'id']);

      const buildNode = (element: Element, depth: number): PageSnapshotNode => {
        const visible = Array.from(element.children).filter(
          (c) => !SKIP_TAGS.has(c.tagName.toLowerCase()),
        );
        const atDepthLimit = depth >= maxDepth;
        const shown = atDepthLimit ? [] : visible.slice(0, maxChildren);
        const hiddenChildCount = visible.length - shown.length;

        // `innerText` is only defined on HTMLElement — SVG/MathML elements
        // and some custom elements return undefined here, so fall back to
        // `textContent` (available on every Node) before failing to ''.
        const rawText = (element as HTMLElement).innerText ?? element.textContent ?? '';
        const allAttrs = Array.from(element.attributes).map(
          (a): [string, string] => [a.name, a.value.slice(0, MAX_ATTR_VALUE_LEN)],
        );
        const prioritized = allAttrs.filter(([k]) => PRIORITY_ATTRS.has(k));
        const rest = allAttrs.filter(([k]) => !PRIORITY_ATTRS.has(k));
        const ordered = [...prioritized, ...rest];
        const shownAttrs = ordered.slice(0, MAX_ATTRS);
        const hiddenAttrCount = ordered.length - shownAttrs.length;
        const attributes: Record<string, string> = Object.fromEntries(shownAttrs);

        return {
          tag: element.tagName.toLowerCase(),
          text: rawText.trim().replace(/\s+/g, ' ').slice(0, 120),
          attributes,
          children: shown.map((child) => buildNode(child, depth + 1)),
          ...(hiddenChildCount > 0 ? { hiddenChildCount } : {}),
          ...(hiddenAttrCount > 0 ? { hiddenAttrCount } : {}),
        };
      };

      if (selector !== null) {
        const root = document.querySelector(selector);
        if (root === null) return { tree: [], hiddenTopLevelCount: 0, title: document.title };
        return { tree: [buildNode(root, 0)], hiddenTopLevelCount: 0, title: document.title };
      }

      const body = document.body ?? document.documentElement;
      const topLevel = Array.from(body.children).filter(
        (c) => !SKIP_TAGS.has(c.tagName.toLowerCase()),
      );
      const shown = topLevel.slice(0, maxChildren);
      return {
        tree: shown.map((child) => buildNode(child, 0)),
        hiddenTopLevelCount: topLevel.length - shown.length,
        title: document.title,
      };
    },
    { maxDepth, maxChildren, selector },
  );

  return {
    title,
    url: page.url(),
    tree,
    // Omit when 0 — the selector path always returns 0 (no top-level siblings to hide).
    ...(hiddenTopLevelCount > 0 ? { hiddenTopLevelCount } : {}),
    params: { maxDepth, maxChildren, selector },
  };
};

export const formatPageStructure = (snapshot: PageSnapshotResult): string => {
  const lines = [`Title: ${snapshot.title}`, `URL: ${snapshot.url}`, ''];
  lines.push(...snapshot.tree.map((node) => formatNode(node, 0)));
  if (snapshot.hiddenTopLevelCount) {
    lines.push(`[…${snapshot.hiddenTopLevelCount} more top-level elements]`);
  }
  return lines.join('\n');
};

export const generateLocatorCandidates = async (
  page: Page,
  selector: string,
): Promise<string[]> => {
  const locator = page.locator(selector);
  // .first().evaluate() throws when the locator matches nothing — guard explicitly so
  // callers get an empty array rather than an unhandled strict-mode error.
  if (await locator.count() === 0) return [];
  return locator.first().evaluate((element) => {
    const candidates = new Set<string>();
    const id = element.getAttribute('id');
    const name = element.getAttribute('name');
    const ariaLabel = element.getAttribute('aria-label');
    // See note in extractPageSnapshot: innerText is HTMLElement-only.
    const rawText = (element as HTMLElement).innerText ?? element.textContent ?? '';
    const text = rawText.trim().replace(/\s+/g, ' ');

    if (id !== null && id.length > 0) {
      candidates.add(`#${id}`);
      candidates.add(`[id="${id}"]`);
    }

    if (name !== null && name.length > 0) {
      candidates.add(`[name="${name}"]`);
    }

    if (ariaLabel !== null && ariaLabel.length > 0) {
      candidates.add(`[aria-label="${ariaLabel}"]`);
    }

    if (text.length > 0) {
      candidates.add(`text=${JSON.stringify(text.slice(0, 80))}`);
    }

    candidates.add(element.tagName.toLowerCase());

    return [...candidates];
  });
};
