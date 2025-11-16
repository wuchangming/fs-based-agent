# fs-based-agent

一个基于 AI 的 agent 框架，专门用于文件系统分析和代码仓库理解。

## 项目说明

本项目实现了一个基于 langchain 的 agent 框架，支持自定义 agent 和工具。核心功能是 **fs-based agent**，它可以智能地分析指定目录中的文件，回答用户关于代码库、文档或任何文件结构的问题。

## 核心特性

### FS-Based Agent

一个专门用于文件系统分析的 AI agent，具有以下能力：

- **目录浏览** (`list_directory`) - 列出目录内容，自动过滤常见的无关文件
- **文件搜索** (`find_files`) - 使用 glob 模式查找文件，按修改时间排序
- **内容搜索** (`search_file_content`) - 在文件内容中搜索正则表达式模式，支持 ripgrep/git grep/系统 grep
- **文件读取** (`read_file`) - 读取单个文件，支持分页查看大文件
- **批量读取** (`read_many_files`) - 一次读取多个文件，适合分析相关文件组

### 智能搜索策略

Agent 会根据问题类型自动选择最佳的工具组合：
- 先用 `list_directory` 和 `find_files` 理解结构
- 用 `search_file_content` 定位相关内容
- 用 `read_file` 深入分析具体文件
- 支持并行执行多个独立搜索操作

### 自动忽略模式

默认忽略常见的无关目录和文件：
- 依赖目录：`node_modules`, `vendor`, `bower_components`
- 构建输出：`dist`, `build`, `out`, `.next`, `target`
- 版本控制：`.git`, `.svn`
- IDE 文件：`.vscode`, `.idea`, `.DS_Store`
- 临时文件：`*.log`, `.cache`, `.tmp`

## 安装和运行

```bash
# 安装依赖
pnpm install

# 运行（指定配置文件）
pnpm start -- -c .config-local/my-analysis.agentConfig.json

# 或使用 JSON 字符串
pnpm start -- -j '{"agentName": "fs-based", "params": {...}}'
```

## 使用示例

### 1. 创建配置文件

创建一个 `.config-local/my-analysis.agentConfig.json` 文件：

```json
{
  "agentName": "fs-based",
  "params": {
    "modelName": "gpt-4o-mini",
    "apiKey": "your-openai-api-key",
    "baseURL": "https://api.openai.com/v1",
    "rootPath": "/path/to/your/project",
    "query": "这个项目的主要功能是什么？"
  }
}
```

### 2. 运行分析

```bash
pnpm start -- -c .config-local/my-analysis.agentConfig.json
```

### 示例查询

**项目结构分析：**
```json
{
  "query": "这个项目使用了什么技术栈？列出主要的依赖和框架。"
}
```

**代码搜索：**
```json
{
  "query": "找出所有导出的函数定义，特别是和用户认证相关的。"
}
```

**配置理解：**
```json
{
  "query": "这个项目是如何配置 TypeScript 的？有哪些特殊的编译选项？"
}
```

**功能分析：**
```json
{
  "query": "src/agents 目录下有哪些 agent 实现？它们各自的作用是什么？"
}
```

## 工具详解

### list_directory
列出指定目录的内容，显示文件和子目录。

**参数：**
- `dir_path` - 要列出的目录路径（相对于 rootPath）
- `ignore` - 可选的额外忽略模式数组

### find_files
使用 glob 模式查找文件。

**参数：**
- `pattern` - glob 模式（如 `**/*.ts`, `*.json`）
- `dir_path` - 可选的搜索目录
- `ignore` - 可选的排除模式
- `case_sensitive` - 是否区分大小写（默认 false）

### search_file_content
在文件内容中搜索正则表达式模式。

**参数：**
- `pattern` - 正则表达式模式
- `dir_path` - 可选的搜索目录
- `include` - 可选的文件过滤模式（如 `*.ts`）
- `case_sensitive` - 是否区分大小写（默认 false）
- `context` - 可选的上下文行数

### read_file
读取单个文件的内容。

**参数：**
- `file_path` - 文件路径（相对于 rootPath）
- `offset` - 可选的起始行号（用于分页）
- `limit` - 可选的行数限制（用于分页）

### read_many_files
一次读取多个文件。

**参数：**
- `include` - 文件模式数组（如 `["**/*.ts", "package.json"]`）
- `exclude` - 可选的排除模式数组
- `dir_path` - 可选的搜索目录

## 依赖项

- `@langchain/core` - LangChain 核心库
- `@langchain/openai` - OpenAI 集成
- `langchain` - LangChain 主库
- `glob` - 文件模式匹配
- `zod` - 参数验证
- `commander` - 命令行解析

## 开发

本项目采用 TypeScript 开发，使用 ESM 模块系统。

### 项目结构

```
src/
├── agents/
│   ├── fs-based-agent/          # FS-Based Agent 实现
│   │   ├── tools/                # 文件系统工具
│   │   │   ├── lsTool.ts
│   │   │   ├── globTool.ts
│   │   │   ├── grepTool.ts
│   │   │   ├── readFileTool.ts
│   │   │   └── readManyFilesTool.ts
│   │   ├── utils/
│   │   │   └── ignorePatterns.ts # 忽略模式工具
│   │   ├── fsBasedAgent.ts       # Agent 主文件
│   │   └── fsBasedAgent.prompt.ts # System prompt
│   └── demo-agent/               # Demo agent 示例
├── core/                         # 核心定义
├── utils/                        # 工具函数
└── cli.ts                        # CLI 入口
```

### 添加新的 Agent

1. 在 `src/agents/` 下创建新目录
2. 实现 `RunAgentFunction` 接口
3. 在 `src/agents/agentMap.ts` 中注册
4. 创建配置文件示例

## 许可证

MIT
