import express from 'express';
import path from 'path';
import { createFsDataManagerRouter } from './router.js';
import type { FsDataManager } from './manager.js';

interface ServerOptions {
  port?: number;
  apiPath?: string;
  /** Optional static directory for the React dashboard (dist/client) */
  staticDir?: string | undefined;
}

/**
 * Start an Express server that exposes the FsData manager API (and optional UI)
 */
export function startFsDataManagerServer(manager: FsDataManager, options: ServerOptions = {}) {
  const app = express();
  app.use(express.json());

  const apiPath = options.apiPath ?? '/api';
  app.use(apiPath, createFsDataManagerRouter(manager));

  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    app.get('*', (_req, res) => res.sendFile(path.join(options.staticDir!, 'index.html')));
  }

  const port = options.port ?? 4100;
  const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`FsData manager server listening on http://localhost:${port}`);
  });

  return server;
}
