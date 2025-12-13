import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { spawn } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { DEFAULT_IGNORE_PATTERNS } from "./utils/ignorePatterns.js";
import { ensureRgPath } from "./utils/ripgrepInstaller.js";

// ============ Configuration Constants ============
const MAX_RESULTS = 2000;               // Maximum 2000 results
const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024;  // 64KB output limit (~16K tokens)
const MAX_LINE_LENGTH = 350;           // Maximum line length (for content mode preview)

// ============ Type Definitions ============

/**
 * Output modes for grep tool
 * 
 * | Mode        | ripgrep flag | Returns                      | Token cost | Use case                              |
 * |-------------|--------------|------------------------------|------------|---------------------------------------|
 * | files_only  | rg -l        | Only file name list          | Least ✅   | Locate files first, then read_file   |
 * | count       | rg -c        | File name + match count      | Less       | Understand match distribution         |
 * | content     | rg --json    | File + line + match content  | Most       | Quick preview with byte limit         |
 * 
 * @example files_only mode output
 * ```
 * Found 50 files matching pattern "useState":
 * src/App.tsx
 * src/hooks/useAuth.ts
 * src/components/Button.tsx
 * ...
 * ```
 * 
 * @example count mode output
 * ```
 * Found 120 matches in 50 files:
 * src/App.tsx: 15 match(es)
 * src/hooks/useAuth.ts: 8 match(es)
 * ...
 * ```
 * 
 * @example content mode output
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
    /** Output mode: files_only, count, content (default) */
    outputMode?: OutputMode;
    /** Maximum output bytes, default 64KB */
    maxOutputBytes?: number;
    /** Maximum results, default 100 */
    maxResults?: number;
}

interface GrepMatch {
    filePath: string;
    lineNumber: number;
    line: string;
    modTime?: number;
}

// ============ Common ripgrep Execution Functions ============

/**
 * Execute ripgrep command and return output
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
 * Build common ripgrep arguments
 */
function buildCommonArgs(
    include?: string,
    caseInsensitive?: boolean,
    ignorePatterns?: string[]
): string[] {
    const args: string[] = [];

    // Do not respect .gitignore rules, ensure all files are searched
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

// ============ Search Function: files_only Mode ============

/**
 * Return only file names containing matches (using rg -l)
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

    // Get file modification time and sort (most recent first)
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

// ============ Search Function: count Mode ============

/**
 * Return match count per file (using rg -c)
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

    // Sort by match count (highest first), then by modification time
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

// ============ Search Function: content Mode ============

/**
 * Return match content (using rg --json), with byte limit
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

    // Sort by modification time (most recent first)
    matches.sort((a, b) => (b.modTime || 0) - (a.modTime || 0));

    const totalCount = matches.length;
    const truncated = totalCount > maxResults;

    return {
        matches: matches.slice(0, maxResults),
        totalCount,
        truncated,
    };
}

// ============ Output Formatting Functions ============

/**
 * Format files_only mode output
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
 * Format count mode output
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
 * Format content mode output with byte limit
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

    // Group by file
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

    // Header info
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

        // Show at most 5 matches per file
        const displayMatches = fileMatches.slice(0, 5);

        for (const match of displayMatches) {
            // Truncate lines that are too long
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

// ============ Tool Description Generation ============

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

// ============ Main Tool Creation Function ============

/**
 * Create grep tool
 */
export function createGrepTool({
    rootPath,
    additionalIgnorePatterns = [],
    outputMode = "content",
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
    maxResults = MAX_RESULTS,
}: GrepToolParams) {
    // Ensure maxResults does not exceed the limit
    const effectiveMaxResults = Math.min(maxResults, MAX_RESULTS);

    return tool(
        async ({ pattern, dir_path, include, case_sensitive = false }) => {
            try {
                // Ensure ripgrep is available
                const rgPath = await ensureRgPath();
                if (!rgPath) {
                    return "Error: Ripgrep is not available and could not be downloaded.";
                }

                // Parse search directory
                const searchDir = dir_path ? path.resolve(rootPath, dir_path) : rootPath;

                // Security check
                if (!searchDir.startsWith(rootPath)) {
                    return "Error: Directory path is outside the allowed root directory.";
                }

                // Merge ignore patterns
                const ignorePatterns = [...DEFAULT_IGNORE_PATTERNS, ...additionalIgnorePatterns];
                const caseInsensitive = !case_sensitive;

                // Execute different search based on configured outputMode
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
