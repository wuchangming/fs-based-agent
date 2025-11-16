import type { RunAgentFunction } from "../core/CoreDef.js";
import { runDemoAgent } from "./demo-agent/demoAgent.js";
import { runFsBasedAgent } from "./fs-based-agent/fsBasedAgent.js";

export default {
    demo: runDemoAgent,
    fsBased: runFsBasedAgent,
} satisfies Record<string, RunAgentFunction<any, any>>;
