import { expect, test, type Page } from "@playwright/test";

import { createDraft, editor, gotoEditor, rawMode, setCaretInEditorText } from "./helpers";

async function setCodeCaret(page: Page, edge: "start" | "end") {
  await page.getByTestId("code-block-input").evaluate((node, targetEdge) => {
    if (!(node instanceof HTMLTextAreaElement)) return;

    const offset = targetEdge === "start" ? 0 : node.value.length;
    node.focus();
    node.setSelectionRange(offset, offset);
  }, edge);
}

test.describe("code block workflows", () => {
  test("creates a code block from triple backticks and serializes the selected language", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft([""]));

    await editor(page).click();
    await page.keyboard.type("```");

    await expect(page.getByTestId("code-block-editor")).toBeVisible();
    await expect(page.getByTestId("code-block-input")).toBeFocused();

    await page.getByTestId("code-block-language").selectOption("jsx");
    await page.getByTestId("code-block-input").fill('console.log("yo")');

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue('```jsx\nconsole.log("yo")\n```\n');
  });

  test("reopens fenced markdown code blocks as embedded write-mode blocks", async ({ page }) => {
    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill('before\n```jsx\nconsole.log("yo")\n```\nafter');

    await page.getByTestId("mode-write").click();
    await expect(page.getByTestId("code-block-input")).toHaveValue('console.log("yo")');
    await expect(page.getByTestId("code-block-language")).toHaveValue("jsx");

    await setCaretInEditorText(page, "before", "end");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("code-block-input")).toBeFocused();

    await setCodeCaret(page, "end");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.type("!");

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue('before\n```jsx\nconsole.log("yo")\n```\n!after');
  });

  test("renders mermaid diagrams in read mode and supports preview in write mode", async ({
    page,
  }) => {
    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill("```mermaid\ngraph TD\nA[Start] --> B[Finish]\n```");

    await page.getByTestId("mode-write").click();
    await expect(page.getByTestId("code-block-language")).toHaveValue("mermaid");
    await expect(page.getByTestId("code-block-panel-preview")).toBeVisible();

    await page.getByTestId("code-block-panel-preview").click();
    await expect(page.locator('[data-testid="code-block-diagram-preview"] svg')).toBeVisible();

    await page.getByTestId("mode-read").click();
    await expect(
      page.locator(
        '[data-testid="read-mode-content"] [data-testid="code-block-diagram-preview"] svg',
      ),
    ).toBeVisible();

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue("```mermaid\ngraph TD\nA[Start] --> B[Finish]\n```\n");
  });

  test("keeps very wide mermaid previews horizontally scrollable instead of shrinking to fit", async ({
    page,
  }) => {
    const wideDiagram = `\`\`\`mermaid
graph LR
  A[Start] --> B[Collect Requirements]
  B --> C[Draft Proposal]
  C --> D[Internal Review]
  D --> E[Revise Scope]
  E --> F[Design Approval]
  F --> G[Implementation]
  G --> H[QA Pass]
  H --> I[Security Review]
  I --> J[Staging Deploy]
  J --> K[Stakeholder Review]
  K --> L[Production Release]
  L --> M[Postmortem]
\`\`\``;

    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill(wideDiagram);

    await page.getByTestId("mode-write").click();
    await page.getByTestId("code-block-panel-preview").click();
    await expect(page.locator('[data-testid="code-block-diagram-preview"] svg')).toBeVisible();

    const previewMetrics = await page.getByTestId("code-block-diagram-preview").evaluate((node) => {
      if (!(node instanceof HTMLElement)) {
        return null;
      }

      return {
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
      };
    });

    expect(previewMetrics).not.toBeNull();
    expect(previewMetrics?.scrollWidth ?? 0).toBeGreaterThan(previewMetrics?.clientWidth ?? 0);
  });

  test("renders PlantUML diagrams with a deflated preview URL in write and read mode", async ({
    page,
  }) => {
    const diagramMarkdown = "```plantuml\n@startuml\nAlice -> Bob: hi\n@enduml\n```";

    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill(diagramMarkdown);

    await page.getByTestId("mode-write").click();
    await expect(page.getByTestId("code-block-language")).toHaveValue("plantuml");
    await expect(page.getByTestId("code-block-panel-preview")).toBeVisible();

    await page.getByTestId("code-block-panel-preview").click();
    await expect(
      page.locator(
        '[data-testid="code-block-diagram-preview"] img[alt="PlantUML diagram preview"]',
      ),
    ).toBeVisible();

    await page.getByTestId("mode-read").click();
    await expect(
      page.locator(
        '[data-testid="read-mode-content"] [data-testid="code-block-diagram-preview"] img[alt="PlantUML diagram preview"]',
      ),
    ).toBeVisible();

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(`${diagramMarkdown}\n`);
  });

  test("renders LaTeX blocks in write preview and read mode", async ({ page }) => {
    const latexMarkdown = "```latex\n\\\\frac{-b \\\\pm \\\\sqrt{b^2 - 4ac}}{2a}\n```";

    await gotoEditor(page, createDraft([""]));

    await page.getByTestId("mode-raw").click();
    await rawMode(page).fill(latexMarkdown);

    await page.getByTestId("mode-write").click();
    await expect(page.getByTestId("code-block-language")).toHaveValue("latex");
    await expect(page.getByTestId("code-block-panel-preview")).toBeVisible();

    await page.getByTestId("code-block-panel-preview").click();
    await expect(
      page.locator('[data-testid="code-block-diagram-preview"] .katex-display'),
    ).toBeVisible();

    await page.getByTestId("mode-read").click();
    await expect(
      page.locator(
        '[data-testid="read-mode-content"] [data-testid="code-block-diagram-preview"] .katex-display',
      ),
    ).toBeVisible();

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(`${latexMarkdown}\n`);
  });

  test("deletes an empty code block with backspace", async ({ page }) => {
    await gotoEditor(page, createDraft([""]));

    await editor(page).click();
    await page.keyboard.type("```");
    await expect(page.getByTestId("code-block-input")).toBeFocused();

    await page.keyboard.press("Backspace");
    await expect(page.getByTestId("code-block-editor")).toHaveCount(0);

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue("");
  });
});
