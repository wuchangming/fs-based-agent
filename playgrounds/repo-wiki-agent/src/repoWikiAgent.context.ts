import { FsContextEngine } from "@fs-based-agent/core";
import * as fs from "node:fs/promises";
import { createGitCloneExecutor } from "./executors/gitClone.executor.js";

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
 * @param wikiOutputDir - Directory name for wiki output
 * @returns Async function that creates and executes the context
 */
export function setupRepoWikiContext(
    engine: FsContextEngine,
    wikiOutputDir: string
) {
    const cloneRepo = createGitCloneExecutor(engine);

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
                // Create wiki output directory in data-space
                await fs.mkdir(`${dataDir}/${wikiOutputDir}`, { recursive: true });
                return { entry: "." };
            },
        });

        // Execute and return the context path
        return executor({ input, skipCache: true });
    };
}
