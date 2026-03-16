import { expect, test, type Page } from "@playwright/test";

import {
  createDraft,
  editor,
  getVisibleCaretOffset,
  getVisibleEditorText,
  gotoEditor,
  rawMode,
  readMode,
  selectEditorText,
  setCaretInEditorText,
  setVisibleCaretOffset,
} from "./helpers";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function createLongFindParagraphs() {
  return Array.from({ length: 120 }, (_, index) => {
    if (index === 8 || index === 92) {
      return `Paragraph ${index + 1}: find-target`;
    }

    return `Paragraph ${index + 1}: filler content for scroll testing.`;
  });
}

async function getFindSelectionViewportMetrics(page: Page, mode: "raw" | "write") {
  return await page.evaluate((currentMode) => {
    function getStickyChromeBottom() {
      const candidates = [
        document.querySelector('[data-testid="view-mode-toggle"]'),
        document.querySelector('[data-testid="editor-find-replace"]'),
      ];

      return candidates.reduce((maxBottom, element) => {
        if (!(element instanceof HTMLElement)) {
          return maxBottom;
        }

        return Math.max(maxBottom, element.getBoundingClientRect().bottom);
      }, 0);
    }

    function getRawSelectionRect() {
      const textarea = document.querySelector(
        '[data-testid="raw-mode-content"]',
      ) as HTMLTextAreaElement | null;
      if (!textarea) {
        return null;
      }

      const startOffset = textarea.selectionStart ?? 0;
      const endOffset = textarea.selectionEnd ?? startOffset;
      const computedStyle = window.getComputedStyle(textarea);
      const marker = document.createElement("span");
      const mirror = document.createElement("div");

      mirror.style.position = "absolute";
      mirror.style.visibility = "hidden";
      mirror.style.pointerEvents = "none";
      mirror.style.whiteSpace = "pre-wrap";
      mirror.style.overflowWrap = "break-word";
      mirror.style.wordBreak = "break-word";
      mirror.style.boxSizing = computedStyle.boxSizing;
      mirror.style.width = `${textarea.offsetWidth}px`;
      mirror.style.padding = computedStyle.padding;
      mirror.style.border = computedStyle.border;
      mirror.style.font = computedStyle.font;
      mirror.style.fontFamily = computedStyle.fontFamily;
      mirror.style.fontSize = computedStyle.fontSize;
      mirror.style.fontStyle = computedStyle.fontStyle;
      mirror.style.fontWeight = computedStyle.fontWeight;
      mirror.style.letterSpacing = computedStyle.letterSpacing;
      mirror.style.lineHeight = computedStyle.lineHeight;
      mirror.style.textTransform = computedStyle.textTransform;
      mirror.style.textIndent = computedStyle.textIndent;
      mirror.style.textRendering = computedStyle.textRendering;
      mirror.style.tabSize = computedStyle.tabSize;
      mirror.style.top = `${window.scrollY + textarea.getBoundingClientRect().top}px`;
      mirror.style.left = `${window.scrollX + textarea.getBoundingClientRect().left}px`;
      mirror.textContent = textarea.value.slice(0, startOffset);
      marker.textContent = textarea.value.slice(startOffset, endOffset) || "\u200b";
      mirror.appendChild(marker);
      document.body.appendChild(mirror);

      const rect = marker.getBoundingClientRect();
      mirror.remove();
      return rect;
    }

    const rect =
      currentMode === "write"
        ? (() => {
            const matchElement = document.querySelector('[data-current-find-match="true"]');
            if (!(matchElement instanceof HTMLElement)) {
              return null;
            }

            return matchElement.getBoundingClientRect();
          })()
        : getRawSelectionRect();

    if (!rect) {
      return null;
    }

    const stickyBottom = getStickyChromeBottom();
    const targetCenter = stickyBottom + (window.innerHeight - stickyBottom) / 2;
    const rectCenter = rect.top + rect.height / 2;

    return {
      distanceFromCenter: Math.abs(rectCenter - targetCenter),
      scrollY: window.scrollY,
    };
  }, mode);
}

