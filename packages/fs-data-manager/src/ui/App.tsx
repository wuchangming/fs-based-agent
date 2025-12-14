import { useMemo } from 'react';
import { GraphView } from './GraphView.js';
import { NodeList } from './NodeList.js';
import { RegisteredExecutors } from './RegisteredExecutors.js';
import { useGraphData } from './hooks/useGraphData.js';

export function App() {
  const {
    graph,
    executors,
    loading,
    error,
    refresh,
    reExecuteNode,
    executeExecutor,
    lastEntryPath,
  } = useGraphData();

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
            Explore the FsData DAG, inspect manifests, and re-run individual nodes with fresh cache.
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
<<<<<<< ours
          {graph ? (
            <GraphView graph={graph} />
=======
          <div className="selector-row">
            <div>
              <div className="eyebrow">选择 executor</div>
              <select
                value={selectedKind ?? ''}
                onChange={(e) => setSelectedKind(e.target.value || null)}
              >
                {executors.map((ex) => (
                  <option key={ex.kind} value={ex.kind}>
                    {ex.label || ex.kind}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {graph && selectedKind ? (
            <GraphView
              graph={filtered}
              primaryKind={selectedKind}
              selectedNodeId={selectedNodeId}
              onSelectNode={setSelectedNodeId}
            />
>>>>>>> theirs
          ) : (
            <div className="card muted">Waiting for graph data...</div>
          )}
        </section>
        <section className="panel list-panel">
          {graph ? (
            <NodeList graph={graph} onReExecute={reExecuteNode} />
          ) : (
            <div className="card muted">暂无 FsData 节点，先运行一个 executor 吧。</div>
          )}
          <RegisteredExecutors executors={executors} onExecute={executeExecutor} />
        </section>
      </main>
    </div>
  );
}
<<<<<<< ours
=======

function filterGraph(graph: FsDataGraph | null, kind: string): FsDataGraph {
  if (!graph) return { nodes: [], edges: [] };
  const selectedNodes = graph.nodes.filter((n) => n.kind === kind);
  const includeIds = new Set<string>();
  const includeEdges: typeof graph.edges = [];

  for (const node of selectedNodes) {
    includeIds.add(node.id);
  }

  for (const edge of graph.edges) {
    if (includeIds.has(edge.target)) {
      includeIds.add(edge.source);
      includeEdges.push(edge);
    }
  }

  const nodes = graph.nodes.filter((n) => includeIds.has(n.id));
  return { nodes, edges: includeEdges };
}
>>>>>>> theirs
