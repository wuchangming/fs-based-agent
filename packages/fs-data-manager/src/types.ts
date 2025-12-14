import type { ExecutorConfig, FsDataNodeInfo } from '@fs-based-agent/core';

export interface ManagedExecutorMeta {
  kind: string;
  label?: string;
  description?: string;
  deps?: Record<string, ExecutorConfig<unknown>>;
  /** For dynamic deps, use this to expose "deps enabled" in UI */
  hasDeps?: boolean;
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
