import type { CreateExecutorParams, Executor, FnResult } from "@fs-based-agent/core";
import { FsContextEngine } from "@fs-based-agent/core";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";

export const gitCloneInputSchema = z
    .object({
        url: z.string().min(1).describe("Git repository url (https or ssh)"),
        branch: z.string().min(1).optional().describe("Git branch/tag (optional)"),
    })
    .passthrough()
    .describe("Clone a git repository into repo/");

export type GitCloneInput = z.infer<typeof gitCloneInputSchema>;

const execAsync = promisify(exec);

/**
 * Executor fn: clone repository into `repo/`
 */
export async function gitCloneExecutorFn(input: GitCloneInput, dataDir: string): Promise<FnResult> {
    const { url, branch } = input;
    const repoPath = `${dataDir}/repo`;

    // Build git clone command
    const branchArg = branch ? `-b ${branch}` : "";
    const command = `git clone --depth 1 ${branchArg} ${url} ${repoPath}`.trim();

    try {
        await execAsync(command, { maxBuffer: 50 * 1024 * 1024 });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to clone repository: ${message}`);
    }

    return { entry: "repo" };
}

export const gitCloneExecutorParams: CreateExecutorParams<GitCloneInput> = {
    kind: "git-clone",
    fn: gitCloneExecutorFn,
};

/**
 * Creates a git clone executor that caches cloned repositories
 *
 * @param engine - FsContextEngine instance
 * @returns Executor for cloning git repositories
 */
export function createGitCloneExecutor(engine: FsContextEngine): Executor<GitCloneInput> {
    return engine.createExecutor<GitCloneInput>(gitCloneExecutorParams);
}
