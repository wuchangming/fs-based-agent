import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FsDataGraph } from '../../types.js';
import { execute, fetchGraph, reExecute, type GraphResponse } from '../api.js';

export type ExecutorSummary = GraphResponse['executors'][number];

interface State {
  graph: FsDataGraph | null;
  executors: ExecutorSummary[];
  selectedKind: string | null;
  loading: boolean;
  error: string | null;
  lastEntryPath: string | null;
}

export function useGraphData() {
  const [state, setState] = useState<State>({
    graph: null,
    executors: [],
    selectedKind: null,
    loading: true,
    error: null,
    lastEntryPath: null,
  });

  const loadGraph = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const { graph, executors } = await fetchGraph();
      setState((prev) => {
        const stillValid = prev.selectedKind && executors.some((ex) => ex.kind === prev.selectedKind);
        const selectedKind = stillValid ? prev.selectedKind : executors[0]?.kind ?? null;
        return { ...prev, graph, executors, selectedKind, loading: false };
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: message, loading: false }));
    }
  }, []);

  const reExecuteNode = useCallback(
    async (kind: string, dataId: string) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const entryPath = await reExecute(kind, dataId);
        await loadGraph();
        setState((prev) => ({ ...prev, lastEntryPath: entryPath }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, error: message, loading: false }));
      }
    },
    [loadGraph]
  );

  const executeExecutor = useCallback(
    async (kind: string, input: Record<string, unknown>, skipCache = false) => {
      setState((prev) => ({ ...prev, loading: true, error: null }));
      try {
        const entryPath = await execute(kind, input, skipCache);
        await loadGraph();
        setState((prev) => ({ ...prev, lastEntryPath: entryPath }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setState((prev) => ({ ...prev, error: message, loading: false }));
      }
    },
    [loadGraph]
  );

  useEffect(() => {
    void loadGraph();
  }, [loadGraph]);

  const selectedExecutor = useMemo(
    () => state.executors.find((ex) => ex.kind === state.selectedKind) ?? null,
    [state.executors, state.selectedKind]
  );

  return {
    ...state,
    selectedExecutor,
    refresh: loadGraph,
    reExecuteNode,
    executeExecutor,
    setSelectedKind: (kind: string | null) => setState((prev) => ({ ...prev, selectedKind: kind })),
  };
}
