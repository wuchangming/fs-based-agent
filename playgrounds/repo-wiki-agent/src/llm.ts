import { ChatOpenAI } from "@langchain/openai";
export const getLLM = () => {

    if (process.env.API_KEY === undefined) {
        throw new Error("API_KEY is not set");
    }
    if (process.env.MODEL === undefined) {
        throw new Error("MODEL is not set");
    }

    return new ChatOpenAI({
        configuration: {
            apiKey: process.env.API_KEY,
            baseURL: process.env.API_BASE_URL,
        },
        model: process.env.MODEL as string,
    });
}