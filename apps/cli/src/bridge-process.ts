import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { underwrittenBridgePortRange } from "underwritten-bridge-contract";

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function probeBridge(explicitPort?: number) {
  const ports = explicitPort
    ? [explicitPort]
    : Array.from(
        { length: underwrittenBridgePortRange.end - underwrittenBridgePortRange.start + 1 },
        (_, i) => underwrittenBridgePortRange.start + i,
      );

  for (const port of ports) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/cli/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        return { port };
      }
    } catch {
      // Ignore
    }
  }

  return null;
}

export async function ensureBridge(explicitPort?: number, entrypointOverride?: string) {
  const existing = await probeBridge(explicitPort);
  if (existing) {
    return existing;
  }

  const dirname = fileURLToPath(new URL(".", import.meta.url));
  const entrypoint = entrypointOverride ?? join(dirname, "cli.js");
  const child = spawn(process.execPath, [entrypoint, "__bridge"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      UNDERWRITTEN_BRIDGE_PORT: explicitPort?.toString(),
    },
  });

  child.unref();

  // Wait for bridge to become healthy
  const start = Date.now();
  const timeout = 10_000;
  while (Date.now() - start < timeout) {
    const health = await probeBridge(explicitPort);
    if (health) {
      return health;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error("Failed to start Underwritten bridge daemon.");
}
