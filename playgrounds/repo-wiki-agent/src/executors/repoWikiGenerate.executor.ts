import type { FnResult } from '@fs-based-agent/core';
import {
  createGlobTool,
  createGrepTool,
  createLSTool,
  createReadFileTool,
  createWriteFileTool,
} from '@fs-based-agent/langchain-tools';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createAgent, HumanMessage, SystemMessage } from 'langchain';
import { z } from 'zod';
import { getLLM } from '../llm.js';
import { uniqueIdMiddleware } from '../fix/uniqueIdMiddleware.js';
import { createRepoWikiSystemPrompt, WIKI_GENERATION_PROMPT } from '../repoWikiAgent.prompt.js';

export const repoWikiGenerateInputSchema = z
  .object({
    repoUrl: z.string().min(1).describe('Git repository url (same as repo-wiki-context.repoUrl)'),
    branch: z.string().min(1).optional().describe('Git branch/tag (optional)'),
  })
  .loose()
  .describe('Generate wiki docs for a repository');

export type RepoWikiGenerateInput = z.infer<typeof repoWikiGenerateInputSchema>;

export interface RepoWikiGenerateExecutorOptions {
  wikiOutputDir: string;
  /** LangChain recursion limit (default: 2000) */
  recursionLimit?: number;
  /** Dep key mounted in data-space that is already the repo directory (default: "repo") */
  repoDepKey?: string;
  /** Dep key mounted in data-space (default: "context") */
  contextDepKey?: string;
}

async function safeRemove(targetPath: string) {
  try {
    await fs.rm(targetPath, { recursive: true, force: true });
  } catch {
    // ignore
  }
}

async function ensureSymlink(linkPath: string, targetRelativeToLinkParent: string) {
  await safeRemove(linkPath);
  await fs.symlink(targetRelativeToLinkParent, linkPath);
}

export function createRepoWikiGenerateExecutorFn(options: RepoWikiGenerateExecutorOptions) {
  const contextKey = options.contextDepKey ?? 'context';
  const wikiOutputDir = options.wikiOutputDir;
  const repoDepKey = options.repoDepKey ?? 'repo';
  const recursionLimit =
    typeof options.recursionLimit === 'number' && Number.isFinite(options.recursionLimit)
      ? Math.max(1, Math.floor(options.recursionLimit))
      : 2000;

  return async (input: RepoWikiGenerateInput, dataDir: string): Promise<FnResult> => {
    // Prepare workspace:
    // - when deps mounts repo directly under `repo/`, do nothing
    // - otherwise create `repo/` symlink for the prompt convention
    const repoTarget = options.contextDepKey ? `${contextKey}/repo` : repoDepKey;
    if (repoTarget !== 'repo') {
      await ensureSymlink(path.join(dataDir, 'repo'), repoTarget);
    }
    await fs.mkdir(path.join(dataDir, wikiOutputDir), { recursive: true });

    const tools = [
      createLSTool({ rootPath: dataDir }),
      createGrepTool({ rootPath: dataDir, outputMode: 'content' }),
      createGlobTool({ rootPath: dataDir }),
      createReadFileTool({ rootPath: dataDir }),
      createWriteFileTool({ rootPath: dataDir }),
    ];

    const agent = createAgent({
      model: getLLM(),
      tools,
      middleware: [uniqueIdMiddleware],
    });

    await agent.invoke(
      {
        messages: [
          new SystemMessage(createRepoWikiSystemPrompt(wikiOutputDir)),
          new HumanMessage(WIKI_GENERATION_PROMPT),
        ],
      },
      {
        recursionLimit,
      }
    );

    const title =
      typeof input.repoUrl === 'string' && input.repoUrl.trim()
        ? `wiki: ${input.repoUrl}`.slice(0, 60)
        : 'repo-wiki-generate';

    return {
      entry: wikiOutputDir,
      metadata: { title },
    };
  };
}
