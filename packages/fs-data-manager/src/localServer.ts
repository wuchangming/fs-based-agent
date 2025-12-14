import path from 'path';
import { FsDataManager, startFsDataManagerServer } from './index.js';

/**
 * Local dev server for the FsData manager UI + API.
 * Configure FS_DATA_ROOT to point to the FsData root.
 */
const defaultRoot =
  process.env.FS_DATA_ROOT ||
  '../../playgrounds/repo-wiki-agent/.local-fs-data';

async function main() {
  const manager = new FsDataManager(defaultRoot);
  const staticDir = path.resolve('dist/client');

  startFsDataManagerServer(manager, {
    port: 4100,
    apiPath: '/api',
    staticDir: await exists(staticDir) ? staticDir : undefined,
  });
}

async function exists(p: string) {
  try {
    await import('fs/promises').then((m) => m.access(p));
    return true;
  } catch {
    return false;
  }
}

void main();
