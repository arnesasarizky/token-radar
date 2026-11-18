// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board ranks protocols that record no token yet (no CoinGecko id, no symbol) by an implied
// value: what a token would plausibly be worth if the protocol issued one at the valuation its
// already-tokenised peers actually trade at. The model is peer-relative, never name-based:
//
//   peers      = protocols with a market cap and at least $5M of TVL
//   multiple   = the protocol's category median mcap/TVL among peers, shrunk toward the global
//                peer median by sample size and clamped to [0.02, 2.5]; a category with fewer
//                than 3 peers (or none) borrows the global median outright
//   growth     = clamp(1 + change_7d / 100, 0.5, 1.8)      (a missing change reads as 0)
//   age        = 1 + min(0.35, tokenless years x 0.06)     (an unknown listing date reads as 1)
//   implied    = max($1,000,000, round(tvl_usd x multiple x growth x age))
//
// Coverage: every watchlist slug is ranked, whatever it is. Beyond the watchlist, the board takes
// every eligible pre-token protocol at or above a TVL cutoff ($7.5M, falling back to $5M when that
// yields fewer than 160 rows). Exchanges, bridges, liquid staking/restaking wrappers and wrapped,
// staked or versioned namesakes of a parent protocol are not future-token candidates and stay off
// the board; the protocols that already have tokens are set aside as the live comparison set.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  /** A protocol counts as a valuation peer only at or above this TVL. */
  peer_floor_usd: number;
  /** A category needs at least this many peers before its own median is used at all. */
  peer_min_count: number;
  /** Pseudo-count the global median is weighted with when shrinking a category median. */
  shrink_peers: number;
  /** The clamp on every multiple the model applies, peer medians included. */
  multiple_floor: number;
  multiple_cap: number;
  /** The clamp on the seven-day growth factor. */
  growth_floor: number;
  growth_cap: number;
  /** The tokenless-age bonus: this much per year without a token, up to the cap. */
  age_bonus_per_year: number;
  age_bonus_cap: number;
  /** No ranked protocol is valued below this, however small its inputs. */
  min_value_usd: number;
  /** The TVL cutoff for non-watchlist rows, and the fallback when it yields too few. */
  board_tvl_usd: number;
  board_fallback_tvl_usd: number;
  board_min_rows: number;
}

export const MODEL: ModelConstants = {
  peer_floor_usd: 5_000_000,
  peer_min_count: 3,
  shrink_peers: 3,
  multiple_floor: 0.02,
  multiple_cap: 2.5,
  growth_floor: 0.5,
  growth_cap: 1.8,
  age_bonus_per_year: 0.06,
  age_bonus_cap: 0.35,
  min_value_usd: 1_000_000,
  board_tvl_usd: 7_500_000,
  board_fallback_tvl_usd: 5_000_000,
  board_min_rows: 160,
};

/** The model's version label: the dashboard names it and the entrypoint logs it. */
export const MODEL_VERSION = 'peer-multiple-1';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    /** The peer-derived category multiple this row was valued with. */
    base_multiple: number;
    growth_pct: number;
    /** The seven-day growth factor. */
    growth_multiplier: number;
    /** The tokenless-age factor. */
    maturity_multiplier: number;
    age_days: number | null;
    /** The category's own peer median before shrinkage, or null when it borrowed the global one. */
    category_median: number | null;
    /** How many token-bearing peers stand behind this row's multiple. */
    peers: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  /** The peer-derived category multiple this row was valued with. */
  base_multiple: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  /** How many token-bearing peers stand behind this row's multiple. */
  peers: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One category's peer evidence, as the dashboard states the model. */
