import { FsContextEngine } from "@fs-based-agent/core";
import {
    createLSTool,
    createGrepTool,
    createReadFileTool,
    createWriteFileTool,
    createGlobTool,
} from "@fs-based-agent/langchain-tools";
import { createAgent, HumanMessage, SystemMessage } from "langchain";
import { getLLM } from "./llm.js";
import { setupRepoWikiContext } from "./repoWikiAgent.context.js";
import {
    WIKI_GENERATION_PROMPT,
    createRepoWikiSystemPrompt,
} from "./repoWikiAgent.prompt.js";
import { FS_DATA_FOLDER, WIKI_OUTPUT_DIR } from "./constants.js";
import { uniqueIdMiddleware } from "./fix/uniqueIdMiddleware.js";

export interface RepoWikiAgentOptions {
    repoUrl: string;
    branch?: string;
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
    const createContext = setupRepoWikiContext(engine, WIKI_OUTPUT_DIR);

    // Execute context - get the workspace path
    const contextPath = await createContext({
        repoUrl,
        branch,
    });
    const repoPath = `${contextPath}/repo`;
    const wikiOutputPath = `${contextPath}/${WIKI_OUTPUT_DIR}`;

    // Create tools scoped to the context path
    // The prompt tells the agent: repo is in ./repo, write wiki to ./WIKI_OUTPUT_DIR
    const tools = [
        createLSTool({ rootPath: contextPath }),
        createGrepTool({ rootPath: contextPath, outputMode: "content" }),
        createGlobTool({ rootPath: contextPath }),
        createReadFileTool({ rootPath: contextPath }),
        createWriteFileTool({ rootPath: contextPath }),
    ];

    // Create the agent
    const agent = createAgent({
        model: getLLM(),
        tools,
        middleware: [uniqueIdMiddleware]
    });

    // Run the agent
    console.log("Starting wiki generation...");

    await agent.invoke({
        messages: [
            new SystemMessage(createRepoWikiSystemPrompt(WIKI_OUTPUT_DIR)),
            new HumanMessage(WIKI_GENERATION_PROMPT),
        ],
    }, {
        recursionLimit: 2000
    });

    console.log("Wiki generation completed!");
    console.log(`Generated files available at: ${wikiOutputPath}`);

    return {
        wikiOutputPath,
        repoPath,
    };
}
