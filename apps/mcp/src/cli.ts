#!/usr/bin/env node

import { underwrittenBridgePortRange } from "underwritten-bridge-contract";

import { startUnderwrittenMcp } from "./index.js";

const startedBridge = await startUnderwrittenMcp({
  portRange: underwrittenBridgePortRange,
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
