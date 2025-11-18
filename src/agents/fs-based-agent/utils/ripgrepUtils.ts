import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

/**
 * Get the directory where ripgrep binary should be stored
 */
function getRipgrepBinDir(): string {
    // Store in user's home directory under .fs-based-agent
    const homeDir = os.homedir();
    return path.join(homeDir, ".fs-based-agent", "bin");
}

/**
 * Get candidate filenames for ripgrep binary based on platform
 */
function getRgCandidateFilenames(): readonly string[] {
    return process.platform === "win32" ? ["rg.exe", "rg"] : ["rg"];
}

/**
 * Check if a file exists
 */
async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch {
        return false;
    }
}

/**
 * Resolve existing ripgrep path in the bin directory
 */
async function resolveExistingRgPath(): Promise<string | null> {
    const binDir = getRipgrepBinDir();
    for (const fileName of getRgCandidateFilenames()) {
        const candidatePath = path.join(binDir, fileName);
        if (await fileExists(candidatePath)) {
            return candidatePath;
        }
    }
    return null;
}

/**
 * Check if ripgrep is available in system PATH
 */
async function isRgInSystemPath(): Promise<boolean> {
    return new Promise((resolve) => {
        const checkCommand = process.platform === "win32" ? "where" : "command";
        const checkArgs = process.platform === "win32" ? ["rg"] : ["-v", "rg"];
        
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
 * Get ripgrep installation instructions based on platform
 */
export function getRipgrepInstallInstructions(): string {
    const platform = process.platform;
    let instructions = "ripgrep (rg) is not installed or not found. Please install it:\n\n";
    
    switch (platform) {
        case "darwin":
            instructions += "On macOS:\n  brew install ripgrep\n\nOr download from: https://github.com/BurntSushi/ripgrep/releases";
            break;
        case "win32":
            instructions += "On Windows:\n  choco install ripgrep\n  or\n  scoop install ripgrep\n\nOr download from: https://github.com/BurntSushi/ripgrep/releases";
            break;
        case "linux":
            instructions += "On Linux:\n  apt install ripgrep  (Debian/Ubuntu)\n  dnf install ripgrep  (Fedora)\n  pacman -S ripgrep    (Arch)\n\nOr download from: https://github.com/BurntSushi/ripgrep/releases";
            break;
        default:
            instructions += "Download from: https://github.com/BurntSushi/ripgrep/releases";
    }
    
    return instructions;
}

let ripgrepPathCache: string | null | undefined = undefined;

/**
 * Get the path to ripgrep binary
 * First checks system PATH, then checks local bin directory
 * @returns The path to ripgrep binary, or null if not found
 */
export async function getRipgrepPath(): Promise<string | null> {
    // Return cached result if available
    if (ripgrepPathCache !== undefined) {
        return ripgrepPathCache;
    }

    // Check if rg is in system PATH (fastest check)
    if (await isRgInSystemPath()) {
        ripgrepPathCache = "rg"; // Use system rg
        return ripgrepPathCache;
    }

    // Check local bin directory
    const localPath = await resolveExistingRgPath();
    if (localPath) {
        ripgrepPathCache = localPath;
        return ripgrepPathCache;
    }

    // Not found
    ripgrepPathCache = null;
    return null;
}

/**
 * Check if ripgrep is available
 */
export async function isRipgrepAvailable(): Promise<boolean> {
    const rgPath = await getRipgrepPath();
    return rgPath !== null;
}

/**
 * Ensure ripgrep is available, throw error with installation instructions if not
 */
export async function ensureRipgrepAvailable(): Promise<string> {
    const rgPath = await getRipgrepPath();
    if (!rgPath) {
        throw new Error(getRipgrepInstallInstructions());
    }
    return rgPath;
}

