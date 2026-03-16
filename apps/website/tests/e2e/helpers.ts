import { expect, type Locator, type Page } from "@playwright/test";

const draftStorageKey = "underwritten.markdown-editor.draft";
const appearanceStorageKey = "underwritten.markdown-editor.appearance";
const workspaceStorageKey = "underwritten.markdown-editor.workspace";
const nativeHandleDatabaseName = "underwritten-file-handles";

type ParagraphNode = {
  children: Array<{ text: string }>;
  type: "paragraph";
};

type TableData = {
  data: string[][];
  id: string;
  position: number;
};

type CodeBlockData = {
  code: string;
  id: string;
  language: string | null;
  position: number;
};

type StoredDraft = {
  codeBlocks: CodeBlockData[];
  tables: TableData[];
  title: string;
  value: ParagraphNode[];
  version: 2;
};

type IterableDirectoryHandle = FileSystemDirectoryHandle & {
  entries: () => AsyncIterableIterator<[string, FileSystemHandle]>;
};

export function createDraft(
  paragraphs: string[] = [""],
  options?: {
    codeBlocks?: CodeBlockData[];
    tables?: TableData[];
    title?: string;
  },
): StoredDraft {
  return {
    codeBlocks: options?.codeBlocks ?? [],
    tables: options?.tables ?? [],
    title: options?.title ?? "Untitled Document",
    value: paragraphs.map((text) => ({
      children: [{ text }],
      type: "paragraph",
    })),
    version: 2,
  };
}

export async function gotoEditor(page: Page, draft = createDraft()) {
  await page.goto("/");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.evaluate(
        async ({
          appearanceKey,
          handleDatabaseName,
          key,
          nextDraft,
          workspaceKey,
        }: {
          appearanceKey: string;
          handleDatabaseName: string;
          key: string;
          nextDraft: StoredDraft;
          workspaceKey: string;
        }) => {
          window.localStorage.removeItem(appearanceKey);
          window.localStorage.removeItem(workspaceKey);
          window.localStorage.setItem(key, JSON.stringify(nextDraft));

          if ("serviceWorker" in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((registration) => registration.unregister()));
          }

          if ("caches" in window) {
            const cacheKeys = await window.caches.keys();
            await Promise.all(cacheKeys.map((cacheKey) => window.caches.delete(cacheKey)));
          }

          const deleteRequest = window.indexedDB.deleteDatabase(handleDatabaseName);
          await new Promise<void>((resolve) => {
            deleteRequest.onerror = () => resolve();
            deleteRequest.onblocked = () => resolve();
            deleteRequest.onsuccess = () => resolve();
          });

          const storageManager = navigator.storage as StorageManager & {
            getDirectory?: () => Promise<FileSystemDirectoryHandle>;
          };

          if (typeof storageManager.getDirectory === "function") {
            const root = (await storageManager.getDirectory()) as IterableDirectoryHandle;

            for await (const [name, handle] of root.entries()) {
              if (handle.kind === "file") {
                await root.removeEntry(name);
                continue;
              }

              await root.removeEntry(name, { recursive: true });
            }
          }
        },
        {
          appearanceKey: appearanceStorageKey,
          handleDatabaseName: nativeHandleDatabaseName,
          key: draftStorageKey,
          nextDraft: draft,
          workspaceKey: workspaceStorageKey,
        },
      );
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Execution context was destroyed") || attempt === 2) {
        throw error;
      }

      await page.waitForLoadState("domcontentloaded");
    }
  }
  await page.reload();
  await expect(page.getByTestId("editor-surface")).toBeVisible();
}

export async function createTable(page: Page, size: `${number}x${number}` = "3x2") {
  await page.getByTestId("toolbar-table").click();
  await page.getByTestId(`table-size-${size}`).click();
}

export async function clickEditorBottom(page: Page) {
  await page.getByTestId("editor-surface").click({
    force: true,
    position: { x: 120, y: 460 },
  });
}

export async function setCaretInEditorText(
  page: Page,
  text: string,
  edge: "start" | "end" = "end",
) {
  const found = await page.evaluate(
    ({ edge, targetText }) => {
      const root = document.querySelector('[data-testid="editor-surface"]');
      if (!(root instanceof HTMLElement)) return false;

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

      while (walker.nextNode()) {
        const currentNode = walker.currentNode;
        const content = currentNode.textContent ?? "";
        const index = content.indexOf(targetText);

        if (index === -1) continue;

        const range = document.createRange();
        const offset = edge === "start" ? index : index + targetText.length;
        range.setStart(currentNode, offset);
        range.collapse(true);

        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        root.focus();
        document.dispatchEvent(new Event("selectionchange"));

        return true;
      }

      return false;
    },
    { edge, targetText: text },
  );

  expect(found).toBeTruthy();
}

