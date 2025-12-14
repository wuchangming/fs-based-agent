import type { ExecutorConfig, FsDataNodeInfo } from '@fs-based-agent/core';

export type ExecutorInputFieldType = 'string' | 'number' | 'boolean' | 'enum' | 'json';

export interface ExecutorInputFieldSchema {
  key: string;
  type: ExecutorInputFieldType;
  required: boolean;
  description?: string;
  defaultValue?: unknown;
  enumValues?: string[];
}

export interface ExecutorInputSchema {
  type: 'object';
  fields: ExecutorInputFieldSchema[];
}

export interface ManagedExecutorMeta {
  kind: string;
  label?: string;
  description?: string;
  deps?: Record<string, ExecutorConfig<unknown>>;
  /** For dynamic deps, use this to expose "deps enabled" in UI */
  hasDeps?: boolean;
  /** Input schema (derived from a Zod schema) for UI rendering */
  inputSchema?: ExecutorInputSchema;
}

export interface FsDataGraphNode extends FsDataNodeInfo {
  /** Unique identifier `${kind}:${dataId}` */
  id: string;
  label: string;
}

export interface FsDataGraphEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface FsDataGraph {
  nodes: FsDataGraphNode[];
  edges: FsDataGraphEdge[];
}
