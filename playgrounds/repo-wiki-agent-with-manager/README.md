# repo-wiki-agent-with-manager

Repo Wiki Agent demo wired to `@fs-based-agent/fs-data-manager` (API + UI).

## What you get
- Executors registered into `FsDataManager`:
  - `git-clone` (from `playgrounds/repo-wiki-agent`)
  - `repo-wiki-context` (dynamic deps: depends on `git-clone`)
  - `repo-wiki-generate` (dynamic deps: depends on `repo-wiki-context`)
- Open the manager UI, pick an executor, run it with parameters, and inspect the FsData DAG.

## Prerequisites
- Provide LLM env vars (same as `repo-wiki-agent`):
  - `API_KEY`
  - `MODEL`
  - optional `API_BASE_URL`
  - Copy `sample.env` → `.env` and fill values.

## Run
1. Build the manager UI assets:
   - `pnpm --filter @fs-based-agent/fs-data-manager build`
2. Start the demo server:
   - `pnpm --filter repo-wiki-agent-with-manager start`
3. Open:
   - `http://localhost:4300`

## Usage
- Select `repo-wiki-generate` in the UI and click **运行**.
- Fill:
  - `repoUrl` (string, required)
  - `branch` (string, optional)
  - `recursionLimit` (number, optional; default 2000)

Outputs:
- `repo-wiki-generate` entry points to `wiki-output/` for the generated docs.
