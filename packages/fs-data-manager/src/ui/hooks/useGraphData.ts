import { useCallback, useEffect, useState } from 'react';
import type { FsDataGraph } from '../../types.js';
import { fetchGraph, reExecute, execute } from '../api.js';

interface State {
  graph: FsDataGraph | null;
  executors: { kind: string; label?: string; description?: string }[];
  loading: boolean;
  error: string | null;
  lastEntryPath: string | null;
}

export function useGraphData() {
  const [state, setState] = useState<State>({
    graph: null,
    executors: [],
    loading: true,
    error: null,
    lastEntryPath: null,
  });

  const loadGraph = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const { graph, executors } = await fetchGraph();
      setState((prev) => ({ ...prev, graph, executors, loading: false }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: message, loading: false }));
    }
  }, []);

  const reExecuteNode = useCallback(async (kind: string, dataId: string) => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const entryPath = await reExecute(kind, dataId);
      await loadGraph();
      setState((prev) => ({ ...prev, lastEntryPath: entryPath }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, error: message, loading: false }));
    }
  }, [loadGraph]);

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

  return {
    ...state,
    refresh: loadGraph,
    reExecuteNode,
    executeExecutor,
  };
}
