/**
 * FsData 操作测试
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  generateDataId,
  getShard,
  buildDataPath,
  buildTempPath,
  fsDataExists,
  readManifest,
  writeManifest,
  createDataLink,
  readDataLink,
  atomicRename,
  removeDir,
  createManifest,
  FS_DATA_VERSION,
} from '../fsData.js';

describe('generateDataId', () => {
  it('应该为相同 kind + input 生成相同的 dataId', () => {
    const kind = 'repo-clone';
    const input1 = { url: 'https://github.com/test', branch: 'main' };
    const input2 = { url: 'https://github.com/test', branch: 'main' };
    
    expect(generateDataId(kind, input1)).toBe(generateDataId(kind, input2));
  });

  it('应该为不同 key 顺序的 input 生成相同的 dataId（稳定排序）', () => {
    const kind = 'test-kind';
    const input1 = { a: 1, b: 2, c: 3 };
    const input2 = { c: 3, a: 1, b: 2 };
    const input3 = { b: 2, c: 3, a: 1 };
    
    const id1 = generateDataId(kind, input1);
    const id2 = generateDataId(kind, input2);
    const id3 = generateDataId(kind, input3);
    
    expect(id1).toBe(id2);
    expect(id2).toBe(id3);
  });

  it('应该处理嵌套对象的稳定排序', () => {
    const kind = 'test-kind';
    const input1 = { outer: { z: 1, a: 2 }, name: 'test' };
    const input2 = { name: 'test', outer: { a: 2, z: 1 } };
    
    expect(generateDataId(kind, input1)).toBe(generateDataId(kind, input2));
  });

  it('应该为不同 input 生成不同的 dataId', () => {
    const kind = 'test-kind';
    const input1 = { url: 'https://github.com/test1' };
    const input2 = { url: 'https://github.com/test2' };
    
    expect(generateDataId(kind, input1)).not.toBe(generateDataId(kind, input2));
  });

  it('应该为不同 kind 生成不同的 dataId', () => {
    const input = { url: 'https://github.com/test' };
    
    expect(generateDataId('kind-a', input)).not.toBe(generateDataId('kind-b', input));
  });

  it('应该返回 32 位的 MD5 hash', () => {
    const dataId = generateDataId('test-kind', { test: 'value' });
    
    expect(dataId).toHaveLength(32);
    expect(dataId).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('getShard', () => {
  it('应该返回 dataId 的前 2 位', () => {
    expect(getShard('abcdef1234567890')).toBe('ab');
    expect(getShard('12345678')).toBe('12');
  });
});

describe('buildDataPath', () => {
  it('应该构建正确的路径格式', () => {
    const root = '/data';
    const kind = 'repo-clone';
    const dataId = 'abcdef1234567890abcdef1234567890';
    
    const result = buildDataPath(root, kind, dataId);
    
    expect(result).toBe(`/data/fs-data/${FS_DATA_VERSION}/repo-clone/ab/abcdef1234567890abcdef1234567890`);
  });
});

describe('buildTempPath', () => {
  it('应该构建临时路径（与正式路径同级）', () => {
    const root = '/data';
    const kind = 'repo-clone';
    const dataId = 'abcdef1234567890abcdef1234567890';
    
    const result = buildTempPath(root, kind, dataId);
    
    expect(result).toContain(`/data/fs-data/${FS_DATA_VERSION}/repo-clone/ab/.tmp-abcdef1234567890abcdef1234567890-`);
  });
});

describe('manifest 操作', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsdata-test-'));
  });

  afterEach(async () => {
    await removeDir(tempDir);
  });

  it('应该正确读写 manifest', async () => {
    const manifest = createManifest('test-kind', { key: 'value' }, { extra: 'data' });
    
    await writeManifest(tempDir, manifest);
    const read = await readManifest(tempDir);
    
    expect(read.manifestVersion).toBe(manifest.manifestVersion);
    expect(read.kind).toBe('test-kind');
    expect(read.input).toEqual({ key: 'value' });
    expect(read.metadata).toEqual({ extra: 'data' });
    expect(read.createdAt).toBeDefined();
    expect(read.updatedAt).toBeDefined();
  });
});

describe('dataLink 操作', () => {
  let tempDir: string;

  beforeEach(async () => {
   tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsdata-test-'));
   // 创建 data-space/my-entry 目录（模拟实际结构）
   await fs.mkdir(path.join(tempDir, 'data-space', 'my-entry'), { recursive: true });
 });

  afterEach(async () => {
    await removeDir(tempDir);
  });

  it('应该创建和读取 dataLink（指向 data-space 下的 entry）', async () => {
    await createDataLink(tempDir, 'my-entry');
    const result = await readDataLink(tempDir);
    
    // dataLink 指向 data-space/my-entry
    expect(result).toBe(path.join(tempDir, 'data-space', 'my-entry'));
  });
});

describe('fsDataExists', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsdata-test-'));
  });

  afterEach(async () => {
    await removeDir(tempDir);
  });

  it('有 manifest 时返回 true', async () => {
    const manifest = createManifest('test', {});
    await writeManifest(tempDir, manifest);
    
    expect(await fsDataExists(tempDir)).toBe(true);
  });

  it('无 manifest 时返回 false', async () => {
    expect(await fsDataExists(tempDir)).toBe(false);
  });
});

describe('atomicRename', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsdata-test-'));
  });

  afterEach(async () => {
    await removeDir(tempDir);
  });

  it('rename 成功时返回 true', async () => {
    const source = path.join(tempDir, 'source');
    const target = path.join(tempDir, 'target');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'test.txt'), 'content');
    
    const result = await atomicRename(source, target);
    
    expect(result).toBe(true);
    expect(await fs.readFile(path.join(target, 'test.txt'), 'utf-8')).toBe('content');
  });
});

