/**
 * FsData operations tests
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
  it('should generate same dataId for same kind + input', () => {
    const kind = 'repo-clone';
    const input1 = { url: 'https://github.com/test', branch: 'main' };
    const input2 = { url: 'https://github.com/test', branch: 'main' };
    
    expect(generateDataId(kind, input1)).toBe(generateDataId(kind, input2));
  });

  it('should generate same dataId for input with different key order (stable sorting)', () => {
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

  it('should handle stable sorting for nested objects', () => {
    const kind = 'test-kind';
    const input1 = { outer: { z: 1, a: 2 }, name: 'test' };
    const input2 = { name: 'test', outer: { a: 2, z: 1 } };
    
    expect(generateDataId(kind, input1)).toBe(generateDataId(kind, input2));
  });

  it('should generate different dataId for different input', () => {
    const kind = 'test-kind';
    const input1 = { url: 'https://github.com/test1' };
    const input2 = { url: 'https://github.com/test2' };
    
    expect(generateDataId(kind, input1)).not.toBe(generateDataId(kind, input2));
  });

  it('should generate different dataId for different kind', () => {
    const input = { url: 'https://github.com/test' };
    
    expect(generateDataId('kind-a', input)).not.toBe(generateDataId('kind-b', input));
  });

  it('should return 32-character MD5 hash', () => {
    const dataId = generateDataId('test-kind', { test: 'value' });
    
    expect(dataId).toHaveLength(32);
    expect(dataId).toMatch(/^[a-f0-9]{32}$/);
  });
});

describe('getShard', () => {
  it('should return first 2 characters of dataId', () => {
    expect(getShard('abcdef1234567890')).toBe('ab');
    expect(getShard('12345678')).toBe('12');
  });
});

describe('buildDataPath', () => {
  it('should build correct path format', () => {
    const root = '/data';
    const kind = 'repo-clone';
    const dataId = 'abcdef1234567890abcdef1234567890';
    
    const result = buildDataPath(root, kind, dataId);
    
    expect(result).toBe(`/data/fs-data/${FS_DATA_VERSION}/repo-clone/ab/abcdef1234567890abcdef1234567890`);
  });
});

describe('buildTempPath', () => {
  it('should build temp path (at same level as formal path)', () => {
    const root = '/data';
    const kind = 'repo-clone';
    const dataId = 'abcdef1234567890abcdef1234567890';
    
    const result = buildTempPath(root, kind, dataId);
    
    expect(result).toContain(`/data/fs-data/${FS_DATA_VERSION}/repo-clone/ab/.tmp-abcdef1234567890abcdef1234567890-`);
  });
});

describe('manifest operations', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsdata-test-'));
  });

  afterEach(async () => {
    await removeDir(tempDir);
  });

  it('should correctly read and write manifest', async () => {
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

describe('dataLink operations', () => {
  let tempDir: string;

  beforeEach(async () => {
   tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fsdata-test-'));
   // Create data-space/my-entry directory (simulate actual structure)
   await fs.mkdir(path.join(tempDir, 'data-space', 'my-entry'), { recursive: true });
 });

  afterEach(async () => {
    await removeDir(tempDir);
  });

  it('should create and read dataLink (pointing to entry under data-space)', async () => {
    await createDataLink(tempDir, 'my-entry');
    const result = await readDataLink(tempDir);
    
    // dataLink points to data-space/my-entry
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

  it('should return true when manifest exists', async () => {
    const manifest = createManifest('test', {});
    await writeManifest(tempDir, manifest);
    
    expect(await fsDataExists(tempDir)).toBe(true);
  });

  it('should return false when manifest does not exist', async () => {
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

  it('should return true when rename succeeds', async () => {
    const source = path.join(tempDir, 'source');
    const target = path.join(tempDir, 'target');
    await fs.mkdir(source);
    await fs.writeFile(path.join(source, 'test.txt'), 'content');
    
    const result = await atomicRename(source, target);
    
    expect(result).toBe(true);
    expect(await fs.readFile(path.join(target, 'test.txt'), 'utf-8')).toBe('content');
  });
});
