import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  underwrittenBridgeApiVersion,
  type UnderwrittenBridgeDisconnectRequest,
  type UnderwrittenBridgePairRequest,
  type UnderwrittenBridgeSessionSyncRequest,
} from "./contract.js";
import * as z from "zod/v4";

import {
  isAllowedUnderwrittenOrigin,
  type UnderwrittenBridgeService,
  UnderwrittenBridgeError,
} from "./service.js";

const pairRequestSchema = z.object({
  pageUrl: z.string().nullable().optional(),
  sessionId: z.string().min(1),
}) satisfies z.ZodType<UnderwrittenBridgePairRequest>;

const sessionStateSchema = z.object({
  activeFilePath: z.string().nullable(),
  appCapabilities: z.object({
    supportsDirectoryAccess: z.boolean(),
  }),
  dirty: z.boolean(),
  lastFocusAt: z.number().nullable(),
  lastHeartbeatAt: z.number(),
  markdown: z.string(),
  nativeFolderSelected: z.boolean(),
  pageUrl: z.string().nullable(),
  revision: z.string().nullable(),
  sessionId: z.string().min(1),
  storageMode: z.enum(["origin-private", "native-folder"]),
  title: z.string(),
  visibilityState: z.enum(["hidden", "visible"]),
  windowLabel: z.string().nullable(),
});

const actionResultSchema = z.discriminatedUnion("ok", [
  z.object({
    actionId: z.string(),
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    actionId: z.string(),
    error: z.object({
      code: z.string(),
      message: z.string(),
    }),
    ok: z.literal(false),
  }),
]);

const syncRequestSchema = z.object({
  completedActions: z.array(actionResultSchema).optional(),
  session: sessionStateSchema,
}) satisfies z.ZodType<UnderwrittenBridgeSessionSyncRequest>;

const disconnectRequestSchema = z.object({
  sessionId: z.string().min(1),
}) satisfies z.ZodType<UnderwrittenBridgeDisconnectRequest>;

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];

    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    request.on("error", reject);
  });
}

function getOrigin(request: IncomingMessage) {
  const origin = request.headers.origin;
  return typeof origin === "string" ? origin : null;
}

function getBearerToken(request: IncomingMessage) {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice("Bearer ".length).trim();
}

function setCors(response: ServerResponse, origin: string | null) {
  if (!origin || !isAllowedUnderwrittenOrigin(origin)) {
    return;
  }

  response.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Private-Network", "true");
  response.setHeader("Vary", "Origin");
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
  origin: string | null,
) {
  setCors(response, origin);
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function sendError(response: ServerResponse, error: unknown, origin: string | null) {
  if (error instanceof UnderwrittenBridgeError) {
    sendJson(
      response,
      error.statusCode,
      {
        error: {
          code: error.code,
          message: error.message,
        },
      },
      origin,
    );
    return;
  }

  const message = error instanceof Error ? error.message : "Unexpected bridge error.";
  sendJson(
    response,
    500,
    {
      error: {
        code: "INTERNAL_ERROR",
        message,
      },
    },
    origin,
  );
}

export async function createHttpServer(service: UnderwrittenBridgeService, port: number) {
  const server = createServer(async (request, response) => {
    const origin = getOrigin(request);
    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

    if (method === "OPTIONS") {
      setCors(response, origin);
      response.statusCode = 204;
      response.end();
      return;
    }

    try {
      if (method === "GET" && url.pathname === "/discover") {
        sendJson(
          response,
          200,
          {
            apiVersion: underwrittenBridgeApiVersion,
            appName: "underwritten",
            bridgeId: service.bridgeId,
            port,
          },
          origin,
        );
        return;
      }

      if (method === "POST" && url.pathname === "/pair") {
        if (!origin) {
          throw new UnderwrittenBridgeError("Missing Origin header.", "INVALID_ORIGIN", 403);
        }

        const body = pairRequestSchema.parse(JSON.parse(await readBody(request)));
        sendJson(response, 200, service.createPairing(origin, body), origin);
        return;
      }

      const token = getBearerToken(request);
      if (!token) {
        throw new UnderwrittenBridgeError(
          "A paired browser token is required.",
          "PAIRING_REQUIRED",
          401,
        );
      }

      if (!origin) {
        throw new UnderwrittenBridgeError("Missing Origin header.", "INVALID_ORIGIN", 403);
      }

      if (method === "POST" && url.pathname === "/session/sync") {
        const body = syncRequestSchema.parse(JSON.parse(await readBody(request)));
        sendJson(response, 200, service.syncSession(origin, token, body), origin);
        return;
      }

      if (method === "POST" && url.pathname === "/session/disconnect") {
        const body = disconnectRequestSchema.parse(JSON.parse(await readBody(request)));
        service.disconnectSession(origin, token, body.sessionId);
        sendJson(response, 200, { ok: true }, origin);
        return;
      }

      if (method === "GET" && url.pathname === "/status") {
        sendJson(response, 200, service.getStatus(origin, token), origin);
        return;
      }

      sendJson(
        response,
        404,
        {
          error: {
            code: "NOT_FOUND",
            message: `Unknown Underwritten bridge endpoint: ${url.pathname}`,
          },
        },
        origin,
      );
    } catch (error) {
      sendError(response, error, origin);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, "127.0.0.1", () => resolve());
    server.on("error", reject);
  });

  return server;
}
