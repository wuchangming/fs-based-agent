import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { mergeIgnorePatterns } from "./utils/ignorePatterns.js";
import { ensureRgPath } from "./utils/ripgrepInstaller.js";

// ============ 配置常量 ============
const MAX_RESULTS = 2000;               // 最多返回 2000 条结果
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;  // 64KB 输出上限（约 16K tokens）
const MAX_LINE_LENGTH = 350;           // 单行最大长度（用于 content 模式预览）

// ============ 类型定义 ============

/**
 * grep 工具的输出模式
 * 
 * | 模式        | ripgrep 参数 | 返回内容                     | Token 消耗 | 适用场景                              |
 * |-------------|-------------|------------------------------|-----------|--------------------------------------|
 * | files_only  | rg -l       | 只返回文件名列表               | 最少 ✅    | 先定位文件，再用 read_file 查看具体内容 |
 * | count       | rg -c       | 文件名 + 每文件匹配数          | 较少      | 了解匹配分布，找出"重点文件"           |
 * | content     | rg --json   | 文件名 + 行号 + 匹配行内容     | 最多      | 需要快速预览匹配上下文（有字节限制保护）  |
 * 
 * @example files_only 模式输出
 * ```
 * Found 50 files matching pattern "useState":
 * src/App.tsx
 * src/hooks/useAuth.ts
 * src/components/Button.tsx
 * ...
 * ```
 * 
 * @example count 模式输出
 * ```
 * Found 120 matches in 50 files:
 * src/App.tsx: 15 match(es)
 * src/hooks/useAuth.ts: 8 match(es)
 * ...
 * ```
 * 
 * @example content 模式输出
 * ```
 * Found 120 matches:
 * 
 * src/App.tsx:
 *   L5: import { useState } from 'react';
 *   L23: const [count, setCount] = useState(0);
 *   ... and 13 more match(es) in this file
 * 
 * src/hooks/useAuth.ts:
 *   L12: const [user, setUser] = useState(null);
 *   ...
 * ```
 */
export type OutputMode = "files_only" | "count" | "content";

export interface GrepToolParams {
    rootPath: string;
    additionalIgnorePatterns?: string[];
    /** 输出模式：files_only、count、content（默认） */
    outputMode?: OutputMode;
    /** 输出字节数上限，默认 64KB */
    maxOutputBytes?: number;
    /** 最大结果数，默认 100 */
    maxResults?: number;
}

interface GrepMatch {
    filePath: string;
    lineNumber: number;
    line: string;
    modTime?: number;
}

// ============ 通用 ripgrep 执行函数 ============

/**
 * 执行 ripgrep 命令并返回输出
 */
async function runRipgrep(rgPath: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(rgPath, args, { windowsHide: true });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];

        child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
        child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
        child.on("error", (err) => reject(err));
        child.on("close", (code) => {
            const stdoutData = Buffer.concat(stdoutChunks).toString("utf8");
            if (code === 0 || code === 1) {
                // code 1 means no matches, which is not an error
                resolve(stdoutData);
            } else {
                const stderrData = Buffer.concat(stderrChunks).toString("utf8");
                reject(new Error(`ripgrep exited with code ${code}: ${stderrData}`));
            }
        });
    });
}

/**
 * 构建通用的 ripgrep 参数
 */
function buildCommonArgs(
    include?: string,
    caseInsensitive?: boolean,
    ignorePatterns?: string[]
): string[] {
    const args: string[] = [];

    // 不遵守 .gitignore 规则，确保搜索所有文件
    args.push("--no-ignore");

    if (caseInsensitive) {
        args.push("--ignore-case");
    }

    if (include) {
        args.push("--glob", include);
    }

    if (ignorePatterns) {
        ignorePatterns.forEach((pattern) => {
            args.push("--glob", `!${pattern}`);
        });
    }

    return args;
}

// ============ 搜索函数：files_only 模式 ============

/**
 * 只返回包含匹配的文件名列表（使用 rg -l）
 */
