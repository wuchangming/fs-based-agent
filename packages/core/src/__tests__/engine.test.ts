/**
 * FsContextEngine tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { FsContextEngine } from '../engine.js';
import { removeDir, readManifest, buildDataPath, generateDataId } from '../fsData.js';

describe('FsContextEngine', () => {
  let testRoot: string;
  let engine: FsContextEngine;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fs-context-engine-test-'));
    engine = new FsContextEngine({ root: testRoot });
  });

  afterEach(async () => {
    await removeDir(testRoot);
  });

  describe('createExecutor basic functionality', () => {
    it('should create a callable executor', async () => {
      const testExecutor = engine.createExecutor({
        kind: 'test-executor',
        fn: async (input, dataDir) => {
          await fs.mkdir(path.join(dataDir, 'output'), { recursive: true });
          await fs.writeFile(path.join(dataDir, 'output', 'result.txt'), `Hello ${input.name}`);
          return { entry: 'output' };
        },
      });

      expect(testExecutor.kind).toBe('test-executor');
      expect(typeof testExecutor).toBe('function');
      expect(typeof testExecutor.config).toBe('function');
    });

    it('should execute fn and return entry path', async () => {
      const testExecutor = engine.createExecutor({
        kind: 'test-executor',
        fn: async (input: { name: string }, dataDir) => {
          await fs.mkdir(path.join(dataDir, 'output'), { recursive: true });
          await fs.writeFile(path.join(dataDir, 'output', 'result.txt'), `Hello ${input.name}`);
          return { entry: 'output' };
        },
      });

      const resultPath = await testExecutor({ input: { name: 'World' } });

      // Verify returned path exists
      const stat = await fs.stat(resultPath);
      expect(stat.isDirectory()).toBe(true);

      // Verify content
      const content = await fs.readFile(path.join(resultPath, 'result.txt'), 'utf-8');
      expect(content).toBe('Hello World');
    });

    it('should write correct manifest', async () => {
      const testExecutor = engine.createExecutor({
        kind: 'test-kind',
        fn: async (input: { key: string }, dataDir) => {
          await fs.writeFile(path.join(dataDir, 'data.txt'), 'test');
          return { entry: 'data.txt', metadata: { custom: 'meta' } };
        },
      });

      await testExecutor({ input: { key: 'value' } });

      // Read manifest
      const dataId = generateDataId('test-kind', { key: 'value' });
      const dataPath = buildDataPath(testRoot, 'test-kind', dataId);
      const manifest = await readManifest(dataPath);

      expect(manifest.kind).toBe('test-kind');
      expect(manifest.input).toEqual({ key: 'value' });
      expect(manifest.metadata).toEqual({ custom: 'meta' });
    });
  });

  describe('cache mechanism', () => {
    it('should use cache for same input (not re-execute fn)', async () => {
      let callCount = 0;

      const testExecutor = engine.createExecutor({
        kind: 'cache-test',
        fn: async (input: { id: string }, dataDir) => {
          callCount++;
          await fs.writeFile(path.join(dataDir, 'data.txt'), `call-${callCount}`);
          return { entry: 'data.txt' };
        },
      });

      // First call
      const path1 = await testExecutor({ input: { id: 'same' } });
      expect(callCount).toBe(1);

      // Second call (same input)
      const path2 = await testExecutor({ input: { id: 'same' } });
      expect(callCount).toBe(1); // fn should not execute again
      expect(path1).toBe(path2);

      // Verify content is from first execution
      const content = await fs.readFile(path1, 'utf-8');
      expect(content).toBe('call-1');
    });

    it('should execute separately for different inputs', async () => {
      let callCount = 0;

      const testExecutor = engine.createExecutor({
        kind: 'cache-test',
        fn: async (input: { id: string }, dataDir) => {
          callCount++;
          await fs.writeFile(path.join(dataDir, 'data.txt'), `call-${callCount}`);
          return { entry: 'data.txt' };
        },
      });

      await testExecutor({ input: { id: 'first' } });
      await testExecutor({ input: { id: 'second' } });

      expect(callCount).toBe(2);
    });

    it('should force execution when skipCache=true', async () => {
      let callCount = 0;

      const testExecutor = engine.createExecutor({
        kind: 'skip-cache-test',
        fn: async (input: { id: string }, dataDir) => {
          callCount++;
          await fs.writeFile(path.join(dataDir, 'data.txt'), `call-${callCount}`);
          return { entry: 'data.txt' };
        },
      });

      // First call
      await testExecutor({ input: { id: 'test' } });
      expect(callCount).toBe(1);

      // Second call (skipCache)
      await testExecutor({ input: { id: 'test' }, skipCache: true });
      expect(callCount).toBe(2);
    });
  });

  describe('get() method', () => {
    it('should return path when cache exists', async () => {
      const testExecutor = engine.createExecutor({
        kind: 'get-test',
        fn: async (input: { id: string }, dataDir) => {
          await fs.writeFile(path.join(dataDir, 'data.txt'), 'test');
          return { entry: 'data.txt' };
        },
      });

      await testExecutor({ input: { id: 'exists' } });

      const result = await engine.get('get-test', { id: 'exists' });
      expect(result).not.toBeNull();
    });

    it('should return null when cache does not exist', async () => {
      const result = await engine.get('nonexistent-kind', { id: 'nonexistent' });
      expect(result).toBeNull();
    });
  });

  describe('remove() method', () => {
    it('should delete cache', async () => {
      const testExecutor = engine.createExecutor({
        kind: 'remove-test',
        fn: async (input: { id: string }, dataDir) => {
          await fs.writeFile(path.join(dataDir, 'data.txt'), 'test');
          return { entry: 'data.txt' };
        },
      });

      await testExecutor({ input: { id: 'to-remove' } });

      // Verify cache exists
      expect(await engine.get('remove-test', { id: 'to-remove' })).not.toBeNull();

      // Delete
      await engine.remove('remove-test', { id: 'to-remove' });

      // Verify cache is deleted
      expect(await engine.get('remove-test', { id: 'to-remove' })).toBeNull();
    });

    it('should silently succeed when deleting non-existent cache (idempotent)', async () => {
      // Should not throw
      await expect(engine.remove('nonexistent', { id: 'nonexistent' })).resolves.toBeUndefined();
    });
  });

  describe('deps functionality', () => {
    it('should correctly mount dependent executor', async () => {
      // Create data source executor
      const dataSource = engine.createExecutor({
        kind: 'data-source',
        fn: async (input: { content: string }, dataDir) => {
          await fs.writeFile(path.join(dataDir, 'source.txt'), input.content);
          return { entry: 'source.txt' };
        },
      });

      // Create executor that uses dep
      const processor = engine.createExecutor({
        kind: 'processor',
        deps: {
          'inputs/data': dataSource.config({ input: { content: 'Hello from source' } }),
        },
        fn: async (input: { suffix: string }, dataDir) => {
          // Read dep's data
          const sourceContent = await fs.readFile(path.join(dataDir, 'inputs/data'), 'utf-8');
          const result = `${sourceContent} - ${input.suffix}`;
          
          await fs.mkdir(path.join(dataDir, 'output'), { recursive: true });
          await fs.writeFile(path.join(dataDir, 'output', 'result.txt'), result);
          return { entry: 'output' };
        },
      });

      const resultPath = await processor({ input: { suffix: 'processed' } });

      // Verify result
      const content = await fs.readFile(path.join(resultPath, 'result.txt'), 'utf-8');
      expect(content).toBe('Hello from source - processed');
    });

    it('should have independent cache for deps', async () => {
      let sourceCallCount = 0;

      const dataSource = engine.createExecutor({
        kind: 'cached-source',
        fn: async (input: { id: string }, dataDir) => {
          sourceCallCount++;
          await fs.writeFile(path.join(dataDir, 'data.txt'), `source-${sourceCallCount}`);
          return { entry: 'data.txt' };
        },
      });

      const processor1 = engine.createExecutor({
        kind: 'processor-1',
        deps: {
          'inputs/data': dataSource.config({ input: { id: 'shared' } }),
        },
        fn: async (_input, dataDir) => {
          await fs.writeFile(path.join(dataDir, 'out.txt'), 'p1');
          return { entry: 'out.txt' };
        },
      });

      const processor2 = engine.createExecutor({
        kind: 'processor-2',
        deps: {
          'inputs/data': dataSource.config({ input: { id: 'shared' } }),
        },
        fn: async (_input, dataDir) => {
          await fs.writeFile(path.join(dataDir, 'out.txt'), 'p2');
          return { entry: 'out.txt' };
        },
      });

      await processor1({ input: {} });
      await processor2({ input: {} });

      // dataSource should only execute once (same input uses cache)
      expect(sourceCallCount).toBe(1);
    });

    it('should auto-recover when dep is deleted', async () => {
      let sourceCallCount = 0;
      let processorCallCount = 0;

      const dataSource = engine.createExecutor({
        kind: 'recoverable-source',
        fn: async (input: { id: string }, dataDir) => {
          sourceCallCount++;
          await fs.writeFile(path.join(dataDir, 'data.txt'), `source-call-${sourceCallCount}`);
          return { entry: 'data.txt' };
        },
      });

      const processor = engine.createExecutor({
        kind: 'recovery-processor',
        deps: {
          'inputs/data': dataSource.config({ input: { id: 'recover-test' } }),
        },
        fn: async (_input, dataDir) => {
          processorCallCount++;
          const sourceContent = await fs.readFile(path.join(dataDir, 'inputs/data'), 'utf-8');
          await fs.writeFile(path.join(dataDir, 'out.txt'), `processed: ${sourceContent}`);
          return { entry: 'out.txt' };
        },
      });

      // First execution
      const result1 = await processor({ input: {} });
      expect(sourceCallCount).toBe(1);
      expect(processorCallCount).toBe(1);

      // Verify result
      const content1 = await fs.readFile(result1, 'utf-8');
      expect(content1).toBe('processed: source-call-1');

      // Delete dataSource's cache
      await engine.remove('recoverable-source', { id: 'recover-test' });

      // Second execution of processor (uses cache, but dep is invalid)
      const result2 = await processor({ input: {} });
      
      // processor's fn should not re-execute (uses cache)
      expect(processorCallCount).toBe(1);
      
      // But dataSource should re-execute (auto-recover)
      expect(sourceCallCount).toBe(2);

      // Result path should be the same
      expect(result2).toBe(result1);

      // Verify dep content is valid after recovery
      const content2 = await fs.readFile(result2, 'utf-8');
      expect(content2).toBe('processed: source-call-1'); // Content from processor's cache
    });

    it('should use new dep data when deps config changes', async () => {
      let sourceCallCount = 0;

      const dataSource = engine.createExecutor({
        kind: 'changeable-source',
        fn: async (input: { version: string }, dataDir) => {
          sourceCallCount++;
          await fs.writeFile(path.join(dataDir, 'data.txt'), `version-${input.version}`);
          return { entry: 'data.txt' };
        },
      });

      // First time: deps config points to version: 'v1'
      const processor1 = engine.createExecutor({
        kind: 'config-change-processor',
        deps: {
          'inputs/data': dataSource.config({ input: { version: 'v1' } }),
        },
        fn: async (_input, dataDir) => {
          const sourceContent = await fs.readFile(path.join(dataDir, 'inputs/data'), 'utf-8');
          await fs.writeFile(path.join(dataDir, 'out.txt'), `got: ${sourceContent}`);
          return { entry: 'out.txt' };
        },
      });

      const result1 = await processor1({ input: {} });
      expect(sourceCallCount).toBe(1);
      const content1 = await fs.readFile(result1, 'utf-8');
      expect(content1).toBe('got: version-v1');

      // Second time: simulate deps config change (points to version: 'v2')
      // Note: re-createExecutor here to simulate code change
      const processor2 = engine.createExecutor({
        kind: 'config-change-processor',  // Same kind
        deps: {
          'inputs/data': dataSource.config({ input: { version: 'v2' } }),  // Config changed!
        },
        fn: async (_input, dataDir) => {
          const sourceContent = await fs.readFile(path.join(dataDir, 'inputs/data'), 'utf-8');
          await fs.writeFile(path.join(dataDir, 'out.txt'), `got: ${sourceContent}`);
          return { entry: 'out.txt' };
        },
      });

      // Execute (processor cache hit, but deps config changed)
      const result2 = await processor2({ input: {} });
      
      // dataSource should execute again (because v2 is new input)
      expect(sourceCallCount).toBe(2);
      
      // Verify dep link is updated, points to new data
      const depContent = await fs.readFile(path.join(path.dirname(result2), 'inputs/data'), 'utf-8');
      expect(depContent).toBe('version-v2');
    });
  });

  describe('.config() method', () => {
    it('should return correct config object', () => {
      const testExecutor = engine.createExecutor({
        kind: 'config-test',
        fn: async (_input, dataDir) => {
          await fs.writeFile(path.join(dataDir, 'data.txt'), 'test');
          return { entry: 'data.txt' };
        },
      });

      const config = testExecutor.config({ input: { key: 'value' }, skipCache: true });

      expect(config.kind).toBe('config-test');
      expect(config.input).toEqual({ key: 'value' });
      expect(config.skipCache).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should clean temp directory when fn throws (cleanTempOnError=true)', async () => {
      const errorEngine = new FsContextEngine({ root: testRoot, cleanTempOnError: true });

      const errorExecutor = errorEngine.createExecutor({
        kind: 'error-test',
        fn: async () => {
          throw new Error('Test error');
        },
      });

      await expect(errorExecutor({ input: { id: 'error' } })).rejects.toThrow('Test error');

      // Verify no residual temp directory
      const kindDir = path.join(testRoot, 'fs-data', '1.0.0', 'error-test');
      try {
        const files = await fs.readdir(kindDir, { recursive: true });
        const tmpFiles = files.filter((f) => f.toString().includes('.tmp-'));
        expect(tmpFiles.length).toBe(0);
      } catch {
        // Directory not existing is also normal
      }
    });
  });
});
