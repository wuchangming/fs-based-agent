import { useEffect, useMemo, useState } from 'react';
import type { FsDataGraph } from '../types.js';
import { GraphView } from './GraphView.js';
import { NodeList } from './NodeList.js';
import { NodeTableView } from './NodeTableView.js';
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

  const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
  const [inspectedNodeId, setInspectedNodeId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const listNodesAll = useMemo(() => {
    if (!graph || !selectedKind) return [];
    return graph.nodes.filter((n) => n.kind === selectedKind);
  }, [graph, selectedKind]);

  const listNodes = useMemo(() => {
    const query = search.trim();
    if (!query) return listNodesAll;
    return listNodesAll.filter((n) => matchesInput(n.manifest.input, query));
  }, [listNodesAll, search]);

  const listGraph = useMemo<FsDataGraph>(() => {
    return { nodes: listNodes, edges: [] };
  }, [listNodes]);

  const dependencyGraph = useMemo<FsDataGraph>(() => {
    if (!graph || !focusNodeId) return { nodes: [], edges: [] };
    return buildDependencySubgraph(graph, focusNodeId);
  }, [focusNodeId, graph]);

  const focusCount = useMemo(() => {
    return listNodes.length;
  }, [listNodes.length]);

  const totalFocusCount = useMemo(() => {
    return listNodesAll.length;
  }, [listNodesAll.length]);

  const dependencyCount = useMemo(() => {
    if (!focusNodeId) return 0;
    return Math.max(0, dependencyGraph.nodes.length - 1);
  }, [dependencyGraph.nodes.length, focusNodeId]);

  useEffect(() => {
    setFocusNodeId(null);
    setInspectedNodeId(null);
    setSearch('');
  }, [selectedKind]);

  useEffect(() => {
    if (!selectedKind) return;

    const listIds = new Set(listNodes.map((n) => n.id));

    // Clear focus selection if it is no longer visible in the list (e.g. filtered out by search)
    if (focusNodeId && !listIds.has(focusNodeId)) {
      setFocusNodeId(null);
      setInspectedNodeId(null);
      return;
    }

    // Auto-select first node for better UX
    if (!focusNodeId && listNodes.length) {
      setFocusNodeId(listNodes[0]!.id);
      setInspectedNodeId(listNodes[0]!.id);
    }
  }, [focusNodeId, listNodes, selectedKind]);

  useEffect(() => {
    if (!focusNodeId) return;
    setInspectedNodeId(focusNodeId);
  }, [focusNodeId]);

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
                </div>
              )}
            </div>
            <div className="selector-right">
              {focusNodeId ? (
                dependencyCount ? (
                  <span className="badge">deps: {dependencyCount}</span>
                ) : (
                  <span className="badge muted">no deps</span>
                )
              ) : null}
            </div>
          </div>

          {selectedKind ? (
            <>
              <div className="toolbar-row">
                <div className="search">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search by input… (e.g. repoUrl=github.com)"
                  />
                  {search.trim() ? (
                    <button type="button" className="ghost" onClick={() => setSearch('')}>
                      Clear
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="explorer">
                <div className="explorer-section">
                  <div className="explorer-head">
                    <div className="eyebrow">Nodes</div>
                    <div className="meta muted">
                      {search.trim() ? `${focusCount}/${totalFocusCount}` : focusCount} items
                    </div>
                  </div>
                  <NodeTableView
                    graph={listGraph}
                    selectedNodeId={focusNodeId}
                    onSelectNode={(nodeId) => {
                      setFocusNodeId(nodeId);
                      setInspectedNodeId(nodeId);
                    }}
                  />
                </div>

                <div className="explorer-section">
                  <div className="explorer-head">
                    <div className="eyebrow">Dependencies</div>
                    <div className="meta muted">
                      {focusNodeId
                        ? dependencyCount
                          ? `showing ${dependencyCount} deps`
                          : 'no deps'
                        : 'select a node above'}
                    </div>
                  </div>

                  <GraphView
                    graph={dependencyGraph}
                    focusKind={selectedKind}
                    focusNodeId={focusNodeId}
                    inspectedNodeId={inspectedNodeId}
                    onInspectNode={setInspectedNodeId}
                  />
                </div>
              </div>
            </>
          ) : (
            <div className="card muted">请选择一个 executor。</div>
          )}
        </section>

        <section className="panel list-panel">
          <NodeList
            graph={graph ?? { nodes: [], edges: [] }}
            focusNodeId={focusNodeId}
            selectedNodeId={inspectedNodeId}
            onReExecute={reExecuteNode}
            onInspectFocus={() => setInspectedNodeId(focusNodeId)}
          />
          <RegisteredExecutors executors={executors} onExecute={executeExecutor} />
        </section>
      </main>
    </div>
  );
}

function buildDependencySubgraph(graph: FsDataGraph, focusNodeId: string): FsDataGraph {
  const includeIds = new Set<string>([focusNodeId]);
  const includeEdgeMap = new Map<string, (typeof graph.edges)[number]>();

  const incoming = new Map<string, (typeof graph.edges)[number][]>();
  for (const edge of graph.edges) {
    const list = incoming.get(edge.target) ?? [];
    list.push(edge);
    incoming.set(edge.target, list);
  }

  const stack = [focusNodeId];
  while (stack.length) {
    const current = stack.pop();
    if (!current) continue;
    for (const edge of incoming.get(current) ?? []) {
      includeEdgeMap.set(edge.id, edge);
      if (!includeIds.has(edge.source)) {
        includeIds.add(edge.source);
        stack.push(edge.source);
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
