import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { glob } from "glob";
import { mergeIgnorePatterns, shouldIgnore } from "../utils/ignorePatterns.js";

export interface ReadManyFilesToolParams {
    rootPath: string;
}

const MAX_FILE_SIZE = 100000; // 100KB per file
const MAX_TOTAL_SIZE = 500000; // 500KB total
const MAX_LINE_LENGTH = 2000;

/**
 * Create a tool for reading multiple files at once
 */
export function createReadManyFilesTool({ rootPath }: ReadManyFilesToolParams) {
    return tool(
        async ({ include, exclude = [], dir_path }) => {
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
                const allIgnorePatterns = mergeIgnorePatterns(exclude);
                
                // Find all matching files
                const allFiles = new Set<string>();
                
                for (const pattern of include) {
                    const matches = await glob(pattern, {
                        cwd: searchDir,
                        nodir: true,
                        dot: true,
                        ignore: allIgnorePatterns,
                        absolute: true,
                    });
                    
                    matches.forEach((file) => allFiles.add(file));
                }
                
                if (allFiles.size === 0) {
                    const location = dir_path ? ` in '${dir_path}'` : "";
                    return `No files found matching patterns: ${include.join(", ")}${location}`;
                }
                
                // Sort files alphabetically
                const sortedFiles = Array.from(allFiles).sort();
                
                // Read files
                const results: Array<{
                    path: string;
                    content: string;
                    error?: string;
                    skipped?: boolean;
                }> = [];
                
                let totalSize = 0;
                let filesRead = 0;
                
                for (const filePath of sortedFiles) {
                    const relativePath = path.relative(rootPath, filePath);
                    
                    // Check if file should be ignored
                    if (shouldIgnore(relativePath, exclude)) {
                        results.push({
                            path: relativePath,
                            content: "",
                            skipped: true,
                        });
                        continue;
                    }
                    
                    try {
                        const stats = await fs.stat(filePath);
                        
                        // Skip if file is too large
                        if (stats.size > MAX_FILE_SIZE) {
                            results.push({
                                path: relativePath,
                                content: "",
                                error: `File too large (${stats.size} bytes, max ${MAX_FILE_SIZE})`,
                            });
                            continue;
                        }
                        
                        // Check total size limit
                        if (totalSize + stats.size > MAX_TOTAL_SIZE) {
                            results.push({
                                path: relativePath,
                                content: "",
                                error: `Total size limit reached (${MAX_TOTAL_SIZE} bytes)`,
                            });
                            continue;
                        }
                        
                        // Read the file
                        const content = await fs.readFile(filePath, "utf8");
                        
                        // Check for binary content
                        if (content.includes("\0")) {
                            results.push({
                                path: relativePath,
                                content: "",
                                error: "Binary file skipped",
                            });
                            continue;
                        }
                        
                        // Truncate very long lines
                        const lines = content.split(/\r?\n/);
                        const truncatedLines = lines.map((line) => {
                            if (line.length > MAX_LINE_LENGTH) {
                                return line.substring(0, MAX_LINE_LENGTH) + "... [line truncated]";
                            }
                            return line;
                        });
                        
                        results.push({
                            path: relativePath,
                            content: truncatedLines.join("\n"),
                        });
                        
                        totalSize += stats.size;
                        filesRead++;
                    } catch (error) {
                        results.push({
                            path: relativePath,
                            content: "",
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
                
                // Format output
                let output = `Successfully processed ${filesRead} file(s) matching patterns: ${include.join(", ")}\n`;
                
                const skipped = results.filter((r) => r.skipped || r.error);
                if (skipped.length > 0) {
                    output += `Skipped ${skipped.length} file(s)\n`;
                }
                
                output += `${"=".repeat(80)}\n\n`;
                
                for (const result of results) {
                    if (result.error || result.skipped) {
                        continue; // Skip files with errors in the main output
                    }
                    
                    output += `--- ${result.path} ---\n\n`;
                    output += result.content;
                    output += `\n\n`;
                }
                
                output += `${"=".repeat(80)}\n`;
                output += `End of content (${filesRead} files read, ${totalSize} bytes total)\n`;
                
                // Add error summary if any
                const errors = results.filter((r) => r.error);
                if (errors.length > 0) {
                    output += `\nFiles with errors or skipped:\n`;
                    for (const error of errors) {
                        output += `- ${error.path}: ${error.error}\n`;
                    }
                }
                
                return output;
            } catch (error) {
                if (error instanceof Error) {
                    return `Error reading files: ${error.message}`;
                }
                return `Error reading files: ${String(error)}`;
            }
        },
        {
            name: "read_many_files",
            description: `Reads and concatenates content from multiple files specified by glob patterns. Useful for getting an overview of multiple related files at once.

Usage examples:
- Read all TypeScript files: { include: ["**/*.ts"] }
- Read specific files: { include: ["package.json", "tsconfig.json"] }
- Read with exclusions: { include: ["src/**/*.ts"], exclude: ["**/*.test.ts"] }
- Read in specific directory: { include: ["*.md"], dir_path: "docs" }

Features:
- Concatenates files with clear separators
- Skips binary files automatically
- Enforces size limits to prevent overwhelming output
- Shows summary of files read and any errors

Limitations:
- Maximum 100KB per file
- Maximum 500KB total content
- Only text files (binary files are skipped)
- Very long lines (>5,000 chars) are truncated

Best practices:
- Use specific patterns to avoid reading too many files
- Use exclude patterns to filter out unwanted files
- Consider using read_file for large individual files`,
            schema: z.object({
                include: z
                    .array(z.string())
                    .min(1)
                    .describe("Array of glob patterns for files to include (e.g., ['**/*.ts', 'package.json'])"),
                exclude: z
                    .array(z.string())
                    .optional()
                    .default([])
                    .describe("Optional array of glob patterns to exclude (e.g., ['**/*.test.ts', '**/*.spec.ts']). Added to default ignores."),
                dir_path: z
                    .string()
                    .optional()
                    .describe("Optional directory to search within, relative to root. If omitted, searches from root directory."),
            }),
        }
    );
}

