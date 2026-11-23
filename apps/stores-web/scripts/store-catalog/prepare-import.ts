import { createHash, randomBytes } from 'node:crypto';
import { lstat, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';
import { prepareVerifiedStoreImport } from '../../lib/store-catalog/import-contract';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--write-staging') {
      if (args[arg]) throw new Error('Duplicate argument');
      args[arg] = true;
    } else if (['--input', '--mapping', '--out'].includes(arg)) {
      if (args[arg] || !argv[i + 1] || argv[i + 1].startsWith('--')) {
        throw new Error('Missing or duplicated ' + arg);
      }
      args[arg] = argv[++i];
    } else throw new Error('Unsupported argument: ' + arg);
  }
  return args;
}
async function readSafeJson(path: unknown, sizeLimit: number): Promise<{data: unknown; sha256: string}> {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Absolute input path required');
  const stat = await lstat(path);
  if (!stat.isFile() || stat.size > sizeLimit) throw new Error('Invalid input file or size');
  const bytes = await readFile(path);
  const data: unknown = JSON.parse(bytes.toString('utf8'));
  return { data, sha256: createHash('sha256').update(bytes).digest('hex') };
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { data: rawExport, sha256: exportSha256 } = await readSafeJson(args['--input'], 20 * 1024 * 1024);
  const { data: mapping, sha256: mappingSha256 } = await readSafeJson(args['--mapping'], 64 * 1024);
  const result = prepareVerifiedStoreImport(rawExport, mapping);
  const summary: Record<string, unknown> = {
    status: 'VALIDATED_STAGING_ONLY',
    store: result.provenance.store,
    products: result.snapshot.products.length,
    exportSha256,
    mappingSha256,
    sourceExportedAt: result.snapshot.exportedAt,
    productionUpdated: false,
  };
  if (args['--write-staging']) {
    if (typeof args['--out'] !== 'string' || !isAbsolute(args['--out'])) {
      throw new Error('Absolute staging directory required');
    }
    const dir = await realpath(args['--out']);
    // Fixed suffix prevents accidental writes into the live catalog directory.
    if (basename(dir) !== 'catalog-staging') throw new Error('Only catalog-staging directory is writable');
    const prod = process.env.AMURSK_CATALOG_DATA_DIR;
    if (prod && await realpath(prod).catch(() => prod) === dir) {
      throw new Error('Production catalog directory may never be changed');
    }
    const stem = result.provenance.store + '-' + Date.now() + '-' + randomBytes(6).toString('hex');
    const temp = join(dir, '.' + stem + '.tmp');
    const output = join(dir, stem + '.candidate.json');
    const source = JSON.stringify(result.snapshot);
    await writeFile(temp, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await rename(temp, output);
    summary.candidateFile = output;
    summary.snapshotSha256 = createHash('sha256').update(source).digest('hex');
  } else if (args['--out']) {
    throw new Error('--out requires --write-staging');
  }
  process.stdout.write(JSON.stringify(summary) + '\n');
}
main().catch(error => {
  console.error(JSON.stringify({ status: 'REJECTED', message: error instanceof Error ? error.message : 'unknown error', productionUpdated: false }));
  process.exitCode = 1;
});
