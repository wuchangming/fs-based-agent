import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  FsDataManager,
  startFsDataManagerServer,
} from '@fs-based-agent/fs-data-manager';
import {
  WIKI_OUTPUT_DIR,
  createRepoWikiContextDeps,
  createRepoWikiContextFn,
  createRepoWikiGenerateExecutorFn,
  gitCloneExecutorParams,
  type RepoWikiGenerateInput,
  type RepoWikiContextInput,
} from '@fs-based-agent/repo-wiki-agent';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

try {
  const require = createRequire(import.meta.url);
  const dotenv = require('dotenv') as { config: () => void };
  dotenv.config();
} catch {
  // dotenv is optional; env vars can be provided by the shell instead
}

const FS_DATA_ROOT =
  process.env.FS_DATA_ROOT || path.resolve(__dirname, '..', '.local-fs-data');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4300;

async function main() {
  const manager = new FsDataManager(FS_DATA_ROOT);

  const cloneRepo = manager.registerExecutor({
    ...gitCloneExecutorParams,
    label: 'git-clone',
    description: 'Clone a git repository (depth=1) into repo/',
  });

  const createContext = manager.registerDynamicExecutor<RepoWikiContextInput>({
    kind: 'repo-wiki-context',
    label: 'repo-wiki-context',
    description: 'Create a workspace with repo/ and wiki-output/ (deps resolved from input)',
    deps: createRepoWikiContextDeps(cloneRepo),
    fn: createRepoWikiContextFn(WIKI_OUTPUT_DIR),
  });

  const generateFn = createRepoWikiGenerateExecutorFn({
    wikiOutputDir: WIKI_OUTPUT_DIR,
    repoDepKey: 'repo',
  });

  manager.registerDynamicExecutor<RepoWikiGenerateInput>({
    kind: 'repo-wiki-generate',
    label: 'repo-wiki-generate',
    description: 'Run the LLM agent to generate wiki docs (deps resolved from input)',
    deps: (input) => ({
      repo: cloneRepo.config({
        input: { url: input.repoUrl, branch: input.branch },
        skipCache: false,
      }),
    }),
    fn: generateFn,
  });

  startFsDataManagerServer(manager, {
    port: PORT,
    apiPath: '/api',
  });

  // eslint-disable-next-line no-console
  console.log(`[repo-wiki-agent-with-manager] API ready on http://localhost:${PORT}/api`);
  // eslint-disable-next-line no-console
  console.log(`[repo-wiki-agent-with-manager] FsData root: ${FS_DATA_ROOT}`);
  // eslint-disable-next-line no-console
  console.log(`[repo-wiki-agent-with-manager] Open http://localhost:${PORT} (UI served if built)`);
}

void main();
