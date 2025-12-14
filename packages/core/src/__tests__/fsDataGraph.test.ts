import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { FsContextEngine } from '../engine.js';
import { listFsDataNodes } from '../fsDataGraph.js';
import { removeDir, FS_DATA_VERSION, MANIFEST_FILENAME, createManifest, writeManifest } from '../fsData.js';

describe('listFsDataNodes', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'fsdata-graph-'));
  });

  afterEach(async () => {
    await removeDir(tempRoot);
  });

  it('should surface manifests, entries and deps', async () => {
    const engine = new FsContextEngine({ root: tempRoot });

    const leaf = engine.createExecutor({
      kind: 'leaf',
      fn: async (_, dataDir) => {
        await fs.writeFile(`${dataDir}/leaf.txt`, 'leaf');
        return { entry: 'leaf.txt' };
      },
    });

    const parent = engine.createExecutor({
      kind: 'parent',
      deps: {
        leaf: leaf.config({ input: {} }),
      },
      fn: async (input, dataDir) => {
        await fs.writeFile(`${dataDir}/parent.txt`, `parent-${input.message}`);
        return { entry: 'parent.txt' };
      },
    });

    const entryPath = await parent({ input: { message: 'hello' } });
    expect(await fs.readFile(entryPath, 'utf-8')).toBe('parent-hello');

    const nodes = await listFsDataNodes(tempRoot);
    expect(nodes).toHaveLength(2);

    const parentNode = nodes.find((n) => n.kind === 'parent');
    expect(parentNode?.entryPath?.endsWith('/parent.txt')).toBe(true);
    expect(parentNode?.manifest.input).toEqual({ message: 'hello' });
    expect(parentNode?.deps).toHaveLength(1);
    expect(parentNode?.deps[0]?.targetKind).toBe('leaf');
  });

  it('should ignore lingering temp dirs', async () => {
    const engine = new FsContextEngine({ root: tempRoot });
    const ex = engine.createExecutor({
      kind: 'leaf',
      fn: async (_, dataDir) => {
        await fs.writeFile(path.join(dataDir, 'leaf.txt'), 'leaf');
        return { entry: 'leaf.txt' };
      },
    });

    await ex({ input: {} });

    const tmpDir = path.join(
      tempRoot,
      'fs-data',
      FS_DATA_VERSION,
      'leaf',
      '00',
      '.tmp-deadbeef-deadbeef'
    );
    await fs.mkdir(tmpDir, { recursive: true });
    await writeManifest(tmpDir, createManifest('leaf', {}));

    const nodes = await listFsDataNodes(tempRoot);
    expect(nodes.map((n) => n.dataId)).not.toContain('.tmp-deadbeef-deadbeef');
  });
});
