import type { RunAgentFunction } from "../core/CoreDef.js";
import { runDemoAgent } from "./demo-agent/demoAgent.js";
import { runFsBasedAgent } from "./fs-based-agent/fsBasedAgent.js";

export default {
    demo: runDemoAgent,
    'fs-based': runFsBasedAgent,
} satisfies Record<string, RunAgentFunction<any, any>>;
