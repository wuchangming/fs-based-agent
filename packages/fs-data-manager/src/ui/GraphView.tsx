import { useEffect, useMemo, useState } from 'react';
import {
  Background,
  Controls,
  MarkerType,
  Position as RFPosition,
  ReactFlow,
  type ReactFlowInstance,
} from 'reactflow';
import type { FsDataGraph } from '../types.js';
import 'reactflow/dist/style.css';

interface GraphViewProps {
  graph: FsDataGraph;
  focusKind: string;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}

interface Coord {
  x: number;
  y: number;
}

function computePositions(graph: FsDataGraph): Record<string, Coord> {
  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const predecessors = new Map<string, string[]>();

  for (const node of graph.nodes) {
    incomingCount.set(node.id, 0);
    outgoing.set(node.id, []);
    predecessors.set(node.id, []);
  }

  for (const edge of graph.edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
    predecessors.get(edge.target)?.push(edge.source);
  }

  // Longest-path layering (DAG)
  const indegree = new Map(incomingCount);
  const queue = [...indegree.entries()]
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id)
    .sort();

  const layers = new Map<string, number>();
  while (queue.length) {
    const current = queue.shift();
    if (!current) break;
    const layer = layers.get(current) ?? 0;
    for (const next of outgoing.get(current) ?? []) {
      layers.set(next, Math.max(layers.get(next) ?? 0, layer + 1));
      const newIn = (indegree.get(next) ?? 1) - 1;
      indegree.set(next, newIn);
      if (newIn === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }

  const grouped = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const layer = layers.get(node.id) ?? 0;
    if (!grouped.has(layer)) grouped.set(layer, []);
    grouped.get(layer)!.push(node.id);
  }

  const columnsByLayer = new Map<number, Map<string, number>>();
  const sortedLayers = [...grouped.keys()].sort((a, b) => a - b);

  // Assign roots first
  const roots = (grouped.get(0) ?? []).slice().sort();
  const rootCols = new Map<string, number>();
  roots.forEach((id, idx) => rootCols.set(id, idx));
  columnsByLayer.set(0, rootCols);

  for (const layer of sortedLayers) {
    if (layer === 0) continue;
    const ids = (grouped.get(layer) ?? []).slice();
    const cols = new Map<string, number>();
    const used = new Set<number>();

    const scored = ids.map((id) => {
      const preds = predecessors.get(id) ?? [];
      const predCols = preds
        .map((p) => {
          const predLayer = layers.get(p) ?? 0;
          return columnsByLayer.get(predLayer)?.get(p);
        })
        .filter((c): c is number => c !== undefined);
      const avg = predCols.length ? predCols.reduce((a, b) => a + b, 0) / predCols.length : Infinity;
      return { id, avg };
    });

    scored.sort((a, b) => a.avg - b.avg || a.id.localeCompare(b.id));

    for (const { id, avg } of scored) {
      const preferred = Number.isFinite(avg) ? Math.max(0, Math.round(avg)) : 0;
      let candidate = preferred;
      while (used.has(candidate)) candidate += 1;
      cols.set(id, candidate);
      used.add(candidate);
    }
    columnsByLayer.set(layer, cols);
  }

  // Re-center roots above their children (optional, improves fan-out)
  const rootUsed = new Set<number>();
  const desiredRoots = roots.map((id) => {
    const children = outgoing.get(id) ?? [];
    const childCols = children
      .map((child) => columnsByLayer.get((layers.get(child) ?? 1))?.get(child))
      .filter((c): c is number => c !== undefined);
    const desired = childCols.length ? childCols.reduce((a, b) => a + b, 0) / childCols.length : (rootCols.get(id) ?? 0);
    return { id, desired };
  });
  desiredRoots.sort((a, b) => a.desired - b.desired || a.id.localeCompare(b.id));

  for (const { id, desired } of desiredRoots) {
    const preferred = Math.max(0, Math.round(desired));
    let candidate = preferred;
    let offset = 0;
    while (true) {
      const left = preferred - offset;
      const right = preferred + offset;
      if (left >= 0 && !rootUsed.has(left)) {
        candidate = left;
        break;
      }
      if (!rootUsed.has(right)) {
        candidate = right;
        break;
      }
      offset += 1;
      if (offset > 200) break;
    }
    rootCols.set(id, candidate);
    rootUsed.add(candidate);
  }

  // Positions
  const xSpacing = 280;
  const ySpacing = 210;
  const positions: Record<string, Coord> = {};

  for (const node of graph.nodes) {
    const layer = layers.get(node.id) ?? 0;
    const col = columnsByLayer.get(layer)?.get(node.id) ?? 0;
    positions[node.id] = { x: col * xSpacing, y: layer * ySpacing };
  }

  return positions;
}

