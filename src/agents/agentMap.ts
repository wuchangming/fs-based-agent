import type { RunAgentFunction } from "../core/CoreDef.js";
import { runDemoAgent } from "./demo-agent/demoAgent.js";

export default {
    demo: runDemoAgent,
} satisfies Record<string, RunAgentFunction<any, any>>;