async function searchFilesOnly(
    rgPath: string,
    pattern: string,
    searchPath: string,
    include?: string,
    caseInsensitive?: boolean,
    ignorePatterns?: string[],
    maxResults: number = MAX_RESULTS
): Promise<{ files: string[]; totalCount: number; truncated: boolean }> {
    const args = ["-l", ...buildCommonArgs(include, caseInsensitive, ignorePatterns)];
    args.push(pattern, searchPath);

    const output = await runRipgrep(rgPath, args);
    if (!output.trim()) {
        return { files: [], totalCount: 0, truncated: false };
    }

    const allFiles = output.trim().split("\n").filter(Boolean);

    // 获取文件修改时间并排序（最近的在前）
    const filesWithTime = await Promise.all(
        allFiles.map(async (filePath) => {
            const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(searchPath, filePath);
            let modTime = 0;
            try {
                const stats = fs.statSync(absolutePath);
                modTime = stats.mtimeMs;
            } catch { /* ignore */ }
            const relativePath = path.relative(searchPath, absolutePath) || path.basename(absolutePath);
            return { path: relativePath, modTime };
        })
    );

    filesWithTime.sort((a, b) => b.modTime - a.modTime);

    const totalCount = filesWithTime.length;
    const truncated = totalCount > maxResults;
    const files = filesWithTime.slice(0, maxResults).map((f) => f.path);

    return { files, totalCount, truncated };
}

// ============ 搜索函数：count 模式 ============

/**
 * 返回每个文件的匹配计数（使用 rg -c）
 */
async function searchWithCount(
    rgPath: string,
    pattern: string,
    searchPath: string,
    include?: string,
    caseInsensitive?: boolean,
    ignorePatterns?: string[],
    maxResults: number = MAX_RESULTS
): Promise<{ counts: Map<string, number>; totalFiles: number; totalMatches: number; truncated: boolean }> {
    const args = ["-c", ...buildCommonArgs(include, caseInsensitive, ignorePatterns)];
    args.push(pattern, searchPath);

    const output = await runRipgrep(rgPath, args);
    const counts = new Map<string, number>();

    if (!output.trim()) {
        return { counts, totalFiles: 0, totalMatches: 0, truncated: false };
    }

    const entries: { path: string; count: number; modTime: number }[] = [];

    for (const line of output.trim().split("\n")) {
        if (!line) continue;
        const lastColonIndex = line.lastIndexOf(":");
        if (lastColonIndex === -1) continue;

        const filePath = line.substring(0, lastColonIndex);
        const countStr = line.substring(lastColonIndex + 1);
        const count = parseInt(countStr, 10);

        if (isNaN(count)) continue;

        const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(searchPath, filePath);
        let modTime = 0;
        try {
            const stats = fs.statSync(absolutePath);
            modTime = stats.mtimeMs;
        } catch { /* ignore */ }

        const relativePath = path.relative(searchPath, absolutePath) || path.basename(absolutePath);
        entries.push({ path: relativePath, count, modTime });
    }

    // 按匹配数排序（多的在前），相同则按修改时间排序
    entries.sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return b.modTime - a.modTime;
    });

    const totalFiles = entries.length;
    const totalMatches = entries.reduce((sum, e) => sum + e.count, 0);
    const truncated = totalFiles > maxResults;

    for (const entry of entries.slice(0, maxResults)) {
        counts.set(entry.path, entry.count);
    }

    return { counts, totalFiles, totalMatches, truncated };
}

// ============ 搜索函数：content 模式 ============

/**
 * 返回匹配内容（使用 rg --json），带字节数限制
 */
async function searchWithContent(
    rgPath: string,
    pattern: string,
    searchPath: string,
    include?: string,
    caseInsensitive?: boolean,
    ignorePatterns?: string[],
    maxResults: number = MAX_RESULTS
): Promise<{ matches: GrepMatch[]; totalCount: number; truncated: boolean }> {
    const args = ["--json", ...buildCommonArgs(include, caseInsensitive, ignorePatterns)];
    args.push("--threads", "4");
    args.push(pattern, searchPath);

    const output = await runRipgrep(rgPath, args);
    if (!output.trim()) {
        return { matches: [], totalCount: 0, truncated: false };
    }

    const matches: GrepMatch[] = [];

    for (const line of output.trim().split("\n")) {
        if (!line.trim()) continue;

        try {
            const json = JSON.parse(line);
            if (json.type === "match" && json.data?.path?.text && json.data?.lines?.text) {
                const absolutePath = path.resolve(searchPath, json.data.path.text);
                const relativePath = path.relative(searchPath, absolutePath) || path.basename(absolutePath);

                let modTime = 0;
                try {
                    const stats = fs.statSync(absolutePath);
                    modTime = stats.mtimeMs;
                } catch { /* ignore */ }

                matches.push({
                    filePath: relativePath,
                    lineNumber: json.data.line_number,
                    line: json.data.lines.text.trimEnd(),
                    modTime,
                });
            }
        } catch { /* skip invalid JSON */ }
    }

    // 按修改时间排序（最近的在前）
    matches.sort((a, b) => (b.modTime || 0) - (a.modTime || 0));

    const totalCount = matches.length;
    const truncated = totalCount > maxResults;

    return {
        matches: matches.slice(0, maxResults),
        totalCount,
        truncated,
    };
}

