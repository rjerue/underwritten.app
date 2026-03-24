import {
  startUnderwrittenBridge,
  type StartedUnderwrittenBridge,
  UnderwrittenBridgeError,
  UnderwrittenBridgeService,
} from "underwritten-bridge";

import { connectMcpServer } from "./mcp-server.js";

export { UnderwrittenBridgeError, UnderwrittenBridgeService };

export type StartedUnderwrittenMcpBridge = StartedUnderwrittenBridge;

export async function startUnderwrittenMcp(options?: {
  port?: number;
  portRange?: { end: number; start: number };
}): Promise<StartedUnderwrittenMcpBridge> {
  const bridge = await startUnderwrittenBridge(options);

  await connectMcpServer(bridge.service);

  return bridge;
}
