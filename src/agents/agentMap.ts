import type { RunAgentFunction } from "../core/CoreDef.js";

export default {
    demo: async (params: any) => {
        return 'demo';
    }
} satisfies Record<string, RunAgentFunction<any, any>>;
