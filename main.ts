// Field Glass runner. Node 22, standard library only, no clock and no randomness.
// Score the sealed snapshot, write board.json and data.js, copy dashboard/ and
// screenshots/, then build dossier.json when the screenshot tree is non-empty.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json

import { createRequire } from 'node:module';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const require = createRequire(import.meta.url);
const repoRoot = fileURLToPath(new URL('.', import.meta.url));

const ROW_KEYS = [
  'slug', 'name', 'rank', 'implied_value_usd', 'lane', 'on_watchlist', 'category', 'chains',
  'tvl_usd', 'change_7d', 'mcap_usd', 'listed_at', 'gecko_id', 'symbol', 'age_days',
  'multiple', 'structure', 'structure_notes', 'tenure', 'growth', 'growth_input', 'growth_clamped',
  'breadth', 'confidence', 'gap', 'season', 'farm_steps'
] as const;

interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Array<{ slug: string }>;
  watchlist: string[];
}

interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  on_watchlist: boolean;
  lane: string;
  [key: string]: unknown;
}

interface FieldApi {
  readSnapshot: (raw: unknown) => Snapshot;
  rankBook: (snapshot: Snapshot) => BoardRow[];
  auditBook: (rows: BoardRow[], snapshot: Snapshot) => string | null;
  confirmScores: (snapshot: Snapshot, rows: BoardRow[]) => string | null;
}

interface Paths {
  inputFile: string;
  out: string;
}

interface Report {
  rows: number;
  watchlist: number;
  offList: number;
  unlaunched: number;
  topSlug: string;
  topValue: number;
  dashFiles: number;
  shots: number;
  dossier: boolean;
}

const field = require('./dashboard/score.js') as FieldApi;
const DOSSIER_CAPS = {
  text_max_bytes: 65_536,
  screenshots: { max: 4, max_bytes: 524_288 },
  dashboard: { max_files: 400, max_bytes: 4_194_304 }
};

function option(name: string, fallback: string): string {
  const withValue = `--${name}=`;
  for (let index = 2; index < process.argv.length; index++) {
    const token = process.argv[index] ?? '';
    if (token.startsWith(withValue)) return token.slice(withValue.length);
    if (token === `--${name}`) {
      const next = process.argv[index + 1];
      if (next !== undefined && !next.startsWith('--')) return next;
    }
  }
  return fallback;
}

function pathsFromArgs(): Paths {
  const inputArg = option('input', '/input/snapshot.json');
  return {
    inputFile: inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json'),
    out: option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output')
  };
}

function orderedRow(row: BoardRow): BoardRow {
  const projected: Record<string, unknown> = {};
  for (const key of ROW_KEYS) projected[key] = row[key];
  return projected as BoardRow;
}

function listFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const found: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.pop() ?? root;
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const path = join(dir, name);
      const info = statSync(path);
      if (info.isDirectory()) pending.push(path);
      else if (info.isFile()) found.push(path.slice(root.length + 1));
    }
  }
  found.sort();
  return found;
}

function replaceTree(from: string, to: string): string[] {
  rmSync(to, { recursive: true, force: true });
  if (!existsSync(from)) return [];
  cpSync(from, to, {
    recursive: true,
    filter: (source) => !basename(source).startsWith('.')
  });
  return listFiles(to);
}

function countsOf(rows: BoardRow[]): { watchlist: number; offList: number; unlaunched: number; recorded: number } {
  let watchlist = 0;
  let unlaunched = 0;
  for (const row of rows) {
    if (row.on_watchlist) watchlist += 1;
    if (row.lane === 'unlaunched') unlaunched += 1;
  }
  return { watchlist, offList: rows.length - watchlist, unlaunched, recorded: rows.length - unlaunched };
}

function publish(paths: Paths): Report {
  if (!existsSync(paths.inputFile)) {
    process.stderr.write(`field glass: no snapshot at ${paths.inputFile}\n`);
    process.exit(2);
  }
  const snapshot = field.readSnapshot(JSON.parse(readFileSync(paths.inputFile, 'utf8')));
  const rows = field.rankBook(snapshot).map(orderedRow);
  const issue = field.auditBook(rows, snapshot);
  if (issue !== null) {
    process.stderr.write(`field glass: board refused: ${issue}\n`);
    process.exit(1);
  }
  const drifted = field.confirmScores(snapshot, rows);
  if (drifted !== null) {
    process.stderr.write(`field glass: rescore drifted on ${drifted}\n`);
    process.exit(1);
  }

  mkdirSync(paths.out, { recursive: true });
  const counts = countsOf(rows);
  const boardPath = join(paths.out, 'board.json');
  const boardDoc = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model: 'field-glass-1',
    rows
  };
  writeFileSync(boardPath, `${JSON.stringify(boardDoc)}\n`);

  const echoed = JSON.parse(readFileSync(boardPath, 'utf8')) as { rows: BoardRow[] };
  const echoIssue = field.auditBook(echoed.rows, snapshot);
  if (echoIssue !== null) {
    process.stderr.write(`field glass: written board failed a reread: ${echoIssue}\n`);
    process.exit(1);
  }

  const dataDoc = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: 'field-glass-1',
    counts: {
      protocols: snapshot.protocols.length,
      rows: rows.length,
      watchlist: counts.watchlist,
      off_list: counts.offList,
      unlaunched: counts.unlaunched,
      recorded: counts.recorded
    },
    rows
  };
  writeFileSync(join(paths.out, 'data.js'), `window.FIELD_GLASS=${JSON.stringify(dataDoc)};\n`);

  rmSync(join(paths.out, 'dossier.json'), { force: true });
  const dashFiles = replaceTree(join(repoRoot, 'dashboard'), join(paths.out, 'dashboard'));
  const shots = replaceTree(join(repoRoot, 'screenshots'), join(paths.out, 'screenshots'));
  let dossier = false;
  if (shots.length > 0) {
    writeFileSync(join(paths.out, 'dossier.json'), buildDossier(paths.out, DOSSIER_CAPS));
    dossier = true;
  }
  const top = rows[0];
  return {
    rows: rows.length,
    watchlist: counts.watchlist,
    offList: counts.offList,
    unlaunched: counts.unlaunched,
    topSlug: top?.slug ?? '',
    topValue: top?.implied_value_usd ?? 0,
    dashFiles: dashFiles.length,
    shots: shots.length,
    dossier
  };
}

const started = process.hrtime.bigint();
const report = publish(pathsFromArgs());
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
process.stdout.write(
  `field glass: ${report.rows} rows, watchlist ${report.watchlist}, off-list ${report.offList}, unlaunched ${report.unlaunched}, top ${report.topSlug} at $${report.topValue}, dashboard ${report.dashFiles}, screenshots ${report.shots}, dossier ${report.dossier ? 'yes' : 'no'}, ${elapsedMs.toFixed(1)} ms\n`
);
if (!report.dossier) process.stdout.write('field glass: screenshots/ is empty, so dossier.json waits until images are added\n');
