/**
 * FsContextEngine 主类
 */

import * as fs from 'fs/promises';
import type {
  FsContextEngineOptions,
  CreateExecutorParams,
  Executor,
  ExecuteParams,
  ExecutorConfig,
  RegisteredExecutor,
  FnResult,
} from './types.js';
import {
  generateDataId,
  buildDataPath,
  buildTempPath,
  fsDataExists,
  readDataLink,
  writeManifest,
  createDataLink,
  createDepLink,
  computeDepLinkTarget,
  atomicRename,
  removeDir,
  createManifest,
  DATA_SPACE_DIRNAME,
} from './fsData.js';

export class FsContextEngine {
  private readonly root: string;
  private readonly cleanTempOnError: boolean;
  private readonly executors: Map<string, RegisteredExecutor> = new Map();

  constructor(options: FsContextEngineOptions) {
    this.root = options.root;
    this.cleanTempOnError = options.cleanTempOnError ?? true;
  }

  /**
   * 创建 Executor
   */
  createExecutor<TInput extends Record<string, unknown>>(
    params: CreateExecutorParams<TInput>
  ): Executor<TInput> {
    const { kind, deps, fn } = params;

    // 注册 executor
    this.executors.set(kind, {
      kind,
      deps: deps ?? {},
      fn: fn as (input: unknown, dataDir: string) => Promise<FnResult>,
    });

    // 创建 executor 函数
    const executor = async (executeParams: ExecuteParams<TInput>): Promise<string> => {
      return this.execute(kind, executeParams, deps, fn);
    };

    // 添加 config 方法
    executor.config = (configParams: ExecuteParams<TInput>): ExecutorConfig<TInput> => {
      return {
        kind,
        input: configParams.input,
        skipCache: configParams.skipCache ?? false,
      };
    };

    // 添加 kind 属性
    executor.kind = kind;

    return executor as Executor<TInput>;
  }

  /**
   * 只读取缓存（不执行）
   * @returns dataLink 指向的路径，或 null（不存在）
   */
  async get(kind: string, input: Record<string, unknown>): Promise<string | null> {
    const dataId = generateDataId(kind, input);
    const dataPath = buildDataPath(this.root, kind, dataId);

    if (await fsDataExists(dataPath)) {
      return readDataLink(dataPath);
    }
    return null;
  }

  /**
   * 删除缓存（幂等，不存在时静默成功）
   */
  async remove(kind: string, input: Record<string, unknown>): Promise<void> {
    const dataId = generateDataId(kind, input);
    const dataPath = buildDataPath(this.root, kind, dataId);
    await removeDir(dataPath);
  }

  /**
   * 内部执行逻辑
   */
  private async execute<TInput extends Record<string, unknown>>(
    kind: string,
    params: ExecuteParams<TInput>,
    deps: Record<string, ExecutorConfig<unknown>> | undefined,
    fn: (input: TInput, dataDir: string) => Promise<FnResult>
  ): Promise<string> {
    const { input, skipCache } = params;
    const dataId = generateDataId(kind, input as Record<string, unknown>);
    const dataPath = buildDataPath(this.root, kind, dataId);

    // 检查缓存
    if (await fsDataExists(dataPath)) {
      if (skipCache) {
        // skipCache 时先删除旧缓存，否则 rename 会因目标非空而失败
        await removeDir(dataPath);
      } else {
        // 命中缓存，如果有 deps，检查并恢复失效的 deps
        if (deps) {
          await this.recoverInvalidDeps(dataPath, deps);
        }
        return readDataLink(dataPath);
      }
    }

    // 创建临时目录
    const tempPath = buildTempPath(this.root, kind, dataId);
    await fs.mkdir(tempPath, { recursive: true });

    // 创建 data-space 目录（fn 的工作目录）
    const dataSpacePath = `${tempPath}/${DATA_SPACE_DIRNAME}`;
    await fs.mkdir(dataSpacePath, { recursive: true });

    try {
      // 处理 deps（挂载到 data-space 内）
      if (deps) {
        await this.processDeps(dataSpacePath, deps);
      }

      // 执行 fn（传入 data-space 路径）
      const result = await fn(input, dataSpacePath);

      // 写入 manifest
      const manifest = createManifest(kind, input as Record<string, unknown>, result.metadata || {});
      await writeManifest(tempPath, manifest);

      // 创建 dataLink
      await createDataLink(tempPath, result.entry);

      // 原子 rename
      const renamed = await atomicRename(tempPath, dataPath);

      if (!renamed) {
        // rename 失败，目标已存在（并发情况）
        // 删除临时目录，使用已有结果
        await removeDir(tempPath);
      }

      // 返回 dataLink 路径
      return readDataLink(dataPath);
    } catch (err) {
      // 出错时清理临时目录
      if (this.cleanTempOnError) {
        await removeDir(tempPath);
      }
      throw err;
    }
  }

