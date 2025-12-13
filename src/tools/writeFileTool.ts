import { tool } from "@langchain/core/tools";
import { z } from "zod";
import fs from "node:fs/promises";
import path from "node:path";
import { shouldIgnore } from "./utils/ignorePatterns.js";

export interface WriteFileToolParams {
    rootPath: string;
    additionalIgnorePatterns?: string[];
}

/**
 * Create a tool for writing file contents
 */
export function createWriteFileTool({ rootPath, additionalIgnorePatterns = [] }: WriteFileToolParams) {
    return tool(
        async ({ file_path, content }) => {
            try {
                // Resolve the file path
                const resolvedPath = path.resolve(rootPath, file_path);
                
                // Security check: use path.relative to prevent path traversal
                // This avoids the /home/user vs /home/username false positive
                const relativePath = path.relative(rootPath, resolvedPath);
                if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
                    return `Error: File path '${file_path}' is outside the allowed root directory`;
                }
                
                // Check if file should be ignored
                if (shouldIgnore(relativePath, additionalIgnorePatterns)) {
                    return `Error: File '${file_path}' is in an ignored directory or matches ignore patterns`;
                }
                
                // Check if file exists (for status message)
                let fileExists = false;
                try {
                    const stats = await fs.stat(resolvedPath);
                    fileExists = stats.isFile();
                    if (stats.isDirectory()) {
                        return `Error: Path '${file_path}' is a directory, cannot write as file`;
                    }
                } catch (err) {
                    // File doesn't exist, will be created
                    fileExists = false;
                }
                
                // Create parent directories if needed
                const dir = path.dirname(resolvedPath);
                await fs.mkdir(dir, { recursive: true });
                
                // Write the file
                await fs.writeFile(resolvedPath, content, "utf8");
                
                // Calculate byte size (handles multi-byte characters correctly)
                const byteSize = Buffer.byteLength(content, "utf8");
                const status = fileExists ? "overwritten" : "created";
                
                return `File written: ${file_path} (${status}), ${byteSize} bytes`;
            } catch (error) {
                if (error instanceof Error) {
                    const code = (error as NodeJS.ErrnoException).code;
                    if (code === "EACCES") {
                        return `Error: Permission denied writing to '${file_path}'`;
                    }
                    if (code === "ENOSPC") {
                        return `Error: No space left on device writing '${file_path}'`;
                    }
                    if (code === "EROFS") {
                        return `Error: Read-only file system, cannot write '${file_path}'`;
                    }
                    return `Error writing file: ${error.message}`;
                }
                return `Error writing file: ${String(error)}`;
            }
        },
        {
            name: "write_file",
            description: `Writes content to a file. If the file exists, it will be overwritten. If it doesn't exist, it will be created. Parent directories are created automatically.

Usage:
- If overwriting an existing file, you MUST use read_file first to get its contents.
- ALWAYS provide the COMPLETE content of the file, without any truncation or omissions.
- ALWAYS prefer editing existing files. NEVER create new files unless explicitly required.
- NEVER proactively create documentation files (*.md) or README files unless requested.
- Only supports UTF-8 text files.`,
            schema: z.object({
                file_path: z
                    .string()
                    .describe("The file path to write to, relative to the root directory"),
                content: z
                    .string()
                    .describe("The COMPLETE content to write. Must include ALL parts of the file, even unchanged sections."),
            }),
        }
    );
}
