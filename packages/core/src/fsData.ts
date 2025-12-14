/**
 * FsData operations module
 */

import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { FsDataManifest } from './types.js';

/** Manifest filename */
export const MANIFEST_FILENAME = '.fs-data-manifest.json';

/** dataLink filename */
export const DATA_LINK_FILENAME = 'dataLink';

/** data-space directory name (fn's working directory) */
export const DATA_SPACE_DIRNAME = 'data-space';

/** Current manifest version */
export const MANIFEST_VERSION = '1.0.0';

/** fs-data directory version */
export const FS_DATA_VERSION = '1.0.0';

function assertSafeRelativePath(value: string, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} must be a non-empty relative path`);
  }
  if (value.includes('\0')) {
    throw new Error(`${name} must not contain null bytes`);
  }
  if (path.isAbsolute(value)) {
    throw new Error(`${name} must be a relative path`);
  }
  // Disallow path traversal (.. segments) for safety.
  const segments = value.split(/[\\/]+/);
  if (segments.some((seg) => seg === '..')) {
    throw new Error(`${name} must not contain ".." segments`);
  }
  return value;
}

/**
 * Recursively stable-sort object keys
 */
function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    // Serialize array elements first then sort, ensure same element set generates same result
    const sorted = obj.map(stableStringify).sort();
    return '[' + sorted.join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(
    (k) => JSON.stringify(k) + ':' + stableStringify((obj as Record<string, unknown>)[k])
  );
  return '{' + pairs.join(',') + '}';
}

/**
 * Generate dataId based on kind + input (MD5 hash)
 */
export function generateDataId(kind: string, input: Record<string, unknown>): string {
  const serialized = stableStringify({ kind, input });
  return createHash('md5').update(serialized).digest('hex');
}

/**
 * Get shard (first 2 characters of dataId)
 */
export function getShard(dataId: string): string {
  return dataId.slice(0, 2);
}

/**
 * Build FsData directory path
 */
export function buildDataPath(root: string, kind: string, dataId: string): string {
  const shard = getShard(dataId);
  return path.join(root, 'fs-data', FS_DATA_VERSION, kind, shard, dataId);
}

/**
 * Build tempDir path (at same level as formal path)
 */
export function buildTempPath(root: string, kind: string, dataId: string): string {
  const shard = getShard(dataId);
  const random = Math.random().toString(36).slice(2, 10);
  return path.join(root, 'fs-data', FS_DATA_VERSION, kind, shard, `.tmp-${dataId}-${random}`);
}

/**
 * Check if FsData exists
 */
export async function fsDataExists(dataPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(dataPath, MANIFEST_FILENAME));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read manifest
 */
export async function readManifest(dataPath: string): Promise<FsDataManifest> {
  const manifestPath = path.join(dataPath, MANIFEST_FILENAME);
  const content = await fs.readFile(manifestPath, 'utf-8');
  try {
    return JSON.parse(content) as FsDataManifest;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse manifest at ${manifestPath}: ${message}`);
  }
}

/**
 * Write manifest
 */
export async function writeManifest(dataPath: string, manifest: FsDataManifest): Promise<void> {
  const manifestPath = path.join(dataPath, MANIFEST_FILENAME);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

/**
 * Create dataLink symlink
 * @param dataPath FsData directory path
 * @param entry fn's returned entry (relative to data-space)
 */
export async function createDataLink(dataPath: string, entry: string): Promise<void> {
  const linkPath = path.join(dataPath, DATA_LINK_FILENAME);
  // Use relative path, pointing to entry under data-space
  const safeEntry = assertSafeRelativePath(entry, 'entry');
  const target = path.join(DATA_SPACE_DIRNAME, safeEntry);
  await fs.symlink(target, linkPath);
}

/**
 * Read absolute path pointed to by dataLink
 */
export async function readDataLink(dataPath: string): Promise<string> {
  const linkPath = path.join(dataPath, DATA_LINK_FILENAME);
  const target = await fs.readlink(linkPath);
  // Resolve to absolute path
  const resolved = path.resolve(dataPath, target);

  // Ensure dataLink points within data-space.
  const dataSpacePath = path.resolve(dataPath, DATA_SPACE_DIRNAME);
  const relative = path.relative(dataSpacePath, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`dataLink points outside of data-space: ${resolved}`);
  }

  return resolved;
}

/**
 * Calculate relative path for dep symlink target
 * @param depPath Symlink path (absolute path)
 * @param targetDataPath Target FsData directory path (absolute path)
 */
export function computeDepLinkTarget(depPath: string, targetDataPath: string): string {
  const targetDataLink = path.join(targetDataPath, DATA_LINK_FILENAME);
  return path.relative(path.dirname(depPath), targetDataLink);
}

/**
 * Create dep symlink
 * @param depPath Symlink path (absolute path)
 * @param targetDataPath Target FsData directory path (absolute path)
 */
export async function createDepLink(depPath: string, targetDataPath: string): Promise<void> {
  // Ensure parent directory exists
  await fs.mkdir(path.dirname(depPath), { recursive: true });
  
  // Calculate relative path: from depPath's parent directory to targetDataPath's dataLink
  const relativePath = computeDepLinkTarget(depPath, targetDataPath);
  
  await fs.symlink(relativePath, depPath);
}

/**
 * Atomic rename (for concurrency control)
 * @returns true if rename succeeds, false if target already exists
 */
export async function atomicRename(tempPath: string, targetPath: string): Promise<boolean> {
  try {
    // Ensure target's parent directory exists
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    // Try rename
    await fs.rename(tempPath, targetPath);
    return true;
  } catch (err: unknown) {
    // Check if error is due to target already existing
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code: string }).code;
      // EEXIST or ENOTEMPTY means target already exists
      if (code === 'EEXIST' || code === 'ENOTEMPTY') {
        return false;
      }
    }
    throw err;
  }
}

/**
 * Recursively delete directory
 */
export async function removeDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // Ignore delete failure
  }
}

/**
 * Create manifest object
 */
export function createManifest(
  kind: string,
  input: Record<string, unknown>,
  metadata: Record<string, unknown> = {}
): FsDataManifest {
  const now = new Date().toISOString();
  return {
    manifestVersion: MANIFEST_VERSION,
    kind,
    input,
    metadata,
    createdAt: now,
    updatedAt: now,
  };
}
