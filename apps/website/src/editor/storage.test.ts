import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import {
  defaultTitle,
  draftStorageKey,
  initialCodeBlocksValue,
  initialTablesValue,
  initialValue,
} from "./constants";
import { saveDraft } from "./storage";

function createLocalStorageMock() {
  const store = new Map<string, string>();

  return {
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

describe("draft storage", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      localStorage: createLocalStorageMock(),
    });
  });

  test("does not persist the bundled starter draft", () => {
    window.localStorage.setItem(
      draftStorageKey,
      JSON.stringify({ title: "Old title", value: initialValue }),
    );

    saveDraft({
      codeBlocks: initialCodeBlocksValue,
      tables: initialTablesValue,
      title: defaultTitle,
      value: initialValue,
      version: 2,
    });

    expect(window.localStorage.getItem(draftStorageKey)).toBeNull();
  });

  test("persists edited drafts", () => {
    saveDraft({
      codeBlocks: initialCodeBlocksValue,
      tables: initialTablesValue,
      title: "Project notes",
      value: initialValue,
      version: 2,
    });

    expect(window.localStorage.getItem(draftStorageKey)).toBe(
      JSON.stringify({
        codeBlocks: initialCodeBlocksValue,
        tables: initialTablesValue,
        title: "Project notes",
        value: initialValue,
        version: 2,
      }),
    );
  });
});
