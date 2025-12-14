import express from 'express';
import type { FsDataManager } from './manager.js';

export interface ExecutorSummary {
  kind: string;
  label?: string;
  description?: string;
  hasDeps: boolean;
}

export function createFsDataManagerRouter(manager: FsDataManager): express.Router {
  const router = express.Router();

  router.get('/graph', async (_req, res) => {
    try {
      const graph = await manager.getGraph();
      const executors: ExecutorSummary[] = manager.listExecutors().map((ex) => {
        const summary: ExecutorSummary = {
          kind: ex.kind,
          hasDeps: ex.hasDeps ?? Boolean(ex.deps && Object.keys(ex.deps).length),
        };
        if (ex.label !== undefined) summary.label = ex.label;
        if (ex.description !== undefined) summary.description = ex.description;
        return summary;
      });

      res.json({ graph, executors });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.post('/executors/:kind/execute', async (req, res) => {
    const { kind } = req.params;
    const body = (req.body ?? {}) as { input?: unknown; skipCache?: unknown };
    try {
      const entryPath = await manager.executeRegistered(
        kind,
        (body.input as Record<string, unknown>) ?? {},
        Boolean(body.skipCache)
      );
      res.json({ entryPath });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  router.post('/nodes/:kind/:dataId/reexecute', async (req, res) => {
    const { kind, dataId } = req.params;
    try {
      const entryPath = await manager.reExecuteNode(kind, dataId);
      res.json({ entryPath });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  return router;
}
