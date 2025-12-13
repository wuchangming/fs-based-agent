/**
 * FsContextEngine 测试
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

  describe('createExecutor 基础功能', () => {
    it('应该创建一个可调用的 executor', async () => {
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

    it('应该执行 fn 并返回 entry 路径', async () => {
      const testExecutor = engine.createExecutor({
        kind: 'test-executor',
        fn: async (input: { name: string }, dataDir) => {
          await fs.mkdir(path.join(dataDir, 'output'), { recursive: true });
          await fs.writeFile(path.join(dataDir, 'output', 'result.txt'), `Hello ${input.name}`);
          return { entry: 'output' };
        },
      });

      const resultPath = await testExecutor({ input: { name: 'World' } });

      // 验证返回的路径存在
      const stat = await fs.stat(resultPath);
      expect(stat.isDirectory()).toBe(true);

      // 验证内容
      const content = await fs.readFile(path.join(resultPath, 'result.txt'), 'utf-8');
      expect(content).toBe('Hello World');
    });

    it('应该写入正确的 manifest', async () => {
      const testExecutor = engine.createExecutor({
        kind: 'test-kind',
        fn: async (input: { key: string }, dataDir) => {
          await fs.writeFile(path.join(dataDir, 'data.txt'), 'test');
          return { entry: 'data.txt', metadata: { custom: 'meta' } };
        },
      });

      await testExecutor({ input: { key: 'value' } });

      // 读取 manifest
      const dataId = generateDataId('test-kind', { key: 'value' });
      const dataPath = buildDataPath(testRoot, 'test-kind', dataId);
      const manifest = await readManifest(dataPath);

      expect(manifest.kind).toBe('test-kind');
      expect(manifest.input).toEqual({ key: 'value' });
      expect(manifest.metadata).toEqual({ custom: 'meta' });
    });
  });

  describe('缓存机制', () => {
    it('相同 input 应该使用缓存（不重复执行 fn）', async () => {
      let callCount = 0;

      const testExecutor = engine.createExecutor({
        kind: 'cache-test',
        fn: async (input: { id: string }, dataDir) => {
          callCount++;
          await fs.writeFile(path.join(dataDir, 'data.txt'), `call-${callCount}`);
          return { entry: 'data.txt' };
        },
      });

      // 第一次调用
      const path1 = await testExecutor({ input: { id: 'same' } });
      expect(callCount).toBe(1);

      // 第二次调用（相同 input）
      const path2 = await testExecutor({ input: { id: 'same' } });
      expect(callCount).toBe(1); // fn 不应该再次执行
      expect(path1).toBe(path2);

      // 验证内容是第一次的结果
      const content = await fs.readFile(path1, 'utf-8');
      expect(content).toBe('call-1');
    });

    it('不同 input 应该分别执行', async () => {
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

    it('skipCache=true 应该强制执行', async () => {
      let callCount = 0;

      const testExecutor = engine.createExecutor({
        kind: 'skip-cache-test',
        fn: async (input: { id: string }, dataDir) => {
          callCount++;
          await fs.writeFile(path.join(dataDir, 'data.txt'), `call-${callCount}`);
          return { entry: 'data.txt' };
        },
      });

      // 第一次调用
      await testExecutor({ input: { id: 'test' } });
      expect(callCount).toBe(1);

      // 第二次调用（skipCache）
      await testExecutor({ input: { id: 'test' }, skipCache: true });
      expect(callCount).toBe(2);
    });
  });

  describe('get() 方法', () => {
    it('缓存存在时返回路径', async () => {
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

    it('缓存不存在时返回 null', async () => {
      const result = await engine.get('nonexistent-kind', { id: 'nonexistent' });
      expect(result).toBeNull();
    });
  });

  describe('remove() 方法', () => {
    it('应该删除缓存', async () => {
      const testExecutor = engine.createExecutor({
        kind: 'remove-test',
        fn: async (input: { id: string }, dataDir) => {
          await fs.writeFile(path.join(dataDir, 'data.txt'), 'test');
          return { entry: 'data.txt' };
        },
      });

      await testExecutor({ input: { id: 'to-remove' } });

      // 验证缓存存在
      expect(await engine.get('remove-test', { id: 'to-remove' })).not.toBeNull();

      // 删除
      await engine.remove('remove-test', { id: 'to-remove' });

      // 验证缓存已删除
      expect(await engine.get('remove-test', { id: 'to-remove' })).toBeNull();
    });

    it('删除不存在的缓存应该静默成功（幂等）', async () => {
      // 不应该抛错
      await expect(engine.remove('nonexistent', { id: 'nonexistent' })).resolves.toBeUndefined();
    });
  });

  describe('deps 功能', () => {
    it('应该正确挂载依赖的 executor', async () => {
      // 创建数据源 executor
      const dataSource = engine.createExecutor({
        kind: 'data-source',
        fn: async (input: { content: string }, dataDir) => {
          await fs.writeFile(path.join(dataDir, 'source.txt'), input.content);
          return { entry: 'source.txt' };
        },
      });

      // 创建使用 dep 的 executor
      const processor = engine.createExecutor({
        kind: 'processor',
        deps: {
          'inputs/data': dataSource.config({ input: { content: 'Hello from source' } }),
        },
        fn: async (input: { suffix: string }, dataDir) => {
          // 读取 dep 的数据
          const sourceContent = await fs.readFile(path.join(dataDir, 'inputs/data'), 'utf-8');
          const result = `${sourceContent} - ${input.suffix}`;
          
          await fs.mkdir(path.join(dataDir, 'output'), { recursive: true });
          await fs.writeFile(path.join(dataDir, 'output', 'result.txt'), result);
          return { entry: 'output' };
        },
      });

      const resultPath = await processor({ input: { suffix: 'processed' } });

      // 验证结果
      const content = await fs.readFile(path.join(resultPath, 'result.txt'), 'utf-8');
      expect(content).toBe('Hello from source - processed');
    });

    it('deps 的缓存应该独立工作', async () => {
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

      // dataSource 应该只执行一次（相同 input 使用缓存）
      expect(sourceCallCount).toBe(1);
    });

    it('dep 被删除后应该自动重新拉取', async () => {
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

      // 第一次执行
      const result1 = await processor({ input: {} });
      expect(sourceCallCount).toBe(1);
      expect(processorCallCount).toBe(1);

      // 验证结果
      const content1 = await fs.readFile(result1, 'utf-8');
      expect(content1).toBe('processed: source-call-1');

      // 删除 dataSource 的缓存
      await engine.remove('recoverable-source', { id: 'recover-test' });

      // 第二次执行 processor（使用缓存，但 dep 失效）
      const result2 = await processor({ input: {} });
      
      // processor 的 fn 不应该重新执行（使用缓存）
      expect(processorCallCount).toBe(1);
      
      // 但 dataSource 应该重新执行（自动恢复）
      expect(sourceCallCount).toBe(2);

      // 结果路径应该相同
      expect(result2).toBe(result1);

      // 验证 dep 恢复后内容有效
      const content2 = await fs.readFile(result2, 'utf-8');
      expect(content2).toBe('processed: source-call-1'); // 内容来自 processor 的缓存
    });

    it('deps 配置变化后应该使用新的 dep 数据', async () => {
      let sourceCallCount = 0;

      const dataSource = engine.createExecutor({
        kind: 'changeable-source',
        fn: async (input: { version: string }, dataDir) => {
          sourceCallCount++;
          await fs.writeFile(path.join(dataDir, 'data.txt'), `version-${input.version}`);
          return { entry: 'data.txt' };
        },
      });

      // 第一次：deps 配置指向 version: 'v1'
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

      // 第二次：模拟 deps 配置变化（指向 version: 'v2'）
      // 注意：这里重新 createExecutor 模拟代码变更
      const processor2 = engine.createExecutor({
        kind: 'config-change-processor',  // 同样的 kind
        deps: {
          'inputs/data': dataSource.config({ input: { version: 'v2' } }),  // 配置变了！
        },
        fn: async (_input, dataDir) => {
          const sourceContent = await fs.readFile(path.join(dataDir, 'inputs/data'), 'utf-8');
          await fs.writeFile(path.join(dataDir, 'out.txt'), `got: ${sourceContent}`);
          return { entry: 'out.txt' };
        },
      });

      // 执行（processor 缓存命中，但 deps 配置变了）
      const result2 = await processor2({ input: {} });
      
      // dataSource 应该再次执行（因为 v2 是新的 input）
      expect(sourceCallCount).toBe(2);
      
      // 验证 dep 链接已更新，指向新数据
      const depContent = await fs.readFile(path.join(path.dirname(result2), 'inputs/data'), 'utf-8');
      expect(depContent).toBe('version-v2');
    });
  });

  describe('.config() 方法', () => {
    it('应该返回正确的配置对象', () => {
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

  describe('错误处理', () => {
    it('fn 抛错时应该清理临时目录（cleanTempOnError=true）', async () => {
      const errorEngine = new FsContextEngine({ root: testRoot, cleanTempOnError: true });

      const errorExecutor = errorEngine.createExecutor({
        kind: 'error-test',
        fn: async () => {
          throw new Error('Test error');
        },
      });

      await expect(errorExecutor({ input: { id: 'error' } })).rejects.toThrow('Test error');

      // 验证没有残留的临时目录
      const kindDir = path.join(testRoot, 'fs-data', '1.0.0', 'error-test');
      try {
        const files = await fs.readdir(kindDir, { recursive: true });
        const tmpFiles = files.filter((f) => f.toString().includes('.tmp-'));
        expect(tmpFiles.length).toBe(0);
      } catch {
        // 目录不存在也是正常的
      }
    });
  });
});

