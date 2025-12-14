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
import { z } from 'zod';

const manager = new FsDataManager('/tmp/fs-data-root');

	// Register executors (same signature as FsContextEngine.createExecutor)
	const cloneRepo = manager.registerExecutor({
	  kind: 'repo',
	  inputSchema: z.object({ url: z.string().min(1) }).loose(),
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

// If deps depend on the runtime input, use registerDynamicExecutor:
// manager.registerDynamicExecutor({
//   kind: 'repo-wiki-context',
//   deps: (input) => ({ repo: cloneRepo.config({ input: { url: input.repoUrl } }) }),
//   fn: async (_, dir) => ({ entry: '.' }),
// });

const app = express();
app.use(express.json());
app.use('/api', createFsDataManagerRouter(manager));
app.listen(4100, () => console.log('FsData manager API ready on :4100'));
```

Or spin up a ready-to-serve combo (API + dashboard). If the UI is built (`dist/client` exists), it will be served automatically:

```ts
import { startFsDataManagerServer } from '@fs-based-agent/fs-data-manager';

startFsDataManagerServer(manager, { port: 4100, apiPath: '/api' });
```

### React dashboard
- UI expects the API under `/api` by default (override at build time with `VITE_API_BASE=/your-api`).
- `npm run dev` (or `pnpm dev`) starts a Vite dev server at `:4173` (Vite proxy points `/api` → `http://localhost:4100`).
- `npm run build` (or `pnpm build`) builds static assets to `dist/client` for hosting.

For a complete integration example (API + UI + demo executors), see `playgrounds/fs-data-manager-demo`.
For a real-world DAG example, see `playgrounds/repo-wiki-agent-with-manager`.

### API surface
- `GET /api/graph` → `{ graph, executors }` where `graph` is `{ nodes, edges }`.
- `POST /api/nodes/:kind/:dataId/reexecute` → `{ entryPath }` (re-runs with `skipCache: true`).
- `POST /api/executors/:kind/execute` with `{ input, skipCache? }` → `{ entryPath }` (run even when no FsData instances exist yet).
