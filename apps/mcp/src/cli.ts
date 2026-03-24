#!/usr/bin/env node

import { startUnderwrittenMcp } from "./index.js";

const explicitPort = process.env.UNDERWRITTEN_BRIDGE_PORT
  ? parseInt(process.env.UNDERWRITTEN_BRIDGE_PORT, 10)
  : undefined;

const startedBridge = await startUnderwrittenMcp({
  port: explicitPort,
});

const shutdown = async () => {
  await startedBridge.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});

process.stdin.on("end", () => {
  void shutdown();
});
