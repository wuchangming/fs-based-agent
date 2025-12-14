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
import { getLLM } from '../llm.js';
import { uniqueIdMiddleware } from '../fix/uniqueIdMiddleware.js';
import { createRepoWikiSystemPrompt, WIKI_GENERATION_PROMPT } from '../repoWikiAgent.prompt.js';

export interface RepoWikiGenerateInput {
  repoUrl: string;
  branch?: string | undefined;
  recursionLimit?: number | undefined;
  [key: string]: unknown;
}

export interface RepoWikiGenerateExecutorOptions {
  wikiOutputDir: string;
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

  return async (input: RepoWikiGenerateInput, dataDir: string): Promise<FnResult> => {
    const recursionLimit =
      typeof input.recursionLimit === 'number' && Number.isFinite(input.recursionLimit)
        ? Math.max(1, Math.floor(input.recursionLimit))
        : 2000;

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
