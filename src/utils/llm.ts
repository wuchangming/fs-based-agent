import { ChatOpenAI } from "@langchain/openai";

export const getLLM = (modelName: string, apiKey: string, baseURL: string) => {
    return new ChatOpenAI({
        model: modelName,
        configuration: {
            apiKey: apiKey,
            baseURL: baseURL,
        },
    });
};
