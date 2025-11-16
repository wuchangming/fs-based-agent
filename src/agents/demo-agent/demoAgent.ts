import type { RunAgentFunction } from "../../core/CoreDef.js";

type DemoAgentParams = {
    modelName: string;
}

export const runDemoAgent = (async (params: DemoAgentParams) => {
    return `demo agent running with model: ${params.modelName}`;
}) satisfies RunAgentFunction<DemoAgentParams, string>;
