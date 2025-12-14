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
  DATA_SPACE_DIRNAME,
  DATA_LINK_FILENAME,
  readManifest,
  readDataLink,
  fsDataExists,
} from './fsData.js';

export { listFsDataNodes, readFsDataNode } from './fsDataGraph.js';

export type { FsDataDepLink, FsDataNodeInfo } from './types.js';
