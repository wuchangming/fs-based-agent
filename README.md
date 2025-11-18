# fs-based-agent

A pragmatic AI agent for understanding large file systems and codebases. Point it at any repository and it will explore, search, and read just the files that matter.

## Highlights
- **Purpose-built tooling** – curated LangChain agent with commands tuned for repositories (directory listing, glob search, regex search, focused readers, batched readers).
- **Smart traversal strategy** – automatically chains listing → locating → deep reads, and can run independent searches in parallel for faster answers.
- **Noise aware** – ships with sensible ignore patterns for dependency folders, build output, VCS metadata, and IDE cruft, so queries stay relevant.

## Architecture Overview
The fs-based agent is implemented with LangChain (`@langchain/core`, `langchain`, and `@langchain/openai`). It exposes a `RunAgentFunction` that the CLI loads based on your configuration. Tools live under `src/agents/fs-based-agent/tools`, while reusable helpers sit in `src/core` and `src/utils`.

## Quick Start
```bash
pnpm install
pnpm start -- -c .config-local/my-analysis.agentConfig.json
```
Prefer inline JSON? Supply it directly:
```bash
pnpm start -- -j '{"agentName":"fs-based","params":{...}}'
```

### Minimal Config
Create `.config-local/my-analysis.agentConfig.json`:
```json
{
  "agentName": "fs-based",
  "params": {
    "modelName": "gpt-4o-mini",
    "apiKey": "sk-your-key",
    "baseURL": "https://api.openai.com/v1",
    "rootPath": "/absolute/path/to/repo",
    "query": "What are the main modules in this project?"
  }
}
```
Run the agent:
```bash
pnpm start -- -c .config-local/my-analysis.agentConfig.json
```

## Built-in Tools
| Tool | Purpose | Notable Parameters |
| --- | --- | --- |
| `list_directory` | Summaries folders/files with optional extra ignore rules. | `dir_path`, `ignore` |
| `find_files` | Glob search sorted by modified time. | `pattern`, `dir_path`, `ignore`, `case_sensitive` |
| `search_file_content` | Regex search via ripgrep / git grep fallback. | `pattern`, `dir_path`, `include`, `context`, `case_sensitive` |
| `read_file` | Paginated single-file reader for targeted inspection. | `file_path`, `offset`, `limit` |
| `read_many_files` | Batch reader for related files or patterns. | `include`, `exclude`, `dir_path` |

## Common Queries
- Project overview: `"What frameworks and key dependencies are used?"`
- Feature tracing: `"Locate every exported auth helper and show their call sites."`
- Configuration review: `"Explain the TypeScript compiler options in this repo."`
- Agent catalog: `"List every agent under src/agents and describe their responsibilities."`

## Extending
1. Create a new folder under `src/agents/` and implement the `RunAgentFunction` interface.
2. Register it in `src/agents/agentMap.ts`.
3. Provide a config sample under `config-sample/` or `.config-local/`.
4. Iterate using the existing CLI.

## License
[MIT](LICENSE)
