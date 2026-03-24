import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  createSessionId,
  type BridgeSessionState,
  type UnderwrittenBridgeAction,
  type UnderwrittenBridgeActionResult,
  underwrittenBridgePollIntervalMs,
  underwrittenBridgePortRange,
  type UnderwrittenBridgeStatusResponse,
} from "underwritten-bridge-contract";

import { Heartbeat } from "./heartbeat";

type BridgeConnectionState = "connected" | "error" | "paired" | "reachable";

type BridgeConnection = {
  bridgeId: string;
  browserToken: string | null;
  error: string | null;
  port: number;
  state: BridgeConnectionState;
  status: UnderwrittenBridgeStatusResponse | null;
};

export type BridgePanelState = {
  configSnippet: string;
  currentSessionId: string;
  enabled: boolean;
  errorMessage: string | null;
  primaryPort: number | null;
  state: "connected" | "disabled" | "reachable" | "unreachable";
  statusLabel: string;
};

type UseUnderwrittenBridgeOptions = {
  applyAction: (action: UnderwrittenBridgeAction) => Promise<unknown>;
  enabled: boolean;
  getSessionState: (context: {
    lastFocusAt: number | null;
    lastHeartbeatAt: number;
    sessionId: string;
  }) => BridgeSessionState;
};

const bridgeConfigSnippet = JSON.stringify(
  {
    mcpServers: {
      underwritten: {
        args: ["-y", "underwritten-mcp"],
        command: "npx",
      },
    },
  },
  null,
  2,
);

const bridgePortOverrideStorageKey = "underwritten.mcp.bridgePorts";

async function fetchWithTimeout(input: URL | string, init?: RequestInit, timeoutMs = 350) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function toActionFailure(actionId: string, error: unknown): UnderwrittenBridgeActionResult {
  const message = error instanceof Error ? error.message : "Unexpected bridge action failure.";

  return {
    actionId,
    error: {
      code: "ACTION_FAILED",
      message,
    },
    ok: false,
  };
}

function getBridgeDiscoveryPorts() {
  try {
    const storedOverride = window.localStorage.getItem(bridgePortOverrideStorageKey);
    if (!storedOverride) {
      return Array.from(
        { length: underwrittenBridgePortRange.end - underwrittenBridgePortRange.start + 1 },
        (_, index) => underwrittenBridgePortRange.start + index,
      );
    }

    const parsed = JSON.parse(storedOverride) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return [...new Set(parsed)]
      .map((value) => (typeof value === "number" ? value : Number.NaN))
      .filter((value) => Number.isInteger(value) && value > 0);
  } catch {
    return [];
  }
}

