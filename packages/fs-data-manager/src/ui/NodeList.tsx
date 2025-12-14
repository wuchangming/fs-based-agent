import type { FsDataGraph } from '../types.js';

interface NodeListProps {
  graph: FsDataGraph;
  onReExecute: (kind: string, dataId: string) => Promise<void> | void;
}

export function NodeList({ graph, onReExecute }: NodeListProps) {
  if (!graph.nodes.length) {
    return <div className="card muted">No fs-data nodes detected yet.</div>;
  }

  return (
    <div className="node-list">
      {graph.nodes.map((node) => (
        <div className="card" key={node.id}>
          <div className="card-header">
            <div>
              <div className="eyebrow">{node.kind}</div>
              <div className="title">{node.label}</div>
            </div>
            <button className="ghost" onClick={() => onReExecute(node.kind, node.dataId)}>
              Re-run
            </button>
          </div>
          <div className="meta">dataId: {node.dataId}</div>
          <div className="meta">entry: {node.entryPath || 'missing'}</div>
          <div className="deps">
            <span>deps:</span>
            {node.deps.length === 0 ? (
              <span className="meta muted">none</span>
            ) : (
              node.deps.map((dep) => (
                <span key={dep.linkPath} className="badge">
                  {dep.linkPath} → {dep.targetKind}:{dep.targetDataId.slice(0, 6)}
                </span>
              ))
            )}
          </div>
          <div className="payload">
            <div className="eyebrow">input</div>
            <pre>{JSON.stringify(node.manifest.input, null, 2)}</pre>
          </div>
        </div>
      ))}
    </div>
  );
}
