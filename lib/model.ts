// Token Launch Radar — the model.
//
// One pricing engine, fitted at run time from the sealed snapshot and from
// nothing else: a robust log-log curve of market cap on TVL over the traded
// protocols that survive a toxicity screen (the comps). A pre-token protocol
// is priced as if it launched today by impliedValue(); launchOdds() reads an
// empirical age x TVL table over all 758 protocols; the rank key is the
// expected value, value if launched x launch odds. Four extra terms
// (category, growth, tenure, chain breadth) are fitted and tested on every
// run and dropped by the both-tests rule — the ladder is printed in the
// meta, not hidden. farmPlan() builds a dated, costed six-step plan per
// row, and checkBoard() verifies the board against the gate's shape.
//
// Deterministic: one mulberry32 PRNG seeded 20261114 drives the odds split
// and the bootstrap; no Math.random, no wall clock anywhere in the output.

// ---------------------------------------------------------------- types

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface CurveFit {
  intercept: number;
  slope: number;
}

export interface FarmStep {
  date: string;
  action: string;
  fee: number;
  minutes: number;
}

export interface Peer {
  name: string;
  mult: number;
  tvl: number;
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl: number;
  change7d: number | null;
  ageDays: number | null;
  watchlist: boolean;
  offList: boolean;
  early: boolean;
  sibling: boolean;
  tags: string[];
  mult: number;
  valueIfLaunched: number;
  odds: number;
  ev: number;
  bandLo: number;
  bandHi: number;
  band10: number;
  band90: number;
  rankLo: number;
  rankHi: number;
  plan: number;
  slice: number;
  costs: number;
  net: number;
  netLow: number;
  perHour: number;
  paysFrom: number | null;
  verdict: string;
  robust: boolean;
  steps: FarmStep[];
  peers: Peer[];
  impliedValueUsd: number;
  farmSteps: string[];
}

// ---------------------------------------------------------------- PRNG

/** mulberry32: one seeded stream for the odds split and the bootstrap. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- stats

function median(values: number[]): number {
  const s = [...values].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Type-7 quantile of an ascending array: linear interpolation on (n - 1) * q. */
function quantile(sortedAsc: number[], q: number): number {
  if (sortedAsc.length === 1) return sortedAsc[0]!;
  const pos = q * (sortedAsc.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, sortedAsc.length - 1);
  return sortedAsc[lo]! + (sortedAsc[hi]! - sortedAsc[lo]!) * (pos - lo);
}

/** Multiplicative miss of a prediction: 10^|log10(pred / actual)|, so 2.0 is "off by a factor of two". */
function missFactor(pred: number, actual: number): number {
  return 10 ** Math.abs(Math.log10(pred / actual));
}

function medianMiss(pairs: { pred: number; actual: number }[]): number {
  return median(pairs.map((p) => missFactor(p.pred, p.actual)));
}

/** Average ranks (ties share), 1-based, for Spearman and AUC. */
function averageRanks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k]![1]] = r;
    i = j + 1;
  }
  return out;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
const round4 = (x: number): number => Math.round(x * 10000) / 10000;

// ---------------------------------------------------------------- dates

const DAY_MS = 86_400_000;

function parseDay(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
}

function dayPlus(ms: number, days: number): string {
  return new Date(ms + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days the protocol has been tracked at the snapshot date; null when unlisted. */
export function ageDays(p: Protocol, asOfMs: number): number | null {
  if (p.listed_at === null) return null;
  return Math.round((asOfMs - parseDay(p.listed_at)) / DAY_MS);
}

// ---------------------------------------------------------------- the curve

function ols(xs: number[], ys: number[]): CurveFit {
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i]! - mx) ** 2;
    sxy += (xs[i]! - mx) * (ys[i]! - my);
  }
  const slope = sxy / sxx;
  return { intercept: my - slope * mx, slope };
}

/**
 * The comps curve: Huber IRLS (delta 1.345, 8 rounds, scale 1.4826 * MAD of
 * the residuals about their median) of log10(market cap) on log10(TVL),
 * started from OLS. On this snapshot: 10^3.2342 x TVL^0.4952.
 */
export function fitCurve(comps: Protocol[]): CurveFit {
  const xs = comps.map((p) => Math.log10(p.tvl_usd));
  const ys = comps.map((p) => Math.log10(p.mcap_usd!));
  let fit = ols(xs, ys);
  for (let round = 0; round < 8; round++) {
    const res = ys.map((y, i) => y - (fit.intercept + fit.slope * xs[i]!));
    const med = median(res);
    const scale = 1.4826 * median(res.map((r) => Math.abs(r - med)));
    if (scale === 0) break;
    const ws = res.map((r) => {
      const u = Math.abs(r) / scale;
      return u <= 1.345 ? 1 : 1.345 / u;
    });
    let sw = 0;
    let mx = 0;
    let my = 0;
    for (let i = 0; i < xs.length; i++) {
      sw += ws[i]!;
      mx += ws[i]! * xs[i]!;
      my += ws[i]! * ys[i]!;
    }
    mx /= sw;
    my /= sw;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxx += ws[i]! * (xs[i]! - mx) ** 2;
      sxy += ws[i]! * (xs[i]! - mx) * (ys[i]! - my);
    }
    const slope = sxy / sxx;
    fit = { intercept: my - slope * mx, slope };
  }
  return fit;
}

function curvePrice(fit: CurveFit, tvl: number): number {
  return 10 ** (fit.intercept + fit.slope * Math.log10(tvl));
}

/**
 * The comps pool: traded protocols with a cap, a listing date, a non-CEX
 * category and a sane cap/TVL ratio, deduplicated by symbol (largest cap
 * kept). Each filter removes one class of poisoned label. 82 comps here.
 */
export function compsPool(protocols: Protocol[]): Protocol[] {
  const best = new Map<string, Protocol>();
  for (const p of protocols) {
    if (p.symbol === null) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0) continue;
    if (p.listed_at === null) continue;
    if (p.category === 'CEX') continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (ratio < 0.005 || ratio > 20) continue;
    const kept = best.get(p.symbol);
    if (kept === undefined || p.mcap_usd > kept.mcap_usd!) best.set(p.symbol, p);
  }
  return [...best.values()].sort((x, y) => (x.slug < y.slug ? -1 : 1));
}

