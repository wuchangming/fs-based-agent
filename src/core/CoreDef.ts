export type AgentConfig<T extends Record<string, any>> = {
    agentName: string;
    params: T;
}

export type RunAgentFunction<P extends Record<string, any>, R> = (params: P) => Promise<R>;