import { AIMessage, createMiddleware } from "langchain";
import { ensureUniqueId } from "./ensureUniqueId.js";

/**
 * Middleware to generate a unique ID for AIMessage.
 * If the message's ID is empty or starts with "chat-", a new unique ID will be generated.
 */
export const uniqueIdMiddleware = createMiddleware({
    name: "UniqueIdMiddleware",
    afterModel: async (state) => {
        const messages = state.messages;
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage?.type === 'ai') {
                const messageWithUniqueId = ensureUniqueId(lastMessage as AIMessage);
                return {
                    messages: [...messages.slice(0, -1), messageWithUniqueId],
                };
            }
        }
    },
});