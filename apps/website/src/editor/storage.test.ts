import { beforeEach, describe, expect, test, vi } from "vite-plus/test";

import {
  blankDocumentValue,
  draftStorageKey,
  initialCodeBlocksValue,
  initialTablesValue,
  initialValue,
  starterTitle,
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
      title: starterTitle,
      value: initialValue,
      version: 2,
    });

    expect(window.localStorage.getItem(draftStorageKey)).toBeNull();
  });

  test("does not persist an untouched blank draft", () => {
    window.localStorage.setItem(draftStorageKey, JSON.stringify({ title: "Old title", value: [] }));

    saveDraft({
      codeBlocks: [],
      tables: [],
      title: "",
      value: blankDocumentValue,
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
