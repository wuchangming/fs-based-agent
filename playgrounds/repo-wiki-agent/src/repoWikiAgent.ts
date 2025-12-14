import { FsContextEngine } from "@fs-based-agent/core";
import {
    createLSTool,
    createGrepTool,
    createReadFileTool,
    createWriteFileTool,
    createGlobTool,
} from "@fs-based-agent/langchain-tools";
import { createAgent, HumanMessage, SystemMessage } from "langchain";
import { llm } from "./llm.js";
import { createGitCloneExecutor } from "./executors/gitClone.executor.js";
import { setupRepoWikiContext } from "./executors/repoWikiAgentCtx.executor.js";
import {
    REPO_WIKI_SYSTEM_PROMPT,
    WIKI_GENERATION_PROMPT,
} from "./repoWikiAgent.propmt.js";
import { FS_DATA_FOLDER } from "./constants.js";

export interface RepoWikiAgentOptions {
    repoUrl: string;
    branch?: string;
    /** Skip cache and re-clone the repository */
    skipCache?: boolean;
}

export interface RepoWikiAgentResult {
    /** Path to the wiki output directory */
    wikiOutputPath: string;
    /** Path to the cloned repository */
    repoPath: string;
}

/**
 * Run the repo wiki agent to generate documentation for a repository
 *
 * @param options - Agent configuration options
 * @returns Paths to generated wiki and cloned repo
 */
export async function runRepoWikiAgent(
    options: RepoWikiAgentOptions
): Promise<RepoWikiAgentResult> {
    const { repoUrl, branch } = options;

    // Initialize the context engine
    const engine = new FsContextEngine({ root: FS_DATA_FOLDER });

    // Create executors
    const cloneRepo = createGitCloneExecutor(engine);
    const createContext = setupRepoWikiContext(engine, cloneRepo);

    // Execute context - get the workspace path
    const contextPath = await createContext({
        repoUrl,
        branch,
    });

    const repoPath = `${contextPath}/repo`;
    const wikiOutputPath = `${contextPath}/wiki-output`;

    console.log(`Repository cloned to: ${repoPath}`);
    console.log(`Wiki will be generated to: ${wikiOutputPath}`);

    // Create tools scoped to the context paths
    const tools = [
        // Read tools scoped to repo
        createLSTool({ rootPath: repoPath }),
        createGrepTool({ rootPath: repoPath, outputMode: "content" }),
        createGlobTool({ rootPath: repoPath }),
        createReadFileTool({ rootPath: repoPath }),
        // Write tool scoped to wiki output
        createWriteFileTool({ rootPath: wikiOutputPath }),
    ];

    // Create the agent
    const agent = createAgent({
        model: llm,
        tools,
    });

    // Run the agent
    console.log("Starting wiki generation...");

    const result = await agent.invoke({
        messages: [
            new SystemMessage(REPO_WIKI_SYSTEM_PROMPT),
            new HumanMessage(WIKI_GENERATION_PROMPT),
        ],
    });

    console.log("Wiki generation completed!");
    console.log(`Generated files available at: ${wikiOutputPath}`);

    // Log the last message from the agent
    const lastMessage = result.messages[result.messages.length - 1];
    if (lastMessage?.content) {
        console.log("\nAgent summary:");
        console.log(lastMessage.content);
    }

    return {
        wikiOutputPath,
        repoPath,
    };
}
