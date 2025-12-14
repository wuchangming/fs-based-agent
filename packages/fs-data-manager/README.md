## @fs-based-agent/fs-data-manager

Service + React dashboard for managing FsData executors as a DAG.

### What it does
- Register executors (wraps `FsContextEngine`) and expose them over a small API.
- Crawl existing `fs-data/<version>` folders, read manifests, and recover dependencies via symlinks to build a DAG.
- Re-run a single node (forces `skipCache`) using the manifest input.
- React dashboard to visualize the DAG and trigger re-runs.

### Quick start
```ts
import { FsDataManager, createFsDataManagerRouter } from '@fs-based-agent/fs-data-manager';
import express from 'express';

const manager = new FsDataManager('/tmp/fs-data-root');

// Register executors (same signature as FsContextEngine.createExecutor)
const cloneRepo = manager.registerExecutor({
  kind: 'repo',
  fn: async (input, dir) => {
    // ...
    return { entry: 'repo' };
  },
});

manager.registerExecutor({
  kind: 'workspace',
  deps: { repo: cloneRepo.config({ input: { url: '...' } }) },
  fn: async (_, dir) => ({ entry: '.' }),
});

const app = express();
app.use(express.json());
app.use('/api', createFsDataManagerRouter(manager));
app.listen(4100, () => console.log('FsData manager API ready on :4100'));
```

Or spin up a ready-to-serve combo (API + static dashboard) if you already built the UI:

```ts
import { startFsDataManagerServer } from '@fs-based-agent/fs-data-manager';
startFsDataManagerServer(manager, { port: 4100, staticDir: path.resolve('dist/client') });
```

### React dashboard
- `pnpm --filter @fs-based-agent/fs-data-manager dev` starts a Vite dev server at `:4173`.
- API calls default to `/api`; Vite dev proxy points to `http://localhost:4100`.
- Build static assets with `pnpm --filter @fs-based-agent/fs-data-manager build` (output: `dist/client`).
- UI behavior: shows DAG nodes if present; always lists registered executors and lets you trigger an execution (with JSON input prompt) even when no FsData instances exist yet.
- Local dev API: `pnpm --filter @fs-based-agent/fs-data-manager dev:api` starts an Express server at `:4100` using `FS_DATA_ROOT` (defaults to `../../playgrounds/repo-wiki-agent/.local-fs-data`). Keep it running alongside `pnpm dev`.

### API surface
- `GET /api/graph` → `{ graph, executors }` where `graph` is `{ nodes, edges }`.
- `POST /api/nodes/:kind/:dataId/reexecute` → `{ entryPath }` (re-runs with `skipCache: true`).
- `POST /api/executors/:kind/execute` with `{ input, skipCache? }` → `{ entryPath }` (run even when no FsData instances exist yet).
