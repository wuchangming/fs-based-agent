import type { RunAgentFunction } from "../../core/CoreDef.js";

type FsBasedAgentParams = {
    modelName: string;
    apiKey: string;
    baseURL: string;
};

export const runFsBasedAgent = (async (params: FsBasedAgentParams) => {
    return "fs based agent running";
}) satisfies RunAgentFunction<FsBasedAgentParams, string>;
