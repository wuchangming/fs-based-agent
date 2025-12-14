import { useMemo } from 'react';
import { ReactFlow, Background, Controls, MarkerType } from 'reactflow';
import type { FsDataGraph } from '../types.js';
import 'reactflow/dist/style.css';

interface GraphViewProps {
  graph: FsDataGraph;
}

interface Position {
  x: number;
  y: number;
}

function computePositions(graph: FsDataGraph): Record<string, Position> {
  const incomingCount = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  for (const node of graph.nodes) {
    incomingCount.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const edge of graph.edges) {
    incomingCount.set(edge.target, (incomingCount.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }

  const queue: string[] = [];
  for (const [id, indeg] of incomingCount.entries()) {
    if (indeg === 0) queue.push(id);
  }

  const layers = new Map<string, number>();
  while (queue.length) {
    const current = queue.shift()!;
    const layer = layers.get(current) ?? 0;
    for (const next of outgoing.get(current) ?? []) {
      const nextLayer = Math.max(layers.get(next) ?? 0, layer + 1);
      layers.set(next, nextLayer);
      const newIn = (incomingCount.get(next) ?? 1) - 1;
      incomingCount.set(next, newIn);
      if (newIn === 0) queue.push(next);
    }
  }

  const grouped = new Map<number, string[]>();
  for (const node of graph.nodes) {
    const layer = layers.get(node.id) ?? 0;
    if (!grouped.has(layer)) grouped.set(layer, []);
    grouped.get(layer)!.push(node.id);
  }

  const positions: Record<string, Position> = {};
  const xSpacing = 240;
  const ySpacing = 170;

  for (const [layer, ids] of grouped.entries()) {
    ids
      .slice()
      .sort()
      .forEach((id, idx) => {
      positions[id] = { x: idx * xSpacing, y: layer * ySpacing };
    });
  }

  return positions;
}

export function GraphView({ graph }: GraphViewProps) {
  const positions = useMemo(() => computePositions(graph), [graph]);

  const nodes = useMemo(
    () =>
<<<<<<< ours
<<<<<<< ours
=======
>>>>>>> theirs
      graph.nodes.map((node) => ({
        id: node.id,
        position: positions[node.id] ?? { x: 0, y: 0 },
        data: { label: `${node.kind}\n${node.dataId.slice(0, 6)}` },
        style: {
          background: '#0f766e',
          color: '#e7fff9',
          borderRadius: 12,
          padding: '12px 10px',
          border: '1px solid #0ea5e9',
          boxShadow: '0 6px 20px rgba(15, 118, 110, 0.35)',
          whiteSpace: 'pre-line',
          fontSize: 12,
          fontWeight: 600,
        },
      })),
    [graph.nodes, positions]
<<<<<<< ours
=======
      graph.nodes.map((node) => {
        const isPrimary = primaryKind ? node.kind === primaryKind : true;
        const isSelected = selectedNodeId === node.id;
        const bg = isPrimary ? '#0f766e' : '#0b4f6c';
        const border = isSelected ? '#38bdf8' : '#0ea5e9';

        return {
          id: node.id,
          position: positions[node.id] ?? { x: 0, y: 0 },
          data: { label: `${node.kind}\n${node.dataId.slice(0, 6)}` },
          targetPosition: RFPosition.Top,
          sourcePosition: RFPosition.Bottom,
          selected: isSelected,
          style: {
            background: bg,
            color: '#e7fff9',
            borderRadius: 12,
            padding: '12px 10px',
            border: `2px solid ${border}`,
            boxShadow: '0 6px 20px rgba(15, 118, 110, 0.35)',
            whiteSpace: 'pre-line',
            fontSize: 12,
            fontWeight: 600,
            opacity: isPrimary || isSelected ? 1 : 0.9,
          },
        };
      }),
    [graph.nodes, positions, primaryKind, selectedNodeId]
>>>>>>> theirs
=======
>>>>>>> theirs
  );

  const edges = useMemo(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        label: edge.label,
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 6,
<<<<<<< ours
<<<<<<< ours
        style: { stroke: '#0ea5e9' },
=======
        style: { stroke: '#0ea5e9', strokeDasharray: '6 6' },
>>>>>>> theirs
=======
        style: { stroke: '#0ea5e9' },
>>>>>>> theirs
        labelStyle: { fill: '#0b3c4b', fontWeight: 600 },
        animated: true,
        type: 'smoothstep',
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: '#0ea5e9',
        },
      })),
    [graph.edges]
  );

  return (
    <div className="graph-view">
      <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }}>
        <Background gap={16} color="#c9e6ff" />
        <Controls position="top-right" />
      </ReactFlow>
    </div>
  );
}