export interface CategoryMultiple {
  category: string;
  /** Token-bearing peers in the category. */
  peers: number;
  /** The category's own median mcap/TVL, or null when it has too few peers to have one. */
  median: number | null;
  /** The multiple actually applied: the shrunk median, or the global median. */
  multiple: number;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  /** The global peer median mcap/TVL and the peers behind it: the model's fallback multiple. */
  global_multiple: number;
  global_peers: number;
  category_multiples: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** One category's peer evidence: how many peers, their median, and the multiple they earn. */
export interface MultipleInfo {
  peers: number;
  median: number | null;
  multiple: number;
}

/** The peer multiples for a whole snapshot: the global median and one entry per category. */
export interface CategoryMultiples {
  global: MultipleInfo;
  byCategory: Map<string | null, MultipleInfo>;
}

/**
 * The peer table: every protocol that already trades (a market cap, at least the peer floor of TVL)
 * votes on what a token is worth per dollar of TVL, in its own category and overall. A category's
 * multiple is its peer median shrunk toward the global median by the pseudo-count in the model, so
 * a thin category leans on the market as a whole; below the minimum peer count it borrows the
 * global median outright. Every multiple is clamped to the model's band.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): CategoryMultiples {
  const ratiosByCategory = new Map<string | null, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd < model.peer_floor_usd) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const list = ratiosByCategory.get(p.category);
    if (list === undefined) ratiosByCategory.set(p.category, [ratio]);
    else list.push(ratio);
  }
  const globalMedian = all.length > 0 ? median(all) : 1;
  const global: MultipleInfo = {
    peers: all.length,
    median: all.length > 0 ? round4(globalMedian) : null,
    multiple: round4(clamp(globalMedian, model.multiple_floor, model.multiple_cap)),
  };
  const byCategory = new Map<string | null, MultipleInfo>();
  for (const [category, ratios] of ratiosByCategory) {
    if (ratios.length >= model.peer_min_count) {
      const med = median(ratios);
      const shrunk = (ratios.length * med + model.shrink_peers * globalMedian) / (ratios.length + model.shrink_peers);
      byCategory.set(category, {
        peers: ratios.length,
        median: round4(med),
        multiple: round4(clamp(shrunk, model.multiple_floor, model.multiple_cap)),
      });
    } else {
      byCategory.set(category, { peers: ratios.length, median: null, multiple: global.multiple });
    }
  }
  return { global, byCategory };
}

/** The multiple one category is valued with: its own shrunk median, or the global peer median. */
export function multipleFor(table: CategoryMultiples, category: string | null): MultipleInfo {
  return table.byCategory.get(category) ?? { peers: 0, median: null, multiple: table.global.multiple };
}

/** The factors and the implied value one protocol gets under the peer model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  table: CategoryMultiples,
  asOf: string,
  model: ModelConstants = MODEL,
): { implied: number; growthPct: number; growthMult: number; ageMult: number; age: number | null; info: MultipleInfo } {
  const info = multipleFor(table, protocol.category);
  const growthPct = finite(protocol.change_7d, 0);
  const growthMult = clamp(1 + growthPct / 100, model.growth_floor, model.growth_cap);
  const age = ageDays(asOf, protocol.listed_at);
  const ageMult = age === null ? 1 : 1 + Math.min(model.age_bonus_cap, (age / 365.25) * model.age_bonus_per_year);
  const implied = Math.max(model.min_value_usd, Math.round(protocol.tvl_usd * info.multiple * growthMult * ageMult));
  return { implied, growthPct, growthMult, ageMult, age, info };
}

/** Whether a protocol records no token at all: no CoinGecko id and no symbol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** Categories that are never a future-token candidate: the product trades through a parent already. */
const EXCLUDED_CATEGORIES = new Set(['CEX', 'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** A wrapped, staked or staking product names what it wraps, as a whole word, in any case. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name ending in a release marker is a later version of a protocol, not a new candidate. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name that opens with an exchange's name is that exchange's product, not a candidate. */
const EXCHANGE_LED = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a name marks the protocol as a wrapped, staked, versioned or exchange-led product. */
export function isExcludedName(name: string): boolean {
  const trimmed = name.trim();
  return WRAPPED_WORD.test(trimmed) || VERSIONED.test(trimmed) || EXCHANGE_LED.test(trimmed);
}

/** Whether a protocol is one the board may rank beyond the watchlist: pre-token and a genuine candidate. */
export function isRankable(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  return !isExcludedName(p.name);
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const table = categoryMultiples(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is ranked, whatever its category or name says.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // Beyond it, every eligible pre-token protocol at or above the TVL cutoff. The cutoff is a size
  // line, not a ranking: if it leaves the board thinner than the model promises, it falls back.
  const eligible = snapshot.protocols.filter((p) => !chosen.has(p.slug) && isRankable(p));
  let added = eligible.filter((p) => p.tvl_usd >= model.board_tvl_usd);
  if (chosen.size + added.length < model.board_min_rows) {
    added = eligible.filter((p) => p.tvl_usd >= model.board_fallback_tvl_usd);
  }
  for (const p of added) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, ...impliedValue(p, table, snapshot.as_of, model) }));
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: s.info.multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.ageMult),
      age_days: s.age,
      category_median: s.info.median,
      peers: s.info.peers,
    },
    farm_steps: farmSteps(s.p).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** A small deterministic hash of a slug, so phrasing varies by protocol and never by run. */
