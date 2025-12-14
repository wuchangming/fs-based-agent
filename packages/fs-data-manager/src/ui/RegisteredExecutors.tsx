interface RegisteredExecutorsProps {
  executors: { kind: string; label?: string; description?: string }[];
  onExecute: (kind: string, input: Record<string, unknown>, skipCache?: boolean) => Promise<void> | void;
}

export function RegisteredExecutors({ executors, onExecute }: RegisteredExecutorsProps) {
  if (!executors.length) {
    return <div className="card muted">没有可用的 executors，请先注册。</div>;
  }

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <div className="eyebrow">Registered executors</div>
          <div className="title">执行器列表（可在此触发首次运行）</div>
        </div>
      </div>
      <div className="executor-list">
        {executors.map((ex) => (
          <div className="executor-row" key={ex.kind}>
            <div>
              <div className="title">{ex.label || ex.kind}</div>
              <div className="meta">{ex.description || ex.kind}</div>
            </div>
            <button
              className="primary"
              onClick={() => {
                const inputRaw = window.prompt(`输入 ${ex.kind} 的 JSON input`, '{}');
                if (inputRaw === null) return;
                try {
                  const parsed = inputRaw.trim() ? JSON.parse(inputRaw) : {};
                  void onExecute(ex.kind, parsed, false);
                } catch (err) {
                  window.alert(`解析 JSON 失败: ${err instanceof Error ? err.message : String(err)}`);
                }
              }}
            >
              运行
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
