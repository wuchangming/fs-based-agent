import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { shouldIgnore } from "./utils/ignorePatterns.js";

export interface LSToolParams {
    rootPath: string;
    additionalIgnorePatterns?: string[];
    /** Maximum number of items to return in recursive mode. Default is 1000. */
    recursiveLimit?: number;
}

interface FileInfo {
    name: string;
    relativePath: string;
    isDirectory: boolean;
    size: number;
    modifiedTime: Date;
}

// Default timeout for recursive operations (10 seconds)
const RECURSIVE_TIMEOUT_MS = 10_000;

/**
 * Recursively list files using BFS (Breadth-First Search)
 * This ensures we get a representative sample of the directory structure
 */
async function listFilesRecursive(
    rootPath: string,
    startPath: string,
    ignorePatterns: string[],
    limit: number
): Promise<{ files: FileInfo[]; truncated: boolean }> {
    const results: FileInfo[] = [];
    const queue: string[] = [startPath];
    let truncated = false;

    const startTime = Date.now();

    while (queue.length > 0 && results.length < limit) {
        // Check for timeout
        if (Date.now() - startTime > RECURSIVE_TIMEOUT_MS) {
            console.warn("Recursive listing timed out, returning partial results");
            truncated = true;
            break;
        }

        const currentPath = queue.shift()!;

        try {
            const entries = await fs.readdir(currentPath);

            for (const entry of entries) {
                if (results.length >= limit) {
                    truncated = true;
                    break;
                }

                const fullPath = path.join(currentPath, entry);
                const relativePath = path.relative(rootPath, fullPath);

                // Check if should be ignored
                if (shouldIgnore(relativePath, ignorePatterns)) {
                    continue;
                }

                try {
                    const stats = await fs.stat(fullPath);
                    const fileInfo: FileInfo = {
                        name: entry,
                        relativePath,
                        isDirectory: stats.isDirectory(),
                        size: stats.size,
                        modifiedTime: stats.mtime,
                    };

                    results.push(fileInfo);

                    // Add directories to the queue for further exploration
                    if (stats.isDirectory()) {
                        queue.push(fullPath);
                    }
                } catch {
                    // Skip files we can't access
                    continue;
                }
            }
        } catch {
            // Skip directories we can't read
            continue;
        }
    }

    // Check if we hit the limit
    if (queue.length > 0 && results.length >= limit) {
        truncated = true;
    }

    return { files: results, truncated };
}

// Default limit for recursive operations (same as cline)
const DEFAULT_RECURSIVE_LIMIT = 200;

/**
 * Create a tool for listing directory contents
 */
