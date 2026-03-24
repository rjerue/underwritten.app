import { exec } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test, type Page } from "@playwright/test";
import { startUnderwrittenBridge, type StartedUnderwrittenBridge } from "underwritten-bridge";
import { underwrittenBridgePortRange } from "underwritten-bridge-contract";
import { createDraft, gotoEditor, rawMode } from "./helpers";

const execAsync = promisify(exec);

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

test.describe("CLI to UI integration", () => {
  let bridge: StartedUnderwrittenBridge;
  const cliPath = join(process.cwd(), "..", "..", "apps", "cli", "dist", "cli.js");

  test.beforeEach(async () => {
    // Pick a port in the standard range
    bridge = await startUnderwrittenBridge({
      portRange: underwrittenBridgePortRange,
    });
  });

  test.afterEach(async () => {
    if (bridge) {
      await bridge.close();
    }
  });

  test("CLI command triggers update in Underwritten UI", async ({ page }) => {
    // 1. Setup website and enable bridge
    await setBridgePortOverride(page, bridge.port);
    await gotoEditor(page, createDraft(["Original text"], { title: "CLI Test" }));
    await waitForBridgeUi(page);
    await page.keyboard.press("Escape");

    // 2. Run the actual CLI binary to replace document content
    const newText = "# Hello from CLI";

    // We might need to retry because the pairing session takes a moment to become "live" in the service
    await expect
      .poll(
        async () => {
          try {
            await execAsync(`node "${cliPath}" document replace "${newText}"`, {
              env: {
                ...process.env,
                NODE_ENV: "test",
                UNDERWRITTEN_BRIDGE_PORT: bridge.port.toString(),
              },
            });
            return true;
          } catch (e: any) {
            return e.message;
          }
        },
        {
          timeout: 10_000,
          intervals: [1000],
        },
      )
      .toBe(true);

    // 3. Verify UI reflects the change
    await page.getByTestId("mode-raw").click();
    await expect(rawMode(page)).toHaveValue(newText);

    // 4. Verify CLI 'document get' returns correct data
    const { stdout } = await execAsync(`node "${cliPath}" document get`, {
      env: {
        ...process.env,
        NODE_ENV: "test",
        UNDERWRITTEN_BRIDGE_PORT: bridge.port.toString(),
      },
    });
    const result = JSON.parse(stdout);
    expect(result.markdown).toBe(newText);
    expect(result.title).toBe("CLI Test");
  });
});
