import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { RunAgentFunction } from "../../core/CoreDef.js";
import { createAgent } from "langchain";
import { getLLM } from "../../utils/llm.js";
import { fsBasedAgentPrompt } from "./fsBasedAgent.prompt.js";
import { createLSTool } from "./tools/lsTool.js";
import { createGlobTool } from "./tools/globTool.js";
import { createGrepTool } from "./tools/grepTool.js";
import { createReadFileTool } from "./tools/readFileTool.js";
import { createReadManyFilesTool } from "./tools/readManyFilesTool.js";

type FsBasedAgentParams = {
    modelName: string;
    apiKey: string;
    baseURL: string;
    rootPath: string;
    query: string;
};

export const runFsBasedAgent = (async (params: FsBasedAgentParams) => {
    // Create all file system tools with the rootPath
    const tools = [
        createLSTool({ rootPath: params.rootPath }),
        createGlobTool({ rootPath: params.rootPath }),
        createGrepTool({ rootPath: params.rootPath }),
        createReadFileTool({ rootPath: params.rootPath }),
        createReadManyFilesTool({ rootPath: params.rootPath }),
    ];

    // Create the agent with the tools
    const agent = createAgent({
        model: getLLM(params.modelName, params.apiKey, params.baseURL),
        tools,
    });

    // Construct the context message
    const contextMessage = `You are analyzing the directory at: ${params.rootPath}

User query: ${params.query}

Use the available tools to search and analyze the files to answer the user's question.`;

    const result = await agent.invoke({
        messages: [
            new SystemMessage(fsBasedAgentPrompt),
            new HumanMessage(contextMessage),
        ],
    });

    return (result.messages.at(-1)?.content as string) ?? "";
}) satisfies RunAgentFunction<FsBasedAgentParams, string>;
