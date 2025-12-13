/**
 * FsContextEngine 类型定义
 */

/**
 * FsData manifest 文件结构
 */
export interface FsDataManifest {
  /** manifest 版本 */
  manifestVersion: string;
  /** 数据类型 */
  kind: string;
  /** 缓存 key（执行时的 input） */
  input: Record<string, unknown>;
  /** 用户自定义元数据 */
  metadata: Record<string, unknown>;
  /** 首次创建时间 */
  createdAt: string;
  /** 最后更新时间 */
  updatedAt: string;
}

/**
 * fn 执行结果
 */
export interface FnResult {
  /** 入口相对路径（相对于 dataDir） */
  entry: string;
  /** 可选的元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * Executor 调用参数
 */
export interface ExecuteParams<TInput> {
  /** 输入参数（同时作为缓存 key） */
  input: TInput;
  /** 是否跳过缓存，强制执行 */
  skipCache?: boolean;
}

/**
 * Executor 配置对象（.config() 返回，用于 deps）
 */
export interface ExecutorConfig<TInput> {
  /** 数据类型 */
  kind: string;
  /** 输入参数 */
  input: TInput;
  /** 是否跳过缓存 */
  skipCache?: boolean;
}

/**
 * Executor 接口
 */
export interface Executor<TInput> {
  /** 执行并返回 dataLink 指向的路径 */
  (params: ExecuteParams<TInput>): Promise<string>;
  /** 返回配置对象（用于 deps） */
  config(params: ExecuteParams<TInput>): ExecutorConfig<TInput>;
  /** 数据类型 */
  kind: string;
}

/**
 * createExecutor 参数
 */
export interface CreateExecutorParams<TInput> {
  /** 数据类型 */
  kind: string;
  /** 依赖项（workspace executor） */
  deps?: Record<string, ExecutorConfig<unknown>>;
  /** 执行函数 */
  fn: (input: TInput, dataDir: string) => Promise<FnResult>;
}

/**
 * FsContextEngine 配置
 */
export interface FsContextEngineOptions {
  /** 数据根目录 */
  root: string;
  /** 出错时是否清理临时目录，默认 true */
  cleanTempOnError?: boolean;
}

/**
 * 内部使用：注册的 executor 信息
 */
export interface RegisteredExecutor {
  kind: string;
  deps?: Record<string, ExecutorConfig<unknown>>;
  fn: (input: unknown, dataDir: string) => Promise<FnResult>;
}