function slugHash(slug: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h ^= slug.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Pick one phrasing for a step, by a slice of the slug's hash. */
function pick<T>(variants: readonly T[], hash: number, shift: number): T {
  return variants[(hash >>> shift) % variants.length]!;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much working capital a farm position on this protocol wants, tiered by its TVL. */
function capitalFor(p: SnapshotProtocol): string {
  if (p.tvl_usd >= 100_000_000) return '$1,000-$5,000';
  if (p.tvl_usd >= 25_000_000) return '$500-$2,000';
  return '$100-$500';
}

/** What staying active costs in network fees on a chain, in one short phrase. */
function gasFor(chain: string): string {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return 'budget $15-$40 a week in mainnet gas while you are active';
  if (c === 'solana') return 'network fees come to roughly $0.50 a week';
  if (c.includes('base') || c.includes('arbitrum') || c.includes('optimism') || c.includes('op mainnet')) return 'gas runs about $1-$5 a week on this L2';
  if (c === 'bitcoin') return 'bitcoin network fees run a few dollars per transaction';
  return `fees on ${chain} are low, a few dollars a week at most`;
}

/** A playbook's two authored moves: the core action that opens the farm, and the one that deepens it. */
interface Playbook {
  open: readonly string[];
  deepen: readonly string[];
}

/** The playbooks, keyed by the kind of protocol. Slots: {name}, {chain}, {cap}. */
const PLAYBOOKS: Record<string, Playbook> = {
  dex: {
    open: [
      `Make {name} your regular swap venue on {chain}: route the trades you would make anyway through its pools, and open a {cap} position in its busiest stablecoin pair.`,
      `Open a {cap} liquidity position in {name}'s main pool on {chain} and leave it in range; a wide range keeps counting while a tight one drifts out and stops.`,
    ],
    deepen: [
      `Swap in both directions at least twice a week, in and out of the pool's main pair, so the wallet shows genuine flow rather than a single parked deposit.`,
      `Take part in any gauge or governance vote the app runs, and claim trading-fee rewards from {name}'s own rewards page as they build up.`,
    ],
  },
  lend: {
    open: [
      `Supply {cap} of USDC or ETH to {name}'s main lending market on {chain} and leave it supplied; lenders who stay in across weekly snapshots are the wallets a protocol can actually see.`,
      `Deposit {cap} into {name} on {chain} as a lender and resist topping up or pulling out for the first month; a steady balance reads as a user, not a passer-by.`,
    ],
    deepen: [
      `Borrow a small slice, 10-20% of your deposit, against the position and repay it inside the week; one clean borrow-and-repay cycle shows you used the market, not just parked in it.`,
      `Claim any lender rewards the app shows, then supply them back into the same market so your supplied balance keeps compounding on {name}'s own books.`,
    ],
  },
  cdp: {
    open: [
      `Open a vault on {name} with {cap} of collateral on {chain} and mint a modest amount of its stablecoin, keeping the collateral ratio well clear of the liquidation line.`,
      `Lock {cap} of collateral in a {name} vault on {chain} and mint against it conservatively; the position only counts while it stays safely open.`,
    ],
    deepen: [
      `Hold the minted stablecoin, or supply it to the protocol's own stability pool, and top the collateral up whenever the ratio drifts toward the minimum.`,
      `Repay a little and mint again over the weeks so the vault shows a living history of both sides of the product, not a single forgotten transaction.`,
    ],
  },
  yield: {
    open: [
      `Deposit {cap} into {name}'s flagship vault on {chain} and keep the vault shares in the same wallet; auto-compounding vaults reward wallets that simply stay put.`,
      `Put {cap} to work in {name} on {chain} through its main vault and leave the shares untouched; churning between vaults resets more than it earns.`,
    ],
    deepen: [
      `Claim whatever the vault pays each week and re-deposit it instead of selling, so your share balance grows on the protocol's own records month after month.`,
      `Once a month, read the vault's strategy note and confirm the underlying markets are still ones you accept; move only if the strategy itself changes.`,
    ],
  },
  curator: {
    open: [
      `Choose one of {name}'s curated vaults on {chain} and deposit {cap}; read the vault's strategy page first, so you know which markets your money is being routed into.`,
      `Deposit {cap} into a {name} vault on {chain} whose curator and strategy you can name; curated vaults track depositors per vault, not per protocol.`,
    ],
    deepen: [
      `Check the vault's allocation page monthly and switch sibling vaults only if the curator changes strategy; steady depositors are far easier to recognise than vault-hoppers.`,
      `Compound any yield the vault distributes back into the same vault, keeping one continuous deposit history under one curator.`,
    ],
  },
  rwa: {
    open: [
      `Complete {name}'s onboarding or allowlist step if it runs one, then mint {cap} of its tokenised treasury or credit asset on {chain} and hold it in the minting wallet.`,
      `Mint {cap} of {name}'s yield-bearing real-world asset on {chain} and hold it where you minted it; these products count holders, and holders are wallets that stay.`,
    ],
    deepen: [
      `Let the position accrue for a full quarter and claim yield from the app's own dashboard; RWA products settle slowly, so plan redemptions around their windows rather than forcing them.`,
      `Add a second, smaller mint after the first settles cleanly, so your history shows a repeat customer rather than a single test transaction.`,
    ],
  },
  derivatives: {
    open: [
      `Deposit {cap} of margin on {name} and open one small hedged position, a long and a short of similar size, so you build real trading history without directional risk.`,
      `Fund a {cap} margin account on {name} and trade one small position end to end, open to close, before doing anything larger; the venue tracks completed behaviour.`,
    ],
    deepen: [
      `Trade a small amount every week, even a $50 position opened and closed, and keep the margin account funded between sessions; consistent small traders are the activity these venues record.`,
      `Use one advanced feature the venue offers, a stop order, a sub-account or its API, once a month; depth of use is visible in an account's history.`,
    ],
  },
  bridge: {
    open: [
      `Bridge {cap} of funds to {chain} through {name} instead of a rival bridge, then actually use the arrived funds in one app on the destination chain before bridging anything back.`,
      `Make {name} your route onto {chain}: move {cap} across with it and leave the funds working on the far side for a few weeks, not a few minutes.`,
    ],
    deepen: [
      `Make the return trip through {name} as well, a few weeks later; round trips in both directions are the usage a bridge can attribute to a single wallet.`,
      `Bridge a second, smaller amount on a different week rather than one large transfer; repeated crossings read as a habit, not an event.`,
    ],
  },
  stable: {
    open: [
      `Mint {cap} of {name}'s stablecoin against a deposit on {chain} and hold the stablecoin in the same wallet; an issuer can only see wallets that actually hold its asset.`,
      `Acquire {cap} of {name}'s stable asset on {chain} through its own mint or main pool and keep it; holding through several weekly snapshots is the visible behaviour.`,
    ],
    deepen: [
      `Use the stablecoin once in a partner app {name} lists, a payment or a lending market, then bring it back; circulation, not just minting, is the usage that shows.`,
      `Top the holding up slightly each month so the balance trends upward; a growing, held balance is the strongest signal a pre-token issuer can record.`,
    ],
  },
  payments: {
    open: [
      `Sign up for {name}, complete its identity check if it asks for one, and fund the account with {cap} so the wallet is fully live long before any token exists.`,
      `Open a {name} account and load it with {cap}; finish every verification step it offers, since half-verified accounts are the first ones filtered out of anything.`,
    ],
    deepen: [
      `Route one genuine payment or card purchase a week through {name} for a couple of months; small, regular, real transactions are the entire point of a payments product.`,
      `Receive one payment through {name} as well as sending them, so the account shows both sides of the network rather than a single funded wallet.`,
    ],
  },
  prediction: {
    open: [
      `Fund {cap} on {name} and take small positions in its most liquid markets, the ones you genuinely have a view on, rather than spraying a little into every market listed.`,
      `Deposit {cap} on {name} and open two or three small positions in markets you follow; settled, considered trades read very differently from random clicks.`,
    ],
    deepen: [
      `Stay active across several market cycles and settle positions as they resolve instead of abandoning them; a settled history is what marks a real user here.`,
      `Reinvest a slice of any winnings into the next market you have a view on, keeping one continuous thread of activity in the account.`,
    ],
  },
  nft: {
    open: [
      `Connect your wallet to {name} on {chain} and make a first genuine trade or purchase inside a {cap} budget; empty profiles and untouched wallets are trivial to filter out.`,
      `Set up your profile on {name} and complete one real transaction on {chain}, a buy, a sale or a mint, sized inside a {cap} budget for the season.`,
    ],
    deepen: [
      `List, play or trade a little each week and keep whatever you earn in the same wallet; steady low-value activity over months outweighs one large purchase.`,
      `Take part in one seasonal event, drop or quest {name} runs, and finish it fully rather than starting three and abandoning them.`,
    ],
  },
  launchpad: {
    open: [
      `Register on {name} and complete any staking or allowlist step it runs, with {cap} held ready; launchpads remember who was prepared before a sale opened, not after.`,
      `Create your {name} account, pass its checks, and park {cap} in whatever its next sale requires, so you are eligible the moment a round opens.`,
    ],
    deepen: [
      `Take part in one small sale or claim round and hold what you receive for a while instead of flipping it on day one; holders are the participants a launchpad can identify.`,
      `Join the allowlist for each new round even when you sit the sale out; repeated registration is a visible, costless signal of a real follower.`,
    ],
  },
  indexes: {
    open: [
      `Buy {cap} of {name}'s headline index product on {chain} and hold it in your own wallet rather than on an exchange, so the holding is attributable to you.`,
      `Open a {cap} position in {name}'s main index on {chain} and leave it alone; index holders are counted by duration as much as by size.`,
    ],
    deepen: [
      `Top the position up as the index rebalances each month; holders who ride several rebalances are the ones an index protocol can pick out.`,
      `Claim any distribution the index pays and reinvest it into the same product, keeping one unbroken holding history.`,
    ],
  },
  staking: {
    open: [
      `Stake {cap} of the chain's native asset through {name} on {chain} and keep the receipt in the same wallet for the whole period.`,
      `Delegate {cap} through {name} on {chain} and leave the stake untouched; staking products measure their users in months staked, not transactions.`,
    ],
    deepen: [
      `Re-stake or re-delegate rewards as they arrive instead of withdrawing them, and never start an unbonding you do not intend to finish.`,
      `Add a small second stake a month later so the position shows growth over time rather than one static deposit.`,
    ],
  },
  generic: {
    open: [
      `Deposit {cap} into {name}'s main product on {chain} and keep the position open; whatever this protocol one day counts, it can only count wallets that actually used it.`,
      `Start with {cap} in {name} on {chain}, using its headline feature end to end once, properly, rather than poking at every screen it has.`,
    ],
    deepen: [
      `Repeat the core action, a deposit, a swap, a vote or a claim, at least once a week, so your history spans months instead of a single afternoon.`,
      `Turn on whatever the app itself offers regulars, notifications, a points page, a referral link, and use it the way a genuine user would.`,
    ],
  },
};

/** Which playbook a category follows. */
function playbookFor(category: string | null): Playbook {
  const c = (category ?? '').toLowerCase();
  if (c === 'dexs') return PLAYBOOKS.dex!;
  if (c.includes('lend') || c === 'collateral markets') return PLAYBOOKS.lend!;
  if (c.includes('cdp')) return PLAYBOOKS.cdp!;
  if (c === 'yield' || c === 'yield aggregator' || c === 'farm' || c === 'leveraged farming' || c === 'liquidity manager') return PLAYBOOKS.yield!;
  if (c === 'risk curators' || c === 'onchain capital allocator' || c === 'collateral management') return PLAYBOOKS.curator!;
  if (c === 'rwa') return PLAYBOOKS.rwa!;
  if (c === 'derivatives' || c.includes('options') || c === 'synthetics' || c === 'interest rate derivatives' || c === 'basis trading') return PLAYBOOKS.derivatives!;
  if (c === 'cross chain bridge') return PLAYBOOKS.bridge!;
  if (c.includes('stable') || c === 'algo-stables') return PLAYBOOKS.stable!;
  if (c === 'payments' || c === 'crypto card issuer') return PLAYBOOKS.payments!;
  if (c === 'prediction market') return PLAYBOOKS.prediction!;
  if (c.includes('nft') || c.includes('gaming')) return PLAYBOOKS.nft!;
  if (c === 'launchpad') return PLAYBOOKS.launchpad!;
  if (c === 'indexes') return PLAYBOOKS.indexes!;
  if (c === 'staking pool' || c === 'restaking') return PLAYBOOKS.staking!;
  return PLAYBOOKS.generic!;
}

/** Fill a playbook template's slots from the protocol's own record. */
function fill(template: string, name: string, chain: string, cap: string): string {
  return template.replaceAll('{name}', name).replaceAll('{chain}', chain).replaceAll('{cap}', cap);
}

const SETUP_STEPS: readonly string[] = [
  `Create a fresh wallet for this farm and keep its seed phrase written down offline; fund it on {chain} with the working capital plus a little extra held back for fees.`,
  `Set up a dedicated wallet, never your main one, and get funds onto {chain} before you touch the app, so a fee spike never strands a half-open position.`,
  `Use one wallet for this protocol and label it in your tracker; send it enough on {chain} to cover the position and a month of transaction fees up front.`,
];

const ROUTINE_STEPS: readonly string[] = [
  `Repeat one qualifying action every week, a swap, a top-up, a vote or a claim, for at least 8-12 weeks; protocols read activity over time, and one busy afternoon rarely counts for much.`,
  `Keep the position open and touch it weekly for 8-12 weeks, compounding or topping up rather than withdrawing, so the wallet appears in month after month of the protocol's own records.`,
  `Set a weekly ten-minute slot to use {name} again: claim, compound, vote or trade small. Eight to twelve weeks of steady use is the pattern that separates farmers from tourists.`,
];

const TRACK_STEPS: readonly string[] = [
  `Check {name}'s own points or rewards page monthly and claim only through links the protocol itself publishes; if it ever issues a token, this recorded history is what would matter, and nothing is promised.`,
  `Keep a simple farm log: wallet, dates, amounts, transaction hashes. If {name} ever launches a token you will want proof of early use; until then, the log is how you unwind the position cleanly.`,
  `Never pay anyone to unlock rewards and never type your seed phrase anywhere; when you are done, withdraw through the app itself and move on. A future token is a possibility here, never a guarantee.`,
];

/**
 * A protocol's farm plan: five steps, each an action with a cost and a time. The plan is generated
 * from the protocol's own record (category playbook, first chain, TVL-tiered capital, chain-aware
 * fees), with phrasing chosen by a hash of the slug so no two protocols read quite alike and no run
 * ever differs. Every step is an honest use of the product; no step promises a token or a reward.
 */
export function farmSteps(p: SnapshotProtocol): FarmStep[] {
  const chain = chainOf(p);
  const cap = capitalFor(p);
  const gas = gasFor(chain);
  const hash = slugHash(p.slug);
  const book = playbookFor(p.category);
  return [
    {
      text: fill(pick(SETUP_STEPS, hash, 0), p.name, chain, cap),
      cost: `no position yet, just the fee float; ${gas}`,
      time: '10-15 minutes, once',
    },
    {
      text: fill(pick(book.open, hash, 3), p.name, chain, cap),
      cost: `${cap} of working capital`,
      time: 'about 20 minutes',
    },
    {
      text: fill(pick(book.deepen, hash, 6), p.name, chain, cap),
      cost: `no new capital; ${gas}`,
      time: '15 minutes',
    },
    {
      text: fill(pick(ROUTINE_STEPS, hash, 9), p.name, chain, cap),
      cost: gas,
      time: '10 minutes a week for 8-12 weeks',
    },
    {
      text: fill(pick(TRACK_STEPS, hash, 12), p.name, chain, cap),
      cost: 'nothing; never pay anyone to claim',
      time: '10 minutes a month',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    base_multiple: row.model.base_multiple,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    peers: row.model.peers,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const table = categoryMultiples(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const category_multiples: CategoryMultiple[] = [...table.byCategory.entries()]
    .filter((entry): entry is [string, MultipleInfo] => entry[0] !== null)
    .map(([category, info]) => ({ category, peers: info.peers, median: info.median, multiple: info.multiple }))
    .sort((a, b) => b.peers - a.peers || (a.category < b.category ? -1 : 1));
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: table.global.multiple,
    global_peers: table.global.peers,
    category_multiples,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
