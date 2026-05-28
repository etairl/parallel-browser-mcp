import type { Page } from 'playwright-core';

interface PageSnapshotNode {
  tag: string;
  text: string;
  attributes: Record<string, string>;
  children: PageSnapshotNode[];
  hiddenByDepth?: number;     // children omitted because maxDepth was reached
  hiddenByCount?: number;     // children omitted because maxChildren was reached
  hiddenByNodeCap?: number;   // children omitted because the 500-node global cap was reached
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

  if (node.hiddenByDepth) {
    childLines.push(`${indent}  - […${node.hiddenByDepth} more children — increase maxDepth to expand]`);
  }
  if (node.hiddenByCount) {
    childLines.push(`${indent}  - […${node.hiddenByCount} more children — increase maxChildren to expand]`);
  }
  if (node.hiddenByNodeCap) {
    childLines.push(`${indent}  - […${node.hiddenByNodeCap} more children — node cap reached]`);
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

  // Capture title, url, and tree in the same CDP call so all three describe the same
  // navigation state — calling page.title() or page.url() separately could race a
  // client-side navigation and return values from different pages.
  const { tree, hiddenTopLevelCount, title, url } = await page.evaluate(
    ({ maxDepth, maxChildren, selector }) => {
      const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'link', 'meta', 'head']);
      const MAX_ATTRS = 8;
      const MAX_ATTR_VALUE_LEN = 80;
      const PRIORITY_ATTRS = new Set(['role', 'aria-label', 'name', 'id']);

      const MAX_TOTAL_NODES = 500;
      let nodesBuilt = 0;

      const buildNode = (element: Element, depth: number): PageSnapshotNode => {
        nodesBuilt++;

        const visible = Array.from(element.children).filter(
          (c) => !SKIP_TAGS.has(c.tagName.toLowerCase()),
        );
        const atDepthLimit = depth >= maxDepth;

        let shown: Element[];
        let hiddenByDepth = 0;
        let hiddenByCount = 0;
        let hiddenByNodeCap = 0;

        if (atDepthLimit) {
          shown = [];
          hiddenByDepth = visible.length;
        } else {
          const byCount = visible.slice(0, maxChildren);
          hiddenByCount = visible.length - byCount.length;
          // Budget check is conservative: it limits children of this node but not their
          // descendants, so the actual total can moderately exceed MAX_TOTAL_NODES.
          const budgetLeft = MAX_TOTAL_NODES - nodesBuilt;
          if (budgetLeft <= 0) {
            shown = [];
            hiddenByNodeCap = byCount.length;
          } else if (budgetLeft < byCount.length) {
            shown = byCount.slice(0, budgetLeft);
            hiddenByNodeCap = byCount.length - shown.length;
          } else {
            shown = byCount;
          }
        }

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
          ...(hiddenByDepth > 0 ? { hiddenByDepth } : {}),
          ...(hiddenByCount > 0 ? { hiddenByCount } : {}),
          ...(hiddenByNodeCap > 0 ? { hiddenByNodeCap } : {}),
          ...(hiddenAttrCount > 0 ? { hiddenAttrCount } : {}),
        };
      };

      if (selector !== null) {
        const root = document.querySelector(selector);
        if (root === null) return { tree: [], hiddenTopLevelCount: 0, title: document.title, url: window.location.href };
        return { tree: [buildNode(root, 0)], hiddenTopLevelCount: 0, title: document.title, url: window.location.href };
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
        url: window.location.href,
      };
    },
    { maxDepth, maxChildren, selector },
  );

  return {
    title,
    url,
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