export async function selectEditorText(page: Page, text: string) {
  const found = await page.evaluate((targetText) => {
    const root = document.querySelector('[data-testid="editor-surface"]');
    if (!(root instanceof HTMLElement)) return false;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const currentNode = walker.currentNode;
      const content = currentNode.textContent ?? "";
      const index = content.indexOf(targetText);

      if (index === -1) continue;

      const range = document.createRange();
      range.setStart(currentNode, index);
      range.setEnd(currentNode, index + targetText.length);

      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      root.focus();
      document.dispatchEvent(new Event("selectionchange"));

      return true;
    }

    return false;
  }, text);

  expect(found).toBeTruthy();
}

export async function getVisibleEditorText(page: Page) {
  return await page.evaluate(() => {
    const root = document.querySelector('[data-testid="editor-surface"]');
    if (!(root instanceof HTMLElement)) return "";

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const parts: string[] = [];

    while (walker.nextNode()) {
      const currentNode = walker.currentNode;
      const parentElement = currentNode.parentElement;
      if (!(parentElement instanceof HTMLElement)) continue;

      const style = window.getComputedStyle(parentElement);
      if (
        parentElement.closest('[aria-hidden="true"]') ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        style.fontSize === "0px"
      ) {
        continue;
      }

      parts.push(currentNode.textContent ?? "");
    }

    return parts.join("");
  });
}

export async function getVisibleCaretOffset(page: Page) {
  return await page.evaluate(() => {
    const root = document.querySelector('[data-testid="editor-surface"]');
    if (!(root instanceof HTMLElement)) return null;

    const selection = window.getSelection();
    if (!selection || !selection.isCollapsed || !selection.anchorNode) return null;

    const caretRange = document.createRange();
    caretRange.setStart(root, 0);
    caretRange.setEnd(selection.anchorNode, selection.anchorOffset);

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let total = 0;

    while (walker.nextNode()) {
      const currentNode = walker.currentNode;
      const parentElement = currentNode.parentElement;
      if (!(parentElement instanceof HTMLElement)) continue;

      const style = window.getComputedStyle(parentElement);
      if (
        parentElement.closest('[aria-hidden="true"]') ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        style.fontSize === "0px"
      ) {
        continue;
      }

      const text = currentNode.textContent ?? "";
      const nodeStartRange = document.createRange();
      nodeStartRange.setStart(root, 0);
      nodeStartRange.setEnd(currentNode, 0);

      if (caretRange.compareBoundaryPoints(Range.END_TO_END, nodeStartRange) <= 0) {
        return total;
      }

      const nodeEndRange = document.createRange();
      nodeEndRange.setStart(root, 0);
      nodeEndRange.setEnd(currentNode, text.length);

      if (caretRange.compareBoundaryPoints(Range.END_TO_END, nodeEndRange) >= 0) {
        total += text.length;
        continue;
      }

      if (currentNode === selection.anchorNode) {
        return total + selection.anchorOffset;
      }

      return total;
    }

    return total;
  });
}

export async function setVisibleCaretOffset(page: Page, targetOffset: number) {
  const found = await page.evaluate((offset) => {
    const root = document.querySelector('[data-testid="editor-surface"]');
    if (!(root instanceof HTMLElement)) return false;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = offset;
    let lastVisibleNode: Node | null = null;
    let lastVisibleLength = 0;

    while (walker.nextNode()) {
      const currentNode = walker.currentNode;
      const parentElement = currentNode.parentElement;
      if (!(parentElement instanceof HTMLElement)) continue;

      const style = window.getComputedStyle(parentElement);
      if (
        parentElement.closest('[aria-hidden="true"]') ||
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        style.fontSize === "0px"
      ) {
        continue;
      }

      const text = currentNode.textContent ?? "";
      lastVisibleNode = currentNode;
      lastVisibleLength = text.length;

      if (remaining <= text.length) {
        const range = document.createRange();
        range.setStart(currentNode, remaining);
        range.collapse(true);

        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        root.focus();
        document.dispatchEvent(new Event("selectionchange"));
        return true;
      }

      remaining -= text.length;
    }

    if (!lastVisibleNode) return false;

    const fallbackRange = document.createRange();
    fallbackRange.setStart(lastVisibleNode, lastVisibleLength);
    fallbackRange.collapse(true);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(fallbackRange);
    root.focus();
    document.dispatchEvent(new Event("selectionchange"));
    return true;
  }, targetOffset);

  expect(found).toBeTruthy();
}

export function editor(page: Page): Locator {
  return page.getByTestId("editor-surface");
}

export function rawMode(page: Page): Locator {
  return page.getByTestId("raw-mode-content");
}

export function readMode(page: Page): Locator {
  return page.getByTestId("read-mode-content");
}