/**
 * impliedValue(): what a token would be worth if the protocol launched
 * today — the comps curve at its TVL, halved for a kin/sibling of a traded
 * protocol (a stated haircut, not a fitted one). The only pricing engine.
 */
export function impliedValue(p: Protocol, fit: CurveFit, sibling: boolean): number {
  return curvePrice(fit, p.tvl_usd) * (sibling ? 0.5 : 1);
}

// ---------------------------------------------------------------- validation of the curve

interface LooResult {
  pred: Map<string, number>;
  flatPred: Map<string, number>;
  curveMiss: number;
  flatMiss: number;
  within3: number;
  flatWithin3: number;
  spearman: number;
}

/** Leave-one-out: every comp priced by a fit that never saw it; flat is the median multiple. */
function leaveOneOut(comps: Protocol[]): LooResult {
  const pred = new Map<string, number>();
  const flatPred = new Map<string, number>();
  for (let i = 0; i < comps.length; i++) {
    const train = comps.filter((_, j) => j !== i);
    const fit = fitCurve(train);
    pred.set(comps[i]!.slug, curvePrice(fit, comps[i]!.tvl_usd));
    const mult = median(train.map((p) => p.mcap_usd! / p.tvl_usd));
    flatPred.set(comps[i]!.slug, mult * comps[i]!.tvl_usd);
  }
  const pairs = comps.map((c) => ({ pred: pred.get(c.slug)!, actual: c.mcap_usd! }));
  const flatPairs = comps.map((c) => ({ pred: flatPred.get(c.slug)!, actual: c.mcap_usd! }));
  const rp = averageRanks(comps.map((c) => Math.log10(pred.get(c.slug)!)));
  const ra = averageRanks(comps.map((c) => Math.log10(c.mcap_usd!)));
  const n = comps.length;
  const mp = rp.reduce((s, x) => s + x, 0) / n;
  const ma = ra.reduce((s, x) => s + x, 0) / n;
  let cov = 0;
  let vp = 0;
  let va = 0;
  for (let i = 0; i < n; i++) {
    cov += (rp[i]! - mp) * (ra[i]! - ma);
    vp += (rp[i]! - mp) ** 2;
    va += (ra[i]! - ma) ** 2;
  }
  return {
    pred,
    flatPred,
    curveMiss: medianMiss(pairs),
    flatMiss: medianMiss(flatPairs),
    within3: pairs.filter((p) => missFactor(p.pred, p.actual) <= 3).length / n,
    flatWithin3: flatPairs.filter((p) => missFactor(p.pred, p.actual) <= 3).length / n,
    spearman: cov / Math.sqrt(vp * va),
  };
}

/** Walk-forward: comps by listing date, five origins (50..90%), each pricing the next block. */
function walkForward(comps: Protocol[], price: (train: Protocol[], p: Protocol) => number): number {
  const srt = [...comps].sort((x, y) =>
    x.listed_at === y.listed_at ? (x.slug < y.slug ? -1 : 1) : x.listed_at! < y.listed_at! ? -1 : 1,
  );
  const pairs: { pred: number; actual: number }[] = [];
  const cuts = [50, 60, 70, 80, 90, 100];
  for (let k = 0; k < 5; k++) {
    const cut = Math.floor((srt.length * cuts[k]!) / 100);
    const next = Math.floor((srt.length * cuts[k + 1]!) / 100);
    const train = srt.slice(0, cut);
    for (const c of srt.slice(cut, next)) pairs.push({ pred: price(train, c), actual: c.mcap_usd! });
  }
  return medianMiss(pairs);
}

// ---------------------------------------------------------------- the ablation ladder

type TermKind = 'category' | 'growth' | 'tenure' | 'breadth';

/** The group a comp falls in for one candidate term. Growth can be sign-flipped (the placebo). */
function termGroup(kind: TermKind, p: Protocol, asOfMs: number, flipGrowth: boolean): string {
  if (kind === 'category') return p.category ?? 'Uncategorized';
  if (kind === 'growth') {
    let g = p.change_7d ?? 0;
    if (flipGrowth) g = -g;
    return g <= -0.05 ? 'down' : g >= 0.05 ? 'up' : 'flat';
  }
  if (kind === 'tenure') {
    const ad = ageDays(p, asOfMs);
    if (ad === null) return 'unlisted';
    if (ad < 180) return 'a0';
    if (ad < 365) return 'a1';
    if (ad < 730) return 'a2';
    if (ad < 1095) return 'a3';
    if (ad < 1825) return 'a4';
    return 'a5';
  }
  const n = p.chains.length;
  return n < 4 ? `c${n}` : 'c4p';
}

interface OffsetModel {
  price: (p: Protocol) => number;
}

/**
 * A term model: the curve, plus shrunk-median residual offsets per group of
 * each term (shrinkage n / (n + 10)), applied in term order. With
 * placeboGrowth, the growth offsets are fitted on the true buckets but read
 * from the flipped bucket when pricing — the control the real term must beat.
 */
function fitOffsetModel(
  train: Protocol[],
  kinds: TermKind[],
  asOfMs: number,
  placeboGrowth: boolean,
): OffsetModel {
  const base = fitCurve(train);
  let resid = new Map<string, number>(
    train.map((p) => [p.slug, Math.log10(p.mcap_usd!) - Math.log10(curvePrice(base, p.tvl_usd))]),
  );
  const stages: { kind: TermKind; off: Map<string, number> }[] = [];
  for (const kind of kinds) {
    const groups = new Map<string, number[]>();
    for (const p of train) {
      const g = termGroup(kind, p, asOfMs, false);
      const arr = groups.get(g);
      if (arr) arr.push(resid.get(p.slug)!);
      else groups.set(g, [resid.get(p.slug)!]);
    }
    const off = new Map<string, number>();
    for (const [g, rs] of groups) off.set(g, (median(rs) * rs.length) / (rs.length + 10));
    stages.push({ kind, off });
    const next = new Map<string, number>();
    for (const p of train) {
      next.set(p.slug, resid.get(p.slug)! - (off.get(termGroup(kind, p, asOfMs, false)) ?? 0));
    }
    resid = next;
  }
  return {
    price: (p: Protocol): number => {
      let lp = Math.log10(curvePrice(base, p.tvl_usd));
      for (const { kind, off } of stages) {
        lp += off.get(termGroup(kind, p, asOfMs, placeboGrowth && kind === 'growth')) ?? 0;
      }
      return 10 ** lp;
    },
  };
}

