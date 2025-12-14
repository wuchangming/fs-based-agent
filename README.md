# fs-based-agent

File-system-first agent toolkit. The core is a cacheable/replayable FsContextEngine plus a set of LangChain file-ops tools, making local automation reproducible and traceable.

## Packages
- `packages/core` (`@fs-based-agent/core`): FsContextEngine implementing the “everything is FsData” execution/cache model.
- `packages/langchain-tools` (`@fs-based-agent/langchain-tools`): LangChain `Tool` set for local repos (list/search/read/write files) with guardrails and output limits.

## Core design: @fs-based-agent/core
- **FsData layout**: Artifacts live in `fs-data/<version>/<kind>/<shard>/<dataId>/` with `.fs-data-manifest.json` (input/metadata) and `dataLink` (points into `data-space`). `dataId` is a stable MD5 of `{ kind, input }`, sharded for FS scalability.
- **Executors as pure functions**: `createExecutor({ kind, deps?, fn })` binds execution to input cache; identical input returns the same `dataLink`; `skipCache` forces refresh.
- **Dependency mounting**: Declarative `deps` run first and are symlinked into `data-space`; `recoverInvalidDeps` fixes stale links on cache hits.
- **Concurrency-safe writes**: Temp dir + atomic rename; first writer wins, others reuse the existing result; optional temp cleanup on error.
- **Minimal example**:
  ```ts
  const engine = new FsContextEngine({ root: '/tmp/fs-data' });
  const cloneRepo = engine.createExecutor({
    kind: 'repo-clone',
    fn: async ({ url }, dir) => {
      await exec(`git clone ${url} ${dir}/repo`);
      return { entry: 'repo' };
    },
  });
  const path = await cloneRepo({ input: { url: 'https://...' } });
  ```

## LangChain tools: @fs-based-agent/langchain-tools
- **Toolbox**: `list_directory` (BFS recursive), `find_files` (glob + mtime sort), `search_file_content` (ripgrep with files_only/count/content modes), `read_file` (pagination, binary guard), `write_file` (full overwrite, mkdir -p).
- **Safety & filtering**: Paths confined to `rootPath`, merged default/custom ignores; read/write rejects ignored or suspicious locations.
- **Output control**: Caps on result count/bytes, long-line truncation, truncation notices; auto-downloads ripgrep if missing.

## Playground
- `playgrounds/repo-wiki-agent` shows using FsContextEngine for cached repo cloning + LangChain tools to generate a repo Wiki. Check `sample.env` for model/repo config and run its scripts to try it out.
