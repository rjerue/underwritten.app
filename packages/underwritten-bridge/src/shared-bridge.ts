import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { open, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import { underwrittenBridgePortRange } from "underwritten-bridge-contract";

import { startUnderwrittenBridge } from "./index.js";
import type { ToolName } from "./service.js";

type BridgeRegistryRecord = {
  createdAt: number;
  pid: number | null;
  port: number;
};

type BridgeLeaseRecord = {
  expiresAt: number;
  pid: number;
};

export type BridgeConnection = {
  port: number;
};

export type SharedBridgeLease = {
  close: () => Promise<void>;
  leaseId: string;
  port: number;
};

export type UnderwrittenBridgeToolClient = {
  callTool: (name: ToolName, args: Record<string, unknown>) => Promise<unknown>;
};

const bridgeHealthTimeoutMs = 1_000;
const bridgeStartupTimeoutMs = 10_000;
const bridgeCommandTimeoutMs = 30_000;
const bridgeLeaseTtlMs = 15_000;
const bridgeLeaseHeartbeatMs = 5_000;
const bridgeLockStaleMs = 15_000;
const bridgeLockRetryMs = 150;
const bridgeIdleTimeoutMs = 60_000;
const bridgeIdleCheckIntervalMs = 10_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBridgeInstanceKey(explicitPort?: number) {
  return typeof explicitPort === "number" ? `port-${explicitPort}` : "default";
}

function getBridgeRegistryPath(explicitPort?: number) {
  return join(tmpdir(), `underwritten-bridge-${getBridgeInstanceKey(explicitPort)}.json`);
}

function getBridgeLockPath(explicitPort?: number) {
  return join(tmpdir(), `underwritten-bridge-${getBridgeInstanceKey(explicitPort)}.lock`);
}

function getBridgeLeaseFilename(instanceKey: string, leaseId: string) {
  return `underwritten-bridge-${instanceKey}-lease-${leaseId}.json`;
}

function getBridgeLeasePath(instanceKey: string, leaseId: string) {
  return join(tmpdir(), getBridgeLeaseFilename(instanceKey, leaseId));
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: any) {
    return error?.code === "EPERM";
  }
}

async function readJsonFile<T>(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

async function readRegistryRecord(explicitPort?: number) {
  const parsed = await readJsonFile<Partial<BridgeRegistryRecord>>(
    getBridgeRegistryPath(explicitPort),
  );
  if (!parsed || typeof parsed.port !== "number") {
    return null;
  }

  return {
    createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : 0,
    pid: typeof parsed.pid === "number" ? parsed.pid : null,
    port: parsed.port,
  } satisfies BridgeRegistryRecord;
}

async function writeRegistryRecord(
  record: {
    pid: number | null;
    port: number;
  },
  explicitPort?: number,
) {
  await writeFile(
    getBridgeRegistryPath(explicitPort),
    JSON.stringify(
      {
        createdAt: Date.now(),
        pid: record.pid,
        port: record.port,
      } satisfies BridgeRegistryRecord,
      null,
      2,
    ),
    "utf8",
  );
}

async function clearRegistryRecord(
  expected: {
    pid?: number | null;
    port?: number;
  },
  explicitPort?: number,
) {
  const current = await readRegistryRecord(explicitPort);
  if (!current) {
    return;
  }

  if (typeof expected.port === "number" && current.port !== expected.port) {
    return;
  }

  if (typeof expected.pid === "number" && current.pid !== expected.pid) {
    return;
  }

  await rm(getBridgeRegistryPath(explicitPort), { force: true });
}

async function probePort(port: number) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/cli/health`, {
      signal: AbortSignal.timeout(bridgeHealthTimeoutMs),
    });
    if (response.ok) {
      return { port } satisfies BridgeConnection;
    }
  } catch {
    // Ignore health probe failures.
  }

  return null;
}

async function probePortRange(range = underwrittenBridgePortRange) {
  for (let port = range.start; port <= range.end; port += 1) {
    const existing = await probePort(port);
    if (existing) {
      return existing;
    }
  }

  return null;
}

async function readLockRecord(explicitPort?: number) {
  const parsed = await readJsonFile<{ createdAt?: unknown; pid?: unknown }>(
    getBridgeLockPath(explicitPort),
  );
  if (!parsed || typeof parsed.createdAt !== "number" || typeof parsed.pid !== "number") {
    return null;
  }

  return {
    createdAt: parsed.createdAt,
    pid: parsed.pid,
  };
}

async function acquireBridgeStartupLock(explicitPort?: number, timeoutMs = bridgeStartupTimeoutMs) {
  const lockPath = getBridgeLockPath(explicitPort);
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(
          JSON.stringify({
            createdAt: Date.now(),
            pid: process.pid,
          }),
          "utf8",
        );
      } finally {
        await handle.close();
      }

      return async () => {
        await rm(lockPath, { force: true });
      };
    } catch (error: any) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      const existing = await readLockRecord(explicitPort);
      if (
        !existing ||
        Date.now() - existing.createdAt > bridgeLockStaleMs ||
        !isProcessAlive(existing.pid)
      ) {
        await rm(lockPath, { force: true });
        continue;
      }

      await sleep(bridgeLockRetryMs);
    }
  }

  throw new Error("Timed out waiting for the shared Underwritten bridge startup lock.");
}

function getDaemonEntrypoint() {
  const currentFilePath = fileURLToPath(import.meta.url);
  const daemonFilename = currentFilePath.endsWith(".ts") ? "daemon.ts" : "daemon.js";

  return fileURLToPath(new URL(`./${daemonFilename}`, import.meta.url));
}

async function spawnSharedBridgeDaemon(explicitPort?: number) {
  const child = spawn(process.execPath, [...process.execArgv, getDaemonEntrypoint()], {
    detached: true,
    env: {
      ...process.env,
      UNDERWRITTEN_BRIDGE_PORT: explicitPort?.toString(),
    },
    stdio: "ignore",
    windowsHide: true,
  });

  child.unref();
}

async function waitForSharedBridge(explicitPort?: number, timeoutMs = bridgeStartupTimeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const existing = await probeSharedBridge(explicitPort);
    if (existing) {
      return existing;
    }

    await sleep(250);
  }

  throw new Error("Failed to start the shared Underwritten bridge daemon.");
}

function isRetryableNetworkError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as Error & { cause?: { code?: string } }).cause?.code;
  return code === "ECONNREFUSED" || code === "ECONNRESET" || code === "UND_ERR_SOCKET";
}

async function requestBridgeCommand(port: number, name: ToolName, args: Record<string, unknown>) {
  const response = await fetch(`http://127.0.0.1:${port}/cli/execute`, {
    body: JSON.stringify({ args, name }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });

  if (response.ok) {
    return await response.json();
  }

  const errorPayload = (await response.json().catch(() => null)) as {
    error?: {
      code?: string;
      message?: string;
    };
  } | null;

  const error = new Error(
    errorPayload?.error?.message || `Bridge command failed: ${name}`,
  ) as Error & { code?: string };
  error.code = errorPayload?.error?.code;
  throw error;
}

