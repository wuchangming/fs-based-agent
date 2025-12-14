import type { ExecutorInputSchema, FsDataGraph } from '../types.js';

const API_BASE = (import.meta.env?.VITE_API_BASE as string | undefined) || '/api';

export interface GraphResponse {
  graph: FsDataGraph;
  executors: {
    kind: string;
    label?: string;
    description?: string;
    hasDeps: boolean;
    inputSchema?: ExecutorInputSchema;
  }[];
}

export async function fetchGraph(): Promise<GraphResponse> {
  const res = await fetch(`${API_BASE}/graph`);
  if (!res.ok) {
    throw new Error(`Failed to load graph: ${res.statusText}`);
  }
  return res.json() as Promise<GraphResponse>;
}

export async function reExecute(kind: string, dataId: string): Promise<string> {
  const res = await fetch(`${API_BASE}/nodes/${kind}/${dataId}/reexecute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = (await res.json()) as { entryPath?: string; error?: string };
  if (!res.ok || body.error) {
    throw new Error(body.error || 'Re-execution failed');
  }
  return body.entryPath ?? '';
}

export async function execute(kind: string, input: Record<string, unknown>, skipCache = false) {
  const res = await fetch(`${API_BASE}/executors/${kind}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, skipCache }),
  });
  const body = (await res.json()) as { entryPath?: string; error?: string };
  if (!res.ok || body.error) {
    throw new Error(body.error || 'Execute failed');
  }
  return body.entryPath ?? '';
}
