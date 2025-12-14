/**
 * FsData graph helpers
 */

import * as fsp from 'fs/promises';
import { Dirent } from 'fs';
import * as path from 'path';
import {
  FS_DATA_VERSION,
  DATA_LINK_FILENAME,
  DATA_SPACE_DIRNAME,
  buildDataPath,
  fsDataExists,
  readManifest,
  readDataLink,
} from './fsData.js';
import type { FsDataDepLink, FsDataNodeInfo } from './types.js';

/**
 * Parse a symlink target to FsData dep info
 */
function parseDepLinkTarget(targetPath: string, root: string): Omit<FsDataDepLink, 'linkPath'> | null {
  // Target must point to dataLink under fs-data/<version>/<kind>/<shard>/<dataId>/
  const fsDataRoot = path.join(root, 'fs-data', FS_DATA_VERSION);
  const relative = path.relative(fsDataRoot, targetPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  const segments = relative.split(path.sep);
  // Expected shape: <kind>/<shard>/<dataId>/dataLink
  if (segments.length < 4) return null;
  const [kind, shard, dataId, fileName] = segments;
  if (fileName !== DATA_LINK_FILENAME) return null;
  if (!kind || !shard || !dataId) return null;

  return {
    targetKind: kind,
    targetDataId: dataId,
    targetPath: path.join(fsDataRoot, kind, shard, dataId),
  };
}

/**
 * Recursively scan data-space for dependency links
 */
async function discoverDepLinks(dataPath: string, root: string): Promise<FsDataDepLink[]> {
  const dataSpacePath = path.join(dataPath, DATA_SPACE_DIRNAME);
  const depLinks: FsDataDepLink[] = [];

  const stack = [dataSpacePath];

  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;

    let dirents: Dirent[];
    try {
      dirents = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const dirent of dirents) {
      const fullPath = path.join(current, dirent.name);

      if (dirent.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (dirent.isSymbolicLink()) {
        try {
          const linkTarget = await fsp.readlink(fullPath);
          const absTarget = path.resolve(path.dirname(fullPath), linkTarget);
          const parsed = parseDepLinkTarget(absTarget, root);
          if (parsed) {
            depLinks.push({
              linkPath: path.relative(dataSpacePath, fullPath),
              ...parsed,
            });
          }
        } catch {
          // Ignore broken links
        }
      }
    }
  }

  return depLinks;
}

/**
 * Read FsData node info
 */
export async function readFsDataNode(
  root: string,
  kind: string,
  dataId: string
): Promise<FsDataNodeInfo | null> {
  const dataPath = buildDataPath(root, kind, dataId);
  if (!(await fsDataExists(dataPath))) {
    return null;
  }

  let manifest: FsDataNodeInfo['manifest'];
  try {
    manifest = await readManifest(dataPath);
  } catch {
    return null;
  }
  let entryPath: string | null = null;
  try {
    entryPath = await readDataLink(dataPath);
  } catch {
    entryPath = null;
  }

  const deps = await discoverDepLinks(dataPath, root);

  return {
    kind,
    dataId,
    dataPath,
    entryPath,
    manifest,
    deps,
  };
}

/**
 * List all FsData nodes under root
 */
export async function listFsDataNodes(root: string): Promise<FsDataNodeInfo[]> {
  const fsDataRoot = path.join(root, 'fs-data', FS_DATA_VERSION);
  const nodes: FsDataNodeInfo[] = [];

  let kindDirs: Dirent[];
  try {
    kindDirs = await fsp.readdir(fsDataRoot, { withFileTypes: true });
  } catch {
    return nodes;
  }

  for (const kindDir of kindDirs) {
    if (!kindDir.isDirectory()) continue;
    const kind = kindDir.name;
    let shardDirs: Dirent[];
    try {
      shardDirs = await fsp.readdir(path.join(fsDataRoot, kind), { withFileTypes: true });
    } catch {
      continue;
    }

    for (const shardDir of shardDirs) {
      if (!shardDir.isDirectory()) continue;
      let dataIdDirs: Dirent[];
      try {
        dataIdDirs = await fsp.readdir(
          path.join(fsDataRoot, kind, shardDir.name),
          { withFileTypes: true }
        );
      } catch {
        continue;
      }

      for (const dataIdDir of dataIdDirs) {
        if (!dataIdDir.isDirectory()) continue;
        const dataId = dataIdDir.name;
        // Ignore temp dirs created during execution (may linger after crashes).
        if (dataId.startsWith('.tmp-')) continue;
        const node = await readFsDataNode(root, kind, dataId);
        if (node) {
          nodes.push(node);
        }
      }
    }
  }

  return nodes;
}
