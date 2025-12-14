import { randomUUID } from "crypto";
import { BaseMessage } from "langchain";

/**
 * Middleware to generate a unique ID for AIMessage.
 * If the message's ID is empty or starts with "chat-", a new unique ID will be generated.
 */
export const ensureUniqueId = (message: BaseMessage): BaseMessage => {
    if (!message.id || message.id.startsWith("chat-")) {
        message.id = randomUUID();
    }
    return message;
};