import { randomUUID } from "crypto";
import { createMiddleware, AIMessage } from "langchain";

export const ensureUniqueId = (message: AIMessage): AIMessage => {
    if (!message.id || message.id.startsWith("chat-")) {
        message.id = randomUUID();
    }
    return message;
};
/**
 * fix the issue that the id of the message is not unique
 */
export const uniqueIdMiddleware = createMiddleware({
    name: "uniqueIdMiddleware",
    wrapModelCall: async (request, handler) => {
        const response = await handler(request);
        const messageWithUniqueId = ensureUniqueId(response);
        return messageWithUniqueId;
    },
});
