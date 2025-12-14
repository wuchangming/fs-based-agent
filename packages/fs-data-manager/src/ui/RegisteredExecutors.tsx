import { useEffect, useMemo, useState } from 'react';
import type { ExecutorInputSchema } from '../types.js';

interface RegisteredExecutorsProps {
  executors: { kind: string; label?: string; description?: string; inputSchema?: ExecutorInputSchema }[];
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

  const [active, setActive] = useState<{
    kind: string;
    label?: string;
    description?: string;
    inputSchema?: ExecutorInputSchema;
  } | null>(null);

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
          onSubmit={async (input, skipCache) => Promise.resolve(onExecute(active.kind, input, skipCache))}
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
  executor: { kind: string; label?: string; description?: string; inputSchema?: ExecutorInputSchema };
  onClose: () => void;
  onSubmit: (input: Record<string, unknown>, skipCache: boolean) => Promise<void>;
}) {
  const storageKey = `fs-data-manager:executor-input:${executor.kind}`;
  const [formState, setFormState] = useState<{
    schemaValues: Record<string, string>;
    rows: InputRow[];
  }>(() => loadFormState(storageKey, executor.inputSchema));

  const [skipCache, setSkipCache] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const schema = executor.inputSchema;
  const hasSchema = Boolean(schema?.fields?.length);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const preview = useMemo(() => {
    try {
      const input = buildInputFromSchema(schema, formState.schemaValues);
      const extra = buildInputFromRows(formState.rows);
      const merged = mergeInputs(input, extra);
      return JSON.stringify(merged, null, 2);
    } catch (err) {
      return `// ${err instanceof Error ? err.message : String(err)}`;
    }
  }, [formState.rows, formState.schemaValues, schema]);

  const advancedPreview = useMemo(() => {
    try {
      const extra = buildInputFromRows(formState.rows);
      return JSON.stringify(extra, null, 2);
    } catch (err) {
      return `// ${err instanceof Error ? err.message : String(err)}`;
    }
  }, [formState.rows]);

  function updateRow(id: string, patch: Partial<InputRow>) {
    setFormState((prev) => ({
      ...prev,
      rows: prev.rows.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  }

  function updateSchemaValue(key: string, value: string) {
    setFormState((prev) => ({
      ...prev,
      schemaValues: { ...prev.schemaValues, [key]: value },
    }));
  }

  async function handleRun() {
    setError(null);
    let inputRows = formState.rows;
    // Auto-add an empty row if all rows have keys (so user always has one spare line)
    if (inputRows.length && inputRows.every((r) => r.key.trim())) {
      inputRows = [...inputRows, createRow()];
      setFormState((prev) => ({ ...prev, rows: inputRows }));
    }

    try {
      // Validate & persist
      const schemaInput = buildInputFromSchema(schema, formState.schemaValues);
      const extraInput = buildInputFromRows(inputRows);
      const merged = mergeInputs(schemaInput, extraInput);

      localStorage.setItem(
        storageKey,
        JSON.stringify({
          version: 2,
          schemaValues: formState.schemaValues,
          rows: inputRows.map(({ key, value, type }) => ({ key, value, type })),
        })
      );

      setRunning(true);
      await onSubmit(merged, skipCache);
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

          {hasSchema ? (
            <div className="schema-form">
              <div className="schema-head">
                <div className="eyebrow">Parameters</div>
                <div className="meta muted">来自注册时提供的 Zod schema，必填项会在此提示。</div>
              </div>

              <div className="schema-fields">
                {schema!.fields.map((field) => (
                  <div key={field.key} className="schema-field">
                    <div className="schema-field-top">
                      <div className="schema-field-name">
                        {field.key}
                        {field.required ? <span className="required">*</span> : null}
                      </div>
                      <span className="badge muted">{field.type}</span>
                      {field.defaultValue !== undefined ? (
                        <span className="badge muted">default: {formatDefaultValue(field.defaultValue)}</span>
                      ) : null}
                    </div>
                    {field.description ? <div className="meta">{field.description}</div> : null}

                    {field.type === 'boolean' ? (
                      field.required ? (
                        <label className="checkbox">
                          <input
                            type="checkbox"
                            checked={(formState.schemaValues[field.key] ?? '').trim() === 'true'}
                            onChange={(e) => updateSchemaValue(field.key, e.target.checked ? 'true' : 'false')}
                            disabled={running}
                          />
                          <span>{(formState.schemaValues[field.key] ?? '').trim() === 'true' ? 'true' : 'false'}</span>
                        </label>
                      ) : (
                        <select
                          value={formState.schemaValues[field.key] ?? ''}
                          onChange={(e) => updateSchemaValue(field.key, e.target.value)}
                          disabled={running}
                        >
                          <option value="">
                            {field.defaultValue !== undefined ? '(use default)' : '(optional)'}
                          </option>
                          <option value="false">false</option>
                          <option value="true">true</option>
                        </select>
                      )
                    ) : field.type === 'enum' ? (
                      <select
                        value={formState.schemaValues[field.key] ?? ''}
                        onChange={(e) => updateSchemaValue(field.key, e.target.value)}
                        disabled={running}
                      >
                        <option value="">
                          {field.required
                            ? '(select...)'
                            : field.defaultValue !== undefined
                              ? '(use default)'
                              : '(optional)'}
                        </option>
                        {(field.enumValues ?? []).map((v) => (
                          <option key={v} value={v}>
                            {v}
                          </option>
                        ))}
                      </select>
                    ) : field.type === 'json' ? (
                      <textarea
                        value={formState.schemaValues[field.key] ?? ''}
                        onChange={(e) => updateSchemaValue(field.key, e.target.value)}
                        placeholder={field.defaultValue !== undefined ? formatDefaultValue(field.defaultValue) : '{"..."}'}
                        rows={3}
                        disabled={running}
                      />
                    ) : (
                      <input
                        value={formState.schemaValues[field.key] ?? ''}
                        onChange={(e) => updateSchemaValue(field.key, e.target.value)}
                        placeholder={
                          field.defaultValue !== undefined
                            ? formatDefaultValue(field.defaultValue)
                            : field.type === 'number'
                              ? '123'
                              : 'value'
                        }
                        inputMode={field.type === 'number' ? 'decimal' : undefined}
                        disabled={running}
                      />
                    )}
                  </div>
                ))}
              </div>

              <div className="schema-footer">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setShowAdvanced((v) => !v)}
                  disabled={running}
                >
                  {showAdvanced ? '隐藏高级参数' : '显示高级参数'}
                </button>
                <div className="meta muted">高级参数使用 key/value 方式，适合传递额外字段。</div>
              </div>
            </div>
          ) : null}

          {!hasSchema || showAdvanced ? (
            <div className="kv">
              <div className="kv-head">
                <div>Key</div>
                <div>Type</div>
                <div>Value</div>
                <div />
              </div>
              {formState.rows.map((row) => (
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
                    onClick={() =>
                      setFormState((prev) => ({ ...prev, rows: prev.rows.filter((r) => r.id !== row.id) }))
                    }
                    disabled={running || formState.rows.length <= 1}
                    title="Remove row"
                  >
                    删除
                  </button>
                </div>
              ))}

              <div className="kv-footer">
                <button
                  type="button"
                  className="ghost"
                  onClick={() => setFormState((prev) => ({ ...prev, rows: [...prev.rows, createRow()] }))}
                  disabled={running}
                >
                  + 添加参数
                </button>
                <div className="meta muted">提示：json 类型支持输入对象/数组；空 key 的行会被忽略。</div>
              </div>

              {hasSchema ? (
                <div className="payload">
                  <div className="eyebrow">advanced preview</div>
                  <pre>{advancedPreview}</pre>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="payload">
            <div className="eyebrow">input preview</div>
            <pre>{preview}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

function loadFormState(
  storageKey: string,
  schema: ExecutorInputSchema | undefined
): { schemaValues: Record<string, string>; rows: InputRow[] } {
  const schemaKeys = new Set(schema?.fields?.map((f) => f.key) ?? []);

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) {
      return { schemaValues: normalizeSchemaValues(schema, {}), rows: [createRow()] };
    }

    const parsed = JSON.parse(raw) as unknown;

    // Legacy format: InputRow[]
    if (Array.isArray(parsed)) {
      const restoredRows = restoreRows(parsed);
      const { schemaValues, extraRows } = splitSchemaRows(restoredRows, schemaKeys);
      return {
        schemaValues: normalizeSchemaValues(schema, schemaValues),
        rows: extraRows.length ? extraRows : [createRow()],
      };
    }

    if (parsed && typeof parsed === 'object') {
      const obj = parsed as {
        schemaValues?: unknown;
        rows?: unknown;
      };

      const rawSchemaValues = obj.schemaValues && typeof obj.schemaValues === 'object' ? (obj.schemaValues as Record<string, unknown>) : {};
      const schemaValues: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawSchemaValues)) {
        if (!schemaKeys.size || schemaKeys.has(key)) {
          schemaValues[key] = typeof value === 'string' ? value : '';
        }
      }

      const restoredRows = restoreRows(Array.isArray(obj.rows) ? obj.rows : []);
      return {
        schemaValues: normalizeSchemaValues(schema, schemaValues),
        rows: restoredRows.length ? restoredRows : [createRow()],
      };
    }

    return { schemaValues: normalizeSchemaValues(schema, {}), rows: [createRow()] };
  } catch {
    return { schemaValues: normalizeSchemaValues(schema, {}), rows: [createRow()] };
  }
}

function restoreRows(items: unknown[]): InputRow[] {
  const restored: InputRow[] = items
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
  return restored;
}

function splitSchemaRows(rows: InputRow[], schemaKeys: Set<string>) {
  const schemaValues: Record<string, string> = {};
  const extraRows: InputRow[] = [];
  for (const row of rows) {
    const key = row.key.trim();
    if (key && schemaKeys.has(key)) {
      schemaValues[key] = row.value;
    } else {
      extraRows.push(row);
    }
  }
  return { schemaValues, extraRows };
}

function normalizeSchemaValues(
  schema: ExecutorInputSchema | undefined,
  values: Record<string, string>
): Record<string, string> {
  if (!schema?.fields?.length) return {};
  const normalized: Record<string, string> = {};
  for (const field of schema.fields) {
    const raw = values[field.key];
    const existing = typeof raw === 'string' ? raw : '';
    if (!existing && field.required && field.type === 'boolean') {
      normalized[field.key] = 'false';
    } else {
      normalized[field.key] = existing;
    }
  }
  return normalized;
}

function buildInputFromSchema(
  schema: ExecutorInputSchema | undefined,
  values: Record<string, string>
): Record<string, unknown> {
  if (!schema?.fields?.length) return {};
  const input: Record<string, unknown> = {};

  for (const field of schema.fields) {
    const raw = values[field.key] ?? '';
    const trimmed = raw.trim();

    if (!trimmed) {
      if (field.required) {
        throw new Error(`Missing required field: ${field.key}`);
      }
      continue;
    }

    if (field.type === 'string') {
      input[field.key] = raw;
      continue;
    }

    if (field.type === 'number') {
      const num = Number(trimmed);
      if (Number.isNaN(num)) throw new Error(`Field "${field.key}" expects a valid number`);
      input[field.key] = num;
      continue;
    }

    if (field.type === 'boolean') {
      if (trimmed !== 'true' && trimmed !== 'false') {
        throw new Error(`Field "${field.key}" expects boolean (true/false)`);
      }
      input[field.key] = trimmed === 'true';
      continue;
    }

    if (field.type === 'enum') {
      const val = trimmed;
      const allowed = field.enumValues ?? [];
      if (allowed.length && !allowed.includes(val)) {
        throw new Error(`Field "${field.key}" expects one of: ${allowed.join(', ')}`);
      }
      input[field.key] = val;
      continue;
    }

    if (field.type === 'json') {
      try {
        input[field.key] = JSON.parse(trimmed) as unknown;
      } catch (err) {
        throw new Error(
          `Field "${field.key}" JSON parse failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
      continue;
    }
  }

  return input;
}

function mergeInputs(base: Record<string, unknown>, extra: Record<string, unknown>) {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    if (Object.prototype.hasOwnProperty.call(merged, key)) {
      throw new Error(`Duplicate key: ${key}`);
    }
    merged[key] = value;
  }
  return merged;
}

function formatDefaultValue(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
