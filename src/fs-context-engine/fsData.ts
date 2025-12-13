/**
 * FsData 操作模块
 */

import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { FsDataManifest } from './types.js';

/** manifest 文件名 */
export const MANIFEST_FILENAME = '.fs-data-manifest.json';

/** dataLink 文件名 */
export const DATA_LINK_FILENAME = 'dataLink';

/** data-space 目录名（fn 的工作目录） */
export const DATA_SPACE_DIRNAME = 'data-space';

/** 当前 manifest 版本 */
export const MANIFEST_VERSION = '1.0.0';

/** fs-data 目录版本 */
export const FS_DATA_VERSION = '1.0.0';

/**
 * 递归稳定排序对象的 key
 */
function stableStringify(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    // 数组元素先序列化再排序，确保相同元素集合生成相同结果
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
 * 根据 kind + input 生成 dataId（MD5 hash）
 */
export function generateDataId(kind: string, input: Record<string, unknown>): string {
  const serialized = stableStringify({ kind, input });
  return createHash('md5').update(serialized).digest('hex');
}

/**
 * 获取 shard（dataId 前 2 位）
 */
export function getShard(dataId: string): string {
  return dataId.slice(0, 2);
}

/**
 * 构建 FsData 目录路径
 */
export function buildDataPath(root: string, kind: string, dataId: string): string {
  const shard = getShard(dataId);
  return path.join(root, 'fs-data', FS_DATA_VERSION, kind, shard, dataId);
}

/**
 * 构建 tempDir 路径（与正式路径同级）
 */
export function buildTempPath(root: string, kind: string, dataId: string): string {
  const shard = getShard(dataId);
  const random = Math.random().toString(36).slice(2, 10);
  return path.join(root, 'fs-data', FS_DATA_VERSION, kind, shard, `.tmp-${dataId}-${random}`);
}

/**
 * 检查 FsData 是否存在
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
 * 读取 manifest
 */
export async function readManifest(dataPath: string): Promise<FsDataManifest> {
  const manifestPath = path.join(dataPath, MANIFEST_FILENAME);
  const content = await fs.readFile(manifestPath, 'utf-8');
  return JSON.parse(content) as FsDataManifest;
}

/**
 * 写入 manifest
 */
export async function writeManifest(dataPath: string, manifest: FsDataManifest): Promise<void> {
  const manifestPath = path.join(dataPath, MANIFEST_FILENAME);
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
}

/**
 * 创建 dataLink 软链接
 * @param dataPath FsData 目录路径
 * @param entry fn 返回的 entry（相对于 data-space）
 */
export async function createDataLink(dataPath: string, entry: string): Promise<void> {
  const linkPath = path.join(dataPath, DATA_LINK_FILENAME);
  // 使用相对路径，指向 data-space 下的 entry
  const target = `./${DATA_SPACE_DIRNAME}/${entry}`;
  await fs.symlink(target, linkPath);
}

/**
 * 读取 dataLink 指向的绝对路径
 */
export async function readDataLink(dataPath: string): Promise<string> {
  const linkPath = path.join(dataPath, DATA_LINK_FILENAME);
  const target = await fs.readlink(linkPath);
  // 解析为绝对路径
  return path.resolve(dataPath, target);
}

/**
 * 计算 dep 软链接的目标相对路径
 * @param depPath 软链接路径（绝对路径）
 * @param targetDataPath 目标 FsData 目录路径（绝对路径）
 */
export function computeDepLinkTarget(depPath: string, targetDataPath: string): string {
  const targetDataLink = path.join(targetDataPath, DATA_LINK_FILENAME);
  return path.relative(path.dirname(depPath), targetDataLink);
}

/**
 * 创建 dep 软链接
 * @param depPath 软链接路径（绝对路径）
 * @param targetDataPath 目标 FsData 目录路径（绝对路径）
 */
export async function createDepLink(depPath: string, targetDataPath: string): Promise<void> {
  // 确保父目录存在
  await fs.mkdir(path.dirname(depPath), { recursive: true });
  
  // 计算相对路径：从 depPath 的父目录到 targetDataPath 的 dataLink
  const relativePath = computeDepLinkTarget(depPath, targetDataPath);
  
  await fs.symlink(relativePath, depPath);
}

/**
 * 原子 rename（用于并发控制）
 * @returns true 如果 rename 成功，false 如果目标已存在
 */
export async function atomicRename(tempPath: string, targetPath: string): Promise<boolean> {
  try {
    // 确保目标的父目录存在
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    // 尝试 rename
    await fs.rename(tempPath, targetPath);
    return true;
  } catch (err: unknown) {
    // 检查是否是目标已存在的错误
    if (err && typeof err === 'object' && 'code' in err) {
      const code = (err as { code: string }).code;
      // EEXIST 或 ENOTEMPTY 表示目标已存在
      if (code === 'EEXIST' || code === 'ENOTEMPTY') {
        return false;
      }
    }
    throw err;
  }
}

/**
 * 递归删除目录
 */
export async function removeDir(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch {
    // 忽略删除失败
  }
}

/**
 * 创建 manifest 对象
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

