import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { shouldIgnore } from "../utils/ignorePatterns.js";

export interface ReadFileToolParams {
    rootPath: string;
}

const DEFAULT_MAX_LINES = 2000;
const MAX_LINE_LENGTH = 10000;

/**
 * Create a tool for reading file contents
 */
export function createReadFileTool({ rootPath }: ReadFileToolParams) {
    return tool(
        async ({ file_path, offset, limit }) => {
            try {
                // Resolve the file path
                const resolvedPath = path.resolve(rootPath, file_path);
                
                // Security check: ensure the path is within rootPath
                if (!resolvedPath.startsWith(rootPath)) {
                    return `Error: File path '${file_path}' is outside the allowed root directory`;
                }
                
                // Check if file should be ignored
                const relativePath = path.relative(rootPath, resolvedPath);
                if (shouldIgnore(relativePath)) {
                    return `Error: File '${file_path}' is in an ignored directory or matches ignore patterns`;
                }
                
                // Check if file exists and is a file
                const stats = await fs.stat(resolvedPath);
                if (!stats.isFile()) {
                    return `Error: Path '${file_path}' is not a file`;
                }
                
                // Read the file
                const content = await fs.readFile(resolvedPath, "utf8");
                const lines = content.split(/\r?\n/);
                
                // Check for binary content
                const hasBinaryContent = content.includes("\0");
                if (hasBinaryContent) {
                    return `Error: File '${file_path}' appears to be a binary file and cannot be displayed as text`;
                }
                
                // Handle pagination
                let startLine = 0;
                let endLine = lines.length;
                let isTruncated = false;
                
                if (offset !== undefined && limit !== undefined) {
                    // User specified specific range
                    startLine = offset;
                    endLine = Math.min(offset + limit, lines.length);
                    isTruncated = endLine < lines.length;
                } else if (lines.length > DEFAULT_MAX_LINES) {
                    // Auto-truncate large files
                    endLine = DEFAULT_MAX_LINES;
                    isTruncated = true;
                }
                
                // Extract the lines to display
                let displayLines = lines.slice(startLine, endLine);
                
                // Truncate overly long lines
                displayLines = displayLines.map((line) => {
                    if (line.length > MAX_LINE_LENGTH) {
                        return line.substring(0, MAX_LINE_LENGTH) + "... [line truncated]";
                    }
                    return line;
                });
                
                // Add line numbers
                const numberedLines = displayLines.map((line, idx) => {
                    const lineNum = startLine + idx + 1;
                    return `${String(lineNum).padStart(6, " ")} | ${line}`;
                });
                
                let result = "";
                
                if (isTruncated) {
                    const nextOffset = endLine;
                    result += `[File content truncated: showing lines ${startLine + 1}-${endLine} of ${lines.length} total lines]\n`;
                    result += `[To read more, use: { file_path: "${file_path}", offset: ${nextOffset}, limit: ${limit || DEFAULT_MAX_LINES} }]\n\n`;
                }
                
                result += `File: ${file_path}\n`;
                result += `${"=".repeat(60)}\n`;
                result += numberedLines.join("\n");
                
                if (!isTruncated) {
                    result += `\n${"=".repeat(60)}\n`;
                    result += `[End of file: ${lines.length} lines total]`;
                }
                
                return result;
            } catch (error) {
                if (error instanceof Error) {
                    if ((error as any).code === "ENOENT") {
                        return `Error: File '${file_path}' does not exist`;
                    }
                    if ((error as any).code === "EACCES") {
                        return `Error: Permission denied reading '${file_path}'`;
                    }
                    if ((error as any).code === "EISDIR") {
                        return `Error: '${file_path}' is a directory, not a file`;
                    }
                    return `Error reading file: ${error.message}`;
                }
                return `Error reading file: ${String(error)}`;
            }
        },
        {
            name: "read_file",
            description: `Reads and returns the content of a specified text file. Supports line-based pagination for large files. Returns file content with line numbers for easy reference.

Usage examples:
- Read entire file: { file_path: "package.json" }
- Read specific file: { file_path: "src/index.ts" }
- Read with pagination: { file_path: "large.txt", offset: 0, limit: 100 }
- Read next page: { file_path: "large.txt", offset: 100, limit: 100 }

Features:
- Automatically truncates files larger than 2000 lines
- Shows line numbers for easy reference
- Detects and rejects binary files
- Provides instructions for reading more content when truncated

Limitations:
- Only reads text files (UTF-8 encoded)
- Binary files are rejected
- Very long lines (>10,000 chars) are truncated`,
            schema: z.object({
                file_path: z
                    .string()
                    .describe("The file path to read, relative to the root directory"),
                offset: z
                    .number()
                    .optional()
                    .describe("Optional: 0-based line number to start reading from. Must be used with 'limit'."),
                limit: z
                    .number()
                    .optional()
                    .describe("Optional: Maximum number of lines to read. Use with 'offset' for pagination."),
            }),
        }
    );
}

