import { useEffect, useMemo, useState } from 'react';
import type { FsDataGraph } from '../types.js';
import { GraphView } from './GraphView.js';
import { NodeList } from './NodeList.js';
import { NodeTableView } from './NodeTableView.js';
import { RegisteredExecutors } from './RegisteredExecutors.js';
import { useGraphData } from './hooks/useGraphData.js';

type LeftViewMode = 'graph' | 'list';

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
  const [viewMode, setViewMode] = useState<LeftViewMode>('list');
  const [search, setSearch] = useState('');

  const filteredGraph = useMemo(() => {
    return buildExecutorGraph(
      graph,
      selectedKind,
      Boolean(selectedExecutor?.hasDeps),
      search
    );
  }, [graph, search, selectedExecutor?.hasDeps, selectedKind]);

  const focusCount = useMemo(() => {
    if (!selectedKind) return 0;
    return filteredGraph.nodes.filter((n) => n.kind === selectedKind).length;
  }, [filteredGraph.nodes, selectedKind]);

  const totalFocusCount = useMemo(() => {
    if (!graph || !selectedKind) return 0;
    return graph.nodes.filter((n) => n.kind === selectedKind).length;
  }, [graph, selectedKind]);

  const depCount = useMemo(() => {
    if (!selectedKind) return 0;
    return filteredGraph.nodes.filter((n) => n.kind !== selectedKind).length;
  }, [filteredGraph.nodes, selectedKind]);

  useEffect(() => {
    setSelectedNodeId(null);
    setSearch('');
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
                  nodes: {search.trim() ? `${focusCount}/${totalFocusCount}` : focusCount}
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
            <>
              <div className="toolbar-row">
                <div className="segmented">
                  <button
                    type="button"
                    className={`seg${viewMode === 'graph' ? ' active' : ''}`}
                    onClick={() => setViewMode('graph')}
                  >
                    Graph
                  </button>
                  <button
                    type="button"
                    className={`seg${viewMode === 'list' ? ' active' : ''}`}
                    onClick={() => setViewMode('list')}
                  >
                    List
                  </button>
                </div>
                <div className="search">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by input… (e.g. text=hello)"
                  />
                  {search.trim() ? (
                    <button type="button" className="ghost" onClick={() => setSearch('')}>
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>

              {viewMode === 'graph' ? (
                <GraphView
                  graph={filteredGraph}
                  focusKind={selectedKind}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={setSelectedNodeId}
                />
              ) : (
                <div className="list-view">
                  <NodeTableView
                    graph={filteredGraph}
                    focusKind={selectedKind}
                    selectedNodeId={selectedNodeId}
                    onSelectNode={setSelectedNodeId}
                  />
                </div>
              )}
            </>
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
  includeDeps: boolean,
  search: string
): FsDataGraph {
  if (!graph || !kind) return { nodes: [], edges: [] };

  const focusNodesAll = graph.nodes.filter((n) => n.kind === kind);
  const query = search.trim();
  const focusNodes = query ? focusNodesAll.filter((n) => matchesInput(n.manifest.input, query)) : focusNodesAll;
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

function matchesInput(input: unknown, query: string): boolean {
  const parts = query
    .trim()
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return true;

  return parts.every((part) => matchesInputToken(input, part));
}

function matchesInputToken(input: unknown, token: string): boolean {
  const normalized = token.trim();
  if (!normalized) return true;

  const lower = normalized.toLowerCase();
  const delimiterIndex = lower.indexOf('=');
  const colonIndex = lower.indexOf(':');
  const idx =
    delimiterIndex === -1
      ? colonIndex
      : colonIndex === -1
        ? delimiterIndex
        : Math.min(delimiterIndex, colonIndex);

  if (idx > 0) {
    const key = normalized.slice(0, idx).trim();
    const expected = normalized.slice(idx + 1).trim().toLowerCase();
    if (!key) return true;
    if (!input || typeof input !== 'object') return false;

    const record = input as Record<string, unknown>;
    if (!(key in record)) return false;
    if (!expected) return true;

    const value = record[key];
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.toLowerCase().includes(expected);
    if (typeof value === 'number' || typeof value === 'boolean') return String(value).toLowerCase() === expected;
    try {
      return JSON.stringify(value).toLowerCase().includes(expected);
    } catch {
      return String(value).toLowerCase().includes(expected);
    }
  }

  try {
    return JSON.stringify(input).toLowerCase().includes(lower);
  } catch {
    return String(input).toLowerCase().includes(lower);
  }
}