async function readLeaseRecord(path: string) {
  const parsed = await readJsonFile<Partial<BridgeLeaseRecord>>(path);
  if (!parsed || typeof parsed.expiresAt !== "number" || typeof parsed.pid !== "number") {
    return null;
  }

  return {
    expiresAt: parsed.expiresAt,
    pid: parsed.pid,
  } satisfies BridgeLeaseRecord;
}

async function listLiveLeasePaths(explicitPort?: number) {
  const instanceKey = getBridgeInstanceKey(explicitPort);
  const leasePrefix = `underwritten-bridge-${instanceKey}-lease-`;
  const names = await readdir(tmpdir()).catch(() => []);
  const now = Date.now();
  const liveLeasePaths: string[] = [];

  for (const name of names) {
    if (!name.startsWith(leasePrefix) || !name.endsWith(".json")) {
      continue;
    }

    const path = join(tmpdir(), name);
    const lease = await readLeaseRecord(path);
    if (!lease || lease.expiresAt <= now || !isProcessAlive(lease.pid)) {
      await rm(path, { force: true });
      continue;
    }

    liveLeasePaths.push(path);
  }

  return liveLeasePaths;
}

async function hasLiveLease(explicitPort?: number) {
  return (await listLiveLeasePaths(explicitPort)).length > 0;
}

async function writeLeaseRecord(path: string, ttlMs: number) {
  await writeFile(
    path,
    JSON.stringify(
      {
        expiresAt: Date.now() + ttlMs,
        pid: process.pid,
      } satisfies BridgeLeaseRecord,
      null,
      2,
    ),
    "utf8",
  );
}

export async function probeSharedBridge(explicitPort?: number) {
  if (typeof explicitPort === "number") {
    return await probePort(explicitPort);
  }

  const registry = await readRegistryRecord();
  if (registry) {
    const healthy = await probePort(registry.port);
    if (healthy) {
      return healthy;
    }

    if (registry.pid === null || !isProcessAlive(registry.pid)) {
      await clearRegistryRecord({ pid: registry.pid, port: registry.port });
    }
  }

  const fallback = await probePortRange();
  if (fallback) {
    await writeRegistryRecord({ pid: null, port: fallback.port });
    return fallback;
  }

  return null;
}