// ============ 输出格式化函数 ============

/**
 * 格式化 files_only 模式的输出
 */
function formatFilesOnlyOutput(
    files: string[],
    totalCount: number,
    truncated: boolean,
    pattern: string
): string {
    if (files.length === 0) {
        return `No files found matching pattern "${pattern}"`;
    }

    const lines: string[] = [];

    if (truncated) {
        lines.push(`Found ${totalCount} files matching pattern "${pattern}" (showing first ${files.length}).`);
        lines.push(`Use read_file to examine specific files, or narrow search with dir_path/include.`);
    } else {
        lines.push(`Found ${totalCount} file(s) matching pattern "${pattern}":`);
    }

    lines.push("");
    lines.push(...files);

    if (truncated) {
        lines.push("");
        lines.push("(Results truncated. Consider using a more specific pattern or path.)");
    }

    return lines.join("\n");
}

/**
 * 格式化 count 模式的输出
 */
function formatCountOutput(
    counts: Map<string, number>,
    totalFiles: number,
    totalMatches: number,
    truncated: boolean,
    pattern: string
): string {
    if (counts.size === 0) {
        return `No matches found for pattern "${pattern}"`;
    }

    const lines: string[] = [];

    if (truncated) {
        lines.push(`Found ${totalMatches} matches in ${totalFiles} files for pattern "${pattern}" (showing top ${counts.size} files).`);
    } else {
        lines.push(`Found ${totalMatches} matches in ${totalFiles} file(s) for pattern "${pattern}":`);
    }

    lines.push("");

    for (const [file, count] of counts) {
        lines.push(`${file}: ${count} match(es)`);
    }

    if (truncated) {
        lines.push("");
        lines.push("(Results truncated. Consider using a more specific pattern or path.)");
    }

    return lines.join("\n");
}

/**
 * 格式化 content 模式的输出，带字节数限制
 */
function formatContentOutput(
    matches: GrepMatch[],
    totalCount: number,
    truncated: boolean,
    pattern: string,
    maxOutputBytes: number
): string {
    if (matches.length === 0) {
        return `No matches found for pattern "${pattern}"`;
    }

    // 按文件分组
    const byFile = new Map<string, GrepMatch[]>();
    for (const match of matches) {
        if (!byFile.has(match.filePath)) {
            byFile.set(match.filePath, []);
        }
        byFile.get(match.filePath)!.push(match);
    }

    let output = "";
    let currentBytes = 0;
    let hitByteLimit = false;

    // 头部信息
    const header = truncated
        ? `Found ${totalCount} matches for pattern "${pattern}" (showing first ${matches.length}):\n\n`
        : `Found ${totalCount} match(es) for pattern "${pattern}":\n\n`;

    output += header;
    currentBytes += Buffer.byteLength(header, "utf8");

    for (const [filePath, fileMatches] of byFile) {
        const fileHeader = `${filePath}:\n`;
        const fileHeaderBytes = Buffer.byteLength(fileHeader, "utf8");

        if (currentBytes + fileHeaderBytes >= maxOutputBytes) {
            hitByteLimit = true;
            break;
        }

        output += fileHeader;
        currentBytes += fileHeaderBytes;

        // 每个文件最多显示 5 行匹配
        const displayMatches = fileMatches.slice(0, 5);

        for (const match of displayMatches) {
            // 截断过长的行
            let lineContent = match.line.trim();
            if (lineContent.length > MAX_LINE_LENGTH) {
                lineContent = lineContent.substring(0, MAX_LINE_LENGTH) + "...";
            }

            const line = `  L${match.lineNumber}: ${lineContent}\n`;
            const lineBytes = Buffer.byteLength(line, "utf8");

            if (currentBytes + lineBytes >= maxOutputBytes) {
                hitByteLimit = true;
                break;
            }

            output += line;
            currentBytes += lineBytes;
        }

        if (fileMatches.length > 5) {
            const moreInfo = `  ... and ${fileMatches.length - 5} more match(es) in this file\n`;
            if (currentBytes + Buffer.byteLength(moreInfo, "utf8") < maxOutputBytes) {
                output += moreInfo;
                currentBytes += Buffer.byteLength(moreInfo, "utf8");
            }
        }

        output += "\n";
        currentBytes += 1;

        if (hitByteLimit) break;
    }

    if (truncated || hitByteLimit) {
        const footer = "(Results truncated. Use read_file to see full content, or use a more specific pattern.)";
        output += footer;
    }

    return output.trim();
}

