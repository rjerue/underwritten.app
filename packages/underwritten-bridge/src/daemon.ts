#!/usr/bin/env node

import { underwrittenBridgePortRange } from "underwritten-bridge-contract";

import { runSharedBridgeDaemon } from "./shared-bridge.js";

const explicitPort = process.env.UNDERWRITTEN_BRIDGE_PORT
  ? parseInt(process.env.UNDERWRITTEN_BRIDGE_PORT, 10)
  : undefined;

await runSharedBridgeDaemon({
  port: explicitPort,
  portRange: explicitPort ? undefined : underwrittenBridgePortRange,
});
