#!/usr/bin/env node

import { underwrittenBridgePortRange } from "./contract.js";

import { startUnderwrittenBridge } from "./index.js";

const startedBridge = await startUnderwrittenBridge({
  connectStdio: true,
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