interface LadderRow {
  term: string;
  loo: number;
  wf: number;
  verdict: string;
}

/**
 * The ladder: each extra term must improve BOTH the LOO and the
 * walk-forward median miss against the curve alone, or it is dropped.
 * On this snapshot every term splits or fails — the shipped price is the
 * curve x kin, and this table is the receipt.
 */
function ablationLadder(comps: Protocol[], asOfMs: number, curveLoo: number, curveWf: number): {
  ladder: LadderRow[];
  placebo: { loo: number; wf: number };
} {
  const test = (kinds: TermKind[], placeboGrowth: boolean): { loo: number; wf: number } => {
    const looPairs: { pred: number; actual: number }[] = [];
    for (let i = 0; i < comps.length; i++) {
      const train = comps.filter((_, j) => j !== i);
      const model = fitOffsetModel(train, kinds, asOfMs, placeboGrowth);
      looPairs.push({ pred: model.price(comps[i]!), actual: comps[i]!.mcap_usd! });
    }
    const wf = walkForward(comps, (train, p) => fitOffsetModel(train, kinds, asOfMs, placeboGrowth).price(p));
    return { loo: medianMiss(looPairs), wf };
  };
  const verdict = (r: { loo: number; wf: number }): string =>
    r.loo < curveLoo && r.wf < curveWf ? 'kept' : 'dropped by the both-tests rule';
  const singles: [string, TermKind[]][] = [
    ['category', ['category']],
    ['growth', ['growth']],
    ['tenure', ['tenure']],
    ['breadth', ['breadth']],
    ['all four', ['category', 'growth', 'tenure', 'breadth']],
  ];
  const ladder: LadderRow[] = singles.map(([term, kinds]) => {
    const r = test(kinds, false);
    return { term, loo: round2(r.loo), wf: round2(r.wf), verdict: verdict(r) };
  });
  const pl = test(['growth'], true);
  return { ladder, placebo: { loo: round2(pl.loo), wf: round2(pl.wf) } };
}

// ---------------------------------------------------------------- bands and calibration

/** LOO residuals of the comps within +/-0.5 dex of a TVL (all of them when fewer than 8 are near). */
function bandResiduals(comps: Protocol[], loo: LooResult, tvl: number, excludeSlug: string | null): number[] {
  const lt = Math.log10(tvl);
  const residOf = (c: Protocol): number => Math.log10(c.mcap_usd!) - Math.log10(loo.pred.get(c.slug)!);
  const near = comps.filter(
    (c) => c.slug !== excludeSlug && Math.abs(Math.log10(c.tvl_usd) - lt) <= 0.5,
  );
  const pool = near.length >= 8 ? near : comps.filter((c) => c.slug !== excludeSlug);
  return pool.map(residOf).sort((x, y) => x - y);
}

interface BandSet {
  p10: number;
  p25: number;
  p75: number;
  p90: number;
}

/** Value bands for a price: the LOO residual quantiles around it, as multipliers. */
function bandsFor(comps: Protocol[], loo: LooResult, tvl: number, value: number): BandSet {
  const rs = bandResiduals(comps, loo, tvl, null);
  return {
    p10: value * 10 ** quantile(rs, 0.1),
    p25: value * 10 ** quantile(rs, 0.25),
    p75: value * 10 ** quantile(rs, 0.75),
    p90: value * 10 ** quantile(rs, 0.9),
  };
}

/** How often held-out comps actually land inside their own stated bands. */
function bandCalibration(comps: Protocol[], loo: LooResult): {
  realised50: number;
  realised80: number;
  oldInBand: number;
  oldN: number;
  newInBand: number;
  newN: number;
} {
  let in50 = 0;
  let in80 = 0;
  const byAge = [...comps].sort((x, y) =>
    x.listed_at === y.listed_at ? (x.slug < y.slug ? -1 : 1) : x.listed_at! < y.listed_at! ? -1 : 1,
  );
  const half = Math.floor(byAge.length / 2);
  let oldIn = 0;
  let newIn = 0;
  comps.forEach((c, idx) => {
    const rs = bandResiduals(comps, loo, c.tvl_usd, c.slug);
    const r = Math.log10(c.mcap_usd!) - Math.log10(loo.pred.get(c.slug)!);
    const inside50 = quantile(rs, 0.25) <= r && r <= quantile(rs, 0.75);
    if (inside50) in50++;
    if (quantile(rs, 0.1) <= r && r <= quantile(rs, 0.9)) in80++;
    const ageIdx = byAge.indexOf(c);
    if (inside50 && ageIdx < half) oldIn++;
    if (inside50 && ageIdx >= byAge.length - (byAge.length - half)) newIn++;
    void idx;
  });
  return {
    realised50: Math.round((in50 / comps.length) * 100),
    realised80: Math.round((in80 / comps.length) * 100),
    oldInBand: oldIn,
    oldN: half,
    newInBand: newIn,
    newN: byAge.length - half,
  };
}

/** The weakest comp category by LOO median miss (n >= 8), named with the flat model's miss there. */
function weakestCategory(comps: Protocol[], loo: LooResult): {
  category: string;
  n: number;
  curveMiss: number;
  flatMiss: number;
} {
  const byCat = new Map<string, Protocol[]>();
  for (const c of comps) {
    const key = c.category ?? 'Uncategorized';
    const arr = byCat.get(key);
    if (arr) arr.push(c);
    else byCat.set(key, [c]);
  }
  let worst: { category: string; n: number; curveMiss: number; flatMiss: number } | null = null;
  for (const [cat, cs] of byCat) {
    if (cs.length < 8) continue;
    const cm = medianMiss(cs.map((c) => ({ pred: loo.pred.get(c.slug)!, actual: c.mcap_usd! })));
    const fm = medianMiss(cs.map((c) => ({ pred: loo.flatPred.get(c.slug)!, actual: c.mcap_usd! })));
    if (worst === null || cm > worst.curveMiss) {
      worst = { category: cat, n: cs.length, curveMiss: round2(cm), flatMiss: round2(fm) };
    }
  }
  return worst!;
}

