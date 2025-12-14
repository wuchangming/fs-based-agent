import { FsContextEngine, type Executor } from "@fs-based-agent/core";
import * as fs from "node:fs/promises";
import type { GitCloneInput } from "./executors/gitClone.executor.js";

export interface RepoWikiContextInput {
    repoUrl: string;
    branch?: string | undefined;
    [key: string]: unknown;
}


/**
 * Setup function to create a repo wiki context executor with deps
 * 
 * This uses the dynamic executor pattern since deps need to be generated
 * based on input (repoUrl, branch)
 * 
 * @param engine - FsContextEngine instance
 * @param cloneRepo - Git clone executor
 * @returns Async function that creates and executes the context
 */
export function setupRepoWikiContext(
    engine: FsContextEngine,
    cloneRepo: Executor<GitCloneInput>
) {
    return async (input: RepoWikiContextInput): Promise<string> => {
        const { repoUrl, branch } = input;

        // Create executor with dynamic deps based on input
        const executor = engine.createExecutor({
            kind: "repo-wiki-context",
            deps: {
                repo: cloneRepo.config({
                    input: { url: repoUrl, branch },
                }),
            },
            fn: async (_, dataDir) => {
                // Create wiki-output directory in data-space
                await fs.mkdir(`${dataDir}/wiki-output`, { recursive: true });
                return { entry: "." };
            },
        });

        // Execute and return the context path
        return executor({ input, skipCache: true });
    };
}
