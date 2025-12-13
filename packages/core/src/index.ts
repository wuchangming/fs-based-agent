/**
 * FsContextEngine - 统一的缓存/幂等基础设施
 *
 * 核心理念：
 * - 相同 input → 相同结果
 * - 一切皆 FsData
 * - 统一的 Executor 模型
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
