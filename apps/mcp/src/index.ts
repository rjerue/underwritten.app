import {
  acquireSharedBridgeLease,
  SharedUnderwrittenBridgeClient,
  UnderwrittenBridgeError,
  type SharedBridgeLease,
} from "underwritten-bridge";

import { connectMcpServer } from "./mcp-server.js";

export { UnderwrittenBridgeError, SharedUnderwrittenBridgeClient };

export type StartedUnderwrittenMcpBridge = {
  close: () => Promise<void>;
  lease: SharedBridgeLease;
  port: number;
};

export async function startUnderwrittenMcp(options?: {
  port?: number;
}): Promise<StartedUnderwrittenMcpBridge> {
  const lease = await acquireSharedBridgeLease({
    port: options?.port,
  });
  const client = new SharedUnderwrittenBridgeClient({
    port: options?.port,
  });
  const server = await connectMcpServer(client);

  let isClosed = false;

  return {
    close: async () => {
      if (isClosed) {
        return;
      }

      isClosed = true;
      await server.close();
      await lease.close();
    },
    lease,
    port: lease.port,
  };
}
