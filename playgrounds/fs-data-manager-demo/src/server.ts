import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import { FsDataManager } from '@fs-based-agent/fs-data-manager';

// Local FsData root (override with FS_DATA_ROOT)
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FS_DATA_ROOT =
  process.env.FS_DATA_ROOT || path.resolve(__dirname, '..', '.local-fs-data');

const manager = new FsDataManager(FS_DATA_ROOT);

const sample = manager.registerExecutor({
  kind: 'sample-text',
  label: 'sample-text',
  fn: async ({ text }: { text: string }, dir: string) => {
    const fs = await import('fs/promises');
    const value = typeof text === 'string' && text.length ? text : 'hello fs-data-manager';
    const textDir = path.join(dir, 'text');
    await fs.mkdir(textDir, { recursive: true });
    await fs.writeFile(path.join(textDir, 'text.txt'), value, 'utf8');
    return { entry: 'text', metadata: { title: value.slice(0, 20) } };
  },
});

const summary = manager.registerExecutor({
  kind: 'text-summary',
  label: 'text-summary',
  deps: {
    source: sample.config({ input: { text: 'hello fs-data-manager' }, skipCache: true }),
  },
  fn: async (_input: Record<string, unknown>, dir: string) => {
    const fs = await import('fs/promises');
    const raw = await fs.readFile(path.join(dir, 'source', 'text.txt'), 'utf8');
    const summaryText = `len=${raw.length}, upper=${raw.toUpperCase()}`;
    await fs.writeFile(`${dir}/summary.txt`, summaryText, 'utf8');
    return { entry: 'summary.txt', metadata: { title: summaryText.slice(0, 20) } };
  },
});

const staticDir = path.resolve(__dirname, '../../../packages/fs-data-manager/dist/client');

async function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
    });
    req.on('end', () => {
      try {
        resolve(data ? (JSON.parse(data) as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

function contentTypeFor(filePath: string) {
  if (filePath.endsWith('.js')) return 'application/javascript';
  if (filePath.endsWith('.css')) return 'text/css';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.json')) return 'application/json';
  return 'application/octet-stream';
}

async function serveStatic(urlPath: string, res: ServerResponse) {
  try {
    const normalized = urlPath.split('?')[0] || '/';
    const candidate =
      normalized === '/' ? path.join(staticDir, 'index.html') : path.join(staticDir, normalized);
    const stat = await fs.stat(candidate).catch(() => null);
    if (stat && stat.isFile()) {
      const content = await fs.readFile(candidate);
      res.writeHead(200, { 'Content-Type': contentTypeFor(candidate) });
      res.end(content);
      return;
    }
    const indexPath = path.join(staticDir, 'index.html');
    const content = await fs.readFile(indexPath);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content);
  } catch {
    sendJson(res, 404, {
      error: 'UI not found. Build it with "pnpm --filter @fs-based-agent/fs-data-manager build" or run the Vite dev server.',
    });
  }
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = req.url || '/';
  const method = req.method || 'GET';

  if (method === 'POST' && url === '/demo/run') {
    const body = await parseBody(req);
    try {
      const text = (body.text as string | undefined) ?? 'hello fs-data-manager';
      const entryPath = await summary({ input: { text }, skipCache: true });
      return sendJson(res, 200, { entryPath });
    } catch (err) {
      return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  if (method === 'GET' && url === '/api/graph') {
    const graph = await manager.getGraph();
    const executors = manager.listExecutors().map((ex) => ({
      kind: ex.kind,
      label: ex.label,
      description: ex.description,
      hasDeps: ex.hasDeps ?? Boolean(ex.deps && Object.keys(ex.deps).length),
    }));
    return sendJson(res, 200, { graph, executors });
  }

  const executeMatch = url.match(/^\/api\/executors\/([^/]+)\/execute$/);
  if (method === 'POST' && executeMatch) {
    const kind = decodeURIComponent(executeMatch[1] ?? '');
    const body = await parseBody(req);
    try {
      const entryPath = await manager.executeRegistered(
        kind,
        (body.input as Record<string, unknown>) ?? {},
        Boolean(body.skipCache)
      );
      return sendJson(res, 200, { entryPath });
    } catch (err) {
      return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const reexecMatch = url.match(/^\/api\/nodes\/([^/]+)\/([^/]+)\/reexecute$/);
  if (method === 'POST' && reexecMatch) {
    const kind = decodeURIComponent(reexecMatch[1] ?? '');
    const dataId = decodeURIComponent(reexecMatch[2] ?? '');
    try {
      const entryPath = await manager.reExecuteNode(kind, dataId);
      return sendJson(res, 200, { entryPath });
    } catch (err) {
      return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Serve static UI if built; otherwise 404
  return serveStatic(url, res);
}

const port = process.env.PORT ? Number(process.env.PORT) : 4200;
createServer((req, res) => {
  void handleRequest(req, res);
}).listen(port, () => {
  console.log(`[demo] API/UI ready on http://localhost:${port}`);
  console.log(`[demo] FsData root: ${FS_DATA_ROOT}`);
  console.log(`[demo] Demo trigger: curl -X POST http://localhost:${port}/demo/run`);
  console.log(`[demo] If UI is built (packages/fs-data-manager/dist/client), open http://localhost:${port}`);
});