export function GraphView({ graph, focusKind, selectedNodeId, onSelectNode }: GraphViewProps) {
  const [instance, setInstance] = useState<ReactFlowInstance | null>(null);
  // UI convention:
  // - Focus executor nodes are the "main" nodes.
  // - Dependency nodes are treated as "children" and should appear BELOW the main nodes.
  // Our FsData graph edges are stored as: dependency -> dependent.
  // For display/layout we reverse edges to render: main -> dependency.
  const renderGraph = useMemo(() => {
    return {
      nodes: graph.nodes,
      edges: graph.edges.map((edge) => ({
        ...edge,
        source: edge.target,
        target: edge.source,
      })),
    };
  }, [graph.edges, graph.nodes]);

  const positions = useMemo(() => computePositions(renderGraph), [renderGraph]);
  const graphKey = useMemo(() => {
    const nodeKey = graph.nodes
      .map((n) => n.id)
      .slice()
      .sort()
      .join('|');
    const edgeKey = graph.edges
      .map((e) => e.id)
      .slice()
      .sort()
      .join('|');
    return `${focusKind}::${nodeKey}::${edgeKey}`;
  }, [focusKind, graph.edges, graph.nodes]);

  const nodes = useMemo(() => {
    return graph.nodes.map((node) => {
      const isFocus = node.kind === focusKind;
      const isSelected = selectedNodeId === node.id;
      const bg = isSelected ? '#0b9e89' : isFocus ? '#0f766e' : '#0b4f6c';
      const border = isSelected ? '#38bdf8' : isFocus ? '#0ea5e9' : '#3b82f6';
      const shadow = isSelected
        ? '0 14px 40px rgba(56, 189, 248, 0.35)'
        : '0 10px 30px rgba(15, 118, 110, 0.22)';

      return {
        id: node.id,
        position: positions[node.id] ?? { x: 0, y: 0 },
        data: { label: `${node.kind}\n${node.dataId.slice(0, 6)}` },
        targetPosition: RFPosition.Top,
        sourcePosition: RFPosition.Bottom,
        style: {
          background: bg,
          color: '#e7fff9',
          borderRadius: 14,
          padding: '12px 12px',
          border: `${isSelected ? 4 : 3}px solid ${border}`,
          boxShadow: shadow,
          whiteSpace: 'pre-line',
          fontSize: 12,
          fontWeight: 700,
          outline: isSelected ? '6px solid rgba(56, 189, 248, 0.16)' : 'none',
          outlineOffset: 2,
          transition: 'box-shadow 150ms ease, border-color 150ms ease, outline-color 150ms ease',
          zIndex: isSelected ? 10 : 0,
        },
      };
    });
  }, [focusKind, graph.nodes, positions, selectedNodeId]);

  const edges = useMemo(() => {
    return renderGraph.edges.map((edge) => {
      const isActive = selectedNodeId
        ? edge.source === selectedNodeId || edge.target === selectedNodeId
        : false;
      const stroke = isActive ? '#38bdf8' : '#0ea5e9';
      const dash = isActive ? '0' : '6 4';

      return {
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        type: 'default' as const,
        pathOptions: { curvature: 0.35 },
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
        style: { stroke, strokeWidth: isActive ? 3 : 2, strokeDasharray: dash },
        labelStyle: { fill: '#0b3c4b', fontWeight: 700 },
        animated: false,
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      };
    });
  }, [renderGraph.edges, selectedNodeId]);

  useEffect(() => {
    if (!instance) return;
    if (!nodes.length) return;
    instance.fitView({ padding: 0.25, duration: 250 });
  }, [instance, graphKey, nodes.length]);

  if (!graph.nodes.length) {
    return <div className="card muted">No nodes for this executor yet. Run it once to generate FsData.</div>;
  }

  return (
    <div className="graph-view">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onInit={setInstance}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} color="#c9e6ff" />
        <Controls position="top-right" />
      </ReactFlow>
    </div>
  );
}
