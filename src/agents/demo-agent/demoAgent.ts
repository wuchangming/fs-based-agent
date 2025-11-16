import type { RunAgentFunction } from "../../core/CoreDef.js";
import { getLLM } from "../../utils/llm.js";
import { getWeatherTool } from "./tools/getWeatherTool.js";
import { createAgent, HumanMessage, SystemMessage } from "langchain";

type DemoAgentParams = {
    modelName: string;
    apiKey: string;
    baseURL: string;
};

const createDemoAgent = (params: DemoAgentParams) => {
    return createAgent({
        model: getLLM(params.modelName, params.apiKey, params.baseURL),
        tools: [getWeatherTool],
    });
};

export const runDemoAgent = (async (params: DemoAgentParams) => {
    const agent = createDemoAgent(params);

    const result = await agent.invoke({
        messages: [
            new SystemMessage(
                "You are a weather agent. You are given a city and you need to return the weather for that city."
            ),
            new HumanMessage("What is the weather in Tokyo?"),
        ],
    });

    return (result.messages.at(-1)?.content as string) ?? "";

}) satisfies RunAgentFunction<DemoAgentParams, string>;
