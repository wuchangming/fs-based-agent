import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { mergeIgnorePatterns } from "../utils/ignorePatterns.js";

export interface GrepToolParams {
    rootPath: string;
}

interface GrepMatch {
    filePath: string;
    lineNumber: number;
    line: string;
}

/**
 * Check if a command is available
 */
async function isCommandAvailable(command: string): Promise<boolean> {
    return new Promise((resolve) => {
        const checkCommand = process.platform === "win32" ? "where" : "command";
        const checkArgs = process.platform === "win32" ? [command] : ["-v", command];
        
        try {
            const child = spawn(checkCommand, checkArgs, {
                stdio: "ignore",
            });
            child.on("close", (code) => resolve(code === 0));
            child.on("error", () => resolve(false));
        } catch {
            resolve(false);
        }
    });
}

/**
 * Parse grep output (format: filepath:lineNumber:lineContent)
 */
function parseGrepOutput(output: string, basePath: string): GrepMatch[] {
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
 * Try ripgrep search
 */
async function tryRipgrep(
    pattern: string,
    searchPath: string,
    include?: string,
    caseInsensitive?: boolean,
    context?: number,
    ignorePatterns?: string[]
): Promise<GrepMatch[] | null> {
    const rgAvailable = await isCommandAvailable("rg");
    if (!rgAvailable) return null;
    
    try {
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
        if (ignorePatterns) {
            ignorePatterns.forEach((pattern) => {
                args.push("--glob", `!${pattern}`);
            });
        }
        
        args.push(pattern, searchPath);
        
        const output = await new Promise<string>((resolve, reject) => {
            const child = spawn("rg", args, { windowsHide: true });
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
        
        return parseGrepOutput(output, searchPath);
    } catch (error) {
        return null;
    }
}

/**
 * Try git grep search
 */
async function tryGitGrep(
    pattern: string,
    searchPath: string,
    include?: string,
    caseInsensitive?: boolean
): Promise<GrepMatch[] | null> {
    const gitAvailable = await isCommandAvailable("git");
    if (!gitAvailable) return null;
    
    // Check if searchPath is in a git repository
    try {
        await new Promise<void>((resolve, reject) => {
            const child = spawn("git", ["rev-parse", "--git-dir"], {
                cwd: searchPath,
                stdio: "ignore",
            });
            child.on("close", (code) => (code === 0 ? resolve() : reject()));
            child.on("error", reject);
        });
    } catch {
        return null; // Not a git repository
    }
    
    try {
        const args = ["grep", "--untracked", "-n", "-E"];
        
        if (caseInsensitive) {
            args.push("--ignore-case");
        }
        
        args.push(pattern);
        
        if (include) {
            args.push("--", include);
        }
        
        const output = await new Promise<string>((resolve, reject) => {
            const child = spawn("git", args, { cwd: searchPath, windowsHide: true });
            const stdoutChunks: Buffer[] = [];
            
            child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
            child.on("error", (err) => reject(err));
            child.on("close", (code) => {
                const stdoutData = Buffer.concat(stdoutChunks).toString("utf8");
                if (code === 0 || code === 1) {
                    resolve(stdoutData);
                } else {
                    reject(new Error(`git grep exited with code ${code}`));
                }
            });
        });
        
        return parseGrepOutput(output, searchPath);
    } catch (error) {
        return null;
    }
}

/**
 * Try system grep search
 */
async function trySystemGrep(
    pattern: string,
    searchPath: string,
    include?: string,
    caseInsensitive?: boolean,
    ignorePatterns?: string[]
): Promise<GrepMatch[] | null> {
    const grepAvailable = await isCommandAvailable("grep");
    if (!grepAvailable) return null;
    
    try {
        const args = ["-r", "-n", "-E"];
        
        if (caseInsensitive) {
            args.push("-i");
        }
        
        // Add exclude patterns
        if (ignorePatterns) {
            ignorePatterns.forEach((pattern) => {
                if (!pattern.includes("*") && !pattern.includes("/")) {
                    args.push(`--exclude-dir=${pattern}`);
                }
            });
        }
        
        if (include) {
            args.push(`--include=${include}`);
        }
        
        args.push(pattern, ".");
        
        const output = await new Promise<string>((resolve, reject) => {
            const child = spawn("grep", args, { cwd: searchPath, windowsHide: true });
            const stdoutChunks: Buffer[] = [];
            
            child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
            child.on("error", (err) => reject(err));
            child.on("close", (code) => {
                const stdoutData = Buffer.concat(stdoutChunks).toString("utf8");
                if (code === 0 || code === 1) {
                    resolve(stdoutData);
                } else {
                    resolve(""); // Suppress other errors
                }
            });
        });
        
        return parseGrepOutput(output, searchPath);
    } catch (error) {
        return null;
    }
}

/**
 * Fallback to JavaScript-based search
 */
async function jsGrep(
    pattern: string,
    searchPath: string,
    include?: string,
    caseInsensitive?: boolean,
    ignorePatterns?: string[]
): Promise<GrepMatch[]> {
    const regex = new RegExp(pattern, caseInsensitive ? "i" : "");
    const globPattern = include || "**/*";
    const allMatches: GrepMatch[] = [];
    
    const files = await glob(globPattern, {
        cwd: searchPath,
        nodir: true,
        dot: true,
        ignore: ignorePatterns || [],
        absolute: true,
    });
    
    for (const filePath of files) {
        try {
            const content = await fs.readFile(filePath, "utf8");
            const lines = content.split(/\r?\n/);
            
            lines.forEach((line, index) => {
                if (regex.test(line)) {
                    allMatches.push({
                        filePath: path.relative(searchPath, filePath),
                        lineNumber: index + 1,
                        line,
                    });
                }
            });
        } catch (error) {
            // Skip files we can't read
        }
    }
    
    return allMatches;
}

/**
 * Create a tool for searching file contents
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
                
                // Try different grep strategies in order
                let matches: GrepMatch[] = [];
                
                // 1. Try ripgrep (fastest)
                const ripgrepResult = await tryRipgrep(
                    pattern,
                    searchDir,
                    include,
                    caseInsensitive,
                    context,
                    allIgnorePatterns
                );
                
                if (ripgrepResult !== null) {
                    matches = ripgrepResult;
                } else {
                    // 2. Try git grep
                    const gitGrepResult = await tryGitGrep(pattern, searchDir, include, caseInsensitive);
                    
                    if (gitGrepResult !== null) {
                        matches = gitGrepResult;
                    } else {
                        // 3. Try system grep
                        const systemGrepResult = await trySystemGrep(
                            pattern,
                            searchDir,
                            include,
                            caseInsensitive,
                            allIgnorePatterns
                        );
                        
                        if (systemGrepResult !== null) {
                            matches = systemGrepResult;
                        } else {
                            // 4. Fallback to JavaScript implementation
                            matches = await jsGrep(
                                pattern,
                                searchDir,
                                include,
                                caseInsensitive,
                                allIgnorePatterns
                            );
                        }
                    }
                }
                
                if (matches.length === 0) {
                    const location = dir_path ? ` in '${dir_path}'` : "";
                    const filter = include ? ` (filter: "${include}")` : "";
                    return `No matches found for pattern "${pattern}"${location}${filter}`;
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
                let result = `Found ${matches.length} match(es) for pattern "${pattern}"${location}${filter}:\n---\n`;
                
                for (const filePath in matchesByFile) {
                    result += `File: ${filePath}\n`;
                    for (const match of matchesByFile[filePath]!) {
                        result += `L${match.lineNumber}: ${match.line.trim()}\n`;
                    }
                    result += "---\n";
                }
                
                return result.trim();
            } catch (error) {
                if (error instanceof Error) {
                    return `Error searching files: ${error.message}`;
                }
                return `Error searching files: ${String(error)}`;
            }
        },
        {
            name: "search_file_content",
            description: `Searches for a regular expression pattern within the content of files. Returns matching lines with file paths and line numbers. Uses ripgrep for performance when available, with automatic fallback to git grep, system grep, or JavaScript implementation.

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

The tool automatically ignores common patterns like node_modules, .git, dist, build, etc.`,
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
                    .describe("Number of lines of context to show around each match (only works with ripgrep)."),
            }),
        }
    );
}

