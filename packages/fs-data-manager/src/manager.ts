import {
  FsContextEngine,
  type CreateExecutorParams,
  type Executor,
  type ExecuteParams,
  type ExecutorConfig,
  listFsDataNodes,
} from '@fs-based-agent/core';
import type { ZodType, ZodTypeAny } from 'zod';
import type {
  FsDataGraph,
  FsDataGraphEdge,
  FsDataGraphNode,
  ManagedExecutorMeta,
} from './types.js';
import { formatZodError, zodToExecutorInputSchema } from './inputSchema.js';

export interface RegisterExecutorParams<TInput extends Record<string, unknown>>
  extends CreateExecutorParams<TInput> {
  label?: string;
  description?: string;
  inputSchema?: ZodType<TInput>;
}

export interface RegisterDynamicExecutorParams<TInput extends Record<string, unknown>>
  extends Omit<CreateExecutorParams<TInput>, 'deps'> {
  label?: string;
  description?: string;
  deps?: (input: TInput) => Record<string, ExecutorConfig<unknown>>;
  inputSchema?: ZodType<TInput>;
}

/**
 * Service that wraps FsContextEngine with registry + graph helpers
 */
export class FsDataManager {
  private readonly engine: FsContextEngine;
  private readonly registry = new Map<
    string,
    ManagedExecutorMeta & { executor: Executor<unknown>; inputZodSchema?: ZodTypeAny }
  >();

  constructor(private readonly root: string) {
    this.engine = new FsContextEngine({ root });
  }

  /**
   * Register executor with metadata
   */
  registerExecutor<TInput extends Record<string, unknown>>(params: RegisterExecutorParams<TInput>): Executor<TInput> {
    const { label, description, inputSchema, ...engineParams } = params;

    const executor = this.engine.createExecutor(engineParams);
    const record: ManagedExecutorMeta & { executor: Executor<unknown>; inputZodSchema?: ZodTypeAny } = {
      kind: engineParams.kind,
      executor: executor as Executor<unknown>,
    };

    if (label !== undefined) record.label = label;
    if (description !== undefined) record.description = description;
    if (engineParams.deps !== undefined) record.deps = engineParams.deps;
    if (inputSchema) {
      record.inputZodSchema = inputSchema as ZodTypeAny;
      const schemaMeta = zodToExecutorInputSchema(inputSchema as ZodTypeAny);
      if (schemaMeta) record.inputSchema = schemaMeta;
    }

    this.registry.set(engineParams.kind, record);
    return executor;
  }

  /**
   * Register an executor whose deps are computed from the input at execution time.
   * This is useful when you want `deps` to depend on input values (e.g. repoUrl/branch).
   */
  registerDynamicExecutor<TInput extends Record<string, unknown>>(
    params: RegisterDynamicExecutorParams<TInput>
  ): Executor<TInput> {
    const wrapper = (async (executeParams: ExecuteParams<TInput>): Promise<string> => {
      const executorParams = params.deps
        ? {
            kind: params.kind,
            deps: params.deps(executeParams.input),
            fn: params.fn,
          }
        : {
            kind: params.kind,
            fn: params.fn,
          };
      const executor = this.engine.createExecutor<TInput>(executorParams);
      return executor(executeParams);
    }) as Executor<TInput>;

    wrapper.kind = params.kind;
    wrapper.config = (configParams: ExecuteParams<TInput>) => ({
      kind: params.kind,
      input: configParams.input,
      skipCache: configParams.skipCache ?? false,
    });

    const record: ManagedExecutorMeta & { executor: Executor<unknown>; inputZodSchema?: ZodTypeAny } = {
      kind: params.kind,
      executor: wrapper as Executor<unknown>,
      hasDeps: Boolean(params.deps),
    };
    if (params.label !== undefined) record.label = params.label;
    if (params.description !== undefined) record.description = params.description;
    if (params.inputSchema) {
      record.inputZodSchema = params.inputSchema as ZodTypeAny;
      const schemaMeta = zodToExecutorInputSchema(params.inputSchema as ZodTypeAny);
      if (schemaMeta) record.inputSchema = schemaMeta;
    }

    this.registry.set(params.kind, record);
    return wrapper;
  }

  /**
   * Execute a registered executor
   */
  async execute<TInput extends Record<string, unknown>>(
    kind: string,
    params: ExecuteParams<TInput>
  ): Promise<string> {
    const registered = this.registry.get(kind);
    if (!registered) {
      throw new Error(`Executor not registered: ${kind}`);
    }
    let validatedInput = params.input as Record<string, unknown>;
    if (registered.inputZodSchema) {
      const parsed = registered.inputZodSchema.safeParse(validatedInput);
      if (!parsed.success) {
        throw new Error(formatZodError(parsed.error));
      }
      validatedInput = parsed.data as Record<string, unknown>;
    }
    return (registered.executor as Executor<TInput>)({
      ...params,
      input: validatedInput as TInput,
    });
  }

  /**
   * Execute a registered executor with raw input (public API usage)
   */
  async executeRegistered(
    kind: string,
    input: Record<string, unknown>,
    skipCache = false
  ): Promise<string> {
    return this.execute(kind, { input, skipCache });
  }

  /**
   * Re-execute a node by kind/dataId using manifest input
   */
  async reExecuteNode(kind: string, dataId: string): Promise<string> {
    const graph = await this.getGraph();
    const node = graph.nodes.find((n) => n.kind === kind && n.dataId === dataId);
    if (!node) {
      throw new Error(`Node not found for ${kind}:${dataId}`);
    }
    return this.execute(kind, { input: node.manifest.input, skipCache: true });
  }

  listExecutors(): ManagedExecutorMeta[] {
    return [...this.registry.values()].map(({ executor: _, inputZodSchema: __, ...meta }) => meta);
  }

  /**
   * Build FsData graph from disk
   */
  async getGraph(): Promise<FsDataGraph> {
    const rawNodes = await listFsDataNodes(this.root);
    const nodes: FsDataGraphNode[] = rawNodes.map((node) => ({
      ...node,
      id: `${node.kind}:${node.dataId}`,
      label: node.manifest.metadata?.title?.toString() ?? node.kind,
    }));

    const edges: FsDataGraphEdge[] = [];
    for (const node of nodes) {
      for (const dep of node.deps) {
        const source = `${dep.targetKind}:${dep.targetDataId}`;
        const target = node.id;
        edges.push({
          id: `${source}->${target}:${dep.linkPath}`,
          source,
          target,
          label: dep.linkPath,
        });
      }
    }

    return { nodes, edges };
  }
}