export async function ensureSharedBridge(options?: { port?: number; startupTimeoutMs?: number }) {
  const explicitPort = options?.port;
  const startupTimeoutMs = options?.startupTimeoutMs ?? bridgeStartupTimeoutMs;
  const existing = await probeSharedBridge(explicitPort);
  if (existing) {
    return existing;
  }

  const releaseLock = await acquireBridgeStartupLock(explicitPort, startupTimeoutMs);

  try {
    const rechecked = await probeSharedBridge(explicitPort);
    if (rechecked) {
      return rechecked;
    }

    await spawnSharedBridgeDaemon(explicitPort);
    return await waitForSharedBridge(explicitPort, startupTimeoutMs);
  } finally {
    await releaseLock();
  }
}

export async function acquireSharedBridgeLease(options?: {
  heartbeatIntervalMs?: number;
  port?: number;
  startupTimeoutMs?: number;
  ttlMs?: number;
}) {
  const ttlMs = options?.ttlMs ?? bridgeLeaseTtlMs;
  const heartbeatIntervalMs = options?.heartbeatIntervalMs ?? bridgeLeaseHeartbeatMs;
  const explicitPort = options?.port;
  const instanceKey = getBridgeInstanceKey(explicitPort);
  const leaseId = randomUUID();
  const leasePath = getBridgeLeasePath(instanceKey, leaseId);
  const { port } = await ensureSharedBridge({
    port: explicitPort,
    startupTimeoutMs: options?.startupTimeoutMs,
  });

  await writeLeaseRecord(leasePath, ttlMs);

  const heartbeat = setInterval(() => {
    void writeLeaseRecord(leasePath, ttlMs);
  }, heartbeatIntervalMs);
  heartbeat.unref();

  let isClosed = false;

  return {
    close: async () => {
      if (isClosed) {
        return;
      }

      isClosed = true;
      clearInterval(heartbeat);
      await rm(leasePath, { force: true });
    },
    leaseId,
    port,
  } satisfies SharedBridgeLease;
}

export async function executeSharedBridgeTool(
  name: ToolName,
  args: Record<string, unknown> = {},
  options?: {
    port?: number;
    startupTimeoutMs?: number;
    timeoutMs?: number;
  },
) {
  const start = Date.now();
  const timeoutMs = options?.timeoutMs ?? bridgeCommandTimeoutMs;

  while (true) {
    const { port } = await ensureSharedBridge({
      port: options?.port,
      startupTimeoutMs: options?.startupTimeoutMs,
    });

    try {
      return await requestBridgeCommand(port, name, args);
    } catch (error: any) {
      const elapsed = Date.now() - start;
      if (error?.code === "NO_LIVE_SESSION" && elapsed < timeoutMs) {
        await sleep(1_000);
        continue;
      }

      if (isRetryableNetworkError(error) && elapsed < timeoutMs) {
        await sleep(250);
        continue;
      }

      throw error;
    }
  }
}

export class SharedUnderwrittenBridgeClient implements UnderwrittenBridgeToolClient {
  constructor(
    private readonly options?: {
      port?: number;
      startupTimeoutMs?: number;
      timeoutMs?: number;
    },
  ) {}

  async callTool(name: ToolName, args: Record<string, unknown>) {
    return await executeSharedBridgeTool(name, args, this.options);
  }
}

export async function runSharedBridgeDaemon(options?: {
  idleCheckIntervalMs?: number;
  idleTimeoutMs?: number;
  port?: number;
  portRange?: { end: number; start: number };
}) {
  const startedBridge = await startUnderwrittenBridge({
    port: options?.port,
    portRange: options?.port ? undefined : (options?.portRange ?? underwrittenBridgePortRange),
  });
  const explicitPort = options?.port;
  const idleTimeoutMs = options?.idleTimeoutMs ?? bridgeIdleTimeoutMs;
  const idleCheckIntervalMs = options?.idleCheckIntervalMs ?? bridgeIdleCheckIntervalMs;

  await writeRegistryRecord({ pid: process.pid, port: startedBridge.port }, explicitPort);

  let isClosing = false;
  const shutdown = async () => {
    if (isClosing) {
      return;
    }

    isClosing = true;
    clearInterval(idleInterval);

    await startedBridge.close();
    await clearRegistryRecord({ pid: process.pid, port: startedBridge.port }, explicitPort);
    process.exit(0);
  };

  const idleInterval = setInterval(() => {
    void (async () => {
      if (startedBridge.service.hasLiveSession()) {
        return;
      }

      if (await hasLiveLease(explicitPort)) {
        return;
      }

      if (Date.now() - startedBridge.service.getLastActivityAt() < idleTimeoutMs) {
        return;
      }

      await shutdown();
    })();
  }, idleCheckIntervalMs);
  idleInterval.unref();

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

export function listSharedBridgeLeaseDebugFiles(explicitPort?: number) {
  return listLiveLeasePaths(explicitPort).then((paths) => paths.map((path) => basename(path)));
}
