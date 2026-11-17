// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// pre-token protocols below the floor that the same record supports: the early rows the radar exists
// to find. A protocol is pre-token when its record carries no token (no market cap, no CoinGecko id,
// no symbol). Token-bearing protocols are never ranked here: they are set aside as the live set, the
// market's own values, and they are what the model's anchors are learned from.
//
// The implied value of a pre-token protocol is its TVL priced the way the snapshot's own token-bearing
// protocols are priced, then adjusted by the protocol's own record:
//
//   anchor(cat)  = shrunk median of mcap / TVL over the snapshot's token-bearing protocols in the
//                  protocol's category (winsorised to [0.01, 5], shrunk toward the global median
//                  with a prior of 4: thin categories borrow the market's centre, deep ones speak
//                  for themselves)
//   momentum     = 1 + clamp(change_7d, -50, 100) / 100 x 0.6     (a week of TVL flow, damped)
//   maturity     = 0.78 + 0.37 x (1 - exp(-age_days / 540))      (years run with no token count;
//                  an unreported listing day is scored as 365 days)
//   breadth      = 1 + 0.025 x min(chains - 1, 12)                (distribution across chains)
//   implied      = max(1, round(TVL x anchor x momentum x maturity x breadth))
//
// Bridges, canonical bridges and staking or restaking products are not ranked at all: each is a claim
// on an asset whose token already trades (WBTC is Bitcoin, a canonical bridge is its chain), so there
// is no launch to price. The radar tracks the largest of them in a set-aside list the dashboard shows,
// with the reason, apart from the board.
//
// No protocol name is ever special-cased: the same function scores every row, and every number in it
// is derived from the snapshot the entry was handed.

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
  ratio_floor: number;
  ratio_cap: number;
  anchor_prior: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_base: number;
  maturity_range: number;
  maturity_tau_days: number;
  unknown_age_days: number;
  breadth_per_chain: number;
  breadth_max_extra_chains: number;
  set_aside_rows: number;
}

export const MODEL: ModelConstants = {
  ratio_floor: 0.01,
  ratio_cap: 5,
  anchor_prior: 4,
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_base: 0.78,
  maturity_range: 0.37,
  maturity_tau_days: 540,
  unknown_age_days: 365,
  breadth_per_chain: 0.025,
  breadth_max_extra_chains: 12,
  set_aside_rows: 24,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 30;

/** One category's learned anchor: how the snapshot's token-bearing protocols in it are priced. */
export interface CategoryAnchor {
  category: string;
  n: number;
  median_ratio: number;
  anchor: number;
}

/** The model's learned anchors and global centre, stated in the dashboard. */
export interface AnchorTable {
  global_ratio: number;
  usable: number;
  categories: CategoryAnchor[];
}

/** One row of board.json: the ranked board's row, with the model's working shown. */
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
  watchlist: boolean;
  implied_value_usd: number;
  model: {
    anchor_ratio: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** A pre-token record the board does not rank, and why: a wrapper or bridge of a traded asset. */
export interface SetAsideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  reason: string;
}

/** The dashboard's view of one board row: the board row itself, plan and flags included. */
export type RadarRow = BoardRow;

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  ratio: number | null;
}

/** Everything the dashboard needs: the board, the live set, the anchors and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  anchors: AnchorTable;
  counts: {
    protocols: number;
    pre_token: number;
    board_size: number;
    watchlist_size: number;
    early_size: number;
    set_aside_size: number;
    excluded_cex: number;
    excluded_named: number;
    live_size: number;
  };
  rows: RadarRow[];
  live: LiveRow[];
  set_aside: SetAsideRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The anchors: what a dollar of TVL is priced at, learned from the snapshot's own token-bearing
 * protocols. Ratios are winsorised so one mispriced microcap cannot move a category, and each
 * category's median is shrunk toward the global median by a prior of `anchor_prior` observations.
 */
export function learnAnchors(snapshot: Snapshot, model: ModelConstants = MODEL): AnchorTable {
  const usable = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ratioOf = (p: SnapshotProtocol): number =>
    Math.min(model.ratio_cap, Math.max(model.ratio_floor, p.mcap_usd! / p.tvl_usd));
  const global = median(usable.map(ratioOf));
  const byCategory = new Map<string, number[]>();
  for (const p of usable) {
    const key = p.category ?? '(uncategorised)';
    const list = byCategory.get(key) ?? [];
    list.push(ratioOf(p));
    byCategory.set(key, list);
  }
  const categories: CategoryAnchor[] = [...byCategory.entries()]
    .map(([category, ratios]) => {
      const med = median(ratios);
      return {
        category,
        n: ratios.length,
        median_ratio: round4(med),
        anchor: round4((ratios.length * med + model.anchor_prior * global) / (ratios.length + model.anchor_prior)),
      };
    })
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  return { global_ratio: round4(global), usable: usable.length, categories };
}

