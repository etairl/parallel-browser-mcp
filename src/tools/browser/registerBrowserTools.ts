import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SessionRegistry } from '../../sessions/SessionRegistry.js';
import {
  domQuerySchema,
  dragSchema,
  evaluateSchema,
  fillFormSchema,
  fillSchema,
  generateLocatorSchema,
  keyboardPressSchema,
  keyboardTypeSchema,
  mouseDragSchema,
  mousePointSchema,
  navigateSchema,
  screenshotSchema,
  selectOptionSchema,
  selectorSchema,
  sessionIdSchema,
  snapshotSchema,
  uploadFileSchema,
  waitForSelectorSchema,
  waitForTimeoutSchema,
} from '../../types/toolArgs.js';
import { generateLocatorCandidates, extractPageSnapshot, formatPageStructure } from '../../utils/dom.js';
import { imageResult, jsonResult, textResult } from '../../utils/mcp.js';
import { withSession } from './browserToolUtils.js';

export const registerBrowserTools = (server: McpServer, registry: SessionRegistry): void => {
  server.registerTool(
    'browser_navigate',
    {
      title: 'Browser Navigate',
      description: 'Navigate the session page to a URL.',
      inputSchema: navigateSchema,
    },
    withSession(registry, async ({ page }, { url }) => {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded' });

      return jsonResult({
        url: page.url(),
        status: response?.status() ?? null,
        title: await page.title(),
      });
    }),
  );

  server.registerTool(
    'browser_go_back',
    {
      title: 'Browser Go Back',
      description: 'Go back in browser history.',
      inputSchema: sessionIdSchema,
    },
    withSession(registry, async ({ page }) => {
      const response = await page.goBack({ waitUntil: 'domcontentloaded' });

      return jsonResult({
        url: page.url(),
        status: response?.status() ?? null,
      });
    }),
  );

  server.registerTool(
    'browser_click',
    {
      title: 'Browser Click',
      description: 'Click an element by selector.',
      inputSchema: selectorSchema,
    },
    withSession(registry, async ({ page }, { selector, timeout }) => {
      await page.locator(selector).first().click({ timeout });

      return textResult(`Clicked ${selector}`);
    }),
  );

  server.registerTool(
    'browser_fill',
    {
      title: 'Browser Fill',
      description: 'Fill a field with text.',
      inputSchema: fillSchema,
    },
    withSession(registry, async ({ page }, { selector, value, timeout }) => {
      await page.locator(selector).first().fill(value, { timeout });

      return textResult(`Filled ${selector}`);
    }),
  );

  server.registerTool(
    'browser_fill_form',
    {
      title: 'Browser Fill Form',
      description: 'Fill multiple form fields.',
      inputSchema: fillFormSchema,
    },
    withSession(registry, async ({ page }, { fields }) => {
      for (const field of fields) {
        await page.locator(field.selector).first().fill(field.value);
      }

      return jsonResult({
        filled: fields.length,
      });
    }),
  );

  server.registerTool(
    'browser_screenshot',
    {
      title: 'Browser Screenshot',
      description: 'Capture a screenshot of the current page.',
      inputSchema: screenshotSchema,
    },
    withSession(registry, async ({ page }, { fullPage }) => {
      const screenshot = await page.screenshot({
        fullPage,
        type: 'png',
      });

      return imageResult('Captured screenshot.', 'image/png', screenshot.toString('base64'));
    }),
  );

  server.registerTool(
    'browser_snapshot',
    {
      title: 'Browser Snapshot',
      description: 'Return a structured page snapshot.',
      inputSchema: snapshotSchema,
    },
    withSession(registry, async ({ page }, { maxDepth, maxChildren, selector }) => {
      const snapshot = await extractPageSnapshot(page, { maxDepth, maxChildren, selector });

      return jsonResult(snapshot);
    }),
  );

  server.registerTool(
    'browser_hover',
    {
      title: 'Browser Hover',
      description: 'Hover over an element by selector.',
      inputSchema: selectorSchema,
    },
    withSession(registry, async ({ page }, { selector, timeout }) => {
      await page.locator(selector).first().hover({ timeout });

      return textResult(`Hovered ${selector}`);
    }),
  );

  server.registerTool(
    'browser_drag',
    {
      title: 'Browser Drag',
      description: 'Drag from one element to another.',
      inputSchema: dragSchema,
    },
    withSession(registry, async ({ page }, { sourceSelector, targetSelector, timeout }) => {
      await page.locator(sourceSelector).first().dragTo(page.locator(targetSelector).first(), {
        timeout,
      });

      return jsonResult({
        sourceSelector,
        targetSelector,
      });
    }),
  );

  server.registerTool(
    'browser_select_option',
    {
      title: 'Browser Select Option',
      description: 'Select options in a select element.',
      inputSchema: selectOptionSchema,
    },
    withSession(registry, async ({ page }, { selector, values, timeout }) => {
      const selected = await page.locator(selector).first().selectOption(values, {
        timeout,
      });

      return jsonResult({
        selector,
        selected,
      });
    }),
  );

  server.registerTool(
    'browser_generate_locator',
    {
      title: 'Browser Generate Locator',
      description: 'Generate locator suggestions for an element.',
      inputSchema: generateLocatorSchema,
    },
    withSession(registry, async ({ page }, { selector }) => {
      const suggestions = await generateLocatorCandidates(page, selector);

      return jsonResult({
        selector,
        suggestions,
      });
    }),
  );

  server.registerTool(
    'browser_get_page_structure',
    {
      title: 'Browser Get Page Structure',
      description: 'Return a readable page structure summary.',
      inputSchema: snapshotSchema,
    },
    withSession(registry, async ({ page }, { maxDepth, maxChildren, selector }) => {
      const snapshot = await extractPageSnapshot(page, { maxDepth, maxChildren, selector });

      return textResult(formatPageStructure(snapshot));
    }),
  );

  server.registerTool(
    'browser_dom_query',
    {
      title: 'Browser DOM Query',
      description: 'Query element presence, count, and state without waiting.',
      inputSchema: domQuerySchema,
    },
    withSession(registry, async ({ page }, { selector }) => {
      const locator = page.locator(selector);
      const count = await locator.count();

      if (count === 0) {
        return jsonResult({ selector, count });
      }

      const first = locator.first();
      const [visible, enabled] = await Promise.all([first.isVisible(), first.isEnabled()]);

      let checked: boolean | null = null;
      try {
        checked = await first.isChecked();
      } catch {
        // not a checkbox or radio
      }

      let value: string | null = null;
      try {
        value = await first.inputValue();
      } catch {
        // not an input element
      }

      return jsonResult({ selector, count, visible, enabled, checked, value });
    }),
  );

  server.registerTool(
    'browser_evaluate',
    {
      title: 'Browser Evaluate',
      description: 'Run JavaScript in the page context.',
      inputSchema: evaluateSchema,
    },
    withSession(registry, async ({ page }, { script, selector }) => {
      const result =
        selector === undefined
          ? await page.evaluate((expression) => {
              const callback = new Function(expression);
              return callback();
            }, script)
          : await page.locator(selector).first().evaluate((element, expression) => {
              const callback = new Function('element', expression);
              return callback(element);
            }, script);

      return jsonResult({
        result,
      });
    }),
  );

  server.registerTool(
    'browser_keyboard_press',
    {
      title: 'Browser Keyboard Press',
      description: 'Press a keyboard key or key chord.',
      inputSchema: keyboardPressSchema,
    },
    withSession(registry, async ({ page }, { key }) => {
      await page.keyboard.press(key);

      return textResult(`Pressed ${key}`);
    }),
  );

  server.registerTool(
    'browser_keyboard_type',
    {
      title: 'Browser Keyboard Type',
      description: 'Type text into the active page.',
      inputSchema: keyboardTypeSchema,
    },
    withSession(registry, async ({ page }, { text, delay }) => {
      await page.keyboard.type(text, { delay });

      return textResult(`Typed ${text.length} characters.`);
    }),
  );

  server.registerTool(
    'browser_mouse_move',
    {
      title: 'Browser Mouse Move',
      description: 'Move the mouse to viewport coordinates.',
      inputSchema: mousePointSchema,
    },
    withSession(registry, async ({ page }, { x, y }) => {
      await page.mouse.move(x, y);

      return jsonResult({ x, y });
    }),
  );

  server.registerTool(
    'browser_mouse_click_xy',
    {
      title: 'Browser Mouse Click XY',
      description: 'Click at viewport coordinates.',
      inputSchema: mousePointSchema,
    },
    withSession(registry, async ({ page }, { x, y }) => {
      await page.mouse.click(x, y);

      return jsonResult({ x, y });
    }),
  );

  server.registerTool(
    'browser_mouse_drag',
    {
      title: 'Browser Mouse Drag',
      description: 'Drag the mouse from one point to another.',
      inputSchema: mouseDragSchema,
    },
    withSession(registry, async ({ page }, { startX, startY, endX, endY }) => {
      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(endX, endY);
      await page.mouse.up();

      return jsonResult({
        startX,
        startY,
        endX,
        endY,
      });
    }),
  );

  server.registerTool(
    'browser_upload_file',
    {
      title: 'Browser Upload File',
      description: 'Upload files to a file input.',
      inputSchema: uploadFileSchema,
    },
    withSession(registry, async ({ page }, { selector, filePaths }) => {
      await page.locator(selector).first().setInputFiles(filePaths);

      return jsonResult({
        selector,
        filePaths,
      });
    }),
  );

  server.registerTool(
    'browser_wait_for_selector',
    {
      title: 'Browser Wait For Selector',
      description: 'Wait for a selector to reach a state.',
      inputSchema: waitForSelectorSchema,
    },
    withSession(registry, async ({ page }, { selector, state, timeout }) => {
      await page.waitForSelector(selector, {
        state,
        timeout,
      });

      return jsonResult({
        selector,
        state: state ?? 'visible',
      });
    }),
  );

  server.registerTool(
    'browser_wait_for_timeout',
    {
      title: 'Browser Wait For Timeout',
      description: 'Wait a fixed number of milliseconds.',
      inputSchema: waitForTimeoutSchema,
    },
    withSession(registry, async ({ page }, { milliseconds }) => {
      await page.waitForTimeout(milliseconds);

      return jsonResult({
        waitedMilliseconds: milliseconds,
      });
    }),
  );
};
