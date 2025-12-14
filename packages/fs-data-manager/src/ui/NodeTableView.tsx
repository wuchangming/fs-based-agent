import type { FsDataGraph } from '../types.js';

interface NodeTableViewProps {
  graph: FsDataGraph;
  focusKind: string;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
}

function toInputPreview(input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') return input;
  if (typeof input === 'number' || typeof input === 'boolean') return String(input);
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

export function NodeTableView({ graph, focusKind, selectedNodeId, onSelectNode }: NodeTableViewProps) {
  if (!graph.nodes.length) {
    return <div className="card muted">没有匹配的节点。</div>;
  }

  const focusNodes = graph.nodes.filter((n) => n.kind === focusKind);
  const depNodes = graph.nodes.filter((n) => n.kind !== focusKind);

  const ordered = [...focusNodes, ...depNodes];

  return (
    <div className="node-table">
      <div className="node-table-head">
        <div>Kind</div>
        <div>Title</div>
        <div>dataId</div>
        <div>input</div>
      </div>
      {ordered.map((node) => {
        const isSelected = node.id === selectedNodeId;
        const isDep = node.kind !== focusKind;
        return (
          <button
            key={node.id}
            type="button"
            className={`node-row${isSelected ? ' selected' : ''}${isDep ? ' dep' : ''}`}
            onClick={() => onSelectNode(node.id)}
          >
            <div className="cell kind">{node.kind}</div>
            <div className="cell title">{node.label}</div>
            <div className="cell mono">{node.dataId.slice(0, 6)}</div>
            <div className="cell mono faint">{toInputPreview(node.manifest.input)}</div>
          </button>
        );
      })}
    </div>
  );
}

