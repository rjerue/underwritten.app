import { expect, test, type Page } from "@playwright/test";

import { startUnderwrittenBridge, type StartedUnderwrittenBridge } from "underwritten-bridge";
import { createDraft, gotoEditor, rawMode } from "./helpers";

async function waitForBridgeSession(bridge: StartedUnderwrittenBridge) {
  return (await bridge.service.callTool("get_workspace_status", {})) as {
    activeFilePath: string | null;
    hasUnsavedChanges: boolean;
    storageMode: string;
  };
}

async function openBridgePanel(page: Page) {
  await page.getByTestId("open-settings").click();
  await page.getByTestId("settings-section-bridge").click();
}

async function setBridgePortOverride(page: Page, port: number) {
  await page.addInitScript((nextPort) => {
    window.localStorage.setItem("underwritten.mcp.bridgePorts", JSON.stringify([nextPort]));
  }, port);
}

async function waitForBridgeUi(page: Page) {
  await openBridgePanel(page);
  await page.getByTestId("mcp-enabled-toggle").click();
  await expect(page.getByText("Connected to local bridge")).toBeVisible({
    timeout: 15_000,
  });
}

test.describe("mcp bridge integration", () => {
  let bridge: StartedUnderwrittenBridge;

  test.beforeEach(async () => {
    bridge = await startUnderwrittenBridge({
      portRange: { end: 0, start: 0 },
    });
  });

  test.afterEach(async () => {
    await bridge.close();
  });

  test("discovers the localhost bridge, pairs automatically, and applies actions", async ({
    page,
  }) => {
    await setBridgePortOverride(page, bridge.port);
    await gotoEditor(page, createDraft(["Bridge test draft"], { title: "Bridge Draft" }));

    await waitForBridgeUi(page);
    await expect(page.getByText("Setup details live on the")).toBeVisible();
    await expect(page.getByRole("link", { name: "About page" })).toHaveAttribute("href", "/about");
    await page.keyboard.press("Escape");
    await expect
      .poll(async () => {
        try {
          return await waitForBridgeSession(bridge);
        } catch {
          return null;
        }
      })
      .toMatchObject({
        activeFilePath: null,
        storageMode: "origin-private",
      });

    await bridge.service.callTool("replace_current_document", {
      markdown: "# MCP Bridge\n\nUpdated from bridge",
    });

    await expect(page.getByTestId("bridge-update-flashbar")).toBeVisible();
    await expect(page.getByTestId("bridge-update-flashbar")).toContainText(
      "Document updated from the bridge.",
    );
    const bridgeFlashbarLayout = await page
      .getByTestId("bridge-update-flashbar")
      .evaluate((node) => {
        if (!(node instanceof HTMLElement)) return null;
        const rect = node.getBoundingClientRect();
        const style = window.getComputedStyle(node);

        return {
          bottomInset: Math.round(window.innerHeight - rect.bottom),
          position: style.position,
        };
      });
    expect(bridgeFlashbarLayout).toEqual({
      bottomInset: 0,
      position: "fixed",
    });

    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue("# MCP Bridge\n\nUpdated from bridge");

    await bridge.service.callTool("save_document", { path: "bridge-note" });
    await expect
      .poll(() => bridge.service.callTool("get_workspace_status", {}))
      .toMatchObject({
        activeFilePath: "bridge-note.md",
      });
    await expect
      .poll(() => bridge.service.callTool("list_files", { recursive: true }))
      .toMatchObject({
        paths: ["bridge-note.md"],
      });
  });

  test("routes current-document tools to the most recently focused tab", async ({ page }) => {
    await setBridgePortOverride(page, bridge.port);
    await gotoEditor(page, createDraft(["From page one"], { title: "Page One" }));
    const secondPage = await page.context().newPage();

    try {
      await waitForBridgeUi(page);
      await page.keyboard.press("Escape");
      await setBridgePortOverride(secondPage, bridge.port);
      await gotoEditor(secondPage, createDraft(["From page two"], { title: "Page Two" }));
      await waitForBridgeUi(secondPage);
      await secondPage.keyboard.press("Escape");

      await page.bringToFront();
      await page.getByTestId("editor-surface").click();

      await expect
        .poll(async () => {
          try {
            return await bridge.service.callTool("get_current_document", {});
          } catch {
            return null;
          }
        })
        .toMatchObject({
          title: "Page One",
        });

      await secondPage.bringToFront();
      await secondPage.getByTestId("editor-surface").click();

      await expect
        .poll(async () => {
          try {
            return await bridge.service.callTool("get_current_document", {});
          } catch {
            return null;
          }
        })
        .toMatchObject({
          title: "Page Two",
        });
    } finally {
      await secondPage.close();
    }
  });
});
