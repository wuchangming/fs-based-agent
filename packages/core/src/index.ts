/**
 * FsContextEngine - Unified cache/idempotent infrastructure
 *
 * Core concepts:
 * - Same input → same result
 * - Everything is FsData
 * - Unified Executor model
 */

export { FsContextEngine } from './engine.js';

export type {
  FsDataManifest,
  FnResult,
  ExecuteParams,
  ExecutorConfig,
  Executor,
  CreateExecutorParams,
  FsContextEngineOptions,
} from './types.js';

export {
  generateDataId,
  getShard,
  buildDataPath,
  MANIFEST_VERSION,
  FS_DATA_VERSION,
} from './fsData.js';