// ============ 工具描述生成 ============

function getToolDescription(outputMode: OutputMode, maxResults: number): string {
    const modeDescriptions: Record<OutputMode, string> = {
        files_only: `Returns ONLY file names that contain matches (most token-efficient).
After locating files, use read_file to examine specific content.`,
        count: `Returns file names with match counts per file.
Useful for understanding the distribution of matches across files.`,
        content: `Returns matching lines with context.
Output is limited by byte size to prevent token overflow.`,
    };

    return `Search for a regex pattern in files using ripgrep.

Current mode: ${outputMode}
${modeDescriptions[outputMode]}

Results limited to ${maxResults} items max.

Usage:
- Search all files: { pattern: "function.*myFunc" }
- Search in directory: { pattern: "import.*React", dir_path: "src" }
- Filter by file type: { pattern: "TODO", include: "*.ts" }
- Case-sensitive: { pattern: "ERROR", case_sensitive: true }

Pattern syntax (Rust regex):
- Word boundaries: \\bexactWord\\b
- Wildcards: .*
- Escape special chars: \\(, \\), \\[, \\]

Automatically ignores node_modules, .git, dist, build, etc.`;
}

// ============ 主工具创建函数 ============

/**
 * 创建 grep 工具
 */
export function createGrepTool({
    rootPath,
    additionalIgnorePatterns = [],
    outputMode = "content",
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    maxResults = MAX_RESULTS,
}: GrepToolParams) {
    // 确保 maxResults 不超过上限
    const effectiveMaxResults = Math.min(maxResults, MAX_RESULTS);

    return tool(
        async ({ pattern, dir_path, include, case_sensitive = false }) => {
            try {
                // 确保 ripgrep 可用
                const rgPath = await ensureRgPath();
                if (!rgPath) {
                    return "Error: Ripgrep is not available and could not be downloaded.";
                }

                // 解析搜索目录
                const searchDir = dir_path ? path.resolve(rootPath, dir_path) : rootPath;

                // 安全检查
                if (!searchDir.startsWith(rootPath)) {
                    return "Error: Directory path is outside the allowed root directory.";
                }

                // 合并忽略模式
                const ignorePatterns = mergeIgnorePatterns(additionalIgnorePatterns);
                const caseInsensitive = !case_sensitive;

                // 根据配置的 outputMode 执行不同的搜索
                switch (outputMode) {
                    case "files_only": {
                        const { files, totalCount, truncated } = await searchFilesOnly(
                            rgPath,
                            pattern,
                            searchDir,
                            include,
                            caseInsensitive,
                            ignorePatterns,
                            effectiveMaxResults
                        );
                        return formatFilesOnlyOutput(files, totalCount, truncated, pattern);
                    }

                    case "count": {
                        const { counts, totalFiles, totalMatches, truncated } = await searchWithCount(
                            rgPath,
                            pattern,
                            searchDir,
                            include,
                            caseInsensitive,
                            ignorePatterns,
                            effectiveMaxResults
                        );
                        return formatCountOutput(counts, totalFiles, totalMatches, truncated, pattern);
                    }

                    case "content": {
                        const { matches, totalCount, truncated } = await searchWithContent(
                            rgPath,
                            pattern,
                            searchDir,
                            include,
                            caseInsensitive,
                            ignorePatterns,
                            effectiveMaxResults
                        );
                        return formatContentOutput(matches, totalCount, truncated, pattern, maxOutputBytes);
                    }

                    default:
                        return `Error: Invalid output mode "${outputMode}"`;
                }
            } catch (error) {
                if (error instanceof Error) {
                    return `Error searching files: ${error.message}`;
                }
                return `Error searching files: ${String(error)}`;
            }
        },
        {
            name: "search_file_content",
            description: getToolDescription(outputMode, effectiveMaxResults),
            schema: z.object({
                pattern: z
                    .string()
                    .describe("Regex pattern to search for (e.g., 'function\\s+myFunc', 'import.*React')"),
                dir_path: z
                    .string()
                    .optional()
                    .describe("Directory to search in, relative to root. Omit to search entire root."),
                include: z
                    .string()
                    .optional()
                    .describe("Glob pattern to filter files (e.g., '*.ts', '*.{js,jsx}')"),
                case_sensitive: z
                    .boolean()
                    .optional()
                    .default(false)
                    .describe("Case-sensitive search. Defaults to false."),
            }),
        }
    );
}
