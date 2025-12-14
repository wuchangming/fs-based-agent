import { FsContextEngine } from "@fs-based-agent/core";
import type { Executor, ExecutorConfig, FnResult } from "@fs-based-agent/core";
import * as fs from "node:fs/promises";
import { createGitCloneExecutor } from "./executors/gitClone.executor.js";
import type { GitCloneInput } from "./executors/gitClone.executor.js";
import { z } from "zod";

export const repoWikiContextInputSchema = z
    .object({
        repoUrl: z.string().min(1).describe("Git repository url (same as git-clone.url)"),
        branch: z.string().min(1).optional().describe("Git branch/tag (optional)"),
    })
    .passthrough()
    .describe("Create a workspace that contains repo/ and wiki output directories");

export type RepoWikiContextInput = z.infer<typeof repoWikiContextInputSchema>;

export function createRepoWikiContextDeps(cloneRepo: Executor<GitCloneInput>) {
    return (input: RepoWikiContextInput): Record<string, ExecutorConfig<unknown>> => {
        const { repoUrl, branch } = input;
        return {
            repo: cloneRepo.config({
                input: { url: repoUrl, branch },
            }),
        };
    };
}

export function createRepoWikiContextFn(wikiOutputDir: string) {
    return async (_input: RepoWikiContextInput, dataDir: string): Promise<FnResult> => {
        await fs.mkdir(`${dataDir}/${wikiOutputDir}`, { recursive: true });
        return { entry: "." };
    };
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
        // Create executor with dynamic deps based on input
        const executor = engine.createExecutor({
            kind: "repo-wiki-context",
            deps: createRepoWikiContextDeps(cloneRepo)(input),
            fn: createRepoWikiContextFn(wikiOutputDir),
        });

        // Execute and return the context path
        return executor({ input, skipCache: true });
    };
}