// ---------------------------------------------------------------- the ranked universe

const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_SUFFIX = /\s[Vv]\d+(\.\d+)?$|\s\d+\.\d+$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export interface Universe {
  ranked: Protocol[];
  setAside: { bridge: number; liquidStaking: number; cex: number; versioned: number; wrapped: number; total: number };
}

/**
 * The house's own watchlist rule, applied to every tokenless protocol:
 * bridges, liquid staking, exchange custody, versioned deployments and
 * wrapped/staked names are products of something else, not launch
 * candidates. What survives is ranked; the set-aside is counted, not hidden.
 */
export function rankedUniverse(protocols: Protocol[]): Universe {
  const setAside = { bridge: 0, liquidStaking: 0, cex: 0, versioned: 0, wrapped: 0, total: 0 };
  const ranked: Protocol[] = [];
  for (const p of protocols) {
    if (p.symbol !== null) continue;
    const cat = p.category;
    if (cat === 'Bridge' || cat === 'Canonical Bridge') {
      setAside.bridge++;
    } else if (cat === 'Liquid Staking' || cat === 'Liquid Restaking' || cat === 'Restaked BTC') {
      setAside.liquidStaking++;
    } else if (cat === 'CEX' || EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) {
      setAside.cex++;
    } else if (VERSION_SUFFIX.test(p.name)) {
      setAside.versioned++;
    } else if (WRAPPED_WORD.test(p.name)) {
      setAside.wrapped++;
    } else {
      ranked.push(p);
    }
  }
  setAside.total = setAside.bridge + setAside.liquidStaking + setAside.cex + setAside.versioned + setAside.wrapped;
  return { ranked, setAside };
}

/** A name stem: lowercased, version suffix stripped — how kin protocols are recognised. */
function nameStem(name: string): string {
  return name.toLowerCase().replace(VERSION_SUFFIX, '').trim();
}

/**
 * Kinship: a candidate whose name stem matches a traded protocol's, or
 * whose name carries a traded token's symbol as a whole word, is a sibling
 * of something that already trades — priced with the stated x0.5 haircut.
 */
export function siblingFlags(ranked: Protocol[], protocols: Protocol[]): Set<string> {
  const stems = new Set<string>();
  const symbols = new Set<string>();
  for (const p of protocols) {
    if (p.symbol === null) continue;
    stems.add(nameStem(p.name));
    symbols.add(p.symbol.toUpperCase());
  }
  const out = new Set<string>();
  for (const p of ranked) {
    let hit = stems.has(nameStem(p.name));
    if (!hit) {
      for (const tok of p.name.split(/[^A-Za-z0-9]+/)) {
        if (tok !== '' && symbols.has(tok.toUpperCase())) {
          hit = true;
          break;
        }
      }
    }
    if (hit) out.add(p.slug);
  }
  return out;
}

// ---------------------------------------------------------------- launch odds

export interface OddsModel {
  cells: Map<string, [number, number]>;
  rows: Map<number, [number, number]>;
  cols: Map<number, [number, number]>;
  base: number;
}

function ageBucket(p: Protocol, asOfMs: number): number {
  const ad = ageDays(p, asOfMs);
  if (ad === null) return 6;
  if (ad < 180) return 0;
  if (ad < 365) return 1;
  if (ad < 730) return 2;
  if (ad < 1095) return 3;
  if (ad < 1825) return 4;
  return 5;
}

function tvlBand(p: Protocol): number {
  const t = p.tvl_usd;
  if (t < 10_000_000) return 0;
  if (t < 50_000_000) return 1;
  if (t < 200_000_000) return 2;
  if (t < 1_000_000_000) return 3;
  return 4;
}

/** Fit the empirical odds table over a set of protocols (outcome: a token is recorded). */
export function fitLaunchOdds(data: Protocol[], asOfMs: number): OddsModel {
  const cells = new Map<string, [number, number]>();
  const rows = new Map<number, [number, number]>();
  const cols = new Map<number, [number, number]>();
  const bump = <K,>(m: Map<K, [number, number]>, k: K, y: number): void => {
    const cur = m.get(k);
    if (cur) {
      cur[0] += y;
      cur[1] += 1;
    } else {
      m.set(k, [y, 1]);
    }
  };
  for (const p of data) {
    const y = p.symbol !== null ? 1 : 0;
    const a = ageBucket(p, asOfMs);
    const b = tvlBand(p);
    bump(cells, `${a},${b}`, y);
    bump(rows, a, y);
    bump(cols, b, y);
  }
  const base = data.filter((p) => p.symbol !== null).length / data.length;
  return { cells, rows, cols, base };
}

/**
 * launchOdds(): the share of lookalike protocols that already record a
 * token — the age x TVL cell when it holds at least 20 protocols (Laplace
 * smoothed), else the age row, else the TVL band, else the base rate.
 */
export function launchOdds(p: Protocol, model: OddsModel, asOfMs: number): number {
  const a = ageBucket(p, asOfMs);
  const b = tvlBand(p);
  const smoothed = (kc: [number, number]): number => (kc[0] + 1) / (kc[1] + 2);
  const cell = model.cells.get(`${a},${b}`);
  if (cell !== undefined && cell[1] >= 20) return smoothed(cell);
  const row = model.rows.get(a);
  if (row !== undefined && row[1] >= 20) return smoothed(row);
  const col = model.cols.get(b);
  if (col !== undefined && col[1] >= 20) return smoothed(col);
  return model.base;
}

