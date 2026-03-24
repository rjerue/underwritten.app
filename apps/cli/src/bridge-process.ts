import { ensureSharedBridge, probeSharedBridge } from "underwritten-bridge";

export async function probeBridge(explicitPort?: number) {
  return await probeSharedBridge(explicitPort);
}

export async function ensureBridge(explicitPort?: number, _entrypointOverride?: string) {
  return await ensureSharedBridge({
    port: explicitPort,
  });
}
