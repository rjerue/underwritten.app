import { createServer, type Server as HttpServer } from "node:http";

import { createHttpServer } from "./http-server.js";
import { UnderwrittenBridgeService } from "./service.js";
export {
  acquireSharedBridgeLease,
  ensureSharedBridge,
  executeSharedBridgeTool,
  listSharedBridgeLeaseDebugFiles,
  probeSharedBridge,
  runSharedBridgeDaemon,
  SharedUnderwrittenBridgeClient,
  type BridgeConnection,
  type SharedBridgeLease,
  type UnderwrittenBridgeToolClient,
} from "./shared-bridge.js";

export {
  UnderwrittenBridgeError,
  UnderwrittenBridgeService,
  toActionResult,
  toCurrentDocument,
  toWorkspaceStatus,
} from "./service.js";

export type StartedUnderwrittenBridge = {
  close: () => Promise<void>;
  httpServer: HttpServer;
  port: number;
  service: UnderwrittenBridgeService;
};

async function listenOnPort(port: number) {
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", () => {
      const address = probe.address();
      const resolvedPort =
        address && typeof address === "object" && typeof address.port === "number"
          ? address.port
          : port;

      probe.close((error?: Error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(resolvedPort);
      });
    });
  });
}

export async function resolveBridgePort(range: { end: number; start: number }) {
  for (let port = range.start; port <= range.end; port += 1) {
    try {
      return await listenOnPort(port);
    } catch {}
  }

  throw new Error(
    `No free localhost port was available in the Underwritten bridge range ${range.start}-${range.end}.`,
  );
}

export async function startUnderwrittenBridge(options?: {
  port?: number;
  portRange?: { end: number; start: number };
}): Promise<StartedUnderwrittenBridge> {
  const service = new UnderwrittenBridgeService();
  const port =
    options?.port ?? (await resolveBridgePort(options?.portRange ?? { end: 45271, start: 45261 }));
  service.setPort(port);

  const httpServer = await createHttpServer(service, port);

  return {
    close: async () => {
      service.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error?: Error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    },
    httpServer,
    port,
    service,
  };
}