/** Odds validation: a seeded 70/30 split, the full-data AUC, and the decile reliability table. */
function oddsValidation(
  protocols: Protocol[],
  asOfMs: number,
  full: OddsModel,
  rnd: () => number,
): {
  splitModelHit: number;
  splitBaseHit: number;
  auc: number;
  deciles: { pred: number; realised: number; n: number }[];
} {
  const idx = protocols.map((_, i) => i);
  for (let i = 0; i < idx.length; i++) {
    const j = i + Math.floor(rnd() * (idx.length - i));
    const tmp = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = tmp;
  }
  const cut = Math.floor(protocols.length * 0.7);
  const train = idx.slice(0, cut).map((i) => protocols[i]!);
  const test = idx.slice(cut).map((i) => protocols[i]!);
  const trainModel = fitLaunchOdds(train, asOfMs);
  let hits = 0;
  let baseHits = 0;
  for (const p of test) {
    const has = p.symbol !== null;
    if ((launchOdds(p, trainModel, asOfMs) >= 0.5) === has) hits++;
    if (has) baseHits++;
  }
  const scored = protocols.map((p) => ({ o: launchOdds(p, full, asOfMs), y: p.symbol !== null ? 1 : 0 }));
  const ranks = averageRanks(scored.map((s) => s.o));
  const nPos = scored.filter((s) => s.y === 1).length;
  const nNeg = scored.length - nPos;
  let rankSum = 0;
  scored.forEach((s, i) => {
    if (s.y === 1) rankSum += ranks[i]!;
  });
  const auc = (rankSum - (nPos * (nPos + 1)) / 2) / (nPos * nNeg);
  const byOdds = [...scored].sort((x, y) => x.o - y.o);
  const deciles: { pred: number; realised: number; n: number }[] = [];
  for (let k = 0; k < 10; k++) {
    const chunk = byOdds.slice(Math.floor((k * byOdds.length) / 10), Math.floor(((k + 1) * byOdds.length) / 10));
    deciles.push({
      pred: round4(chunk.reduce((s, c) => s + c.o, 0) / chunk.length),
      realised: round4(chunk.filter((c) => c.y === 1).length / chunk.length),
      n: chunk.length,
    });
  }
  return {
    splitModelHit: round4(hits / test.length),
    splitBaseHit: round4(baseHits / test.length),
    auc: round2(auc),
    deciles,
  };
}

// ---------------------------------------------------------------- rank ranges (bootstrap)

/**
 * 200 seeded bootstrap refits of the whole pipeline: resample the comps
 * with replacement, refit the curve, reprice and re-rank every row. A
 * row's rank range is the 10th-90th percentile of its ranks across refits.
 */
function bootstrapRanks(
  comps: Protocol[],
  rows: { p: Protocol; value: number; odds: number; sibling: boolean }[],
  rnd: () => number,
): Map<string, number[]> {
  const samples = new Map<string, number[]>(rows.map((r) => [r.p.slug, []]));
  for (let rep = 0; rep < 200; rep++) {
    const sample = comps.map(() => comps[Math.floor(rnd() * comps.length)]!);
    const fit = fitCurve(sample);
    const scored = rows.map((r) => ({
      slug: r.p.slug,
      ev: curvePrice(fit, r.p.tvl_usd) * (r.sibling ? 0.5 : 1) * r.odds,
    }));
    scored.sort((x, y) => y.ev - x.ev || (x.slug < y.slug ? -1 : 1));
    scored.forEach((s, i) => samples.get(s.slug)!.push(i + 1));
  }
  return samples;
}

// ---------------------------------------------------------------- the farm plan

const CHAIN_FEE: Record<string, number> = {
  Ethereum: 6.0,
  Arbitrum: 0.45,
  Base: 0.35,
  BSC: 0.3,
  Solana: 0.1,
};
const DEFAULT_FEE = 1.5;
export const WEEKS_HELD = 8;
export const DROP_SHARE = 0.1;
export const TBILL = 0.04;
export const DEFAULT_TICKET = 1000;
export const PLAN_TVL_SHARE = 0.0002;
export const PLAN_MIN = 500;
export const PLAN_MAX = 10000;

/**
 * planSizeFor(): the board's default deposit for a row — 0.02% of the
 * row's own TVL, clamped to [$500, $10,000]. A fixed $1,000 ticket against
 * a $2.76B TVL stakes almost nothing and farms nothing; sizing the plan to
 * the protocol is what a farmer would actually do, so the board's verdicts
 * are read at the plan size. The reader's fixed-ticket explorer on the
 * detail page is unchanged.
 */
export function planSizeFor(tvl: number): number {
  return Math.min(PLAN_MAX, Math.max(PLAN_MIN, PLAN_TVL_SHARE * tvl));
}

/** The stated per-transaction fee prior for a chain. */
export function chainFee(chain: string | undefined): number {
  if (chain === undefined) return DEFAULT_FEE;
  return CHAIN_FEE[chain] ?? DEFAULT_FEE;
}

const CATEGORY_ACTIONS: Record<string, string> = {
  Lending: 'supply the ticket as collateral and take a small borrow against it',
  Dexs: 'add the ticket as liquidity to the deepest pool pair',
  Yield: 'deposit the ticket into the flagship vault',
  Derivatives: 'post the ticket as margin and open a small hedged position',
  CDP: 'lock the ticket as collateral and mint a stablecoin against it',
  RWA: 'subscribe the ticket to the flagship tokenised real-world asset',
  Launchpad: 'stake the ticket toward launch allocations',
  Chain: "bridge the ticket in and put it to work in the chain's core apps",
  Payments: 'route the ticket through the payment rails and hold a working balance',
  'Risk Curators': "allocate the ticket through the curator's flagship vault",
  'Onchain Capital Allocator': 'allocate the ticket through the flagship strategy',
};

