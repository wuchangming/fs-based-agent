import { useEffect, useMemo, useState } from 'react';

interface RegisteredExecutorsProps {
  executors: { kind: string; label?: string; description?: string }[];
  onExecute: (kind: string, input: Record<string, unknown>, skipCache?: boolean) => Promise<void> | void;
}

type InputValueType = 'string' | 'number' | 'boolean' | 'json';

interface InputRow {
  id: string;
  key: string;
  type: InputValueType;
  value: string;
}

function createRow(overrides: Partial<InputRow> = {}): InputRow {
  const id =
    (globalThis.crypto && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`) as string;
  return {
    id,
    key: '',
    type: 'string',
    value: '',
    ...overrides,
  };
}

function parseRowValue(row: InputRow): unknown {
  const raw = row.value;
  const trimmed = raw.trim();

  switch (row.type) {
    case 'string':
      return raw;
    case 'number': {
      if (!trimmed) throw new Error(`Key "${row.key}" expects a number`);
      const num = Number(trimmed);
      if (Number.isNaN(num)) throw new Error(`Key "${row.key}" expects a valid number`);
      return num;
    }
    case 'boolean':
      return trimmed === 'true';
    case 'json': {
      if (!trimmed) throw new Error(`Key "${row.key}" expects JSON`);
      try {
        return JSON.parse(trimmed) as unknown;
      } catch (err) {
        throw new Error(
          `Key "${row.key}" JSON parse failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
    default:
      return raw;
  }
}

function buildInputFromRows(rows: InputRow[]): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      throw new Error(`Duplicate key: ${key}`);
    }
    input[key] = parseRowValue({ ...row, key });
  }
  return input;
}

export function RegisteredExecutors({ executors, onExecute }: RegisteredExecutorsProps) {
  if (!executors.length) {
    return <div className="card muted">没有可用的 executors，请先注册。</div>;
  }

  const [active, setActive] = useState<{ kind: string; label?: string; description?: string } | null>(
    null
  );

  return (
    <>
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
              <button className="primary" onClick={() => setActive(ex)}>
                运行
              </button>
            </div>
          ))}
        </div>
      </div>

      {active && (
        <ExecutorRunModal
          executor={active}
          onClose={() => setActive(null)}
          onSubmit={async (rows, skipCache) => {
            const input = buildInputFromRows(rows);
            await Promise.resolve(onExecute(active.kind, input, skipCache));
          }}
        />
      )}
    </>
  );
}

function ExecutorRunModal({
  executor,
  onClose,
  onSubmit,
}: {
  executor: { kind: string; label?: string; description?: string };
  onClose: () => void;
  onSubmit: (rows: InputRow[], skipCache: boolean) => Promise<void>;
}) {
  const storageKey = `fs-data-manager:executor-input:${executor.kind}`;
  const [rows, setRows] = useState<InputRow[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [createRow()];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [createRow()];
      const restored: InputRow[] = parsed
        .filter((item): item is Partial<InputRow> => typeof item === 'object' && item !== null)
        .map((item) =>
          createRow({
            key: typeof item.key === 'string' ? item.key : '',
            value: typeof item.value === 'string' ? item.value : '',
            type:
              item.type === 'string' || item.type === 'number' || item.type === 'boolean' || item.type === 'json'
                ? item.type
                : 'string',
          })
        );
      return restored.length ? restored : [createRow()];
    } catch {
      return [createRow()];
    }
  });

  const [skipCache, setSkipCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const preview = useMemo(() => {
    try {
      const input = buildInputFromRows(rows);
      return JSON.stringify(input, null, 2);
    } catch (err) {
      return `// ${err instanceof Error ? err.message : String(err)}`;
    }
  }, [rows]);

  function updateRow(id: string, patch: Partial<InputRow>) {
    setRows((prev) => prev.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  async function handleRun() {
    setError(null);
    let inputRows = rows;
    // Auto-add an empty row if all rows have keys (so user always has one spare line)
    if (inputRows.length && inputRows.every((r) => r.key.trim())) {
      inputRows = [...inputRows, createRow()];
      setRows(inputRows);
    }

    try {
      // Validate & persist
      buildInputFromRows(inputRows);
      localStorage.setItem(storageKey, JSON.stringify(inputRows.map(({ key, value, type }) => ({ key, value, type }))));

      setRunning(true);
      await onSubmit(inputRows, skipCache);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRunning(false);
    }
  }

  return (
    <div
      className="modal-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-label={`Run ${executor.kind}`}>
        <div className="modal-header">
          <div>
            <div className="eyebrow">Run executor</div>
            <div className="title">{executor.label || executor.kind}</div>
            <div className="meta">{executor.description || executor.kind}</div>
          </div>
          <div className="modal-actions">
            <button className="ghost" onClick={onClose} disabled={running}>
              取消
            </button>
            <button className="primary" onClick={() => void handleRun()} disabled={running}>
              {running ? '运行中…' : '运行'}
            </button>
          </div>
        </div>

        {error && <div className="alert danger">{error}</div>}

        <div className="modal-body">
          <div className="form-row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={skipCache}
                onChange={(e) => setSkipCache(e.target.checked)}
                disabled={running}
              />
              <span>skip cache（强制重新执行）</span>
            </label>
          </div>

          <div className="kv">
            <div className="kv-head">
              <div>Key</div>
              <div>Type</div>
              <div>Value</div>
              <div />
            </div>
            {rows.map((row) => (
              <div key={row.id} className="kv-row">
                <input
                  value={row.key}
                  onChange={(e) => updateRow(row.id, { key: e.target.value })}
                  placeholder="key"
                  disabled={running}
                />
                <select
                  value={row.type}
                  onChange={(e) => {
                    const next = e.target.value as InputValueType;
                    updateRow(row.id, {
                      type: next,
                      value: next === 'boolean' ? 'false' : row.value,
                    });
                  }}
                  disabled={running}
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                  <option value="json">json</option>
                </select>
                {row.type === 'boolean' ? (
                  <select
                    value={row.value.trim() === 'true' ? 'true' : 'false'}
                    onChange={(e) => updateRow(row.id, { value: e.target.value })}
                    disabled={running}
                  >
                    <option value="false">false</option>
                    <option value="true">true</option>
                  </select>
                ) : row.type === 'json' ? (
                  <textarea
                    value={row.value}
                    onChange={(e) => updateRow(row.id, { value: e.target.value })}
                    placeholder='{"a":1}'
                    rows={2}
                    disabled={running}
                  />
                ) : (
                  <input
                    value={row.value}
                    onChange={(e) => updateRow(row.id, { value: e.target.value })}
                    placeholder={row.type === 'number' ? '123' : 'value'}
                    inputMode={row.type === 'number' ? 'decimal' : undefined}
                    disabled={running}
                  />
                )}
                <button
                  className="ghost"
                  onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
                  disabled={running || rows.length <= 1}
                  title="Remove row"
                >
                  删除
                </button>
              </div>
            ))}

            <div className="kv-footer">
              <button className="ghost" onClick={() => setRows((prev) => [...prev, createRow()])} disabled={running}>
                + 添加参数
              </button>
              <div className="meta muted">提示：json 类型支持输入对象/数组；空 key 的行会被忽略。</div>
            </div>
          </div>

          <div className="payload">
            <div className="eyebrow">input preview</div>
            <pre>{preview}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