async function writeWorkspaceFile(page: Page, fileName: string, content: string) {
  await page.evaluate(
    async ({ fileName, nextContent }: { fileName: string; nextContent: string }) => {
      const storageManager = navigator.storage as StorageManager & {
        getDirectory?: () => Promise<FileSystemDirectoryHandle>;
      };

      if (typeof storageManager.getDirectory !== "function") {
        return;
      }

      const root = await storageManager.getDirectory();
      const fileHandle = await root.getFileHandle(fileName, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(nextContent);
      await writable.close();
    },
    { fileName, nextContent: content },
  );
}

async function readWorkspaceFile(page: Page, fileName: string) {
  return await page.evaluate(async (targetFileName: string) => {
    const storageManager = navigator.storage as StorageManager & {
      getDirectory?: () => Promise<FileSystemDirectoryHandle>;
    };

    if (typeof storageManager.getDirectory !== "function") {
      return null;
    }

    const root = await storageManager.getDirectory();
    const fileHandle = await root.getFileHandle(targetFileName);
    const file = await fileHandle.getFile();
    return await file.text();
  }, fileName);
}

test.describe("editor core flows", () => {
  test("about page is available from the title bar without losing the draft", async ({ page }) => {
    await gotoEditor(page, createDraft(["About page draft"], { title: "Private Notes" }));

    await page.getByTestId("about-nav").click();
    await expect(page).toHaveURL(/\/about$/);

    await expect(page.getByTestId("about-page")).toBeVisible();
    await expect(page.getByTestId("home-nav")).toHaveCSS("cursor", "pointer");
    await expect(page.getByTestId("about-nav")).toHaveCSS("cursor", "pointer");
    await expect(
      page.getByRole("heading", {
        name: "Local-first markdown editing",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Underwritten does not have its own backend with independent access to your notes.",
      ),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Using MCP" })).toBeVisible();
    await expect(page.getByTestId("mcp-client-select")).toHaveValue("codex");
    await expect(
      page.getByText("codex mcp add underwritten -- npx -y underwritten-mcp"),
    ).toBeVisible();
    await page.getByTestId("mcp-client-select").selectOption("claude-code");
    await expect(page.getByTestId("mcp-client-select")).toHaveValue("claude-code");
    await expect(page.getByText('"type": "stdio"')).toBeVisible();
    await expect(page.getByText('"command": "npx"')).toBeVisible();
    await expect(
      page.getByText("Add this to a project-level .mcp.json file in Claude Code."),
    ).toBeVisible();
    await page.getByTestId("mcp-client-select").selectOption("kiro");
    await expect(page.getByTestId("mcp-client-select")).toHaveValue("kiro");
    await expect(page.getByText('"disabled": false')).toBeVisible();
    await expect(page.getByText(".kiro/settings/mcp.json")).toBeVisible();
    await page.getByTestId("mcp-client-select").selectOption("opencode");
    await expect(page.getByTestId("mcp-client-select")).toHaveValue("opencode");
    await expect(page.getByText('"$schema": "https://opencode.ai/config.json"')).toBeVisible();
    await expect(page.getByText('"command": ["npx", "-y", "underwritten-mcp"]')).toBeVisible();
    await expect(page.getByText("Problems? File an issue on github")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Problems? File an issue on github" }),
    ).toHaveAttribute("href", "https://github.com/rjerue/underwritten.app/issues");
    await expect(
      page.getByRole("link", { name: "github.com/rjerue/underwritten.app" }),
    ).toHaveAttribute("href", "https://github.com/rjerue/underwritten.app");
    await expect(page.getByRole("link", { name: "Problems? File an issue on github" })).toHaveCSS(
      "cursor",
      "pointer",
    );
    await expect(page.getByRole("link", { name: "github.com/rjerue/underwritten.app" })).toHaveCSS(
      "cursor",
      "pointer",
    );
    await expect(page.getByTestId("document-title")).toHaveCount(0);

    await page.getByTestId("home-nav").click();
    await expect(page).toHaveURL(/\/$/);

    await expect(page.getByTestId("document-title")).toHaveValue("Private Notes");
    await expect(editor(page)).toBeVisible();

    await page.goto("/about");
    await expect(page).toHaveURL(/\/about$/);
    await expect(page.getByTestId("about-page")).toBeVisible();
  });

  test("settings modal updates appearance and persists across reload", async ({ page }) => {
    await gotoEditor(page, createDraft(["Appearance sample text"]));

    await page.getByTestId("open-settings").click();
    await expect(page.getByTestId("settings-dialog")).toBeVisible();
    await expect(page.getByTestId("settings-section-appearance")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await expect(page.getByText("The quick brown fox jumps over the lazy dog.")).toBeVisible();
    await expect(page.getByText("Text font: Avenir Next")).toBeVisible();
    await expect(page.getByText("Code font: SF Mono")).toBeVisible();
    await page.getByTestId("settings-section-appearance").click();
    await expect(page.getByTestId("settings-section-appearance")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await expect(page.getByText("The quick brown fox jumps over the lazy dog.")).toHaveCount(0);
    await page.getByTestId("settings-section-appearance").click();
    await expect(page.getByTestId("settings-section-appearance")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    await page.getByTestId("settings-section-layout").click();
    await expect(page.getByTestId("settings-section-layout")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.getByRole("button", { name: /right/i }).click();
    const fillSpaceButton = page.getByRole("button", { name: /fill space/i });
    await fillSpaceButton.scrollIntoViewIfNeeded();
    await fillSpaceButton.click();
    await page.getByRole("button", { name: /Editorial/i }).click();
    const fontSizeSlider = page.getByLabel("Base Font Size");
    await fontSizeSlider.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(fontSizeSlider).toHaveValue("18");

    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const bodyStyle = window.getComputedStyle(document.body);
          return {
            fontFamily: bodyStyle.fontFamily,
            fontSize: document.documentElement.style.fontSize,
          };
        });
      })
      .toMatchObject({
        fontSize: "18px",
      });

    await expect(page.locator("body")).toHaveCSS(
      "font-family",
      '"Iowan Old Style", Georgia, serif, system-ui, sans-serif',
    );
    await expect(page.getByTestId("app-shell")).toHaveAttribute("data-page-width", "fill");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("settings-dialog")).toHaveCount(0);
    await expect(page.getByTestId("file-sidebar")).toHaveAttribute("data-side", "right");

    await page.reload();
    await expect(page.getByTestId("editor-surface")).toBeVisible();
    await expect(page.getByTestId("file-sidebar")).toHaveAttribute("data-side", "right");

    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const storedAppearance = window.localStorage.getItem(
            "underwritten.markdown-editor.appearance",
          );
          const storedWorkspace = window.localStorage.getItem(
            "underwritten.markdown-editor.workspace",
          );

          return {
            htmlFontSize: document.documentElement.style.fontSize,
            storedAppearance,
            storedWorkspace,
          };
        });
      })
      .toEqual({
        htmlFontSize: "18px",
        storedAppearance: JSON.stringify({
          baseFontSize: 18,
          fontPresetId: "editorial",
        }),
        storedWorkspace: JSON.stringify({
          autosaveEnabled: false,
          currentFileName: null,
          lastSavedFingerprint: null,
          mcpEnabled: true,
          pageWidthMode: "fill",
          showLineNumbers: false,
          sidebarCollapsed: false,
          sidebarSide: "right",
          storageMode: "origin-private",
        }),
      });

    await expect(page.locator("body")).toHaveCSS(
      "font-family",
      '"Iowan Old Style", Georgia, serif, system-ui, sans-serif',
    );
    await expect(page.getByTestId("app-shell")).toHaveAttribute("data-page-width", "fill");
  });

  test("line numbers can be enabled in write and read mode from settings", async ({ page }) => {
    await gotoEditor(page, createDraft(["First line", "Second line", "Third line"]));

    await page.getByTestId("open-settings").click();
    await page.getByTestId("settings-section-layout").click();
    await expect(page.getByTestId("line-numbers-toggle")).toHaveAttribute("aria-checked", "false");
    await page.getByTestId("line-numbers-toggle").click();
    await expect(page.getByTestId("line-numbers-toggle")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    await expect
      .poll(async () => {
        return await page
          .locator('[data-testid="editor-surface"] [data-testid="editor-line-number"]')
          .evaluateAll((nodes) => nodes.map((node) => node.textContent));
      })
      .toEqual(["1", "2", "3"]);
    expect(await getVisibleEditorText(page)).toBe("First lineSecond lineThird line");

    await page.getByTestId("mode-read").click();
    await expect
      .poll(async () => {
        return await page
          .locator('[data-testid="read-mode-content"] [data-testid="editor-line-number"]')
          .evaluateAll((nodes) => nodes.map((node) => node.textContent));
      })
      .toEqual(["1", "2", "3"]);

    await page.reload();
    await expect(page.getByTestId("editor-surface")).toBeVisible();
    await expect
      .poll(async () => {
        return await page
          .locator('[data-testid="editor-surface"] [data-testid="editor-line-number"]')
          .evaluateAll((nodes) => nodes.map((node) => node.textContent));
      })
      .toEqual(["1", "2", "3"]);

    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          return window.localStorage.getItem("underwritten.markdown-editor.workspace");
        });
      })
      .toBe(
        JSON.stringify({
          autosaveEnabled: false,
          currentFileName: null,
          lastSavedFingerprint: null,
          mcpEnabled: true,
          pageWidthMode: "responsive",
          showLineNumbers: true,
          sidebarCollapsed: false,
          sidebarSide: "left",
          storageMode: "origin-private",
        }),
      );
  });

  test("write mode keeps inline formatting on a heading line", async ({ page }) => {
    await gotoEditor(
      page,
      createDraft(["#### `apply_markdown_edits` **bold** _italic_ ~~strike~~", "`body_code`"]),
    );

    const metrics = await page.locator('[data-testid="editor-surface"] > p').evaluateAll((nodes) =>
      nodes.slice(0, 2).map((node) => {
        const paragraph = node as HTMLElement;
        const visibleSpans = Array.from(paragraph.querySelectorAll("span")).filter((span) => {
          const style = window.getComputedStyle(span);
          return (
            (span.textContent ?? "").trim().length > 0 &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.opacity !== "0" &&
            style.fontSize !== "0px"
          );
        });

        return {
          fontSize: window.getComputedStyle(paragraph).fontSize,
          spans: visibleSpans.map((span) => ({
            display: window.getComputedStyle(span).display,
            fontSize: window.getComputedStyle(span).fontSize,
            text: span.textContent ?? "",
          })),
        };
      }),
    );

    expect(metrics).toHaveLength(2);

    const headingMetrics = metrics[0];
    const bodyMetrics = metrics[1];
    const headingCode = headingMetrics?.spans.find((span) =>
      span.text.includes("apply_markdown_edits"),
    );
    const bodyCode = bodyMetrics?.spans.find((span) => span.text.includes("body_code"));

    expect(headingMetrics?.spans.every((span) => span.display === "inline")).toBeTruthy();
    expect(headingCode?.fontSize).toBe(headingMetrics?.fontSize);
    expect(Number.parseFloat(headingCode?.fontSize ?? "0")).toBeGreaterThan(
      Number.parseFloat(bodyCode?.fontSize ?? "0"),
    );
  });

  test("ctrl+f opens find and replace in write mode", async ({ page }) => {
    await gotoEditor(page, createDraft(["alpha beta", "beta gamma"]));

    await editor(page).click();
    await page.keyboard.press("Control+f");

    await expect(page.getByTestId("editor-find-replace")).toBeVisible();
    await expect(page.getByTestId("editor-find-input")).toBeFocused();

    await page.getByTestId("editor-find-input").fill("beta");
    await expect(page.getByTestId("editor-find-count")).toHaveText("1 of 2");

    await page.getByTestId("editor-toggle-replace").click();
    await page.getByTestId("editor-replace-input").fill("delta");
    await page.getByTestId("editor-replace-all").click();

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue("alpha delta\ndelta gamma");
  });

  test("ctrl+f opens find and replace in raw mode", async ({ page }) => {
    await gotoEditor(page, createDraft(["beta beta gamma"]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).click();
    await page.keyboard.press("Control+f");

    await expect(page.getByTestId("editor-find-replace")).toBeVisible();
    await expect(page.getByTestId("editor-find-input")).toBeFocused();

    await page.getByTestId("editor-find-input").fill("beta");
    await expect(page.getByTestId("editor-find-count")).toHaveText("1 of 2");

    await page.getByTestId("editor-toggle-replace").click();
    await page.getByTestId("editor-replace-input").fill("delta");
    await page.getByTestId("editor-replace").click();

    await expect(rawMode(page)).toHaveValue("delta beta gamma");
    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const textarea = document.querySelector(
            '[data-testid="raw-mode-content"]',
          ) as HTMLTextAreaElement | null;
          if (!textarea) {
            return null;
          }

          return {
            end: textarea.selectionEnd,
            start: textarea.selectionStart,
          };
        });
      })
      .toEqual({
        end: 10,
        start: 6,
      });
  });

  test("write mode keeps focus in the find input while typing", async ({ page }) => {
    await gotoEditor(page, createDraft(createLongFindParagraphs()));

    await editor(page).click();
    await page.keyboard.press("Control+f");
    const findInput = page.getByTestId("editor-find-input");
    await expect(findInput).toBeFocused();

    await findInput.type("find-target", { delay: 20 });
    await expect(findInput).toBeFocused();
    await expect(page.getByTestId("editor-find-count")).toHaveText("1 of 2");
  });

  test("write mode find navigation centers a distant match in the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoEditor(page, createDraft(createLongFindParagraphs()));

    await editor(page).click();
    await page.keyboard.press("Control+f");
    await page.getByTestId("editor-find-input").fill("find-target");
    await expect(page.getByTestId("editor-find-count")).toHaveText("1 of 2");

    await page.getByTestId("editor-find-next").click();
    await expect(page.getByTestId("editor-find-count")).toHaveText("2 of 2");

    await expect
      .poll(async () => {
        return await getFindSelectionViewportMetrics(page, "write");
      })
      .toMatchObject({
        scrollY: expect.any(Number),
      });

    const metrics = await getFindSelectionViewportMetrics(page, "write");
    expect(metrics).not.toBeNull();
    expect(metrics?.scrollY ?? 0).toBeGreaterThan(500);
    expect(metrics?.distanceFromCenter ?? Number.POSITIVE_INFINITY).toBeLessThan(140);
  });

  test("raw mode find navigation centers a distant match in the viewport", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoEditor(page, createDraft(createLongFindParagraphs()));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).click();
    await page.keyboard.press("Control+f");
    await page.getByTestId("editor-find-input").fill("find-target");
    await expect(page.getByTestId("editor-find-count")).toHaveText("1 of 2");

    await page.getByTestId("editor-find-next").click();
    await expect(page.getByTestId("editor-find-count")).toHaveText("2 of 2");

    await expect
      .poll(async () => {
        return await getFindSelectionViewportMetrics(page, "raw");
      })
      .toMatchObject({
        scrollY: expect.any(Number),
      });

    const metrics = await getFindSelectionViewportMetrics(page, "raw");
    expect(metrics).not.toBeNull();
    expect(metrics?.scrollY ?? 0).toBeGreaterThan(500);
    expect(metrics?.distanceFromCenter ?? Number.POSITIVE_INFINITY).toBeLessThan(140);
  });

  test("sidebar saves files and warns before loading another file over unsaved work", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft([""]));

    await editor(page).click();
    await page.keyboard.type("First draft");

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("alpha-note");
    });
    await page.getByTestId("sidebar-save").click({ button: "right" });

    await expect(page.getByTestId("current-file-name")).toContainText("alpha-note.md");
    await expect(page.getByTestId("tree-entry-alpha-note.md")).toBeVisible();

    await page.getByTestId("sidebar-new-file").click();
    await expect(page.getByTestId("current-file-name")).toContainText("Not saved yet");

    await editor(page).click();
    await page.keyboard.type("Unsaved buffer");

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      await dialog.dismiss();
    });
    await page.getByTestId("tree-entry-alpha-note.md").click();

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(/Unsaved buffer/);
    await expect(page.getByTestId("current-file-name")).toContainText("Not saved yet");

    await page.getByTestId("mode-write").click();
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      await dialog.accept();
    });
    await page.getByTestId("tree-entry-alpha-note.md").click();

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(/First draft/);
    await expect(rawMode(page)).not.toHaveValue(/Unsaved buffer/);
    await expect(page.getByTestId("current-file-name")).toContainText("alpha-note.md");
  });

  test("autosaves edits for files that already have a saved path", async ({ page }) => {
    await gotoEditor(page, createDraft([""]));

    await editor(page).click();
    await page.keyboard.type("Saved once");

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("autosave-note");
    });
    await page.getByTestId("sidebar-save").click({ button: "right" });

    await page.getByTestId("open-settings").click();
    await page.getByTestId("settings-section-storage").click();
    await page.getByTestId("autosave-toggle").click();
    await expect(page.getByTestId("autosave-toggle")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill("Autosaved content");
    await expect(page.getByTestId("unsaved-indicator")).toBeVisible();
    await expect(page.getByTestId("unsaved-indicator")).toHaveCount(0, { timeout: 5000 });

    await expect
      .poll(async () => {
        return await page.evaluate(async () => {
          const storageManager = navigator.storage as StorageManager & {
            getDirectory?: () => Promise<FileSystemDirectoryHandle>;
          };

          if (typeof storageManager.getDirectory !== "function") {
            return null;
          }

          const root = await storageManager.getDirectory();
          const fileHandle = await root.getFileHandle("autosave-note.md");
          const file = await fileHandle.getFile();
          return await file.text();
        });
      })
      .toBe("Autosaved content");
  });

  test("mcp integration can be turned off from settings and persists across reload", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft(["MCP toggle"]));

    await page.getByTestId("open-settings").click();
    await page.getByTestId("settings-section-bridge").click();
    await expect(page.getByTestId("mcp-enabled-toggle")).toHaveAttribute("aria-checked", "true");

    await page.getByTestId("mcp-enabled-toggle").click();
    await expect(page.getByTestId("mcp-enabled-toggle")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("MCP integration is turned off")).toBeVisible();

    await page.reload();
    await page.getByTestId("open-settings").click();
    await page.getByTestId("settings-section-bridge").click();
    await expect(page.getByTestId("mcp-enabled-toggle")).toHaveAttribute("aria-checked", "false");
    await expect(page.getByText("MCP integration is turned off")).toBeVisible();
  });

  test("clean files auto-update when the on-disk version changes", async ({ page }) => {
    await gotoEditor(page, createDraft([""]));

    await editor(page).click();
    await page.keyboard.type("Saved once");

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("sync-note");
    });
    await page.getByTestId("sidebar-save").click({ button: "right" });

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue("Saved once");

    await writeWorkspaceFile(page, "sync-note.md", "Fresh disk version");

    await expect(rawMode(page)).toHaveValue("Fresh disk version", { timeout: 6000 });
    await expect(page.getByTestId("disk-conflict-banner")).toHaveCount(0);
  });

  test("external disk changes block save and let the user open the disk version", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft([""]));

    await editor(page).click();
    await page.keyboard.type("Saved once");

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("disk-conflict-note");
    });
    await page.getByTestId("sidebar-save").click({ button: "right" });

    await page.getByTestId("open-settings").click();
    await page.getByTestId("settings-section-storage").click();
    await page.getByTestId("autosave-toggle").click();
    await expect(page.getByTestId("autosave-toggle")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill("Local unsaved draft");

    await writeWorkspaceFile(page, "disk-conflict-note.md", "Disk wins");

    await expect(page.getByTestId("disk-conflict-banner")).toBeVisible({ timeout: 6000 });
    await expect(page.getByTestId("sidebar-save")).toBeDisabled();

    await page.waitForTimeout(2500);
    expect(await readWorkspaceFile(page, "disk-conflict-note.md")).toBe("Disk wins");

    await page.getByTestId("disk-conflict-open-disk").click();
    await expect(rawMode(page)).toHaveValue("Disk wins");
    await expect(page.getByTestId("disk-conflict-banner")).toHaveCount(0);
  });

  test("acknowledging an external disk change allows overwrite on the next autosave", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft([""]));

    await editor(page).click();
    await page.keyboard.type("Saved once");

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("acknowledge-conflict-note");
    });
    await page.getByTestId("sidebar-save").click({ button: "right" });

    await page.getByTestId("open-settings").click();
    await page.getByTestId("settings-section-storage").click();
    await page.getByTestId("autosave-toggle").click();
    await expect(page.getByTestId("autosave-toggle")).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill("Local draft override");

    await writeWorkspaceFile(page, "acknowledge-conflict-note.md", "External edit");

    await expect(page.getByTestId("disk-conflict-banner")).toBeVisible({ timeout: 6000 });
    await page.getByTestId("disk-conflict-acknowledge").click();
    await expect(page.getByTestId("sidebar-save")).toBeEnabled();

    await expect
      .poll(async () => {
        return await readWorkspaceFile(page, "acknowledge-conflict-note.md");
      })
      .toBe("Local draft override");
  });

  test("file browser renders as a tree and supports folders", async ({ page }) => {
    await gotoEditor(page, createDraft(["Tree draft"]));

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("notes");
    });
    await page.getByTestId("sidebar-new-folder").click();

    await expect(page.getByTestId("tree-entry-notes")).toBeVisible();
    await expect(page.getByTestId("tree-toggle-notes")).toBeVisible();
    await page.getByTestId("tree-entry-notes").click();

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("daily-entry");
    });
    await page.getByTestId("sidebar-save").click({ button: "right" });

    await expect(page.getByTestId("current-file-name")).toContainText("notes/daily-entry.md");
    await expect(page.getByTestId("tree-entry-notes/daily-entry.md")).toBeVisible();

    await page.getByTestId("sidebar-new-file").click();
    await page.getByTestId("tree-entry-notes/daily-entry.md").click();

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(/Tree draft/);
  });

  test("sidebar can collapse and persists that state", async ({ page }) => {
    await gotoEditor(page, createDraft(["Collapse me"]));

    await expect(page.getByTestId("file-sidebar")).toHaveAttribute("data-collapsed", "false");
    await expect(page.getByTestId("file-entry-collapse-me.md")).toHaveCount(0);

    await page.getByTestId("sidebar-toggle").click();
    await expect(page.getByTestId("file-sidebar")).toHaveAttribute("data-collapsed", "true");
    await expect(page.getByTestId("sidebar-new-folder")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-rename")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-delete")).toHaveCount(0);
    await expect(page.getByTestId("sidebar-save")).toBeVisible();

    await page.reload();
    await expect(page.getByTestId("editor-surface")).toBeVisible();
    await expect(page.getByTestId("file-sidebar")).toHaveAttribute("data-collapsed", "true");
    await expect(page.getByTestId("sidebar-save")).toBeVisible();
  });

  test("mobile sidebar docks as a bottom drawer with horizontal collapsed actions", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 844, width: 390 });
    await gotoEditor(page, createDraft(["Mobile drawer"]));

    const sidebar = page.getByTestId("file-sidebar");
    await expect(sidebar).toHaveAttribute("data-mobile-layout", "drawer");
    await expect(sidebar).toHaveAttribute("data-collapsed", "false");

    const expandedBottomInset = await sidebar.evaluate((node) => {
      if (!(node instanceof HTMLElement)) return null;
      const rect = node.getBoundingClientRect();
      return Math.round(window.innerHeight - rect.bottom);
    });
    expect(expandedBottomInset).not.toBeNull();
    expect(expandedBottomInset).toBeLessThanOrEqual(16);

    await page.getByTestId("sidebar-toggle").click();
    await expect(sidebar).toHaveAttribute("data-collapsed", "true");

    const collapsedLayout = await page.evaluate(() => {
      const sidebarNode = document.querySelector('[data-testid="file-sidebar"]');
      const toggleNode = document.querySelector('[data-testid="sidebar-toggle"]');
      const newFileNode = document.querySelector('[data-testid="sidebar-new-file"]');
      const saveNode = document.querySelector('[data-testid="sidebar-save"]');

      if (
        !(sidebarNode instanceof HTMLElement) ||
        !(toggleNode instanceof HTMLElement) ||
        !(newFileNode instanceof HTMLElement) ||
        !(saveNode instanceof HTMLElement)
      ) {
        return null;
      }

      const sidebarRect = sidebarNode.getBoundingClientRect();
      const toggleRect = toggleNode.getBoundingClientRect();
      const newFileRect = newFileNode.getBoundingClientRect();
      const saveRect = saveNode.getBoundingClientRect();

      return {
        bottomInset: Math.round(window.innerHeight - sidebarRect.bottom),
        newFileLeft: Math.round(newFileRect.left),
        newFileTop: Math.round(newFileRect.top),
        saveLeft: Math.round(saveRect.left),
        saveTop: Math.round(saveRect.top),
        toggleTop: Math.round(toggleRect.top),
      };
    });

    expect(collapsedLayout).not.toBeNull();
    expect(collapsedLayout?.bottomInset).toBeLessThanOrEqual(16);
    expect(
      Math.abs((collapsedLayout?.toggleTop ?? 0) - (collapsedLayout?.newFileTop ?? 0)),
    ).toBeLessThanOrEqual(8);
    expect(
      Math.abs((collapsedLayout?.newFileTop ?? 0) - (collapsedLayout?.saveTop ?? 0)),
    ).toBeLessThanOrEqual(8);
    expect(collapsedLayout?.saveLeft ?? 0).toBeGreaterThan(collapsedLayout?.newFileLeft ?? 0);
  });

  test("sidebar can rename and delete selected files and folders", async ({ page }) => {
    await gotoEditor(page, createDraft(["Rename and delete"]));

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("notes");
    });
    await page.getByTestId("sidebar-new-folder").click();
    await page.getByTestId("tree-entry-notes").click();

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("draft-one");
    });
    await page.getByTestId("sidebar-save").click({ button: "right" });
    await expect(page.getByTestId("tree-entry-notes/draft-one.md")).toBeVisible();

    await page.getByTestId("tree-entry-notes/draft-one.md").click();
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("notes/renamed-draft");
    });
    await page.getByTestId("sidebar-rename").click();
    await expect(page.getByTestId("tree-entry-notes/renamed-draft.md")).toBeVisible();
    await expect(page.getByTestId("tree-entry-notes/draft-one.md")).toHaveCount(0);
    await expect(page.getByTestId("current-file-name")).toContainText("notes/renamed-draft.md");

    await page.getByTestId("tree-entry-notes").click();
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("projects");
    });
    await page.getByTestId("sidebar-rename").click();
    await expect(page.getByTestId("tree-entry-projects")).toBeVisible();
    await expect(page.getByTestId("current-file-name")).toContainText("projects/renamed-draft.md");
    await page.getByTestId("tree-entry-projects").click();
    await expect(page.getByTestId("tree-entry-projects/renamed-draft.md")).toBeVisible();

    await page.getByTestId("tree-entry-projects/renamed-draft.md").click();
    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      await dialog.accept();
    });
    await page.getByTestId("sidebar-delete").click();
    await expect(page.getByTestId("tree-entry-projects/renamed-draft.md")).toHaveCount(0);
    await expect(page.getByTestId("current-file-name")).toContainText("Not saved yet");
  });

  test("file tree supports drag and drop moves", async ({ page }) => {
    await gotoEditor(page, createDraft(["Drag me"]));

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("notes");
    });
    await page.getByTestId("sidebar-new-folder").click();
    await page.getByTestId("tree-entry-notes").click();

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("drag-me");
    });
    await page.getByTestId("sidebar-save").click({ button: "right" });
    await expect(page.getByTestId("current-file-name")).toContainText("notes/drag-me.md");
    await expect(page.getByTestId("tree-entry-notes/drag-me.md")).toBeVisible();

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("archive");
    });
    await page.getByTestId("sidebar-new-folder").click();
    await expect(page.getByTestId("tree-entry-archive")).toBeVisible();

    await page
      .getByTestId("tree-entry-notes/drag-me.md")
      .dragTo(page.getByTestId("tree-row-archive"));

    await expect(page.getByTestId("tree-entry-archive/drag-me.md")).toBeVisible();
    await expect(page.getByTestId("tree-entry-notes/drag-me.md")).toHaveCount(0);
    await expect(page.getByTestId("current-file-name")).toContainText("archive/drag-me.md");
  });

  test("file tree exposes a root drop target and can move files back to root", async ({ page }) => {
    await gotoEditor(page, createDraft(["Back to root"]));

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("notes");
    });
    await page.getByTestId("sidebar-new-folder").click();
    await expect(page.getByTestId("tree-root-row")).toBeVisible();
    await page.getByTestId("tree-entry-notes").click();

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("back-to-root");
    });
    await page.getByTestId("sidebar-save").click({ button: "right" });
    await expect(page.getByTestId("current-file-name")).toContainText("notes/back-to-root.md");

    await page
      .getByTestId("tree-entry-notes/back-to-root.md")
      .dragTo(page.getByTestId("tree-root-row"));

    await expect(page.getByTestId("tree-entry-back-to-root.md")).toBeVisible();
    await expect(page.getByTestId("tree-entry-notes/back-to-root.md")).toHaveCount(0);
    await expect(page.getByTestId("current-file-name")).toContainText("back-to-root.md");
    await expect(page.getByTestId("current-file-name")).not.toContainText("notes/");
  });

  test("persists title and body edits across reload", async ({ page }) => {
    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("document-title").fill("Integration Draft");
    await editor(page).click();
    await page.keyboard.type("Hello persisted world");

    await page.reload();

    await expect(page.getByTestId("document-title")).toHaveValue("Integration Draft");
    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(/Hello persisted world/);
  });

  test("toolbar buttons insert the expected markdown tokens", async ({ page }) => {
    const scenarios = [
      {
        button: "toolbar-bold",
        expectedMarkdown: "**bold**",
        readText: "bold",
        text: "bold",
      },
      {
        button: "toolbar-italic",
        expectedMarkdown: "*italic*",
        readText: "italic",
        text: "italic",
      },
      {
        button: "toolbar-underline",
        expectedMarkdown: "<u>underline</u>",
        readText: "underline",
        text: "underline",
      },
      {
        button: "toolbar-strikethrough",
        expectedMarkdown: "~~strike~~",
        readText: "strike",
        text: "strike",
      },
      {
        button: "toolbar-code",
        expectedMarkdown: "`code`",
        readText: "code",
        text: "code",
      },
      {
        button: "toolbar-heading",
        expectedMarkdown: "## Heading",
        readText: "Heading",
        text: "Heading",
      },
      {
        button: "toolbar-blockquote",
        expectedMarkdown: "> Quote",
        readText: "Quote",
        text: "Quote",
      },
      {
        button: "toolbar-bulleted-list",
        expectedMarkdown: "- Bullet",
        readText: "Bullet",
        text: "Bullet",
      },
      {
        button: "toolbar-numbered-list",
        expectedMarkdown: "1. First",
        readText: "First",
        text: "First",
      },
    ] as const;

    for (const scenario of scenarios) {
      await test.step(scenario.button, async () => {
        await page.context().clearCookies();
        await gotoEditor(page, createDraft([""]));

        await editor(page).click();
        await page.getByTestId(scenario.button).click();
        await page.keyboard.type(scenario.text);

        await page.getByTestId("mode-raw").click();
        await expect(rawMode(page)).toHaveValue(new RegExp(escapeRegex(scenario.expectedMarkdown)));

        await page.getByTestId("mode-read").click();
        await expect(readMode(page)).toContainText(scenario.readText);
        await expect(readMode(page)).not.toContainText(scenario.expectedMarkdown);
      });
    }
  });

  test("toolbar buttons insert links and images from prompts", async ({ page }) => {
    await gotoEditor(page, createDraft([""]));

    await editor(page).click();

    const linkDialogs = ["https://example.com/docs", "Example docs"];
    const handleLinkDialog = async (dialog: { accept: (value?: string) => Promise<void> }) => {
      const nextValue = linkDialogs.shift();
      if (!nextValue) {
        throw new Error("Unexpected extra link prompt.");
      }

      await dialog.accept(nextValue);
    };

    page.on("dialog", handleLinkDialog);
    await page.getByTestId("toolbar-link").click();
    page.off("dialog", handleLinkDialog);

    const imageDialogs = ["https://example.com/preview.png", "Example preview"];
    const handleImageDialog = async (dialog: { accept: (value?: string) => Promise<void> }) => {
      const nextValue = imageDialogs.shift();
      if (!nextValue) {
        throw new Error("Unexpected extra image prompt.");
      }

      await dialog.accept(nextValue);
    };

    page.on("dialog", handleImageDialog);
    await page.getByTestId("toolbar-image").click();
    page.off("dialog", handleImageDialog);

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(
      "[Example docs](https://example.com/docs)![Example preview](https://example.com/preview.png)",
    );

    await page.getByTestId("mode-read").click();
    await expect(page.getByRole("link", { name: "Example docs" })).toHaveAttribute(
      "href",
      "https://example.com/docs",
    );
    await expect(page.locator('img[alt="Example preview"]')).toHaveAttribute(
      "src",
      /https:\/\/example\.com\/preview\.png/,
    );
  });

  test("write mode shows link previews and edits them in a dialog", async ({ page }) => {
    await gotoEditor(page, createDraft(["Visit [Example Domain](https://example.com) today"]));

    await expect(page.getByTestId("write-link-preview")).toContainText("Example Domain");
    await expect(page.getByTestId("write-link-edit")).toHaveCSS("opacity", "0");
    await page.getByTestId("write-link-preview").hover();
    await expect(page.getByTestId("write-link-edit")).toHaveCSS("opacity", "1");
    await page.getByTestId("write-link-edit").click();

    await expect(page.getByTestId("link-editor-dialog")).toBeVisible();
    await page.getByTestId("link-editor-label-input").fill("MDN Docs");
    await page.getByTestId("link-editor-url-input").fill("https://developer.mozilla.org/");
    await page.getByTestId("link-editor-save").click();

    await expect(page.getByTestId("write-link-preview")).toContainText("MDN Docs");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(
      "Visit [MDN Docs](https://developer.mozilla.org/) today",
    );
  });

  test("write mode shows image previews with a fallback and edits them in a dialog", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft(["![Broken preview](https://example.invalid/missing.png)"]));

    await expect(page.getByTestId("write-image-preview")).toBeVisible();
    await expect(page.getByTestId("write-image-not-found")).toContainText("Image not found");

    await page.getByTestId("write-image-edit").click();

    await expect(page.getByTestId("image-editor-dialog")).toBeVisible();
    await page.getByTestId("image-editor-url-input").fill("https://placehold.co/320x180/png");
    await page.getByTestId("image-editor-alt-input").fill("Updated preview");
    await page.getByTestId("image-editor-save").click();

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue("![Updated preview](https://placehold.co/320x180/png)");

    await page.getByTestId("mode-write").click();
    await expect(page.getByTestId("write-image-preview")).toContainText("Updated preview");
  });

  test("arrow keys move around standalone images without losing the caret", async ({ page }) => {
    const imageMarkdown = "![Preview](https://placehold.co/320x180/png)";

    await gotoEditor(page, createDraft(["Before", imageMarkdown, "After"]));

    await setCaretInEditorText(page, "Before", "end");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("!");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(`Before\n${imageMarkdown}\n!After`);

    await gotoEditor(page, createDraft(["Before", imageMarkdown, "After"]));

    await setCaretInEditorText(page, "After", "start");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("!");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(`Before!\n${imageMarkdown}\nAfter`);
  });

  test("arrow keys create a caret position after or before edge images", async ({ page }) => {
    const imageMarkdown = "![Preview](https://placehold.co/320x180/png)";

    await gotoEditor(page, createDraft(["Before", imageMarkdown]));

    await setCaretInEditorText(page, "Before", "end");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("!");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(`Before\n${imageMarkdown}\n!`);

    await gotoEditor(page, createDraft([imageMarkdown, "After"]));

    await setCaretInEditorText(page, "After", "start");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("!");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(`!\n${imageMarkdown}\nAfter`);
  });

  test("deleting a selected link label removes the full link markdown", async ({ page }) => {
    await gotoEditor(
      page,
      createDraft(["This sentence has [Example Domain](https://example.com) in the middle"]),
    );

    await selectEditorText(page, "Example Domain");
    await page.keyboard.press("Delete");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue("This sentence has  in the middle");
  });

  test("shift-arrow selection into a link reveals raw markdown instead of hidden preview text", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft(["Visit [Example Domain](https://example.com) today"]));

    await setCaretInEditorText(page, "today", "start");
    await page.keyboard.press("Shift+ArrowLeft");
    await page.keyboard.press("Shift+ArrowLeft");

    await expect(page.getByTestId("write-link-preview")).toHaveCount(0);
  });

  test("arrowing left from following text reaches the visible end of a link without hidden text", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft(["Visit [Example Domain](https://example.com) today"]));

    await setCaretInEditorText(page, "today", "start");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.type("!");

    await expect(page.getByTestId("write-link-preview")).toContainText("Example Domain");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue("Visit [Example Domain](https://example.com)! today");
  });

  test("arrowing right from the end of a link exits the link without landing in hidden text", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft(["Visit [Example Domain](https://example.com) today"]));

    await setCaretInEditorText(page, "Example Domain", "end");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.type("!");

    await expect(page.getByTestId("write-link-preview")).toContainText("Example Domain");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue("Visit [Example Domain](https://example.com) !today");
  });

  test("left and right arrow navigation moves through link text like ordinary visible text", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft(["Visit [Example Domain](https://example.com) today"]));

    const visibleText = await getVisibleEditorText(page);
    expect(visibleText).toBe("Visit Example Domain today");

    for (let offset = 0; offset < visibleText.length; offset += 1) {
      await setVisibleCaretOffset(page, offset);
      await page.keyboard.press("ArrowRight");

      const nextOffset = await getVisibleCaretOffset(page);
      expect(nextOffset, `ArrowRight from visible offset ${offset}`).toBe(offset + 1);
    }

    for (let offset = 1; offset <= visibleText.length; offset += 1) {
      await setVisibleCaretOffset(page, offset);
      await page.keyboard.press("ArrowLeft");

      const nextOffset = await getVisibleCaretOffset(page);
      expect(nextOffset, `ArrowLeft from visible offset ${offset}`).toBe(offset - 1);
    }
  });

  test("read and raw modes show the expected markdown transformations", async ({ page }) => {
    await gotoEditor(
      page,
      createDraft([
        "## Heading",
        "Paragraph with **bold** and *italic* plus `code`.",
        "> Quote block",
        "- Bullet item",
      ]),
    );

    await page.getByTestId("mode-read").click();
    await expect(readMode(page)).toContainText("Heading");
    await expect(readMode(page)).toContainText("Paragraph with bold and italic plus code.");
    await expect(readMode(page)).toContainText("Quote block");
    await expect(readMode(page)).toContainText("Bullet item");
    await expect(readMode(page)).not.toContainText("## Heading");
    await expect(readMode(page)).not.toContainText("**bold**");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(/## Heading/);
    await expect(rawMode(page)).toHaveValue(/\*\*bold\*\*/);
    await expect(rawMode(page)).toHaveValue(/\*italic\*/);
    await expect(rawMode(page)).toHaveValue(/`code`/);
    await expect(rawMode(page)).toHaveValue(/> Quote block/);
    await expect(rawMode(page)).toHaveValue(/- Bullet item/);
  });

  test("read mode preserves nested list indentation", async ({ page }) => {
    await gotoEditor(
      page,
      createDraft([
        "- Parent bullet",
        "\t- Child bullet",
        "1. Parent ordered",
        "\ta. Child ordered",
      ]),
    );

    await page.getByTestId("mode-read").click();

    const parentBullet = readMode(page).getByText("Parent bullet");
    const childBullet = readMode(page).getByText("Child bullet");
    const parentOrdered = readMode(page).getByText("Parent ordered");
    const childOrdered = readMode(page).getByText("Child ordered");

    const parentBulletBox = await parentBullet.boundingBox();
    const childBulletBox = await childBullet.boundingBox();
    const parentOrderedBox = await parentOrdered.boundingBox();
    const childOrderedBox = await childOrdered.boundingBox();

    expect(parentBulletBox).not.toBeNull();
    expect(childBulletBox).not.toBeNull();
    expect(parentOrderedBox).not.toBeNull();
    expect(childOrderedBox).not.toBeNull();

    if (!parentBulletBox || !childBulletBox || !parentOrderedBox || !childOrderedBox) {
      throw new Error("Nested read-mode list items were not rendered.");
    }

    expect(childBulletBox.x).toBeGreaterThan(parentBulletBox.x + 12);
    expect(childOrderedBox.x).toBeGreaterThan(parentOrderedBox.x + 12);
  });

  test("read mode preserves paragraph spacing from line breaks", async ({ page }) => {
    await gotoEditor(page, createDraft(["First paragraph", "Second paragraph"]));

    await page.getByTestId("mode-read").click();

    const firstParagraph = readMode(page).getByText("First paragraph");
    const secondParagraph = readMode(page).getByText("Second paragraph");
    const firstBox = await firstParagraph.boundingBox();
    const secondBox = await secondParagraph.boundingBox();

    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();

    if (!firstBox || !secondBox) {
      throw new Error("Read mode paragraphs were not rendered.");
    }

    expect(secondBox.y - (firstBox.y + firstBox.height)).toBeGreaterThan(8);
  });

  test("read mode preserves blank lines as visible spacing", async ({ page }) => {
    await gotoEditor(page, createDraft(["First paragraph", "", "Second paragraph"]));

    await page.getByTestId("mode-read").click();

    const firstParagraph = readMode(page).getByText("First paragraph");
    const secondParagraph = readMode(page).getByText("Second paragraph");
    const firstBox = await firstParagraph.boundingBox();
    const secondBox = await secondParagraph.boundingBox();

    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();

    if (!firstBox || !secondBox) {
      throw new Error("Read mode paragraphs were not rendered.");
    }

    expect(secondBox.y - (firstBox.y + firstBox.height)).toBeGreaterThan(24);
  });

  test("read mode wraps very long unbroken strings instead of overflowing", async ({ page }) => {
    const longString = "a".repeat(600);
    await gotoEditor(page, createDraft([longString]));

    await page.getByTestId("mode-read").click();

    await expect(readMode(page)).toContainText(longString);
    await expect
      .poll(async () => {
        return await page.evaluate(() => {
          const root = document.documentElement;
          return root.scrollWidth <= root.clientWidth;
        });
      })
      .toBe(true);
  });

  test("raw mode allows direct markdown editing", async ({ page }) => {
    await gotoEditor(page, createDraft(["Initial line"]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill("## New heading\nParagraph with **bold** text.");

    await expect(rawMode(page)).toHaveValue("## New heading\nParagraph with **bold** text.");

    await page.getByTestId("mode-read").click();
    await expect(readMode(page)).toContainText("New heading");
    await expect(readMode(page)).toContainText("Paragraph with bold text.");
    await expect(readMode(page)).not.toContainText("**bold**");

    await page.getByTestId("mode-write").click();
    await expect(editor(page)).toContainText("## New heading");
    await expect(editor(page)).toContainText("Paragraph with **bold** text.");
  });

  test("formatting toolbar is only visible in write mode", async ({ page }) => {
    await gotoEditor(page, createDraft(["Toolbar visibility"]));

    await expect(page.getByTestId("toolbar-bold")).toBeVisible();
    await expect(page.getByTestId("toolbar-table")).toBeVisible();

    await page.getByTestId("mode-read").click();
    await expect(page.getByTestId("toolbar-bold")).toHaveCount(0);
    await expect(page.getByTestId("toolbar-table")).toHaveCount(0);

    await page.getByTestId("mode-raw").click();
    await expect(page.getByTestId("toolbar-bold")).toHaveCount(0);
    await expect(page.getByTestId("toolbar-table")).toHaveCount(0);

    await page.getByTestId("mode-write").click();
    await expect(page.getByTestId("toolbar-bold")).toBeVisible();
    await expect(page.getByTestId("toolbar-table")).toBeVisible();
  });
});