function commas(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function pctText(g: number | null): string {
  if (g === null) return 'a 7-day change DefiLlama does not report';
  return `a 7-day change of ${g >= 0 ? '+' : ''}${g.toFixed(1)}%`;
}

/**
 * farmPlan(): a dated six-step plan for one protocol — fund, act, a weekly
 * repeat, a monthly TVL check with an exit trigger, a claim watch, and the
 * exit. Every step carries its fee and its minutes; the weekly step is
 * charged for the six repeats of an eight-week hold, the checks are reads
 * and cost nothing until a trigger fires.
 */
export function farmPlan(p: Protocol, asOfMs: number): { steps: FarmStep[]; feeTotal: number; minutesTotal: number } {
  const chain = p.chains[0];
  const fee = chainFee(chain);
  const chainName = chain ?? 'its main chain';
  const action = CATEGORY_ACTIONS[p.category ?? ''] ?? 'put the ticket to work in the core product';
  const steps: FarmStep[] = [
    {
      date: dayPlus(asOfMs, 0),
      action: `Fund the position: move the ticket onto ${chainName} in one transaction and connect the wallet to ${p.name}.`,
      fee,
      minutes: 25,
    },
    {
      date: dayPlus(asOfMs, 1),
      action: `Put the money to work in ${p.name} on ${chainName}: ${action}.`,
      fee,
      minutes: 30,
    },
    {
      date: dayPlus(asOfMs, 7),
      action: `Weekly repeat, weeks 2 to 7: harvest any rewards ${p.name} has paid, re-supply them into the position and re-check its size on ${chainName}.`,
      fee: fee * 6,
      minutes: 60,
    },
    {
      date: dayPlus(asOfMs, 28),
      action: `Monthly TVL check, weeks 4 and 8: ${p.name} holds $${commas(p.tvl_usd)} of TVL with ${pctText(p.change_7d)}; keep holding while TVL holds, and start the exit early if TVL falls 15% from entry or the 7-day change drops below -20%.`,
      fee: 0,
      minutes: 30,
    },
    {
      date: dayPlus(asOfMs, 49),
      action: `Claim watch: follow only ${p.name}'s official channels for a token announcement, record every transaction hash, and never pay a claim fee — a real claim is free.`,
      fee: 0,
      minutes: 10,
    },
    {
      date: dayPlus(asOfMs, 56),
      action: `Exit in week 8: withdraw the position from ${p.name} on ${chainName} and swap back to cash; if a token has launched, claim it first, then decide whether to hold or sell.`,
      fee,
      minutes: 20,
    },
  ];
  return {
    steps,
    feeTotal: steps.reduce((s, x) => s + x.fee, 0),
    minutesTotal: steps.reduce((s, x) => s + x.minutes, 0),
  };
}

interface Econ {
  slice: number;
  costs: number;
  breakEven: number;
  verdict: string;
}

/** The economics of one row at one ticket: slice, all-in costs, break-even launch odds, verdict. */
function economicsAt(
  value: number,
  tvl: number,
  feeTotal: number,
  ticket: number,
  share: number,
  tbill: number,
): Econ {
  const slice = (share * value * ticket) / (tvl + ticket);
  const costs = feeTotal + (ticket * tbill * WEEKS_HELD) / 52;
  const breakEven = slice > 0 ? costs / slice : Infinity;
  const verdict = breakEven <= 0.1 ? 'FARM' : breakEven <= 0.33 ? 'THIN' : 'SKIP';
  return { slice, costs, breakEven, verdict };
}

/** The smallest ticket at which the expected net turns non-negative at the row's own odds, if any. */
function paysFromTicket(
  value: number,
  tvl: number,
  odds: number,
  feeTotal: number,
): number | null {
  const net = (t: number): number =>
    odds * ((DROP_SHARE * value * t) / (tvl + t)) - (feeTotal + (t * TBILL * WEEKS_HELD) / 52);
  const grid = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 250000, 500000, 1000000];
  let lo: number | null = null;
  let hi: number | null = null;
  for (let i = 0; i < grid.length; i++) {
    if (net(grid[i]!) >= 0) {
      hi = grid[i]!;
      lo = i === 0 ? 1 : grid[i - 1]!;
      break;
    }
  }
  if (hi === null || lo === null) return null;
  for (let it = 0; it < 50; it++) {
    const mid = (lo + hi) / 2;
    if (net(mid) >= 0) hi = mid;
    else lo = mid;
  }
  return Math.ceil(hi);
}

/** The peer set: the nearest traded comps, same category first, inside +/-1 dex of TVL when possible. */
function peersFor(p: Protocol, comps: Protocol[]): Peer[] {
  const lt = Math.log10(p.tvl_usd);
  const byDist = (arr: Protocol[]): Protocol[] =>
    [...arr].sort(
      (x, y) =>
        Math.abs(Math.log10(x.tvl_usd) - lt) - Math.abs(Math.log10(y.tvl_usd) - lt) ||
        (x.slug < y.slug ? -1 : 1),
    );
  const same = byDist(comps.filter((c) => c.category === p.category));
  let cand = same.filter((c) => Math.abs(Math.log10(c.tvl_usd) - lt) <= 1);
  if (cand.length < 3) cand = same;
  if (cand.length < 3) {
    const rest = byDist(comps.filter((c) => c.category !== p.category));
    cand = cand.concat(rest.slice(0, 3 - cand.length));
  }
  return cand.slice(0, 5).map((c) => ({
    name: c.name,
    mult: round4(c.mcap_usd! / c.tvl_usd),
    tvl: c.tvl_usd,
  }));
}

// ---------------------------------------------------------------- the board check

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
}

/**
 * checkBoard(): the gate's shape, verified before anything is written —
 * ranks exactly 1..N, implied values positive whole dollars that never
 * rise with rank and are not all equal, every watchlist slug present, and
 * every farm plan 3-12 strings of 20-600 trimmed characters.
 */
export function checkBoard(rows: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of rows) {
    if (!slugs.has(r.slug)) return `row names a protocol the snapshot does not hold: ${r.slug}`;
    if (seen.has(r.slug)) return `slug appears twice: ${r.slug}`;
    seen.add(r.slug);
    if (r.name.trim() === '') return `row ${r.slug} has an empty name`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      return `row ${r.slug} has a non-positive or fractional implied value`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      return `row ${r.slug} has ${r.farm_steps.length} farm steps`;
    }
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `row ${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  const byRank = [...rows].sort((x, y) => x.rank - y.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `ranks are not exactly 1..N (rank ${byRank[i]!.rank} at position ${i + 1})`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return `implied value rises at rank ${byRank[i]!.rank}`;
    }
  }
  if (byRank.length > 1 && byRank.every((r) => r.implied_value_usd === byRank[0]!.implied_value_usd)) {
    return 'every implied value is the same: a board that ranks nothing by value';
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol missing from the board: ${slug}`;
  }
  return null;
}

