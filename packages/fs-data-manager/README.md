## @fs-based-agent/fs-data-manager

Service + React dashboard for managing FsData executors as a DAG.

### What it does
- Register executors (wraps `FsContextEngine`) and expose them over a small API.
- Crawl existing `fs-data/<version>` folders, read manifests, and recover dependencies via symlinks to build a DAG.
- Re-run a single node (forces `skipCache`) using the manifest input.
- React dashboard to visualize the DAG and trigger re-runs.

### Quick start (as a library)
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
import path from 'path';
import { createRequire } from 'module';
import { startFsDataManagerServer } from '@fs-based-agent/fs-data-manager';

const require = createRequire(import.meta.url);
const pkgRoot = path.dirname(require.resolve('@fs-based-agent/fs-data-manager/package.json'));
const staticDir = path.join(pkgRoot, 'dist/client');

startFsDataManagerServer(manager, { port: 4100, staticDir });
```

### React dashboard
- UI expects the API under `/api` by default (override at build time with `VITE_API_BASE=/your-api`).
- `npm run dev` (or `pnpm dev`) starts a Vite dev server at `:4173` (Vite proxy points `/api` → `http://localhost:4100`).
- `npm run build` (or `pnpm build`) builds static assets to `dist/client` for hosting.

For a complete integration example (API + UI + demo executors), see `playgrounds/fs-data-manager-demo`.

### API surface
- `GET /api/graph` → `{ graph, executors }` where `graph` is `{ nodes, edges }`.
- `POST /api/nodes/:kind/:dataId/reexecute` → `{ entryPath }` (re-runs with `skipCache: true`).
- `POST /api/executors/:kind/execute` with `{ input, skipCache? }` → `{ entryPath }` (run even when no FsData instances exist yet).
