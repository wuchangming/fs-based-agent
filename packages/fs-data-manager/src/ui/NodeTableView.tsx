import type { FsDataGraph } from '../types.js';

interface NodeTableViewProps {
  graph: FsDataGraph;
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

export function NodeTableView({ graph, selectedNodeId, onSelectNode }: NodeTableViewProps) {
  if (!graph.nodes.length) {
    return <div className="card muted">没有匹配的节点。可在右侧执行器列表先运行一次。</div>;
  }

  return (
    <div className="node-table">
      <div className="node-table-head">
        <div>Title</div>
        <div>dataId</div>
        <div>deps</div>
        <div>input</div>
      </div>
      {graph.nodes.map((node) => {
        const isSelected = node.id === selectedNodeId;
        return (
          <button
            key={node.id}
            type="button"
            className={`node-row${isSelected ? ' selected' : ''}`}
            onClick={() => onSelectNode(node.id)}
          >
            <div className="cell title">{node.label}</div>
            <div className="cell mono">{node.dataId.slice(0, 6)}</div>
            <div className="cell mono faint">{node.deps.length}</div>
            <div className="cell mono faint">{toInputPreview(node.manifest.input)}</div>
          </button>
        );
      })}
    </div>
  );
}
