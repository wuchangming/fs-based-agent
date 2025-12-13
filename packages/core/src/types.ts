/**
 * FsContextEngine type definitions
 */

/**
 * FsData manifest file structure
 */
export interface FsDataManifest {
  /** Manifest version */
  manifestVersion: string;
  /** Data type */
  kind: string;
  /** Cache key (input at execution time) */
  input: Record<string, unknown>;
  /** User-defined metadata */
  metadata: Record<string, unknown>;
  /** First creation time */
  createdAt: string;
  /** Last update time */
  updatedAt: string;
}

/**
 * fn execution result
 */
export interface FnResult {
  /** Entry relative path (relative to dataDir) */
  entry: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Executor call parameters
 */
export interface ExecuteParams<TInput> {
  /** Input parameters (also used as cache key) */
  input: TInput;
  /** Whether to skip cache, force execution */
  skipCache?: boolean;
}

/**
 * Executor config object (returned by .config(), used for deps)
 */
export interface ExecutorConfig<TInput> {
  /** Data type */
  kind: string;
  /** Input parameters */
  input: TInput;
  /** Whether to skip cache */
  skipCache?: boolean;
}

/**
 * Executor interface
 */
export interface Executor<TInput> {
  /** Execute and return path pointed to by dataLink */
  (params: ExecuteParams<TInput>): Promise<string>;
  /** Return config object (used for deps) */
  config(params: ExecuteParams<TInput>): ExecutorConfig<TInput>;
  /** Data type */
  kind: string;
}

/**
 * createExecutor parameters
 */
export interface CreateExecutorParams<TInput> {
  /** Data type */
  kind: string;
  /** Dependencies (workspace executor) */
  deps?: Record<string, ExecutorConfig<unknown>>;
  /** Execution function */
  fn: (input: TInput, dataDir: string) => Promise<FnResult>;
}

/**
 * FsContextEngine configuration
 */
export interface FsContextEngineOptions {
  /** Data root directory */
  root: string;
  /** Whether to clean temp directory on error, default true */
  cleanTempOnError?: boolean;
}

/**
 * Internal use: registered executor info
 */
export interface RegisteredExecutor {
  kind: string;
  deps?: Record<string, ExecutorConfig<unknown>>;
  fn: (input: unknown, dataDir: string) => Promise<FnResult>;
}
