import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { glob } from "glob";
import path from "node:path";
import { mergeIgnorePatterns } from "./utils/ignorePatterns.js";

const LIMIT = 100;

export interface GlobToolParams {
    rootPath: string;
    additionalIgnorePatterns?: string[];
}

/**
 * Create a tool for finding files matching glob patterns
 */
export function createGlobTool({ rootPath, additionalIgnorePatterns = [] }: GlobToolParams) {
    return tool(
        async ({ pattern, dir_path, ignore = [], case_sensitive = false }) => {
            try {
                // Resolve the search directory
                const searchDir = dir_path
                    ? path.resolve(rootPath, dir_path)
                    : rootPath;
                
                // Security check: ensure the path is within rootPath
                if (!searchDir.startsWith(rootPath)) {
                    return `Error: Directory path is outside the allowed root directory`;
                }
                
                // Merge ignore patterns with additional patterns
                const allIgnorePatterns = mergeIgnorePatterns([...ignore, ...additionalIgnorePatterns]);
                
                // Search for matching files
                // Note: cannot use `absolute` option together with `withFileTypes: true`
                const matches = await glob(pattern, {
                    cwd: searchDir,
                    nodir: true, // Only return files, not directories
                    dot: true, // Include dotfiles
                    ignore: allIgnorePatterns,
                    nocase: !case_sensitive,
                    withFileTypes: true, // Get Path objects with stats
                    stat: true, // Include file stats for sorting
                }) as Array<{ fullpath(): string; mtimeMs?: number }>;
                
                if (matches.length === 0) {
                    const location = dir_path ? `within '${dir_path}'` : "in the root directory";
                    return `No files found matching pattern "${pattern}" ${location}`;
                }
                
                // Sort by modification time (newest first)
                const sorted = matches.sort((a, b) => {
                    const mtimeA = (a.mtimeMs ?? 0);
                    const mtimeB = (b.mtimeMs ?? 0);
                    return mtimeB - mtimeA;
                });
                
                // Check if results need to be truncated
                const truncated = sorted.length > LIMIT;
                const limitedResults = truncated ? sorted.slice(0, LIMIT) : sorted;
                
                // Get file paths
                const filePaths = limitedResults.map((match) => {
                    const fullPath = path.join(searchDir, match.fullpath());
                    return path.relative(rootPath, fullPath);
                });
                
                const location = dir_path ? ` within '${dir_path}'` : "";
                const truncateNote = truncated 
                    ? ` (showing first ${LIMIT} of ${sorted.length} total, truncated)`
                    : "";
                const result = `Found ${filePaths.length} file(s) matching "${pattern}"${location}${truncateNote}, sorted by modification time (newest first):\n${filePaths.join("\n")}`;
                
                return result;
            } catch (error) {
                if (error instanceof Error) {
                    return `Error searching for files: ${error.message}`;
                }
                return `Error searching for files: ${String(error)}`;
            }
        },
        {
            name: "find_files",
            description: `Efficiently finds files matching specific glob patterns (e.g., 'src/**/*.ts', '**/*.md'), returning paths sorted by modification time (newest first). Ideal for quickly locating files based on their name or path structure.

Usage examples:
- Find all TypeScript files: { pattern: "**/*.ts" }
- Find files in specific directory: { pattern: "*.json", dir_path: "config" }
- Case-sensitive search: { pattern: "README.md", case_sensitive: true }
- With custom ignores: { pattern: "**/*.js", ignore: ["test/**"] }

Common patterns:
- "**/*.ext" - All files with extension recursively
- "*.ext" - Files with extension in current directory only
- "dir/**/*" - All files in a directory recursively
- "**/{name1,name2}.ext" - Multiple specific files

The tool automatically ignores common patterns like node_modules, .git, dist, build, etc.`,
            schema: z.object({
                pattern: z
                    .string()
                    .describe("The glob pattern to match files against (e.g., '**/*.py', 'docs/*.md')"),
                dir_path: z
                    .string()
                    .optional()
                    .describe("Optional directory to search within, relative to root. If omitted, searches from root directory."),
                ignore: z
                    .array(z.string())
                    .optional()
                    .describe("Optional array of glob patterns to exclude (e.g., ['test/**', '*.log']). Added to default ignores."),
                case_sensitive: z
                    .boolean()
                    .optional()
                    .default(false)
                    .describe("Whether the search should be case-sensitive. Defaults to false."),
            }),
        }
    );
}