/** Categories whose product is a claim on another protocol's economics: bridges and staking wrappers. */
const DERIVATIVE_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whole words that mark a wrapped or staked product of another asset. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Names that begin with an exchange's name: the exchange's own product, not a launch candidate. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Why a pre-token protocol is kept off the early board, or null when it is a clean candidate. */
function exclusion(p: SnapshotProtocol): 'cex' | 'derivative' | 'named' | null {
  if (p.category === 'CEX') return 'cex';
  if (DERIVATIVE_CATEGORIES.has(p.category ?? '')) return 'derivative';
  if (VERSIONED.test(p.name) || WRAPPED_WORD.test(p.name) || EXCHANGE_PREFIX.test(p.name)) return 'named';
  return null;
}

/** The model's working on one protocol: its anchor and each multiplier, then the implied value. */
export function impliedValue(
  p: SnapshotProtocol,
  asOf: string,
  anchors: AnchorTable,
  model: ModelConstants = MODEL,
): { implied: number; anchor: number; momentumMult: number; maturityMult: number; breadthMult: number; age: number | null } {
  const age = ageDays(asOf, p.listed_at);
  const cat = anchors.categories.find((c) => c.category === (p.category ?? '(uncategorised)'));
  const anchor = cat ? cat.anchor : anchors.global_ratio;
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  const momentumMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_base + model.maturity_range * (1 - Math.exp(-Math.max(ageForModel, 0) / model.maturity_tau_days));
  const breadthMult = 1 + model.breadth_per_chain * Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_extra_chains);
  const implied = Math.max(1, Math.round(p.tvl_usd * anchor * momentumMult * maturityMult * breadthMult));
  return { implied, anchor, momentumMult, maturityMult, breadthMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/**
 * The protocols the board ranks, strongest first, with ranks 1..n: every watchlist slug and every
 * clean pre-token protocol below the floor. Derivative categories, CEX records and versioned or
 * wrapped names are not ranked: there is no launch of their own to price.
 */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const anchors = learnAnchors(snapshot, model);
  const index = bySlug(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (chosen.has(p.slug) || !isPreToken(p)) continue;
    if (exclusion(p) === null) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => ({ p, v: impliedValue(p, snapshot.as_of, anchors, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
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
    token_status: 'pre-token' as const,
    age_days: s.v.age,
    watchlist: watch.has(s.p.slug),
    implied_value_usd: s.v.implied,
    model: {
      anchor_ratio: s.v.anchor,
      momentum_multiplier: round4(s.v.momentumMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
    },
    farm_steps: farmSteps(s.p, s.v.age),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: { text: string; cost: string; time: string }): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** What a round trip of gas costs on a chain, in the plain ranges a farmer budgets with. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return '$15-30 of ETH gas at typical mainnet fees';
  if (chain === 'Solana' || chain === 'Bitcoin') return 'under $1 of network fees';
  if (['Base', 'Arbitrum', 'Optimism', 'Polygon', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'BSC', 'Avalanche'].includes(chain)) return '$1-3 of gas on a low-fee chain';
  return '$3-8 of gas';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 500;
  if (p.tvl_usd >= 250_000_000) return 250;
  if (p.tvl_usd >= 50_000_000) return 150;
  if (p.tvl_usd >= 10_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The playbook a category farms by: its core position and its weekly qualifying action. */
function playbook(p: SnapshotProtocol): { core: string; weekly: string } {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('yield aggregator') || c === 'yield')
    return {
      core: `Deposit the capital into the largest ${n} vault on the chain and keep the vault shares in the same wallet`,
      weekly: `Check the vault's allocation page, and move the position if ${n} opens a newer vault with the same mandate`,
    };
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return {
      core: `Supply the capital as collateral on ${n}, then borrow a stablecoin against it at under 50% of the borrowing limit and repay it in full`,
      weekly: `Repeat one supply-and-borrow cycle and check the position's health factor stays above 1.8`,
    };
  if (c.includes('dex') || c.includes('derivative'))
    return {
      core: `Add the capital as liquidity to ${n}'s deepest pool and make two swaps through the same interface`,
      weekly: `Make two swaps and rebalance the liquidity position if it drifts out of range`,
    };
  if (c.includes('rwa'))
    return {
      core: `Complete ${n}'s onboarding or KYC if it asks for one, then mint or buy its yield asset with the capital and hold it`,
      weekly: `Hold the asset and claim any distribution ${n} pays to holders that week`,
    };
  if (c.includes('staking') || c.includes('restak'))
    return {
      core: `Stake the capital in the chain's native asset through ${n} and keep the staking receipt in the same wallet`,
      weekly: `Claim and restake the week's rewards so the position compounds`,
    };
  if (c.includes('bridge'))
    return {
      core: `Bridge the capital through ${n} to the destination chain and use the bridged funds in one app there`,
      weekly: `Bridge a smaller amount on a second route and spend it in the destination ecosystem`,
    };
  if (c.includes('chain') || c.includes('payment'))
    return {
      core: `Hold the capital in the network's native asset in a wallet on ${n} and make real transfers and one native app transaction`,
      weekly: `Use one native application on the network and keep a balance history in the wallet`,
    };
  if (c.includes('basis') || c.includes('cede'))
    return {
      core: `Deposit the capital into ${n}'s basis or yield vault and keep the shares for the full funding cycle`,
      weekly: `Read the week's funding or yield report and leave the position untouched while it stays positive`,
    };
  if (c.includes('insurance'))
    return {
      core: `Stake the capital into ${n}'s cover pool, or buy one cover policy if staking is closed, and keep the position open`,
      weekly: `Check the cover pool's capacity page and renew or extend the position if it lapses`,
    };
  if (c.includes('stable'))
    return {
      core: `Mint ${n}'s stable asset with the capital, or deposit into its wrapper, and hold or pool the result`,
      weekly: `Make one mint, redemption or pool deposit so the wallet shows continuing use`,
    };
  return {
    core: `Deposit the capital into ${n}'s main product on the chain and keep the position open`,
    weekly: `Make one qualifying deposit, claim or governance action inside ${n}`,
  };
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time, built from the
 * protocol's own record — its category's playbook, its first chain's gas, a capital tier from its
 * TVL, a hold window from its age, and a caution when its TVL is falling fast.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasFor(chain);
  const book = playbook(p);
  const chg = p.change_7d;
  const momentumNote =
    chg !== null && chg <= -20
      ? `Its TVL fell ${Math.abs(Math.round(chg))}% in seven days: start with half the capital and add the rest only after two weekly checks show TVL stabilising.`
      : chg !== null && chg >= 20
        ? `Its TVL grew ${Math.round(chg)}% in seven days: farming will be crowded, so start this week rather than next and expect a smaller share.`
        : `Its seven-day TVL change is ${chg === null ? 'unreported' : `${Math.round(chg)}%`}: size the position at the standard tier and review it at each weekly check.`;
  const steps = [
    {
      text: `Create a fresh wallet for ${p.name} alone, back up its seed phrase offline, and label it with the protocol's name and the start date`,
      cost: 'nothing to create, and never reuse a wallet that holds other funds',
      time: '10 minutes',
    },
    {
      text: `Fund the wallet and move the capital to ${chain}${p.chains.length > 1 ? `, the first of the ${p.chains.length} chains ${p.name} runs on` : ''}, keeping a small extra balance for gas`,
      cost: `$${capital} of capital plus ${gas}`,
      time: '15 minutes',
    },
    {
      text: `${book.core}`,
      cost: `$${capital} in position plus ${gas}`,
      time: '20 minutes to set up',
    },
    {
      text: `${book.weekly}`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity spans more than one weekly snapshot. ${momentumNote}`,
      cost: `the $${capital} stays in the position for the hold`,
      time: `${hold} days`,
    },
    {
      text: `Each week, open ${p.name}'s own site and its official announcements and check for a points, rewards or snapshot notice; claim only from links the protocol itself publishes`,
      cost: 'nothing to check, and never pay a third party to claim',
      time: '10 minutes a week',
    },
    {
      text: `Keep a farm log of the wallet, every transaction hash, the dates and the running cost; when you exit, withdraw in one transaction, bridge back and record what the round cost in total`,
      cost: `${gas} to unwind`,
      time: '20 minutes to exit',
    },
  ];
  return steps.map(stepText);
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
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      ratio: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** The largest wrapper and bridge records, tracked but not ranked, each with its reason. */
export function setAsideRows(snapshot: Snapshot, model: ModelConstants = MODEL): SetAsideRow[] {
  return snapshot.protocols
    .filter((p) => isPreToken(p) && exclusion(p) === 'derivative')
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, model.set_aside_rows)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      reason: (p.category ?? '').includes('Bridge')
        ? 'A bridge: the value it moves belongs to the chains and assets it connects, whose tokens already trade.'
        : 'A staking or restaking product of an asset whose token already trades: its economics accrue to that token, not to a launch of its own.',
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const pre = snapshot.protocols.filter(isPreToken);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    anchors: learnAnchors(snapshot, model),
    counts: {
      protocols: snapshot.protocols.length,
      pre_token: pre.length,
      board_size: board.length,
      watchlist_size: snapshot.watchlist.length,
      early_size: board.filter((r) => !watch.has(r.slug)).length,
      set_aside_size: pre.filter((p) => exclusion(p) === 'derivative').length,
      excluded_cex: pre.filter((p) => exclusion(p) === 'cex').length,
      excluded_named: pre.filter((p) => exclusion(p) === 'named').length,
      live_size: live.length,
    },
    rows: board,
    live,
    set_aside: setAsideRows(snapshot, model),
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
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