export function createLSTool({ rootPath, additionalIgnorePatterns = [], recursiveLimit = DEFAULT_RECURSIVE_LIMIT }: LSToolParams) {
    return tool(
        async ({ dir_path, ignore = [], recursive = true }) => {
            try {
                // Resolve the directory path relative to rootPath
                const resolvedPath = path.resolve(rootPath, dir_path);
                
                // Security check: ensure the path is within rootPath
                if (!resolvedPath.startsWith(rootPath)) {
                    return `Error: Path '${dir_path}' is outside the allowed root directory`;
                }
                
                // Check if the directory exists
                const stats = await fs.stat(resolvedPath);
                if (!stats.isDirectory()) {
                    return `Error: Path '${dir_path}' is not a directory`;
                }

                // Merge ignore patterns with additional patterns
                const allIgnorePatterns = [...ignore, ...additionalIgnorePatterns];

                // Handle recursive listing
                if (recursive) {
                    const { files, truncated } = await listFilesRecursive(
                        rootPath,
                        resolvedPath,
                        allIgnorePatterns,
                        recursiveLimit
                    );

                    if (files.length === 0) {
                        return `Directory '${dir_path}' is empty or all files are ignored.`;
                    }

                    // Sort: directories first, then by relative path alphabetically
                    files.sort((a, b) => {
                        if (a.isDirectory && !b.isDirectory) return -1;
                        if (!a.isDirectory && b.isDirectory) return 1;
                        return a.relativePath.localeCompare(b.relativePath);
                    });

                    // Format output with relative paths
                    const formattedEntries = files.map((entry) => {
                        const prefix = entry.isDirectory ? "[DIR] " : "";
                        return `${prefix}${entry.relativePath}`;
                    });

                    let result = `Directory listing for '${dir_path}' (recursive):\n${formattedEntries.join("\n")}`;

                    if (truncated) {
                        result += `\n\n(Results truncated at ${recursiveLimit} items. Use more specific path or ignore patterns to narrow down.)`;
                    } else {
                        result += `\n\n(${files.length} items total)`;
                    }

                    return result;
                }
                
                // Non-recursive listing (original behavior)
                const entries = await fs.readdir(resolvedPath);
                
                if (entries.length === 0) {
                    return `Directory '${dir_path}' is empty.`;
                }
                
                // Get stats for each entry and filter
                const fileInfos = await Promise.all(
                    entries.map(async (entry) => {
                        const fullPath = path.join(resolvedPath, entry);
                        const relativePath = path.relative(rootPath, fullPath);
                        
                        // Check if should be ignored
                        if (shouldIgnore(relativePath, allIgnorePatterns)) {
                            return null;
                        }
                        
                        try {
                            const stats = await fs.stat(fullPath);
                            return {
                                name: entry,
                                isDirectory: stats.isDirectory(),
                                size: stats.size,
                                modifiedTime: stats.mtime,
                            };
                        } catch (error) {
                            // Skip files we can't access
                            return null;
                        }
                    })
                );
                
                // Filter out null entries and sort
                const validEntries = fileInfos.filter((info) => info !== null);
                
                // Sort: directories first, then alphabetically
                validEntries.sort((a, b) => {
                    if (a!.isDirectory && !b!.isDirectory) return -1;
                    if (!a!.isDirectory && b!.isDirectory) return 1;
                    return a!.name.localeCompare(b!.name);
                });
                
                // Format output
                const formattedEntries = validEntries.map((entry) => {
                    const prefix = entry!.isDirectory ? "[DIR] " : "";
                    return `${prefix}${entry!.name}`;
                });
                
                const ignoredCount = entries.length - validEntries.length;
                let result = `Directory listing for '${dir_path}':\n${formattedEntries.join("\n")}`;
                
                if (ignoredCount > 0) {
                    result += `\n\n(${ignoredCount} items ignored)`;
                }
                
                return result;
            } catch (error) {
                if (error instanceof Error) {
                    if ((error as any).code === "ENOENT") {
                        return `Error: Directory '${dir_path}' does not exist`;
                    }
                    if ((error as any).code === "EACCES") {
                        return `Error: Permission denied accessing '${dir_path}'`;
                    }
                    return `Error listing directory: ${error.message}`;
                }
                return `Error listing directory: ${String(error)}`;
            }
        },
        {
            name: "list_directory",
            description: `Lists the names of files and subdirectories within a specified directory path. Returns entries sorted with directories first, then alphabetically. Supports recursive listing to explore nested directory structures.

Usage examples:
- List root directory: { dir_path: "." }
- List subdirectory: { dir_path: "src" }
- List with custom ignores: { dir_path: ".", ignore: ["*.log", "temp"] }
- Recursive listing: { dir_path: ".", recursive: true }
- Recursive listing of specific path: { dir_path: "src/components", recursive: true }

The tool automatically ignores common patterns like node_modules, .git, dist, build, etc.
When using recursive mode, results are returned with relative paths. If results exceed the limit, a truncation notice will be shown.`,
            schema: z.object({
                dir_path: z
                    .string()
                    .describe("The directory path to list, relative to the root path. Use '.' for the root directory."),
                ignore: z
                    .array(z.string())
                    .optional()
                    .describe("Optional array of glob patterns to ignore (e.g., ['*.log', 'temp']). These are added to default ignore patterns."),
                recursive: z
                    .boolean()
                    .optional()
                    .describe("If true, recursively list all files and subdirectories using breadth-first traversal. Default is true."),
            }),
        }
    );
}
