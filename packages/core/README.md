# FsContextEngine Core Design

FsContextEngine provides unified caching/idempotent infrastructure, treating Executors as "functions on the filesystem". All invocation inputs/outputs are persisted through standardized directories and manifests, enabling reproducible, traceable, and cacheable orchestration infrastructure.

**Core Principles**:
- **Idempotency**: Same input → Same result
- **Unified Abstraction**: Everything is FsData
- **Standardized Execution**: Unified Executor model
- **Convention over Configuration**: Standardized path rules

**Unix Design Philosophy: Everything is a file.**

## Core Concepts

### FsData

FsData is the smallest data unit managed by the engine. Each FsData corresponds to a directory containing a manifest descriptor file and a dataLink entry point.

#### Data Directory Structure

```
<root>/fs-data/1.0.0/{kind}/{shard}/{dataId}/
├── .fs-data-manifest.json
├── dataLink -> ./data-space/actual-entry
└── data-space/             # fn's working directory
    └── actual-entry/       # entry created by fn
```

> **Note**: The `dataDir` passed to fn is the `data-space` directory, not the FsData root. This prevents fn from accidentally accessing or overwriting the manifest file.

Parameter Definitions:

- `kind`: Data category, defined by business logic (e.g., `repo-clone`, `analysis-agent`)
- `shard`: Sharding directory, takes first 2 characters of `dataId` to reduce file count per directory
- `dataId`: Unique data identifier, computed from `hash(input)`

### Executor

`createExecutor` returns an executor:

```typescript
// Basic executor
const cloneRepo = engine.createExecutor({
  kind: 'repo-clone',
  fn: async (input, dataDir) => {
    await exec(`git clone ${input.url} ${dataDir}/repo`)
    return { entry: 'repo' }
  }
})

// Workspace executor (fixed deps)
const analysisAgent = engine.createExecutor({
  kind: 'analysis-agent',
  deps: {
    'inputs/repo': cloneRepo.config({ input: { url: 'https://...' } }),
    'inputs/docs': fetchDocs.config({ input: { docId: '123' } })
  },
  fn: async (input, dataDir) => {
    // dataDir/inputs/repo and inputs/docs are already mounted
    return { entry: 'outputs' }
  }
})

// Dynamic deps: create executor at runtime
function setupDynamicContext(engine, cloneRepo) {
  async function execute(input: { repoUrl: string }) {
    // Create at runtime, deps generated dynamically based on input
    const executor = engine.createExecutor({
      kind: 'dynamic-context',
      deps: {
        repo: cloneRepo.config({ input: { url: input.repoUrl } })
      },
      fn: async () => ({ entry: 'repo' })
    })
    return executor({ input })
  }
  return { execute }
}
```

## .fs-data-manifest.json

```json
{
  "manifestVersion": "1.0.0",
  "kind": "repo-clone",
  "input": { "url": "https://..." },
  "metadata": {},
  "createdAt": "2025-01-01T00:00:00.000Z",
  "updatedAt": "2025-01-01T00:00:00.000Z"
}
```

- `manifestVersion`: Manifest version for future compatibility
- `kind`: Data type
- `input`: Cache key (input at execution time)
- `metadata`: User-defined metadata (returned by fn)
- `createdAt`: Initial creation timestamp
- `updatedAt`: Last update timestamp

## Execution Flow

1. `dataId = hash({ kind, input })` - Recursively sort by key + MD5
2. Check cache (skip if skipCache=true)
3. Cache hit → Return dataLink path
4. Cache miss:
   - Create tempDir (sibling to final path: `{shard}/.tmp-{dataId}-{random}/`)
   - If deps exist: Execute each, create symlinks
   - Execute `fn(input, tempDir)`
   - Write manifest, create dataLink
   - Rename tempDir → final path (on failure: delete tempDir, read existing result)
   - Return path
5. On error: Clean tempDir based on `cleanTempOnError` (default: true)

## Concurrent Write Control

When multiple processes write to the same dataId simultaneously, the first successful rename wins. Other processes reuse the existing directory and discard their temporary directories. No distributed lock required.

## Usage Examples

```typescript
const engine = new FsContextEngine({ root: '/data' })

// Basic executor
const cloneRepo = engine.createExecutor({
  kind: 'repo-clone',
  fn: async (input, dataDir) => {
    await exec(`git clone ${input.url} ${dataDir}/repo`)
    return { entry: 'repo' }
  }
})

// Invoke
await cloneRepo({ input: { url: 'https://...' } })

// Force refresh
await cloneRepo({ input: { url: '...' }, skipCache: true })

// Read only
const cached = await engine.get('repo-clone', { url: '...' })

// Delete (silent success if not exists)
await engine.remove('repo-clone', { url: '...' })
```
