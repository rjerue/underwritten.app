import { expect, test, type Page } from "@playwright/test";

import {
  clickEditorBottom,
  createDraft,
  createTable,
  editor,
  gotoEditor,
  rawMode,
  readMode,
  setCaretInEditorText,
} from "./helpers";

async function moveLeftUntil(page: Page, predicate: () => Promise<boolean>) {
  for (let index = 0; index < 30; index += 1) {
    if (await predicate()) return;
    await page.keyboard.press("ArrowLeft");
  }
}

async function setInputCaret(page: Page, testId: string, edge: "start" | "end") {
  await page.getByTestId(testId).evaluate((node, targetEdge) => {
    if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return;

    const offset = targetEdge === "start" ? 0 : node.value.length;
    node.focus();
    node.setSelectionRange(offset, offset);
  }, edge);
}

test.describe("table workflows", () => {
  test("creates, edits, and renders tables across modes", async ({ page }) => {
    await gotoEditor(page, createDraft([""]));

    await editor(page).click();
    await createTable(page, "3x2");

    await expect(page.getByTestId("header-cell-1")).toBeFocused();
    await page.getByTestId("header-cell-1").fill("Name");
    await page.getByTestId("header-cell-2").fill("Role");
    await page.getByTestId("body-cell-1-1").fill("Ada");
    await page.getByTestId("body-cell-1-2").fill("Writer");
    await page.getByTestId("body-cell-2-1").fill("Linus");
    await page.getByTestId("body-cell-2-2").fill("Editor");

    await page.getByTestId("add-column").click();
    await expect(page.getByTestId("header-cell-3")).toBeVisible();
    await page.getByTestId("header-cell-3").fill("Team");
    await page.getByTestId("remove-column-3").click();
    await expect(page.getByTestId("header-cell-3")).toHaveCount(0);

    await page.getByTestId("add-row").click();
    await expect(page.getByTestId("body-cell-3-1")).toBeVisible();
    await page.getByTestId("body-cell-3-1").fill("Grace");
    await page.getByTestId("remove-row-3").click();
    await expect(page.getByTestId("body-cell-3-1")).toHaveCount(0);

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(/\| Name \| Role \|/);
    await expect(rawMode(page)).toHaveValue(/\| Ada \| Writer \|/);
    await expect(rawMode(page)).toHaveValue(/\| Linus \| Editor \|/);
    await expect(rawMode(page)).not.toHaveValue(/\[TABLE:/);

    await page.getByTestId("mode-read").click();
    await expect(readMode(page).locator("table")).toBeVisible();
    await expect(readMode(page)).toContainText("Ada");
    await expect(readMode(page)).toContainText("Linus");
  });

  test("keeps focus stable when moving between outside text and table inputs", async ({ page }) => {
    await gotoEditor(page, createDraft(["before text"]));

    await editor(page).click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await createTable(page, "3x2");

    await page.getByTestId("header-cell-1").fill("");
    await page.getByTestId("header-cell-2").fill("");

    await page.getByTestId("body-cell-1-1").click();
    await expect(page.getByTestId("body-cell-1-1")).toBeFocused();
    await page.getByTestId("body-cell-1-1").fill("inside");
    await expect(page.getByTestId("body-cell-1-1")).toBeFocused();

    await setCaretInEditorText(page, "before text", "end");
    await page.getByTestId("body-cell-1-1").click();
    await page.keyboard.type(" table");
    await expect(page.getByTestId("body-cell-1-1")).toHaveValue("inside table");
    await expect(page.getByTestId("body-cell-1-1")).toBeFocused();

    await page.getByTestId("body-cell-1-1").fill("");

    await clickEditorBottom(page);
    await page.keyboard.type("after text");

    const lastBodyCell = page.getByTestId("body-cell-2-2");
    await moveLeftUntil(
      page,
      async () => await lastBodyCell.evaluate((node) => node === document.activeElement),
    );
    await expect(page.getByTestId("body-cell-2-2")).toBeFocused();

    const editorSurface = editor(page);
    await moveLeftUntil(
      page,
      async () => await editorSurface.evaluate((node) => node === document.activeElement),
    );
    await page.keyboard.type("!");
    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(/after text/);
    await expect(rawMode(page)).toHaveValue(/!/);
    await expect(rawMode(page)).not.toHaveValue(/\| ! \|/);
  });

  test("moves between table cells with Tab and Shift+Tab", async ({ page }) => {
    await gotoEditor(page, createDraft([""]));

    await editor(page).click();
    await createTable(page, "3x2");

    await expect(page.getByTestId("header-cell-1")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("header-cell-2")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("body-cell-1-1")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("header-cell-2")).toBeFocused();
  });

  test("adds a row when tabbing past the last table cell", async ({ page }) => {
    await gotoEditor(page, createDraft([""]));

    await editor(page).click();
    await createTable(page, "3x2");

    await page.getByTestId("body-cell-2-2").focus();
    await page.keyboard.press("Tab");

    await expect(page.getByTestId("body-cell-3-1")).toBeVisible();
    await page.getByTestId("body-cell-3-1").fill("created");
    await expect(page.getByTestId("body-cell-3-1")).toHaveValue("created");
  });

  test("creates a line before the table when exiting left with no preceding text", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft([""]));

    await editor(page).click();
    await createTable(page, "3x2");
    await page.getByTestId("header-cell-1").fill("");
    await page.getByTestId("header-cell-2").fill("");

    await clickEditorBottom(page);
    await page.keyboard.type("after text");
    await setCaretInEditorText(page, "after text", "start");

    for (let index = 0; index < 7; index += 1) {
      await page.keyboard.press("ArrowLeft");
    }

    await page.keyboard.type("new before");
    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(/new before/);
    await expect(rawMode(page)).toHaveValue(/\|  \|  \|/);
  });

  test("reopens saved markdown tables as tables instead of placeholder tokens", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill(
      "test\n\ntest\n\ntest\n\n| 1 | 2 |\n| --- | --- |\n| 1 | 2 |\n| 1 | 2 |",
    );

    page.once("dialog", async (dialog) => {
      expect(dialog.type()).toBe("prompt");
      await dialog.accept("table-reopen");
    });
    await page.getByTestId("sidebar-save").click({ button: "right" });

    await page.getByTestId("sidebar-new-file").click();
    await page.getByTestId("tree-entry-table-reopen.md").click();

    await page.getByTestId("mode-write").click();
    await expect(page.getByTestId("header-cell-1")).toHaveValue("1");
    await expect(page.getByTestId("header-cell-2")).toHaveValue("2");
    await expect(page.getByTestId("body-cell-1-1")).toHaveValue("1");
    await expect(page.getByTestId("body-cell-2-2")).toHaveValue("2");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(/\| 1 \| 2 \|/);
    await expect(rawMode(page)).not.toHaveValue(/\[TABLE:/);
  });

  test("starts a numbered list after an imported table instead of mutating the placeholder", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill("| Name | Role |\n| --- | --- |\n| Ada | Writer |");

    await page.getByTestId("mode-write").click();
    await setCaretInEditorText(page, "[TABLE:table-import-1]", "end");
    await page.getByTestId("toolbar-numbered-list").click();
    await page.keyboard.type("Next item");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(
      /\| Name \| Role \|\n\| --- \| --- \|\n\| Ada \| Writer \|\n1\. Next item/,
    );
    await expect(rawMode(page)).not.toHaveValue(/\[TABLE:/);
  });

  test("starts a list at text after consecutive imported tables", async ({ page }) => {
    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill(
      "testy test tes\n\n| Header 1 | Header 2 |\n| --- | --- |\n| 1 | 2 |\n| 3dfsdfsdf | 3 |\n\n| Header 1 |\n| --- |\n| yoyo |\nHERE",
    );

    await page.getByTestId("mode-write").click();
    await page.getByText("HERE").click();
    await page.keyboard.press("Home");
    await page.getByTestId("toolbar-numbered-list").click();

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(
      /testy test tes\n\n\| Header 1 \| Header 2 \|\n\| --- \| --- \|\n\| 1 \| 2 \|\n\| 3dfsdfsdf \| 3 \|\n\n\| Header 1 \|\n\| --- \|\n\| yoyo \|\n1\. HERE/,
    );
    await expect(rawMode(page)).not.toHaveValue(/\[TABLE:/);
  });

  test("does not add a second heading prefix after imported tables", async ({ page }) => {
    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill(
      "test\n| Header 1 | Header 2 |\n| --- | --- |\n|  |  |\n\n| Header 1 | Header 2 |\n| --- | --- |\n|  |  |\n|  |  |\n ## ## ",
    );

    await page.getByTestId("mode-write").click();
    await page.getByText(" ## ## ").click();
    await page.getByTestId("toolbar-heading").click();

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(
      "test\n| Header 1 | Header 2 |\n| --- | --- |\n|  |  |\n\n| Header 1 | Header 2 |\n| --- | --- |\n|  |  |\n|  |  |\n ## ## ",
    );
    await expect(rawMode(page)).not.toHaveValue(/\[TABLE:/);
  });

  test("lets me place the cursor after a trailing imported table", async ({ page }) => {
    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill("| Header 1 |\n| --- |\n| yoyo |");
    await expect(rawMode(page)).toHaveValue("| Header 1 |\n| --- |\n| yoyo |\n");

    await page.getByTestId("mode-write").click();
    await clickEditorBottom(page);
    await page.keyboard.type("after table");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue("| Header 1 |\n| --- |\n| yoyo |\nafter table");
    await expect(rawMode(page)).not.toHaveValue(/\[TABLE:/);
  });

  test("keeps a writable line after a trailing table even after backspacing it empty", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill("| Header 1 |\n| --- |\n| yoyo |");

    await page.getByTestId("mode-write").click();
    await clickEditorBottom(page);
    await page.keyboard.type("x");
    await page.keyboard.press("Backspace");

    await clickEditorBottom(page);
    await page.keyboard.type("after again");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue("| Header 1 |\n| --- |\n| yoyo |\nafter again");
    await expect(rawMode(page)).not.toHaveValue(/\[TABLE:/);
  });

  test("does not merge a heading line into an inserted table on backspace", async ({ page }) => {
    await gotoEditor(
      page,
      createDraft(["[TABLE:table-1]", "# Test"], {
        tables: [
          {
            data: [
              ["Header 1", "Header 2"],
              ["", ""],
              ["", ""],
            ],
            id: "table-1",
            position: 0,
          },
        ],
      }),
    );

    await setCaretInEditorText(page, "# Test", "start");
    await page.keyboard.press("Backspace");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(
      /\| Header 1 \| Header 2 \|\n\| --- \| --- \|\n\|  \|  \|\n\|  \|  \|\n# Test/,
    );
    await expect(rawMode(page)).not.toHaveValue(/\[TABLE:/);
  });

  test("moves right from text into the next imported table", async ({ page }) => {
    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill("test\n| Header 1 |\n| --- |\n|  |");

    await page.getByTestId("mode-write").click();
    await setCaretInEditorText(page, "test", "end");
    await page.keyboard.press("ArrowRight");

    await expect(page.getByTestId("header-cell-1")).toBeFocused();
  });

  test("moves right through a single-column table and exits after the last cell", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill("test\n| Header 1 |\n| --- |\n|  |");

    await page.getByTestId("mode-write").click();
    await setCaretInEditorText(page, "test", "end");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("header-cell-1")).toBeFocused();

    await setInputCaret(page, "header-cell-1", "end");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("body-cell-1-1")).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type("after right");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue("test\n| Header 1 |\n| --- |\n|  |\nafter right");
  });

  test("moves down through a single-column table and exits after the last cell", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill("test\n| Header 1 |\n| --- |\n|  |");

    await page.getByTestId("mode-write").click();
    await setCaretInEditorText(page, "test", "end");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("header-cell-1")).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(page.getByTestId("body-cell-1-1")).toBeFocused();

    await page.keyboard.press("ArrowDown");
    await expect(editor(page)).toBeFocused();
    await page.keyboard.type("after down");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue("test\n| Header 1 |\n| --- |\n|  |\nafter down");
  });

  test("only moves right to the next cell when the caret is at the end of header text", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill("test\n| Header 1 | Header 2 |\n| --- | --- |\n|  |  |");

    await page.getByTestId("mode-write").click();
    await setCaretInEditorText(page, "test", "end");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("header-cell-1")).toBeFocused();

    await setInputCaret(page, "header-cell-1", "start");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("header-cell-1")).toBeFocused();
    await expect
      .poll(async () =>
        page
          .getByTestId("header-cell-1")
          .evaluate((node) =>
            node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
              ? node.selectionStart
              : -1,
          ),
      )
      .toBe(1);

    await setInputCaret(page, "header-cell-1", "end");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("header-cell-2")).toBeFocused();

    await setInputCaret(page, "header-cell-2", "start");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("header-cell-2")).toBeFocused();
    await expect
      .poll(async () =>
        page
          .getByTestId("header-cell-2")
          .evaluate((node) =>
            node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement
              ? node.selectionStart
              : -1,
          ),
      )
      .toBe(1);

    await setInputCaret(page, "header-cell-2", "end");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("body-cell-1-1")).toBeFocused();
  });
});
