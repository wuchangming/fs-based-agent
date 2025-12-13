/**
 * Ripgrep installer utility
 * Handles automatic download and installation of ripgrep binary
 */

import fs from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import https from "node:https";
import { createWriteStream } from "node:fs";
import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Get the global bin directory for storing ripgrep
 */
export function getGlobalBinDir(): string {
    return path.join(homedir(), ".fs-researcher", "bin");
}

/**
 * Get ripgrep candidate filenames based on platform
 */
export function getRgCandidateFilenames(): readonly string[] {
    return process.platform === "win32" ? ["rg.exe", "rg"] : ["rg"];
}

/**
 * Get the ripgrep download URL based on platform and architecture
 */
function getRipgrepDownloadUrl(): string {
    const REPOSITORY = "microsoft/ripgrep-prebuilt";
    const VERSION = "v13.0.0-10";
    
    const arch = process.arch;
    const platform = process.platform;
    
    let target: string;
    
    switch (platform) {
        case "darwin":
            target = arch === "arm64" 
                ? "aarch64-apple-darwin.tar.gz" 
                : "x86_64-apple-darwin.tar.gz";
            break;
        case "win32":
            if (arch === "x64") target = "x86_64-pc-windows-msvc.zip";
            else if (arch === "arm64") target = "aarch64-pc-windows-msvc.zip";
            else target = "i686-pc-windows-msvc.zip";
            break;
        case "linux":
            if (arch === "x64") target = "x86_64-unknown-linux-musl.tar.gz";
            else if (arch === "arm64") target = "aarch64-unknown-linux-gnu.tar.gz";
            else if (arch === "arm") target = "arm-unknown-linux-gnueabihf.tar.gz";
            else target = "i686-unknown-linux-musl.tar.gz";
            break;
        default:
            throw new Error(`Unsupported platform: ${platform}`);
    }
    
    return `https://github.com/${REPOSITORY}/releases/download/${VERSION}/ripgrep-${VERSION}-${target}`;
}

/**
 * Download a file with SSL verification disabled
 */
async function downloadFile(url: string, destPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const file = createWriteStream(destPath);
        
        https.get(url, {
            rejectUnauthorized: false, // Ignore SSL certificate errors
        }, (response) => {
            if (response.statusCode === 302 || response.statusCode === 301) {
                // Handle redirects
                file.close();
                if (response.headers.location) {
                    downloadFile(response.headers.location, destPath)
                        .then(resolve)
                        .catch(reject);
                } else {
                    reject(new Error("Redirect without location header"));
                }
                return;
            }
            
            if (response.statusCode !== 200) {
                file.close();
                reject(new Error(`Failed to download: ${response.statusCode} ${response.statusMessage}`));
                return;
            }
            
            response.pipe(file);
            
            file.on("finish", () => {
                file.close();
                resolve();
            });
            
            file.on("error", (err) => {
                file.close();
                reject(err);
            });
        }).on("error", (err) => {
            file.close();
            reject(err);
        });
    });
}

/**
 * Extract tar.gz file
 */
async function extractTarGz(archivePath: string, destDir: string): Promise<void> {
    await fs.mkdir(destDir, { recursive: true });
    await execAsync(`tar -xzf "${archivePath}" -C "${destDir}"`);
}

/**
 * Download and install ripgrep
 */
async function downloadAndInstallRipgrep(binDir: string): Promise<void> {
    const url = getRipgrepDownloadUrl();
    const tmpDir = path.join(homedir(), ".fs-researcher", "tmp");
    await fs.mkdir(tmpDir, { recursive: true });
    
    const archivePath = path.join(tmpDir, path.basename(url));
    
    await downloadFile(url, archivePath);
    
    await extractTarGz(archivePath, tmpDir);
    
    // Find the rg binary in the extracted files
    const files = await fs.readdir(tmpDir, { recursive: true, withFileTypes: true });
    for (const file of files) {
        if (file.isFile() && (file.name === "rg" || file.name === "rg.exe")) {
            const sourcePath = path.join(tmpDir, file.name);
            const destPath = path.join(binDir, file.name);
            
            await fs.mkdir(binDir, { recursive: true });
            await fs.copyFile(sourcePath, destPath);
            await fs.chmod(destPath, 0o755);
            
            break;
        }
    }
    
    // Clean up
    await fs.rm(tmpDir, { recursive: true, force: true });
}

/**
 * Check if ripgrep exists in the global bin directory
 */
export async function resolveExistingRgPath(): Promise<string | null> {
    const binDir = getGlobalBinDir();
    for (const fileName of getRgCandidateFilenames()) {
        const candidatePath = path.join(binDir, fileName);
        if (existsSync(candidatePath)) {
            return candidatePath;
        }
    }
    return null;
}

let ripgrepAcquisitionPromise: Promise<string | null> | null = null;

/**
 * Ensure ripgrep is available, download if necessary
 */
export async function ensureRipgrepAvailable(): Promise<string | null> {
    const existingPath = await resolveExistingRgPath();
    if (existingPath) {
        return existingPath;
    }
    
    if (!ripgrepAcquisitionPromise) {
        ripgrepAcquisitionPromise = (async () => {
            try {
                const binDir = getGlobalBinDir();
                await downloadAndInstallRipgrep(binDir);
                return await resolveExistingRgPath();
            } catch (error) {
                return null;
            } finally {
                ripgrepAcquisitionPromise = null;
            }
        })();
    }
    
    return ripgrepAcquisitionPromise;
}

/**
 * Get the path to ripgrep, ensuring it's downloaded
 */
export async function ensureRgPath(): Promise<string | null> {
    return await ensureRipgrepAvailable();
}

