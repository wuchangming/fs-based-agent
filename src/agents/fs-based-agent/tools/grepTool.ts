import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { spawn } from "node:child_process";
import path from "node:path";
import { mergeIgnorePatterns } from "../utils/ignorePatterns.js";
import { ensureRipgrepAvailable } from "../utils/ripgrepUtils.js";

export interface GrepToolParams {
    rootPath: string;
}

interface GrepMatch {
    filePath: string;
    lineNumber: number;
    line: string;
}

/**
 * Parse ripgrep output (format: filepath:lineNumber:lineContent)
 */
function parseRipgrepOutput(output: string, basePath: string): GrepMatch[] {
    const results: GrepMatch[] = [];
    if (!output) return results;
    
    const lines = output.split("\n");
    
    for (const line of lines) {
        if (!line.trim()) continue;
        
        const firstColonIndex = line.indexOf(":");
        if (firstColonIndex === -1) continue;
        
        const secondColonIndex = line.indexOf(":", firstColonIndex + 1);
        if (secondColonIndex === -1) continue;
        
        const filePathRaw = line.substring(0, firstColonIndex);
        const lineNumberStr = line.substring(firstColonIndex + 1, secondColonIndex);
        const lineContent = line.substring(secondColonIndex + 1);
        
        const lineNumber = parseInt(lineNumberStr, 10);
        
        if (!isNaN(lineNumber)) {
            results.push({
                filePath: filePathRaw,
                lineNumber,
                line: lineContent,
            });
        }
    }
    
    return results;
}

/**
 * Perform ripgrep search
 */
async function ripgrepSearch(
    pattern: string,
    searchPath: string,
    include?: string,
    caseInsensitive?: boolean,
    context?: number,
    ignorePatterns?: string[]
): Promise<GrepMatch[]> {
    // Ensure ripgrep is available
    const rgPath = await ensureRipgrepAvailable();
    
    const args = ["--line-number", "--no-heading"];
    
    if (caseInsensitive) {
        args.push("--ignore-case");
    }
    
    if (context !== undefined && context > 0) {
        args.push("--context", context.toString());
    }
    
    if (include) {
        args.push("--glob", include);
    }
    
    // Add ignore patterns
    if (ignorePatterns && ignorePatterns.length > 0) {
        ignorePatterns.forEach((pattern) => {
            args.push("--glob", `!${pattern}`);
        });
    }
    
    args.push(pattern, searchPath);
    
    const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(rgPath, args, { windowsHide: true });
        const stdoutChunks: Buffer[] = [];
        const stderrChunks: Buffer[] = [];
        
        child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
        child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
        child.on("error", (err) => reject(err));
        child.on("close", (code) => {
            const stdoutData = Buffer.concat(stdoutChunks).toString("utf8");
            if (code === 0) {
                resolve(stdoutData);
            } else if (code === 1) {
                resolve(""); // No matches
            } else {
                const stderrData = Buffer.concat(stderrChunks).toString("utf8");
                reject(new Error(`ripgrep exited with code ${code}: ${stderrData}`));
            }
        });
    });
    
    return parseRipgrepOutput(output, searchPath);
}

/**
 * Create a tool for searching file contents using ripgrep
 */
