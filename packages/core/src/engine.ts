/**
 * FsContextEngine main class
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
   * Create Executor
   */
  createExecutor<TInput extends Record<string, unknown>>(
    params: CreateExecutorParams<TInput>
  ): Executor<TInput> {
    const { kind, deps, fn } = params;

    // Register executor
    this.executors.set(kind, {
      kind,
      deps: deps ?? {},
      fn: fn as (input: unknown, dataDir: string) => Promise<FnResult>,
    });

    // Create executor function
    const executor = async (executeParams: ExecuteParams<TInput>): Promise<string> => {
      return this.execute(kind, executeParams, deps, fn);
    };

    // Add config method
    executor.config = (configParams: ExecuteParams<TInput>): ExecutorConfig<TInput> => {
      return {
        kind,
        input: configParams.input,
        skipCache: configParams.skipCache ?? false,
      };
    };

    // Add kind property
    executor.kind = kind;

    return executor as Executor<TInput>;
  }

  /**
   * Read cache only (without execution)
   * @returns Path pointed to by dataLink, or null (if not exists)
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
   * Delete cache (idempotent, silently succeeds if not exists)
   */
  async remove(kind: string, input: Record<string, unknown>): Promise<void> {
    const dataId = generateDataId(kind, input);
    const dataPath = buildDataPath(this.root, kind, dataId);
    await removeDir(dataPath);
  }

  /**
   * Internal execution logic
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

    // Check cache
    if (await fsDataExists(dataPath)) {
      if (skipCache) {
        // When skipCache, delete old cache first, otherwise rename will fail due to non-empty target
        await removeDir(dataPath);
      } else {
        // Cache hit, if there are deps, check and recover invalid deps
        if (deps) {
          await this.recoverInvalidDeps(dataPath, deps);
        }
        return readDataLink(dataPath);
      }
    }

    // Create temp directory
    const tempPath = buildTempPath(this.root, kind, dataId);
    await fs.mkdir(tempPath, { recursive: true });

    // Create data-space directory (fn's working directory)
    const dataSpacePath = `${tempPath}/${DATA_SPACE_DIRNAME}`;
    await fs.mkdir(dataSpacePath, { recursive: true });

    try {
      // Process deps (mount to data-space)
      if (deps) {
        await this.processDeps(dataSpacePath, deps);
      }

      // Execute fn (pass data-space path)
      const result = await fn(input, dataSpacePath);

      // Write manifest
      const manifest = createManifest(kind, input as Record<string, unknown>, result.metadata || {});
      await writeManifest(tempPath, manifest);

      // Create dataLink
      await createDataLink(tempPath, result.entry);

      // Atomic rename
      const renamed = await atomicRename(tempPath, dataPath);

      if (!renamed) {
        // Rename failed, target already exists (concurrent scenario)
        // Delete temp directory, use existing result
        await removeDir(tempPath);
      }

      // Return dataLink path
      return readDataLink(dataPath);
    } catch (err) {
      // Clean up temp directory on error
      if (this.cleanTempOnError) {
        await removeDir(tempPath);
      }
      throw err;
    }
  }

  /**
   * Process deps: execute each dep's executor, create symlinks
   */
  private async processDeps(
    tempPath: string,
    deps: Record<string, ExecutorConfig<unknown>>
  ): Promise<void> {
    for (const [depPath, config] of Object.entries(deps)) {
      const { kind, input, skipCache } = config;

      // Find registered executor
      const registered = this.executors.get(kind);
      if (!registered) {
        throw new Error(`Executor not found for kind: ${kind}`);
      }

      // Execute dep's executor (ensure data is generated)
      await this.execute(
        kind,
        { input: input as Record<string, unknown>, skipCache: skipCache ?? false },
        registered.deps,
        registered.fn as (input: Record<string, unknown>, dataDir: string) => Promise<FnResult>
      );

      // Get dep's FsData directory path
      const depDataId = generateDataId(kind, input as Record<string, unknown>);
      const depFsDataPath = buildDataPath(this.root, kind, depDataId);

      // Create symlink
      const fullDepPath = `${tempPath}/${depPath}`;
      await createDepLink(fullDepPath, depFsDataPath);
    }
  }

  /**
   * Check and recover invalid deps
   * Invalid cases: 1) symlink target does not exist  2) symlink points to wrong target (deps config changed)
   */
  private async recoverInvalidDeps(
    dataPath: string,
    deps: Record<string, ExecutorConfig<unknown>>
  ): Promise<void> {
    const dataSpacePath = `${dataPath}/${DATA_SPACE_DIRNAME}`;

    for (const [depPath, config] of Object.entries(deps)) {
      const linkPath = `${dataSpacePath}/${depPath}`;

      // Calculate expected target path
      const expectedDataId = generateDataId(config.kind, config.input as Record<string, unknown>);
      const expectedFsDataPath = buildDataPath(this.root, config.kind, expectedDataId);
      const expectedTarget = computeDepLinkTarget(linkPath, expectedFsDataPath);

      let needRecover = false;

      try {
        // Check if symlink exists
        const actualTarget = await fs.readlink(linkPath);

        if (actualTarget !== expectedTarget) {
          // Symlink points to wrong target (deps config changed)
          needRecover = true;
        } else {
          // Symlink target is correct, check if target data exists
          await fs.stat(linkPath);
        }
      } catch {
        // Symlink does not exist or target does not exist
        needRecover = true;
      }

      if (needRecover) {
        // Re-execute dep's executor
        const registered = this.executors.get(config.kind);
        if (registered) {
          await this.execute(
            config.kind,
            { input: config.input as Record<string, unknown>, skipCache: false },
            registered.deps,
            registered.fn as (input: Record<string, unknown>, dataDir: string) => Promise<FnResult>
          );

          // Delete old symlink, create new one
          try {
            await fs.unlink(linkPath);
          } catch {
            // Symlink may not exist, ignore
          }
          await createDepLink(linkPath, expectedFsDataPath);
        }
      }
    }
  }
}
