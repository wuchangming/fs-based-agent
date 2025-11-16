import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunAgentFunction } from "../../core/CoreDef.js";
import { createAgent } from "langchain";
import { getLLM } from "../../utils/llm.js";
import { fsBasedAgentPrompt } from "./fsBasedAgent.prompt.js";

type FsBasedAgentParams = {
    modelName: string;
    apiKey: string;
    baseURL: string;
    rootPath: string;
    query: string;
};

export const runFsBasedAgent = (async (params: FsBasedAgentParams) => {
    const agent = createAgent({
        model: getLLM(params.modelName, params.apiKey, params.baseURL),
        tools: [],
    });

    const result = await agent.invoke({
        messages: [
            new SystemMessage(fsBasedAgentPrompt),
            new HumanMessage(`${params.query}`),
        ],
    });

    return (result.messages.at(-1)?.content as string) ?? "";
}) satisfies RunAgentFunction<FsBasedAgentParams, string>;
