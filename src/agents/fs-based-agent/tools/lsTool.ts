import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { mergeIgnorePatterns, shouldIgnore } from "../utils/ignorePatterns.js";

export interface LSToolParams {
    rootPath: string;
}

/**
 * Create a tool for listing directory contents
 */
export function createLSTool({ rootPath }: LSToolParams) {
    return tool(
        async ({ dir_path, ignore = [] }) => {
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
                
                // Read directory contents
                const entries = await fs.readdir(resolvedPath);
                
                if (entries.length === 0) {
                    return `Directory '${dir_path}' is empty.`;
                }
                
                // Merge ignore patterns
                const allIgnorePatterns = mergeIgnorePatterns(ignore);
                
                // Get stats for each entry and filter
                const fileInfos = await Promise.all(
                    entries.map(async (entry) => {
                        const fullPath = path.join(resolvedPath, entry);
                        const relativePath = path.relative(rootPath, fullPath);
                        
                        // Check if should be ignored
                        if (shouldIgnore(relativePath, ignore)) {
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
            description: `Lists the names of files and subdirectories within a specified directory path. Returns entries sorted with directories first, then alphabetically. Can optionally ignore entries matching provided patterns.

Usage examples:
- List root directory: { dir_path: "." }
- List subdirectory: { dir_path: "src" }
- List with custom ignores: { dir_path: ".", ignore: ["*.log", "temp"] }

The tool automatically ignores common patterns like node_modules, .git, dist, build, etc.`,
            schema: z.object({
                dir_path: z
                    .string()
                    .describe("The directory path to list, relative to the root path. Use '.' for the root directory."),
                ignore: z
                    .array(z.string())
                    .optional()
                    .describe("Optional array of glob patterns to ignore (e.g., ['*.log', 'temp']). These are added to default ignore patterns."),
            }),
        }
    );
}