export function useUnderwrittenBridge({
  applyAction,
  enabled,
  getSessionState,
}: UseUnderwrittenBridgeOptions) {
  const sessionIdRef = useRef(createSessionId());
  const connectionsRef = useRef<BridgeConnection[]>([]);
  const lastFocusAtRef = useRef<number | null>(
    typeof document !== "undefined" && document.hasFocus() ? Date.now() : null,
  );
  const applyActionRef = useRef(applyAction);
  const getSessionStateRef = useRef(getSessionState);
  const syncingPortsRef = useRef<Set<number>>(new Set());
  const [connections, setConnections] = useState<BridgeConnection[]>([]);
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    applyActionRef.current = applyAction;
  }, [applyAction]);

  useEffect(() => {
    getSessionStateRef.current = getSessionState;
  }, [getSessionState]);

  useEffect(() => {
    connectionsRef.current = connections;
  }, [connections]);

  useEffect(() => {
    const handleFocus = () => {
      lastFocusAtRef.current = Date.now();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        lastFocusAtRef.current = Date.now();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const buildSession = useCallback(() => {
    return getSessionStateRef.current({
      lastFocusAt: lastFocusAtRef.current,
      lastHeartbeatAt: Date.now(),
      sessionId: sessionIdRef.current,
    });
  }, []);

  const disconnectConnections = useCallback(async (activeConnections: BridgeConnection[]) => {
    await Promise.all(
      activeConnections.map(async (connection) => {
        if (!connection.browserToken) {
          return;
        }

        try {
          await fetch(`http://127.0.0.1:${connection.port}/session/disconnect`, {
            body: JSON.stringify({
              sessionId: sessionIdRef.current,
            }),
            headers: {
              Authorization: `Bearer ${connection.browserToken}`,
              "Content-Type": "application/json",
            },
            method: "POST",
          });
        } catch {
          // Ignore disconnect failures while tearing down bridge state.
        }
      }),
    );
  }, []);

  const pairBridge = useCallback(async (port: number, bridgeId: string) => {
    const response = await fetchWithTimeout(`http://127.0.0.1:${port}/pair`, {
      body: JSON.stringify({
        pageUrl: window.location.href,
        sessionId: sessionIdRef.current,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    if (!response.ok) {
      throw new Error(`Pairing failed with bridge on port ${port}.`);
    }

    const payload = (await response.json()) as { browserToken: string };

    return {
      bridgeId,
      browserToken: payload.browserToken,
      error: null,
      port,
      state: "paired" as const,
      status: null,
    };
  }, []);

  const fetchStatus = useCallback(async (connection: BridgeConnection) => {
    if (!connection.browserToken) {
      return connection;
    }

    try {
      const response = await fetchWithTimeout(`http://127.0.0.1:${connection.port}/status`, {
        headers: {
          Authorization: `Bearer ${connection.browserToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Status request failed for bridge on port ${connection.port}.`);
      }

      const status = (await response.json()) as UnderwrittenBridgeStatusResponse;
      return {
        ...connection,
        state: "connected" as const,
        status,
      };
    } catch (error) {
      return {
        ...connection,
        error: error instanceof Error ? error.message : "Unable to read bridge status.",
        state: "error" as const,
      };
    }
  }, []);

  const discoverBridges = useCallback(async () => {
    if (!enabled) {
      return;
    }

    const probes = getBridgeDiscoveryPorts();

    const discoveries = await Promise.all(
      probes.map(async (port) => {
        try {
          const response = await fetchWithTimeout(`http://127.0.0.1:${port}/discover`);
          if (!response.ok) {
            return null;
          }

          const payload = (await response.json()) as { bridgeId: string };
          return {
            bridgeId: payload.bridgeId,
            port,
          };
        } catch {
          return null;
        }
      }),
    );

    const knownByPort = new Map(
      connectionsRef.current.map((connection) => [connection.port, connection]),
    );
    const nextConnections: BridgeConnection[] = [];

    for (const discovery of discoveries) {
      if (!discovery) {
        continue;
      }

      const existing = knownByPort.get(discovery.port);
      if (existing && existing.bridgeId === discovery.bridgeId) {
        nextConnections.push(await fetchStatus(existing));
        continue;
      }

      try {
        const paired = await pairBridge(discovery.port, discovery.bridgeId);
        nextConnections.push(await fetchStatus(paired));
      } catch (error) {
        nextConnections.push({
          bridgeId: discovery.bridgeId,
          browserToken: null,
          error: error instanceof Error ? error.message : "Pairing failed.",
          port: discovery.port,
          state: "error",
          status: null,
        });
      }
    }

    setConnections(nextConnections.sort((left, right) => left.port - right.port));
  }, [enabled, fetchStatus, pairBridge]);

  const syncConnection = useCallback(
    async (connection: BridgeConnection) => {
      if (!connection.browserToken || syncingPortsRef.current.has(connection.port)) {
        return;
      }

      syncingPortsRef.current.add(connection.port);

      try {
        const response = await fetchWithTimeout(
          `http://127.0.0.1:${connection.port}/session/sync`,
          {
            body: JSON.stringify({
              session: buildSession(),
            }),
            headers: {
              Authorization: `Bearer ${connection.browserToken}`,
              "Content-Type": "application/json",
            },
            method: "POST",
          },
          1_000,
        );

        if (!response.ok) {
          throw new Error(`Bridge sync failed on port ${connection.port}.`);
        }

        const payload = (await response.json()) as {
          pendingActions: UnderwrittenBridgeAction[];
        };

        if (payload.pendingActions.length > 0) {
          const completedActions: UnderwrittenBridgeActionResult[] = [];

          for (const action of payload.pendingActions) {
            try {
              completedActions.push({
                actionId: action.id,
                ok: true,
                result: await applyActionRef.current(action),
              });
            } catch (error) {
              completedActions.push(toActionFailure(action.id, error));
            }
          }

          await fetchWithTimeout(
            `http://127.0.0.1:${connection.port}/session/sync`,
            {
              body: JSON.stringify({
                completedActions,
                session: buildSession(),
              }),
              headers: {
                Authorization: `Bearer ${connection.browserToken}`,
                "Content-Type": "application/json",
              },
              method: "POST",
            },
            1_000,
          );
        }
      } catch (error) {
        setConnections((previous) =>
          previous.map((current) =>
            current.port === connection.port
              ? {
                  ...current,
                  error:
                    error instanceof Error ? error.message : "Bridge sync failed unexpectedly.",
                  state: "error",
                }
              : current,
          ),
        );
      } finally {
        syncingPortsRef.current.delete(connection.port);
      }
    },
    [buildSession],
  );

  useEffect(() => {
    if (!enabled) {
      setConnections([]);
      return;
    }

    void discoverBridges();
  }, [discoverBridges, enabled, refreshNonce]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const heartbeat = new Heartbeat(underwrittenBridgePollIntervalMs);
    let tickCount = 0;

    heartbeat.addCallback(() => {
      // 1. Discovery (every 5 seconds, and on the first tick)
      if (tickCount % Math.max(1, 5000 / underwrittenBridgePollIntervalMs) === 0) {
        void discoverBridges();
      }
      tickCount++;

      // 2. Sync (every second)
      for (const connection of connectionsRef.current) {
        if (connection.browserToken) {
          void syncConnection(connection);
        }
      }
    });

    heartbeat.start();

    return () => {
      heartbeat.stop();
    };
  }, [discoverBridges, enabled, syncConnection]);

  useEffect(() => {
    if (enabled) {
      return;
    }

    const activeConnections = connectionsRef.current;
    connectionsRef.current = [];
    setConnections([]);
    void disconnectConnections(activeConnections);
  }, [disconnectConnections, enabled]);

  useEffect(() => {
    return () => {
      for (const connection of connectionsRef.current) {
        if (!connection.browserToken) {
          continue;
        }

        void fetch(`http://127.0.0.1:${connection.port}/session/disconnect`, {
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
          }),
          headers: {
            Authorization: `Bearer ${connection.browserToken}`,
            "Content-Type": "application/json",
          },
          keepalive: true,
          method: "POST",
        }).catch(() => {});
      }
    };
  }, []);

  const refresh = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);

  const panel = useMemo<BridgePanelState>(() => {
    const connected = connections.filter((connection) => connection.state === "connected");
    const paired = connections.filter((connection) => connection.state !== "error");
    const primary = connected[0] ?? paired[0] ?? null;

    return {
      configSnippet: bridgeConfigSnippet,
      currentSessionId: sessionIdRef.current,
      enabled,
      errorMessage: connections.find((connection) => connection.error)?.error ?? null,
      primaryPort: primary?.port ?? null,
      state: !enabled
        ? "disabled"
        : connected.length > 0
          ? "connected"
          : connections.length > 0
            ? "reachable"
            : "unreachable",
      statusLabel: !enabled
        ? "MCP integration is turned off"
        : connected.length > 0
          ? "Connected to local bridge"
          : connections.length > 0
            ? "Local bridge detected but not paired"
            : "Local bridge not detected",
    };
  }, [connections, enabled]);

  return {
    connections,
    panel,
    refresh,
  };
}