// ---------------------------------------------------------------- runModel

export interface RadarMeta {
  asOf: string;
  floorUsd: number;
  ticket: number;
  weeksHeld: number;
  dropShare: number;
  tbill: number;
  counts: {
    protocols: number;
    tokened: number;
    tokenless: number;
    ranked: number;
    watchlist: number;
    watchlistCovered: number;
    setAside: { bridge: number; liquidStaking: number; cex: number; versioned: number; wrapped: number; total: number };
    siblings: number;
  };
  curve: { intercept: number; slope: number; comps: number };
  validation: {
    flatLoo: number;
    flatWf: number;
    curveLoo: number;
    curveWf: number;
    within3Curve: number;
    within3Flat: number;
    spearman: number;
    ladder: LadderRow[];
    placebo: { loo: number; wf: number };
    calibration: { stated50: number; stated80: number; realised50: number; realised80: number };
    cohorts: { oldInBand: number; oldN: number; newInBand: number; newN: number };
    weakestCategory: { category: string; n: number; curveMiss: number; flatMiss: number };
  };
  odds: {
    baseRate: number;
    splitModelHit: number;
    splitBaseHit: number;
    auc: number;
    deciles: { pred: number; realised: number; n: number }[];
  };
  stability: { top20Stay: number; top20N: number; medianRankWidth: number; rowsFarFromTvl: number };
  farm: {
    atPlan: { FARM: number; THIN: number; SKIP: number };
    firstFarmAtPlan: string | null;
    at1000: { FARM: number; THIN: number; SKIP: number };
    at10000: { FARM: number; THIN: number; SKIP: number };
    firstFarmAt10000: string | null;
    robustAtPlan: number;
  };
}

/**
 * runModel(): fit everything from the snapshot and return the ranked rows
 * plus every number the dashboard prints. Pure and deterministic: the same
 * snapshot bytes give the same rows and meta on every run.
 */