export function createGrepTool({ rootPath }: GrepToolParams) {
    return tool(
        async ({
            pattern,
            dir_path,
            include,
            case_sensitive = false,
            context,
        }) => {
            try {
                // Resolve the search directory
                const searchDir = dir_path
                    ? path.resolve(rootPath, dir_path)
                    : rootPath;
                
                // Security check
                if (!searchDir.startsWith(rootPath)) {
                    return `Error: Directory path is outside the allowed root directory`;
                }
                
                // Merge ignore patterns
                const allIgnorePatterns = mergeIgnorePatterns([]);
                const caseInsensitive = !case_sensitive;
                
                // Perform ripgrep search (will throw if ripgrep not available)
                let matches = await ripgrepSearch(
                    pattern,
                    searchDir,
                    include,
                    caseInsensitive,
                    context,
                    allIgnorePatterns
                );
                
                if (matches.length === 0) {
                    const location = dir_path ? ` in '${dir_path}'` : "";
                    const filter = include ? ` (filter: "${include}")` : "";
                    return `No matches found for pattern "${pattern}"${location}${filter}`;
                }
                
                // Limits
                const MAX_MATCHES = 2000;
                const MAX_LINE_LENGTH = 2000;
                let matchesLimited = false;
                
                // Limit number of matches
                if (matches.length > MAX_MATCHES) {
                    matches = matches.slice(0, MAX_MATCHES);
                    matchesLimited = true;
                }
                
                // Group matches by file
                const matchesByFile: Record<string, GrepMatch[]> = {};
                for (const match of matches) {
                    if (!matchesByFile[match.filePath]) {
                        matchesByFile[match.filePath] = [];
                    }
                    matchesByFile[match.filePath]!.push(match);
                }
                
                // Sort matches within each file by line number
                for (const filePath in matchesByFile) {
                    matchesByFile[filePath]!.sort((a, b) => a.lineNumber - b.lineNumber);
                }
                
                // Format output
                const location = dir_path ? ` in '${dir_path}'` : "";
                const filter = include ? ` (filter: "${include}")` : "";
                const matchTerm = matches.length === 1 ? "match" : "matches";
                let result = `Found ${matches.length} ${matchTerm} for pattern "${pattern}"${location}${filter}`;
                
                if (matchesLimited) {
                    result += ` (limited to ${MAX_MATCHES} matches)`;
                }
                
                result += `:\n---\n`;
                
                for (const filePath in matchesByFile) {
                    result += `File: ${filePath}\n`;
                    
                    for (const match of matchesByFile[filePath]!) {
                        const trimmedLine = match.line.trim();
                        // Limit line length
                        const displayLine = trimmedLine.length > MAX_LINE_LENGTH 
                            ? trimmedLine.substring(0, MAX_LINE_LENGTH) + `... [line truncated, total ${trimmedLine.length} chars]`
                            : trimmedLine;
                        result += `L${match.lineNumber}: ${displayLine}\n`;
                    }
                    
                    result += "---\n";
                }
                
                return result.trim();
            } catch (error) {
                if (error instanceof Error) {
                    return error.message;
                }
                return `Error searching files: ${String(error)}`;
            }
        },
        {
            name: "search_file_content",
            description: `Searches for a regular expression pattern within the content of files using ripgrep (rg). Returns matching lines with file paths and line numbers.

Usage examples:
- Search in all files: { pattern: "function.*myFunc" }
- Search in specific directory: { pattern: "import.*React", dir_path: "src" }
- Filter by file type: { pattern: "class.*Component", include: "*.ts" }
- Case-sensitive search: { pattern: "TODO", case_sensitive: true }
- With context lines: { pattern: "error", context: 2 }

Pattern syntax:
- Regular expressions (extended/ERE syntax)
- Use \\b for word boundaries: "\\bexactWord\\b"
- Use .* for wildcards
- Escape special characters: \\(, \\), \\[, \\]

Limits:
- Maximum 2000 matching lines (results are truncated if exceeded)
- Maximum 2000 characters per line (lines are truncated if exceeded)

The tool automatically ignores common patterns like node_modules, .git, dist, build, etc.
Requires ripgrep (rg) to be installed on the system.`,
            schema: z.object({
                pattern: z
                    .string()
                    .describe("The regular expression pattern to search for (e.g., 'function\\s+myFunc', 'import.*React')"),
                dir_path: z
                    .string()
                    .optional()
                    .describe("Optional directory to search within, relative to root. If omitted, searches from root directory."),
                include: z
                    .string()
                    .optional()
                    .describe("Optional glob pattern to filter files (e.g., '*.js', '*.{ts,tsx}'). If omitted, searches all files."),
                case_sensitive: z
                    .boolean()
                    .optional()
                    .default(false)
                    .describe("Whether the search should be case-sensitive. Defaults to false."),
                context: z
                    .number()
                    .optional()
                    .describe("Number of lines of context to show around each match."),
            }),
        }
    );
}
