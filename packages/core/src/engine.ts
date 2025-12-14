/**
 * FsContextEngine main class
 */

import * as fs from 'fs/promises';
import * as path from 'path';
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

function assertValidKind(kind: string): string {
  if (typeof kind !== 'string') {
    throw new Error('Executor kind must be a string');
  }
  const trimmed = kind.trim();
  if (!trimmed) {
    throw new Error('Executor kind must be a non-empty string');
  }
  if (kind !== trimmed) {
    throw new Error(`Executor kind "${kind}" must not have leading/trailing whitespace`);
  }
  if (trimmed === '.' || trimmed === '..') {
    throw new Error(`Executor kind "${kind}" is not allowed`);
  }
  if (kind.includes('/') || kind.includes('\\')) {
    throw new Error(`Executor kind "${kind}" must not contain path separators`);
  }
  return kind;
}

function safeResolveWithin(baseDir: string, relativePath: string, name: string): string {
  if (typeof relativePath !== 'string') {
    throw new Error(`${name} must be a string`);
  }
  const trimmed = relativePath.trim();
  if (!trimmed) {
    throw new Error(`${name} must be a non-empty relative path`);
  }
  if (relativePath.includes('\0')) {
    throw new Error(`${name} must not contain null bytes`);
  }
  if (path.isAbsolute(relativePath)) {
    throw new Error(`${name} must be a relative path`);
  }
  const segments = relativePath.split(/[\\/]+/);
  if (segments.some((seg) => seg === '..')) {
    throw new Error(`${name} must not contain ".." segments`);
  }

  const resolvedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(baseDir, relativePath);
  const relative = path.relative(resolvedBase, resolvedTarget);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`${name} must resolve within ${baseDir}`);
  }
  return resolvedTarget;
}

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
    const kind = assertValidKind(params.kind);
    const { deps, fn } = params;

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
      return this.tryReadEntryPath(dataPath);
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
        const cachedEntry = await this.tryReadEntryPath(dataPath);
        if (cachedEntry) {
          // Cache hit, if there are deps, check and recover invalid deps
          if (deps) {
            await this.recoverInvalidDeps(dataPath, deps);
          }
          return cachedEntry;
        }
        // Cache is corrupted (missing dataLink/entry). Remove and rebuild.
        await removeDir(dataPath);
      }
    }

    // Create temp directory
    const tempPath = buildTempPath(this.root, kind, dataId);
    await fs.mkdir(tempPath, { recursive: true });

    // Create data-space directory (fn's working directory)
    const dataSpacePath = path.join(tempPath, DATA_SPACE_DIRNAME);
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
   * Best-effort read of dataLink (and validate it exists on disk).
   * Returns null when cache is incomplete/corrupted.
   */
  private async tryReadEntryPath(dataPath: string): Promise<string | null> {
    try {
      const entryPath = await readDataLink(dataPath);
      await fs.stat(entryPath);
      return entryPath;
    } catch {
      return null;
    }
  }

  /**
   * Process deps: execute each dep's executor, create symlinks
   */
  private async processDeps(
    tempPath: string,
    deps: Record<string, ExecutorConfig<unknown>>
  ): Promise<void> {
    const entries = Object.entries(deps);

    // Execute deps concurrently (they are cacheable and guarded by atomic renames).
    await Promise.all(
      entries.map(async ([depPath, config]) => {
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

        // Create symlink under the current executor's data-space
        const fullDepPath = safeResolveWithin(tempPath, depPath, 'depPath');
        await createDepLink(fullDepPath, depFsDataPath);
      })
    );
  }

  /**
   * Check and recover invalid deps
   * Invalid cases: 1) symlink target does not exist  2) symlink points to wrong target (deps config changed)
   */
  private async recoverInvalidDeps(
    dataPath: string,
    deps: Record<string, ExecutorConfig<unknown>>
  ): Promise<void> {
    const dataSpacePath = path.join(dataPath, DATA_SPACE_DIRNAME);

    for (const [depPath, config] of Object.entries(deps)) {
      const linkPath = safeResolveWithin(dataSpacePath, depPath, 'depPath');

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