export function runModel(snapshot: Snapshot): { rows: RadarRow[]; meta: RadarMeta } {
  const asOfMs = parseDay(snapshot.as_of);
  const protocols = snapshot.protocols;
  const watchlist = new Set(snapshot.watchlist);

  // The pricing engine and its out-of-sample receipt.
  const comps = compsPool(protocols);
  const fit = fitCurve(comps);
  const loo = leaveOneOut(comps);
  const curveWf = walkForward(comps, (train, p) => curvePrice(fitCurve(train), p.tvl_usd));
  const flatWf = walkForward(
    comps,
    (train, p) => median(train.map((c) => c.mcap_usd! / c.tvl_usd)) * p.tvl_usd,
  );
  const { ladder, placebo } = ablationLadder(comps, asOfMs, loo.curveMiss, curveWf);
  const calib = bandCalibration(comps, loo);
  const weakest = weakestCategory(comps, loo);

  // The ranked universe and its kin.
  const { ranked, setAside } = rankedUniverse(protocols);
  const siblings = siblingFlags(ranked, protocols);

  // Launch odds: fitted on all 758, validated on a seeded split drawn from
  // the one PRNG stream (the bootstrap below draws from the same stream).
  const rnd = mulberry32(20261114);
  const oddsModel = fitLaunchOdds(protocols, asOfMs);
  const oddsVal = oddsValidation(protocols, asOfMs, oddsModel, rnd);

  interface Priced {
    p: Protocol;
    sibling: boolean;
    value: number;
    odds: number;
    ev: number;
  }
  const priced: Priced[] = ranked.map((p) => {
    const sibling = siblings.has(p.slug);
    const value = impliedValue(p, fit, sibling);
    const odds = launchOdds(p, oddsModel, asOfMs);
    return { p, sibling, value, odds, ev: value * odds };
  });
  priced.sort((x, y) => y.ev - x.ev || (x.p.slug < y.p.slug ? -1 : 1));

  // Rank ranges from 200 bootstrap refits.
  const samples = bootstrapRanks(
    comps,
    priced.map((r) => ({ p: r.p, value: r.value, odds: r.odds, sibling: r.sibling })),
    rnd,
  );
  const rankRange = new Map<string, { lo: number; hi: number; width: number }>();
  for (const r of priced) {
    const ss = [...samples.get(r.p.slug)!].sort((x, y) => x - y);
    rankRange.set(r.p.slug, {
      lo: Math.max(1, Math.round(quantile(ss, 0.1))),
      hi: Math.min(priced.length, Math.round(quantile(ss, 0.9))),
      width: quantile(ss, 0.9) - quantile(ss, 0.1),
    });
  }
  let top20Stay = 0;
  priced.slice(0, 20).forEach((r) => {
    const ss = samples.get(r.p.slug)!;
    if (ss.filter((x) => x <= 20).length / ss.length >= 0.8) top20Stay++;
  });
  const tvlOrder = [...ranked].sort((x, y) => y.tvl_usd - x.tvl_usd || (x.slug < y.slug ? -1 : 1));
  const tvlRank = new Map(tvlOrder.map((p, i) => [p.slug, i + 1] as const));
  let rowsFarFromTvl = 0;
  priced.forEach((r, i) => {
    if (Math.abs(i + 1 - tvlRank.get(r.p.slug)!) >= 5) rowsFarFromTvl++;
  });

  // Rows carry farm economics at their own plan size (planSizeFor); the
  // fixed-ticket counts stay in the meta for the detail page's explorer.
  const verdictCounts = (ticket: number): { FARM: number; THIN: number; SKIP: number } => {
    const counts = { FARM: 0, THIN: 0, SKIP: 0 };
    for (const r of priced) {
      const plan = farmPlan(r.p, asOfMs);
      const econ = economicsAt(r.value, r.p.tvl_usd, plan.feeTotal, ticket, DROP_SHARE, TBILL);
      counts[econ.verdict as 'FARM' | 'THIN' | 'SKIP']++;
    }
    return counts;
  };
  const at1000 = verdictCounts(1000);
  const at10000 = verdictCounts(10000);
  let firstFarmAt10000: string | null = null;
  for (const r of priced) {
    const plan = farmPlan(r.p, asOfMs);
    if (economicsAt(r.value, r.p.tvl_usd, plan.feeTotal, 10000, DROP_SHARE, TBILL).verdict === 'FARM') {
      firstFarmAt10000 = r.p.name;
      break;
    }
  }
  const atPlan = { FARM: 0, THIN: 0, SKIP: 0 };
  let firstFarmAtPlan: string | null = null;
  for (const r of priced) {
    const plan = farmPlan(r.p, asOfMs);
    const v = economicsAt(r.value, r.p.tvl_usd, plan.feeTotal, planSizeFor(r.p.tvl_usd), DROP_SHARE, TBILL).verdict;
    atPlan[v as 'FARM' | 'THIN' | 'SKIP']++;
    if (v === 'FARM' && firstFarmAtPlan === null) firstFarmAtPlan = r.p.name;
  }

  const rows: RadarRow[] = priced.map((r, i) => {
    const p = r.p;
    const plan = farmPlan(p, asOfMs);
    const bands = bandsFor(comps, loo, p.tvl_usd, r.value);
    const planTicket = planSizeFor(p.tvl_usd);
    const econ = economicsAt(r.value, p.tvl_usd, plan.feeTotal, planTicket, DROP_SHARE, TBILL);
    const net = r.odds * econ.slice - econ.costs;
    const netLow = r.odds * ((DROP_SHARE * bands.p25 * planTicket) / (p.tvl_usd + planTicket)) - econ.costs;
    let robust = true;
    for (const share of [0.05, 0.1, 0.2]) {
      for (const tb of [0, 0.04, 0.08]) {
        if (economicsAt(r.value, p.tvl_usd, plan.feeTotal, planTicket, share, tb).verdict !== 'FARM') {
          robust = false;
        }
      }
    }
    const ad = ageDays(p, asOfMs);
    const tags: string[] = [];
    if (p.chains.length === 1) tags.push('SINGLE-CHAIN');
    if (p.change_7d !== null && p.change_7d <= -20) tags.push('FALLING');
    if (ad !== null && ad < 180) tags.push('NEW');
    if (r.sibling) tags.push('SIBLING');
    const range = rankRange.get(p.slug)!;
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Uncategorized',
      chains: p.chains,
      tvl: p.tvl_usd,
      change7d: p.change_7d,
      ageDays: ad,
      watchlist: watchlist.has(p.slug),
      offList: !watchlist.has(p.slug),
      early: p.tvl_usd < snapshot.floor_usd,
      sibling: r.sibling,
      tags,
      mult: round4(r.value / p.tvl_usd),
      valueIfLaunched: Math.round(r.value),
      odds: r.odds,
      ev: Math.round(r.ev),
      bandLo: Math.round(bands.p25),
      bandHi: Math.round(bands.p75),
      band10: Math.round(bands.p10),
      band90: Math.round(bands.p90),
      rankLo: range.lo,
      rankHi: range.hi,
      plan: Math.round(planTicket),
      slice: round2(econ.slice),
      costs: round2(econ.costs),
      net: round2(net),
      netLow: round2(netLow),
      perHour: round2(net / (plan.minutesTotal / 60)),
      paysFrom: paysFromTicket(r.value, p.tvl_usd, r.odds, plan.feeTotal),
      verdict: econ.verdict,
      robust,
      steps: plan.steps,
      peers: peersFor(p, comps),
      impliedValueUsd: Math.max(1, Math.round(r.ev)),
      farmSteps: plan.steps.map(
        (s) => `${s.date}: ${s.action} Cost $${s.fee.toFixed(2)} · ${s.minutes} min.`,
      ),
    };
  });

  const meta: RadarMeta = {
    asOf: snapshot.as_of,
    floorUsd: snapshot.floor_usd,
    ticket: DEFAULT_TICKET,
    weeksHeld: WEEKS_HELD,
    dropShare: DROP_SHARE,
    tbill: TBILL,
    counts: {
      protocols: protocols.length,
      tokened: protocols.filter((p) => p.symbol !== null).length,
      tokenless: protocols.filter((p) => p.symbol === null).length,
      ranked: rows.length,
      watchlist: snapshot.watchlist.length,
      watchlistCovered: rows.filter((r) => r.watchlist).length,
      setAside,
      siblings: siblings.size,
    },
    curve: { intercept: round4(fit.intercept), slope: round4(fit.slope), comps: comps.length },
    validation: {
      flatLoo: round2(loo.flatMiss),
      flatWf: round2(flatWf),
      curveLoo: round2(loo.curveMiss),
      curveWf: round2(curveWf),
      within3Curve: round4(loo.within3),
      within3Flat: round4(loo.flatWithin3),
      spearman: round2(loo.spearman),
      ladder,
      placebo,
      calibration: { stated50: 50, stated80: 80, realised50: calib.realised50, realised80: calib.realised80 },
      cohorts: { oldInBand: calib.oldInBand, oldN: calib.oldN, newInBand: calib.newInBand, newN: calib.newN },
      weakestCategory: weakest,
    },
    odds: {
      baseRate: round4(oddsModel.base),
      splitModelHit: oddsVal.splitModelHit,
      splitBaseHit: oddsVal.splitBaseHit,
      auc: oddsVal.auc,
      deciles: oddsVal.deciles,
    },
    stability: {
      top20Stay,
      top20N: Math.min(20, rows.length),
      medianRankWidth: round2(median(priced.map((r) => rankRange.get(r.p.slug)!.width))),
      rowsFarFromTvl,
    },
    farm: {
      atPlan,
      firstFarmAtPlan,
      at1000,
      at10000,
      firstFarmAt10000,
      robustAtPlan: rows.filter((r) => r.robust).length,
    },
  };
  return { rows, meta };
}
