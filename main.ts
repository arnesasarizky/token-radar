// Token Launch Radar — the program.
//
// Reads the sealed snapshot (/input/snapshot.json, or --input), fits the
// model in lib/model.ts from those bytes alone, and writes the ranked
// board to /output/board.json. implied_value_usd is the model's headline
// value — the expected value the board ranks by (rank 1 is the board's
// most valuable protocol, and the value never rises as rank ascends, as
// the gate's sorted_by_value check requires); each row also carries
// value_if_launched_usd, the price before launch odds are applied. The
// dashboard's data goes to data.js in the fixed window.RADAR shape, the
// repository's dashboard/ and screenshots/ are copied across, and
// dossier.json is written last with the vendored buildDossier, exactly
// the bytes the scorer rebuilds and compares.
//
// Run locally:  mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBoard, runModel, type BoardRow, type Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> or --name=<value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const started = performance.now();

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(
    `token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`,
  );
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = JSON.parse(readFileSync(inputFile, 'utf8')) as Snapshot;
const { rows, meta } = runModel(snapshot);

const board: BoardRow[] = rows.map((r) => ({
  slug: r.slug,
  name: r.name,
  rank: r.rank,
  implied_value_usd: r.impliedValueUsd,
  farm_steps: r.farmSteps,
}));
const boardFile = {
  rows: rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    rank: r.rank,
    implied_value_usd: r.impliedValueUsd,
    value_if_launched_usd: r.valueIfLaunched,
    launch_odds: r.odds,
    watchlist: r.watchlist,
    farm_steps: r.farmSteps,
  })),
};
const issue = checkBoard(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify(boardFile)}\n`);

const data = {
  meta,
  rows: rows.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl: r.tvl,
    change7d: r.change7d,
    ageDays: r.ageDays,
    watchlist: r.watchlist,
    offList: r.offList,
    early: r.early,
    sibling: r.sibling,
    tags: r.tags,
    mult: r.mult,
    valueIfLaunched: r.valueIfLaunched,
    odds: r.odds,
    ev: r.ev,
    bandLo: r.bandLo,
    bandHi: r.bandHi,
    band10: r.band10,
    band90: r.band90,
    rankLo: r.rankLo,
    rankHi: r.rankHi,
    plan: r.plan,
    slice: r.slice,
    costs: r.costs,
    net: r.net,
    netLow: r.netLow,
    perHour: r.perHour,
    paysFrom: r.paysFrom,
    verdict: r.verdict,
    robust: r.robust,
    steps: r.steps,
    peers: r.peers,
  })),
  protocols: snapshot.protocols.map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    listed_at: p.listed_at,
    symbol: p.symbol,
    mcap_usd: p.mcap_usd,
  })),
  watchlist: snapshot.watchlist,
};
writeFileSync(join(out, 'data.js'), `window.RADAR = ${JSON.stringify(data)};\n`);

/** Copy a directory tree's regular files into `to`, skipping names that start with a dot. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const src = join(from, name);
    const dst = join(to, name);
    if (statSync(src).isDirectory()) {
      copied.push(...copyTree(src, dst).map((n) => `${name}/${n}`));
    } else if (statSync(src).isFile()) {
      copyFileSync(src, dst);
      copied.push(name);
    }
  }
  return copied;
}

const dashFiles = copyTree(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyTree(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(
    `token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`,
  );
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: DASHBOARD_CAPS,
  }),
);

const v = meta.validation;
process.stdout.write(
  `token radar: ${meta.counts.protocols} protocols (${meta.counts.tokened} tokened, ${meta.counts.tokenless} tokenless), ` +
    `${meta.counts.ranked} ranked, watchlist ${meta.counts.watchlistCovered}/${meta.counts.watchlist}, ` +
    `${meta.counts.setAside.total} set aside, ${meta.counts.siblings} siblings\n` +
    `token radar: comps ${meta.curve.comps}, curve 10^${meta.curve.intercept} x TVL^${meta.curve.slope}; ` +
    `LOO x${v.curveLoo} vs flat x${v.flatLoo}, walk-forward x${v.curveWf} vs flat x${v.flatWf}; ` +
    `odds AUC ${meta.odds.auc}, split hit ${meta.odds.splitModelHit} vs base caller ${meta.odds.splitBaseHit}\n` +
    `token radar: verdicts at plan size — ${meta.farm.atPlan.FARM} FARM / ${meta.farm.atPlan.THIN} THIN / ${meta.farm.atPlan.SKIP} SKIP (first FARM: ${meta.farm.firstFarmAtPlan ?? 'none'}); ` +
    `at $1,000 — ${meta.farm.at1000.FARM} FARM / ${meta.farm.at1000.THIN} THIN / ${meta.farm.at1000.SKIP} SKIP; ` +
    `at $10,000 — ${meta.farm.at10000.FARM} FARM (first: ${meta.farm.firstFarmAt10000 ?? 'none'})\n` +
    `token radar: wrote board.json (${board.length} rows), data.js, dashboard/ (${dashFiles.length} files), ` +
    `screenshots/ (${shots.length} images) and dossier.json to ${out} in ${((performance.now() - started) / 1000).toFixed(2)}s\n`,
);
