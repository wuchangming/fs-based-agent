import { useEffect, useMemo, useState } from 'react';
import type { FsDataGraph } from '../types.js';
import { GraphView } from './GraphView.js';
import { NodeList } from './NodeList.js';
import { RegisteredExecutors } from './RegisteredExecutors.js';
import { useGraphData } from './hooks/useGraphData.js';

export function App() {
  const {
    graph,
    executors,
    selectedKind,
    selectedExecutor,
    loading,
    error,
    lastEntryPath,
    refresh,
    setSelectedKind,
    reExecuteNode,
    executeExecutor,
  } = useGraphData();

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const filteredGraph = useMemo(() => {
    return buildExecutorGraph(graph, selectedKind, Boolean(selectedExecutor?.hasDeps));
  }, [graph, selectedExecutor?.hasDeps, selectedKind]);

  const focusCount = useMemo(() => {
    if (!selectedKind) return 0;
    return filteredGraph.nodes.filter((n) => n.kind === selectedKind).length;
  }, [filteredGraph.nodes, selectedKind]);

  const depCount = useMemo(() => {
    if (!selectedKind) return 0;
    return filteredGraph.nodes.filter((n) => n.kind !== selectedKind).length;
  }, [filteredGraph.nodes, selectedKind]);

  useEffect(() => {
    setSelectedNodeId(null);
  }, [selectedKind]);

  useEffect(() => {
    if (selectedNodeId && !filteredGraph.nodes.some((n) => n.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [filteredGraph.nodes, selectedNodeId]);

  const headline = useMemo(() => {
    if (loading) return 'Loading fs-data graph...';
    if (error) return 'Failed to load graph';
    return 'FsData DAG';
  }, [loading, error]);

  return (
    <div className="page">
      <header>
        <div>
          <p className="eyebrow">fs-based-agent</p>
          <h1>{headline}</h1>
          <p className="lede">
            Select an executor, explore its FsData instances and dependencies, and re-run a single
            node with fresh cache.
          </p>
        </div>
        <div className="header-actions">
          <button className="primary" onClick={() => refresh()}>
            Refresh graph
          </button>
        </div>
      </header>

      {error && <div className="alert danger">{error}</div>}
      {lastEntryPath && <div className="alert success">Updated entry: {lastEntryPath}</div>}

      <main className="layout">
        <section className="panel">
          <div className="selector-row">
            <div className="selector-left">
              <div className="eyebrow">Executor</div>
              <select
                value={selectedKind ?? ''}
                onChange={(e) => setSelectedKind(e.target.value || null)}
                disabled={!executors.length}
              >
                {!executors.length && <option value="">No executors</option>}
                {executors.map((ex) => (
                  <option key={ex.kind} value={ex.kind}>
                    {ex.label || ex.kind}
                  </option>
                ))}
              </select>
              {selectedKind && (
                <div className="meta">
                  nodes: {focusCount}
                  {selectedExecutor?.hasDeps ? `, deps: ${depCount}` : ''}
                </div>
              )}
            </div>
            <div className="selector-right">
              {selectedExecutor?.hasDeps ? (
                <span className="badge">deps enabled</span>
              ) : (
                selectedKind && <span className="badge muted">no deps</span>
              )}
            </div>
          </div>

          {selectedKind ? (
            <GraphView
              graph={filteredGraph}
              focusKind={selectedKind}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
          ) : (
            <div className="card muted">请选择一个 executor。</div>
          )}
        </section>

        <section className="panel list-panel">
          <NodeList graph={filteredGraph} selectedNodeId={selectedNodeId} onReExecute={reExecuteNode} />
          <RegisteredExecutors executors={executors} onExecute={executeExecutor} />
        </section>
      </main>
    </div>
  );
}

function buildExecutorGraph(
  graph: FsDataGraph | null,
  kind: string | null,
  includeDeps: boolean
): FsDataGraph {
  if (!graph || !kind) return { nodes: [], edges: [] };

  const focusNodes = graph.nodes.filter((n) => n.kind === kind);
  if (!includeDeps) {
    return { nodes: focusNodes, edges: [] };
  }

  const includeIds = new Set<string>(focusNodes.map((n) => n.id));
  const includeEdgeMap = new Map<string, (typeof graph.edges)[number]>();

  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of graph.edges) {
      if (includeIds.has(edge.target)) {
        includeEdgeMap.set(edge.id, edge);
        if (!includeIds.has(edge.source)) {
          includeIds.add(edge.source);
          changed = true;
        }
      }
    }
  }

  const nodes = graph.nodes.filter((n) => includeIds.has(n.id));
  const edges = Array.from(includeEdgeMap.values()).filter(
    (e) => includeIds.has(e.source) && includeIds.has(e.target)
  );

  return { nodes, edges };
}
