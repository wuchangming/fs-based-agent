import { ChatOpenAI } from "@langchain/openai";
export const llm = new ChatOpenAI({
    configuration: {
        apiKey: process.env.API_KEY,
        baseURL: process.env.API_BASE_URL,
    },
    model: process.env.MODEL as string,
});