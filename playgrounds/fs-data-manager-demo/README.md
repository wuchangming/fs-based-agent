## fs-data-manager-demo

Minimal playground showing how to register executors with `FsDataManager` and generate a DAG you can browse in the React UI.

### What it does
- Registers two executors:
  - `sample-text`: writes `text.txt` with provided text.
  - `text-summary`: depends on `sample-text` (symlinked at `source/`) and writes `summary.txt`.
- Exposes a tiny API:
  - `POST /run` – executes the chain once (cached by input).
  - `GET /graph` – raw graph data from `FsDataManager`.

### How to run
1) Build the manager UI once (serves static assets if present):
   ```bash
   pnpm --filter @fs-based-agent/fs-data-manager build
   ```
2) Start the demo (API + manager API + optional static UI on the same port):
   ```bash
   pnpm --filter fs-data-manager-demo start
   # FsData root defaults to playgrounds/fs-data-manager-demo/.local-fs-data (override FS_DATA_ROOT)
   ```
3) Trigger a run (to create nodes):
   ```bash
   curl -X POST http://localhost:4200/demo/run
   ```
4) Open the UI:
   - If step 1 built the UI, visit http://localhost:4200 (served from packages/fs-data-manager/dist/client).
   - Otherwise run `pnpm --filter @fs-based-agent/fs-data-manager dev` and point it to `FS_DATA_ROOT=$(pwd)/playgrounds/fs-data-manager-demo/.local-fs-data`.

You’ll see the two-node DAG (`sample-text` → `text-summary`). The UI can trigger executors even when no FsData instances exist.