  /**
   * 处理 deps：执行每个 dep 的 executor，创建软链接
   */
  private async processDeps(
    tempPath: string,
    deps: Record<string, ExecutorConfig<unknown>>
  ): Promise<void> {
    for (const [depPath, config] of Object.entries(deps)) {
      const { kind, input, skipCache } = config;

      // 查找注册的 executor
      const registered = this.executors.get(kind);
      if (!registered) {
        throw new Error(`Executor not found for kind: ${kind}`);
      }

      // 执行 dep 的 executor（确保数据已生成）
      await this.execute(
        kind,
        { input: input as Record<string, unknown>, skipCache: skipCache ?? false },
        registered.deps,
        registered.fn as (input: Record<string, unknown>, dataDir: string) => Promise<FnResult>
      );

      // 获取 dep 的 FsData 目录路径
      const depDataId = generateDataId(kind, input as Record<string, unknown>);
      const depFsDataPath = buildDataPath(this.root, kind, depDataId);

      // 创建软链接
      const fullDepPath = `${tempPath}/${depPath}`;
      await createDepLink(fullDepPath, depFsDataPath);
    }
  }

  /**
   * 检查并恢复失效的 deps
   * 失效情况：1) 软链接目标不存在  2) 软链接指向错误目标（deps 配置变化）
   */
  private async recoverInvalidDeps(
    dataPath: string,
    deps: Record<string, ExecutorConfig<unknown>>
  ): Promise<void> {
    const dataSpacePath = `${dataPath}/${DATA_SPACE_DIRNAME}`;

    for (const [depPath, config] of Object.entries(deps)) {
      const linkPath = `${dataSpacePath}/${depPath}`;

      // 计算期望的目标路径
      const expectedDataId = generateDataId(config.kind, config.input as Record<string, unknown>);
      const expectedFsDataPath = buildDataPath(this.root, config.kind, expectedDataId);
      const expectedTarget = computeDepLinkTarget(linkPath, expectedFsDataPath);

      let needRecover = false;

      try {
        // 检查软链接是否存在
        const actualTarget = await fs.readlink(linkPath);

        if (actualTarget !== expectedTarget) {
          // 软链接指向错误目标（deps 配置变化）
          needRecover = true;
        } else {
          // 软链接目标正确，检查目标数据是否存在
          await fs.stat(linkPath);
        }
      } catch {
        // 软链接不存在或目标不存在
        needRecover = true;
      }

      if (needRecover) {
        // 重新执行 dep 的 executor
        const registered = this.executors.get(config.kind);
        if (registered) {
          await this.execute(
            config.kind,
            { input: config.input as Record<string, unknown>, skipCache: false },
            registered.deps,
            registered.fn as (input: Record<string, unknown>, dataDir: string) => Promise<FnResult>
          );

          // 删除旧的软链接，创建新的
          try {
            await fs.unlink(linkPath);
          } catch {
            // 软链接可能不存在，忽略
          }
          await createDepLink(linkPath, expectedFsDataPath);
        }
      }
    }
  }
}

