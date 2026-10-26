#!/usr/bin/env bun
// Bun provides Node-compatible fs/promises; node types are intentionally not required at runtime.
/// <reference types="bun" />
import { readFile as outputReadFile, readdir as outputReadDir } from 'node:fs/promises';
import { createHash as outputCreateHash } from 'node:crypto';
import { join as outputJoin } from 'node:path';
import { fileURLToPath as outputFileURLToPath } from 'node:url';

// Console presentation; no changes to provider requests or persisted data.
/** Presentation only: no requests, writes, filtering, or changes to updater state. */

const outputClean = (value: unknown): string => String(value ?? 'null').replace(/[\r\n\t]+/g, ' ');
/** Presentation only: per-fund retry and fallback notices are printed when VERBOSE is enabled. */
const outputVerbose = (): boolean => /^(1|true|yes|on)$/i.test((globalThis as any).process?.env?.VERBOSE ?? '');
function outputNote(message: string): void { if (outputVerbose()) console.warn(message); }
/** Names are the canonical environment knobs, not internal parser properties. */
function outputConfigEntries(config: Record<string, any>): [string, string][] {
  const values = new Map<string, string>();
  const aliases: Record<string, string> = {
    requestSleepSeconds: 'REQUEST_SLEEP', categories: 'CATEGORY',
    aumRange: 'AUM', terRange: 'TER', dividendYieldRange: 'DIVIDEND_YIELD', secYieldRange: 'SEC_YIELD',
    performanceRanges: 'PERFORMANCE', totalReturnRanges: 'TOTAL_RETURN',
    skipVanEck: 'SKIP_VANECK', skipProShares: 'SKIP_PROSHARES',
    skipWisdomTree: 'SKIP_WISDOMTREE', skipGoldmanSachs: 'SKIP_GOLDMANSACHS',
    skipGlobalX: 'SKIP_GLOBALX', skipNorthernTrust: 'SKIP_NORTHERNTRUST',
  };
  const range = (v: any): string => typeof v === 'string' ? v : v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    if (['proxyGapMs', 'fetchTimeoutMs', 'retryDelayMs'].includes(key)) continue;
    const name = aliases[key] ?? (/^[A-Z0-9_]+$/.test(key) ? key : key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase());
    if (name === 'PERFORMANCE' || name === 'TOTAL_RETURN') {
      for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y']) values.set(`${name}_${period}`, range(value?.[period]));
    } else if (['AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD'].includes(name)) {
      values.set(name, range(value));
    } else {
      values.set(name, value instanceof Set ? [...value].join(',') || 'all' : Array.isArray(value) ? value.join(',') || 'all' : outputClean(value));
    }
  }
  const first = ['MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY'];
  return [...values].sort(([a], [b]) => {
    const ai = first.indexOf(a), bi = first.indexOf(b);
    return (ai < 0 ? first.length : ai) - (bi < 0 ? first.length : bi) || a.localeCompare(b);
  });
}
function outputConfigValue(key: string, value: string): string {
  if (/TOKEN|PASSWORD|SECRET|COOKIE|SEC_UA/i.test(key)) return '<redacted>';
  if (key === 'TICKERS' && ['', 'null', 'undefined'].includes(value)) return 'all';
  return outputClean(value);
}
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${outputConfigValue(key, value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
    !['', ':', 'null', 'all'].includes(value));
}
function outputPrintFilter(selected: number, total: number, deferred = false): void {
  console.log(`[ filter   ] ${selected} of ${total} funds ${deferred ? 'selected for evaluation (data-dependent filters applied per fund)' : 'pass filters'}`);
}
function outputStable(value: any): any {
  if (Array.isArray(value)) return value.map(outputStable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().filter(key => !['generatedAt', 'catalogReadAt'].includes(key)).map(key => [key, outputStable(value[key])]));
  return value;
}
function outputContentKey(value: unknown): string { return JSON.stringify(outputStable(value)) ?? 'null'; }
async function outputInspectFund(root: URL | string, ticker: string): Promise<{ digest: string; meta: any }> {
  const dir = outputJoin(root instanceof URL ? outputFileURLToPath(root) : root, 'funds', ticker);
  const hash = outputCreateHash('sha256');
  async function visit(path: string): Promise<void> {
    const entries = await outputReadDir(path, { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory()) await visit(outputJoin(path, entry.name));
      else if (entry.name.endsWith('.json')) {
        const text = await outputReadFile(outputJoin(path, entry.name), 'utf8').catch(() => '');
        hash.update(outputJoin(path.slice(dir.length), entry.name));
        try { hash.update(outputContentKey(JSON.parse(text))); } catch { hash.update(text); }
      }
    }
  }
  await visit(dir);
  const meta = await outputReadFile(outputJoin(dir, 'meta.json'), 'utf8').then(JSON.parse).catch(() => ({}));
  return { digest: hash.digest('hex'), meta };
}
const outputCount = (value: any): unknown => typeof value === 'number' ? value : Array.isArray(value) ? value.length : value?.totalRows ?? value?.rows?.length ?? null;
const outputScalar = (value: any): any => value && typeof value === 'object' ? value.display ?? value.value ?? null : value;
const outputUnits: Record<string, number> = { K: 1e3, M: 1e6, B: 1e9, T: 1e12, THOUSAND: 1e3, MILLION: 1e6, BILLION: 1e9, TRILLION: 1e12 };
function outputMoney(value: any): string {
  const raw = value && typeof value === 'object' && typeof value.value === 'number' && Number.isFinite(value.value) ? value.value : outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)(K|M|B|T|Thousand|Million|Billion|Trillion)?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * (outputUnits[match[2]?.toUpperCase() ?? ''] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
}
/** Yields: rounded to 2 decimals without trailing zeros; placeholders are omitted like null. */
function outputPercent(value: any): unknown {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? Number(raw.toFixed(2)) : null;
  const text = String(raw).trim().replace(/%$/, '').trim();
  if (['', '-', '—', '--', 'n/a'].includes(text.toLowerCase())) return null;
  const number = Number(text.replace(/,/g, ''));
  return Number.isFinite(number) ? Number(number.toFixed(2)) : outputClean(raw);
}
function outputFundLine(index: number, total: number, ticker: string, status: string, data: any = {}, reason?: unknown): string {
  const width = Math.max(2, String(total).length);
  const metrics = data.metrics ?? {};
  // Presentation only. Keep valid zero/false values; omit unavailable fields.
  // outputMoney returns the string 'null' for an unavailable monetary value.
  const field = (key: string, value: unknown): string =>
    value === null || value === undefined || value === 'null' ? '' : `${key}=${outputClean(value)}`;
  const sources = [
    field('official', data.officialHistoryCount),
    field('yahoo', data.yahooHistoryCount),
  ].filter(part => part !== '').join(' ');
  const detail = [
    field('port', data.portId ?? data.portfolioId),
    field('history', outputCount(data.history ?? data.historyCount)),
    sources ? `(${sources})` : '',
    field('holdings', outputCount(data.holdings ?? data.holdingsCount)),
    field('divs', outputCount(data.worksheets?.Distributions ?? data.distributions)),
    field('netAssets', outputMoney(data.netAssets ?? data.aum)),
    field('total', outputMoney(data.totalFundNetAssets ?? data.totalNetAssets)),
    field('div', outputPercent(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputPercent(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  const tally = new Map<string, number>();
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      const final = status ?? (before.digest === after.digest ? 'unchanged' : 'updated');
      tally.set(final, (tally.get(final) ?? 0) + 1);
      console.log(outputFundLine(++completed, total, ticker, final, { ...after.meta, ...extra }, reason));
    },
    /** First [ done ] line: the statuses of every fund line this reporter printed. */
    summary(startedAt: number): string {
      const order = ['updated', 'unchanged', 'kept', 'skipped', 'failed'];
      const statuses = [...order, ...[...tally.keys()].filter(status => !order.includes(status))];
      return `[ done     ] ${completed} fund${completed === 1 ? '' : 's'}: ${statuses.map(status => `${tally.get(status) ?? 0} ${status}`).join(', ')} in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`;
    },
  };
}
/** Second [ done ] line: published totals. */
function outputCounts(funds: number, holdings: number, history: number): string {
  return `[ done     ] counts: ${funds.toLocaleString('en-US')} funds / ${holdings.toLocaleString('en-US')} holdings rows / ${history.toLocaleString('en-US')} history rows`;
}


// Goldman Sachs U.S.-listed ETF static data updater.
//
// The browser application is deliberately static. This script builds the feed
// under api/goldmansachs/** from public issuer/SEC/market-data sources:
//
//   catalog       Goldman Sachs Asset Management fund finder filtered to ETFs
//                 https://am.gs.com/en-us/individual/funds (48 ETFs), pinned
//                 by the checked-in universe seed in the universe seed in this file
//   fund page     https://am.gs.com/en-us/individual/funds/detail/PV<id>/<CUSIP>/<slug>
//                 (Quick Stats, Key Facts, Fees & Expenses, Pricing Table,
//                 Cumulative/Annualized/Quarterly returns, Rate, Distributions,
//                 Allocations top-10)
//   holdings      the All Holdings list of the fund page, read from the fund
//                 data API (daily, every position); SEC EDGAR Form N-PORT-P
//                 for the exact series only when that list is missing
//                 (EDGAR_FALLBACK, never older than the published holdings);
//                 the previous run is the last resort
//   distributions the Distributions table on the official fund page (Yahoo
//                 dividend events as the fallback)
//   history       Yahoo Finance's public chart endpoint (daily close, adjusted
//                 close, volume, dividends, splits)
//
// Since the October 2026 redesign the finder and the fund pages are client-rendered:
// their HTML carries no figures and the browser reads them from the public fund
// data API https://am.gs.com/services/funds (GraphQL, POST). The direct path asks
// that API the questions the pages ask (finder: ETF filter; fund: PV id + CUSIP
// from the page URL); the proxy fallback reads the rendered public page.
//
// Issuer requests are made directly with a browser-like User-Agent first; when
// the issuer answers a non-browser client with an error or a bot-wall page,
// the same public URL is read through the read-only r.jina.ai rendering proxy
// (identical to daggerok/Schwab). No user data or credentials are sent to
// the proxy. SEC and Yahoo requests stay direct.
//
// Usage: bun ./scripts/update-data.ts [--help]

import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { AsyncLocalStorage } from 'node:async_hooks';

// ---------------------------------------------------------------------------
// Universe seed (inlined from the former the universe seed in this file)
// ---------------------------------------------------------------------------

/**
 * Goldman Sachs ETF universe seed.
 *
 * Same role as `scripts/vaneck-funds.ts` in daggerok/VanEck and
 * `scripts/fidelity-funds.ts` in daggerok/Fidelity: a checked-in, reviewable
 * list of the funds the updater walks, so a refresh never silently changes the
 * universe and so the provider's own category vocabulary is preserved verbatim.
 *
 * Source of the catalog rows: the official **Goldman Sachs Asset Management
 * Fund Finder** (individual audience, ETF filter)
 * <https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100>,
 * which renders one card per ETF with the fund name, symbol, asset class, NAV,
 * average annual returns, distribution frequency and inception date, plus the
 * canonical detail-page URL
 * (`/funds/detail/PV<productId>/<CUSIP>/<slug>`).
 *
 * Verified live on 2026-09-21 against that finder:
 *   - the finder lists 48 ETFs: 31 Equity, 16 Fixed Income, 1 Commodities.
 *   - NAV column as of Sep 17, 2026; returns column as of Aug 31, 2026.
 *   - every Goldman Sachs ETF ticker is 3 or 4 characters long, which is what
 *     the pinned Ticker column width is sized from.
 *
 * `inceptionDate` is the finder's own inception date and never changes; live
 * fields (NAV, returns, AUM, expense ratio, yields) are refreshed from the
 * detail pages on every run.
 */

/** Provider asset-class headings, in the finder's own order and vocabulary. */
export const GOLDMAN_SACHS_CATEGORIES = [
  'EQUITY',
  'FIXED INCOME',
  'COMMODITIES',
] as const;

export type GoldmanSachsSeedFund = {
  /** Exchange ticker, e.g. 'GSLC'. */
  ticker: string;
  /** Fund name as printed by the finder. */
  name: string;
  /** Asset class as printed by the finder (verbatim provider vocabulary). */
  category: string;
  /** CUSIP as printed by the finder (link text of the CUSIP cell). */
  cusip: string;
  /** Canonical detail-page URL (finder card link). */
  fundPage: string;
  /** Inception date as printed by the finder ('Mon D, YYYY'). */
  inceptionDate: string;
};

/**
 * The 48-ETF universe, in finder order (alphabetical by fund name).
 * Finder read: 2026-09-21 (NAV as of Sep 17, 2026; returns as of Aug 31, 2026).
 */
export const GOLDMAN_SACHS_FUNDS: GoldmanSachsSeedFund[] = [
  // Fixed Income (16)
  {
    ticker: 'GEMD',
    name: 'Goldman Sachs Access Emerging Markets USD Bond ETF',
    category: 'FIXED INCOME',
    cusip: '381430388',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102979/381430388/goldman-sachs-access-emerging-markets-usd-bond-etf',
    inceptionDate: 'Feb 15, 2022',
  },
  {
    ticker: 'GHYB',
    name: 'Goldman Sachs Access High Yield Corporate Bond ETF',
    category: 'FIXED INCOME',
    cusip: '381430453',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102746/381430453/goldman-sachs-access-high-yield-corporate-bond-etf',
    inceptionDate: 'Sep 5, 2017',
  },
  {
    ticker: 'GTIP',
    name: 'Goldman Sachs Access Inflation Protected USD Bond ETF',
    category: 'FIXED INCOME',
    cusip: '381430362',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102998/381430362/goldman-sachs-access-inflation-protected-usd-bond-etf',
    inceptionDate: 'Oct 2, 2018',
  },
  {
    ticker: 'GIGB',
    name: 'Goldman Sachs Access Investment Grade Corporate Bond ETF',
    category: 'FIXED INCOME',
    cusip: '381430479',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102748/381430479/goldman-sachs-access-investment-grade-corporate-bond-etf',
    inceptionDate: 'Jun 6, 2017',
  },
  {
    ticker: 'GBIL',
    name: 'Goldman Sachs Access Treasury 0-1 Year ETF',
    category: 'FIXED INCOME',
    cusip: '381430529',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf',
    inceptionDate: 'Sep 6, 2016',
  },
  {
    ticker: 'GCOR',
    name: 'Goldman Sachs Access U.S. Aggregate Bond ETF',
    category: 'FIXED INCOME',
    cusip: '38149W101',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV103404/38149W101/goldman-sachs-access-u-s-aggregate-bond-etf',
    inceptionDate: 'Sep 8, 2020',
  },
  {
    ticker: 'GPRF',
    name: 'Goldman Sachs Access U.S. Preferred Stock and Hybrid Securities ETF',
    category: 'FIXED INCOME',
    cusip: '38149W127',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV105611/38149W127/goldman-sachs-access-u-s-preferred-stock-and-hybrid-securities-etf',
    inceptionDate: 'Jul 30, 2024',
  },
  // Equity (31)
  {
    ticker: 'GEM',
    name: 'Goldman Sachs ActiveBeta Emerging Markets Equity ETF',
    category: 'EQUITY',
    cusip: '381430206',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102391/381430206/goldman-sachs-active-beta-emerging-markets-equity-etf',
    inceptionDate: 'Sep 25, 2015',
  },
  {
    ticker: 'GSEU',
    name: 'Goldman Sachs ActiveBeta Europe Equity ETF',
    category: 'EQUITY',
    cusip: '381430305',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102392/381430305/goldman-sachs-active-beta-europe-equity-etf',
    inceptionDate: 'Mar 2, 2016',
  },
  {
    ticker: 'GSIE',
    name: 'Goldman Sachs ActiveBeta International Equity ETF',
    category: 'EQUITY',
    cusip: '381430107',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102390/381430107/goldman-sachs-active-beta-international-equity-etf',
    inceptionDate: 'Nov 6, 2015',
  },
  {
    ticker: 'GSJY',
    name: 'Goldman Sachs ActiveBeta Japan Equity ETF',
    category: 'EQUITY',
    cusip: '381430404',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102393/381430404/goldman-sachs-active-beta-japan-equity-etf',
    inceptionDate: 'Mar 2, 2016',
  },
  {
    ticker: 'GSLC',
    name: 'Goldman Sachs ActiveBeta U.S. Large Cap Equity ETF',
    category: 'EQUITY',
    cusip: '381430503',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102394/381430503/goldman-sachs-active-beta-u-s-large-cap-equity-etf',
    inceptionDate: 'Sep 17, 2015',
  },
  {
    ticker: 'GSSC',
    name: 'Goldman Sachs ActiveBeta U.S. Small Cap Equity ETF',
    category: 'EQUITY',
    cusip: '381430602',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102395/381430602/goldman-sachs-active-beta-u-s-small-cap-equity-etf',
    inceptionDate: 'Jun 28, 2017',
  },
  {
    ticker: 'GSWO',
    name: 'Goldman Sachs ActiveBeta World Equity ETF',
    category: 'EQUITY',
    cusip: '38149W739',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV104218/38149W739/goldman-sachs-active-beta-world-equity-etf',
    inceptionDate: 'Mar 15, 2022',
  },
  {
    ticker: 'GBND',
    name: 'Goldman Sachs Core Bond ETF',
    category: 'FIXED INCOME',
    cusip: '38149W473',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV109040/38149W473/goldman-sachs-core-bond-etf',
    inceptionDate: 'Jun 24, 2025',
  },
  {
    ticker: 'GCPB',
    name: 'Goldman Sachs Core Plus Bond ETF',
    category: 'FIXED INCOME',
    cusip: '38151N809',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV110568/38151N809/goldman-sachs-core-plus-bond-etf',
    inceptionDate: 'Nov 30, 2006',
  },
  {
    ticker: 'GIGL',
    name: 'Goldman Sachs Corporate Bond ETF',
    category: 'FIXED INCOME',
    cusip: '38149W465',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV109041/38149W465/goldman-sachs-corporate-bond-etf',
    inceptionDate: 'Jun 24, 2025',
  },
  {
    ticker: 'GEMQ',
    name: 'Goldman Sachs Data Enhanced Emerging Markets Equity ETF',
    category: 'EQUITY',
    cusip: '38149W390',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV110439/38149W390/goldman-sachs-data-enhanced-emerging-markets-equity-etf',
    inceptionDate: 'Sep 9, 2026',
  },
  {
    ticker: 'GIEQ',
    name: 'Goldman Sachs Data Enhanced International Equity ETF',
    category: 'EQUITY',
    cusip: '38149W382',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV110311/38149W382/goldman-sachs-data-enhanced-international-equity-etf',
    inceptionDate: 'May 19, 2026',
  },
  {
    ticker: 'GCAL',
    name: 'Goldman Sachs Dynamic California Municipal Income ETF',
    category: 'FIXED INCOME',
    cusip: '38149W564',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV105933/38149W564/goldman-sachs-dynamic-california-municipal-income-etf',
    inceptionDate: 'Jul 23, 2024',
  },
  {
    ticker: 'GMNY',
    name: 'Goldman Sachs Dynamic New York Municipal Income ETF',
    category: 'FIXED INCOME',
    cusip: '38149W556',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV105932/38149W556/goldman-sachs-dynamic-new-york-municipal-income-etf',
    inceptionDate: 'Jul 23, 2024',
  },
  {
    ticker: 'GUSE',
    name: 'Goldman Sachs Enhanced U.S. Equity ETF',
    category: 'EQUITY',
    cusip: '38149W424',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV109508/38149W424/goldman-sachs-enhanced-u-s-equity-etf',
    inceptionDate: 'Jan 31, 2008',
  },
  {
    ticker: 'GSEW',
    name: 'Goldman Sachs Equal Weight U.S. Large Cap Equity ETF',
    category: 'EQUITY',
    cusip: '381430438',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102787/381430438/goldman-sachs-equal-weight-u-s-large-cap-equity-etf',
    inceptionDate: 'Sep 12, 2017',
  },
  {
    ticker: 'GDOC',
    name: 'Goldman Sachs Future Health Care Equity ETF',
    category: 'EQUITY',
    cusip: '38149W770',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV103944/38149W770/goldman-sachs-future-health-care-equity-etf',
    inceptionDate: 'Nov 9, 2021',
  },
  {
    ticker: 'GTEK',
    name: 'Goldman Sachs Future Tech Leaders Equity ETF',
    category: 'EQUITY',
    cusip: '38149W812',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV103849/38149W812/goldman-sachs-future-tech-leaders-equity-etf',
    inceptionDate: 'Sep 14, 2021',
  },
  {
    ticker: 'GSGO',
    name: 'Goldman Sachs Growth Opportunities ETF',
    category: 'EQUITY',
    cusip: '38149W440',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV109510/38149W440/goldman-sachs-growth-opportunities-etf',
    inceptionDate: 'May 24, 1999',
  },
  {
    ticker: 'GVIP',
    name: 'Goldman Sachs Hedge Industry VIP ETF',
    category: 'EQUITY',
    cusip: '381430545',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102634/381430545/goldman-sachs-hedge-industry-vip-etf',
    inceptionDate: 'Nov 1, 2016',
  },
  {
    ticker: 'GINC',
    name: 'Goldman Sachs Income ETF',
    category: 'FIXED INCOME',
    cusip: '38151N882',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV110567/38151N882/goldman-sachs-income-etf',
    inceptionDate: 'Dec 3, 2019',
  },
  {
    ticker: 'GIND',
    name: 'Goldman Sachs India Equity ETF',
    category: 'EQUITY',
    cusip: '38149W481',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV106306/38149W481/goldman-sachs-india-equity-etf',
    inceptionDate: 'Apr 1, 2025',
  },
  {
    ticker: 'GINN',
    name: 'Goldman Sachs Innovate Equity ETF',
    category: 'EQUITY',
    cusip: '38149W820',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV103686/38149W820/goldman-sachs-innovate-equity-etf',
    inceptionDate: 'Nov 6, 2020',
  },
  {
    ticker: 'JUST',
    name: 'Goldman Sachs JUST U.S. Large Cap Equity ETF',
    category: 'EQUITY',
    cusip: '381430396',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102957/381430396/goldman-sachs-just-u-s-large-cap-equity-etf',
    inceptionDate: 'Jun 7, 2018',
  },
  {
    ticker: 'GSEE',
    name: 'Goldman Sachs MarketBeta Emerging Markets Equity ETF',
    category: 'EQUITY',
    cusip: '381430164',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV103363/381430164/goldman-sachs-market-beta-emerging-markets-equity-etf',
    inceptionDate: 'May 12, 2020',
  },
  {
    ticker: 'GSID',
    name: 'Goldman Sachs MarketBeta International Equity ETF',
    category: 'EQUITY',
    cusip: '381430180',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV103362/381430180/goldman-sachs-market-beta-international-equity-etf',
    inceptionDate: 'May 12, 2020',
  },
  {
    ticker: 'GGUS',
    name: 'Goldman Sachs MarketBeta Russell 1000 Growth Equity ETF',
    category: 'EQUITY',
    cusip: '38149W598',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV105434/38149W598/goldman-sachs-market-beta-russell-1000-growth-equity-etf',
    inceptionDate: 'Nov 28, 2023',
  },
  {
    ticker: 'GVUS',
    name: 'Goldman Sachs MarketBeta Russell 1000 Value Equity ETF',
    category: 'EQUITY',
    cusip: '38149W580',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV105433/38149W580/goldman-sachs-market-beta-russell-1000-value-equity-etf',
    inceptionDate: 'Nov 28, 2023',
  },
  {
    ticker: 'GXUS',
    name: 'Goldman Sachs MarketBeta Total International Equity ETF',
    category: 'EQUITY',
    cusip: '38150W206',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV104572/38150W206/goldman-sachs-market-beta-total-international-equity-etf',
    inceptionDate: 'May 31, 2023',
  },
  {
    ticker: 'GSUS',
    name: 'Goldman Sachs MarketBeta U.S. Equity ETF',
    category: 'EQUITY',
    cusip: '381430123',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV103365/381430123/goldman-sachs-market-beta-u-s-equity-etf',
    inceptionDate: 'May 12, 2020',
  },
  {
    ticker: 'GUSA',
    name: 'Goldman Sachs MarketBeta US 1000 Equity ETF',
    category: 'EQUITY',
    cusip: '38150W107',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV104276/38150W107/goldman-sachs-market-beta-us-1000-equity-etf',
    inceptionDate: 'Apr 5, 2022',
  },
  {
    ticker: 'GTPE',
    name: 'Goldman Sachs MSCI World Private Equity Return Tracker ETF',
    category: 'EQUITY',
    cusip: '38149W457',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV109407/38149W457/goldman-sachs-msci-world-private-equity-return-tracker-etf',
    inceptionDate: 'Oct 21, 2025',
  },
  {
    ticker: 'GMUB',
    name: 'Goldman Sachs Municipal Income ETF',
    category: 'FIXED INCOME',
    cusip: '38149W549',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV105934/38149W549/goldman-sachs-municipal-income-etf',
    inceptionDate: 'Jul 23, 2024',
  },
  {
    ticker: 'GPIQ',
    name: 'Goldman Sachs Nasdaq-100 Premium Income ETF',
    category: 'EQUITY',
    cusip: '38149W630',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV105259/38149W630/goldman-sachs-nasdaq-100-premium-income-etf',
    inceptionDate: 'Oct 24, 2023',
  },
  {
    ticker: 'AAAU',
    name: 'Goldman Sachs Physical Gold ETF',
    category: 'COMMODITIES',
    cusip: '38150K103',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV103623/38150K103/goldman-sachs-physical-gold-etf',
    inceptionDate: 'Jul 26, 2018',
  },
  {
    ticker: 'GPIX',
    name: 'Goldman Sachs S&P 500 Premium Income ETF',
    category: 'EQUITY',
    cusip: '38149W622',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV105258/38149W622/goldman-sachs-s-p-500-premium-income-etf',
    inceptionDate: 'Oct 24, 2023',
  },
  {
    ticker: 'GSC',
    name: 'Goldman Sachs Small Cap Equity ETF',
    category: 'EQUITY',
    cusip: '38149W614',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV105332/38149W614/goldman-sachs-small-cap-equity-etf',
    inceptionDate: 'Oct 3, 2023',
  },
  {
    ticker: 'GTOP',
    name: 'Goldman Sachs Technology Opportunities ETF',
    category: 'EQUITY',
    cusip: '38149W432',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV109507/38149W432/goldman-sachs-technology-opportunities-etf',
    inceptionDate: 'Oct 1, 1999',
  },
  {
    ticker: 'GSST',
    name: 'Goldman Sachs Ultra Short Bond ETF',
    category: 'FIXED INCOME',
    cusip: '381430230',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV103157/381430230/goldman-sachs-ultra-short-bond-etf',
    inceptionDate: 'Apr 15, 2019',
  },
  {
    ticker: 'GUMI',
    name: 'Goldman Sachs Ultra Short Municipal Income ETF',
    category: 'FIXED INCOME',
    cusip: '38149W572',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV105931/38149W572/goldman-sachs-ultra-short-municipal-income-etf',
    inceptionDate: 'Jul 23, 2024',
  },
  {
    ticker: 'GVLE',
    name: 'Goldman Sachs Value Opportunities ETF',
    category: 'EQUITY',
    cusip: '38149W416',
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV109509/38149W416/goldman-sachs-value-opportunities-etf',
    inceptionDate: 'Jul 31, 2015',
  },
];

// --- TLS trust store (identical in every ETF repo) ---
const SYSTEM_CA_MARKER = 'ETF_UPDATER_SYSTEM_CA';
const CERT_ERROR = /UNABLE_TO_GET_ISSUER_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT|CERT_HAS_EXPIRED|unable to get (?:local )?issuer certificate|self[- ]signed certificate|certificate has expired/i;

export function isCertError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown; cause?: unknown } | null;
  return CERT_ERROR.test(`${String(e?.code ?? '')} ${String(e?.message ?? '')}`) || (e?.cause ? isCertError(e.cause) : false);
}

export function systemCaActive(env: Record<string, string | undefined> = process.env, execArgv: string[] = process.execArgv): boolean {
  return execArgv.includes('--use-system-ca') || env.NODE_USE_SYSTEM_CA === '1' || env[SYSTEM_CA_MARKER] === '1';
}

export function reexecWithSystemCa(): never {
  const child = Bun.spawnSync([process.execPath, '--use-system-ca', ...process.argv.slice(1)], {
    env: { ...process.env, [SYSTEM_CA_MARKER]: '1' },
    stdio: ['inherit', 'inherit', 'inherit'],
  });
  process.exit(child.exitCode ?? 1);
}

/** mode: auto (restart once on an untrusted-certificate error), true (restart now), false (never). */
export function installSystemCa(mode: string, reexec: () => never = reexecWithSystemCa, active: boolean = systemCaActive()): void {
  if (mode === 'false' || active) return;
  if (mode === 'true') reexec();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    try { return await realFetch(...args); }
    catch (error) {
      if (!isCertError(error)) throw error;
      console.error('[ notice   ] TLS certificate not trusted; restarting once with --use-system-ca');
      return reexec();
    }
  }) as typeof fetch;
}

type JsonRecord = Record<string, any>;
type Range = { min?: number; max?: number };
type ReturnPeriod = 'YTD' | '1Y' | '3Y' | '5Y' | '10Y';
type RangeMap = Partial<Record<ReturnPeriod, Range>>;

const GS_SITE = 'https://am.gs.com';
const GS_CATALOG_URL = `${GS_SITE}/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100`;
/**
 * Fund data API behind the fund finder and the fund pages. Since the October 2026 redesign both pages are
 * client-rendered shells (a Next.js document whose HTML carries no fund figures); the browser reads every
 * value from this public GraphQL endpoint (POST, JSON). The direct path asks it the same questions the
 * pages ask; the r.jina.ai fallback still reads the rendered public page.
 */
const GS_FUNDS_API = `${GS_SITE}/services/funds`;
const GS_REQUEST_LOCALE = { country: 'us', language: 'en', audience: 'individual' } as const;
const GS_FINDER_QUERY = 'query getFundShareClasses($fundRequest: FundRequest) { fundShareClasses(fundRequest: $fundRequest) { funds { fundName fundType pvNumber shareClassId ticker marketingAssetClass distributionFrequency shareClassInceptionDate dailyPerformance { nav { asAtDate value } } monthlyPerformance { asAtDate annualisedReturns1yr annualisedReturns3yr annualisedReturns5yr annualisedReturns10yr annualisedReturnsSinceIncept } } } }';
const GS_DETAIL_QUERY = 'query getFundsDetail($fundDetailRequest: FundDetailRequest) { fundsDetail(fundDetailRequest: $fundDetailRequest) { fundName ticker cusip marketingAssetClass fundInceptionDate benchmark exchange navTicker intradayNavTicker quickStats { label asAtDate value currency suffix upDownValue upDownPctValue } feesAndExpenses { label asAtDate value suffix } pricingTable { label asAtDate value currency suffix } cumulativeReturnsAsAtDate cumulativeReturns annualizedReturnsAsAtDate annualizedReturns averageAnnualizedReturnsAsAtDate averageAnnualizedReturns quarterlyAnnualizedReturnsAsAtDate quarterlyAnnualizedReturns yield { label value asAtDate } distributions premiumsAndDiscount { asAtDate quarterInsights { id insights { label value } } } topHoldings { asAtDate data { series { name dataset { name y } } } } allHoldings { asAtDate holdings { coupon cusip holding isin marketValue maturityDate numberOfShares order portfolio sedol ticker } } } }';
const PROXY_PREFIX = 'https://r.jina.ai/';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SEC_SITE = 'https://www.sec.gov';
const SEC_FUND_TICKERS_URL = `${SEC_SITE}/files/company_tickers_mf.json`;
const SEC_COMPANY_TICKERS_URL = `${SEC_SITE}/files/company_tickers.json`;
const SEC_UA_DEFAULT = 'daggerok ETF feed daggerok@gmail.com';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PROXY_SLEEP_SECONDS = 3.2; // r.jina.ai anonymous tier is ~20 requests per minute

let API_ROOT = new URL('../api/goldmansachs/', import.meta.url);
let INDEX_FILE = new URL('index.json', API_ROOT);
let STATE_FILE = new URL('update-state.json', API_ROOT);
/** Tests point the updater at a throwaway output directory. */
export function setApiRootForTests(root: URL): void {
  API_ROOT = root;
  INDEX_FILE = new URL('index.json', API_ROOT);
  STATE_FILE = new URL('update-state.json', API_ROOT);
}

const HOLDINGS_HEADERS = ['Name', 'Ticker', 'Identifier', 'Weight', 'Market Value', 'Shares Held', 'Asset Category'];
const BOND_HOLDINGS_HEADERS = [...HOLDINGS_HEADERS, 'Coupon', 'Maturity'];
/** Columns the fund data API adds to the sheet (a superset: the shared columns keep their positions). */
const GS_HOLDINGS_EXTRA_HEADERS = ['ISIN', 'SEDOL'];
/** Funds whose holdings legitimately fail a holdingsGuard check (geared, futures, look-through, top-N lists): ticker, or '*' for every fund -> relaxed checks. */
export const HOLDINGS_GUARD_RELAX: Record<string, string[]> = {};
/** Funds the issuer closed, each confirmed from an SEC filing or the issuer notice (`source`): never fetched or guarded, last published data kept, index row marked closed. */
export const CLOSED_FUNDS: ClosedFund[] = [];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const TRUTHY = new Set(['1', 'true', 'yes', 'y', 'on']);
const AUM_BOUNDS = { nano: [0, 10_000_000], micro: [10_000_000, 300_000_000], small: [300_000_000, 2_000_000_000], mid: [2_000_000_000, 10_000_000_000], large: [10_000_000_000, undefined] } as const;
const KNOWN_ASSET_CLASSES = ['Equity', 'Fixed Income', 'Commodities'];

export type CatalogReturns = {
  ytd: number | null;
  yr1: number | null;
  yr3: number | null;
  yr5: number | null;
  yr10: number | null;
  sinceInception: number | null;
};

export type CatalogFund = {
  ticker: string;
  name: string;
  category: string;
  categoryPath: string;
  inception: string | null;
  exchange: string;
  cusip: string;
  isin: string;
  benchmark: string;
  ter: number | null;
  grossTer: number | null;
  nav: number | null;
  close: number | null;
  premiumDiscount: number | null;
  netAssets: number | null;
  dividendYield: number | null;
  secYield: number | null;
  asOfDate: string | null;
  /** Distribution Frequency column of the fund finder ('Monthly' | 'Quarterly' | 'Annually' | 'None'). */
  frequency: string;
  /** As-of date of the finder Average Annual Returns column (null for funds too young to have one). */
  returnsAsOf: string | null;
  returns: CatalogReturns;
  fundPage: string;
  source: 'goldman' | 'previous index' | 'seed';
};

export type ChartDay = { date: string; close: number; adjClose: number; volume: number };
export type ParsedChart = {
  days: ChartDay[];
  dividends: Array<{ epoch: number; amount: number }>;
  exchangeName: string;
  regularMarketPrice: number | null;
  regularMarketTime: number | null;
  firstTradeDate: number | null;
};

export type PriceReturns = {
  asOfDate: string;
  mo1: number | null;
  qtd: number | null;
  ytd: number | null;
  yr1: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
};

/** One row of the official performance table (NAV or Market Price basis). */
export type OfficialReturnRow = {
  asOfDate: string;
  mo1: number | null;
  mo3: number | null;
  ytd: number | null;
  yr1: number | null;
  cagr3y: number | null;
  cagr5y: number | null;
  cagr10y: number | null;
  siAnn: number | null;
};

export type OfficialReturns = {
  monthEnd: { nav: OfficialReturnRow | null; marketPrice: OfficialReturnRow | null };
  quarterEnd: { nav: OfficialReturnRow | null; marketPrice: OfficialReturnRow | null };
};

/** Full holdings list of the fund data API, already in sheet shape. */
export type GsHoldings = { asOfDate: string | null; headers: string[]; rows: JsonRecord[] };

/** Official top-10 holdings block of the Allocations tab. */
export type GsTopHoldings = {
  asOfDate: string | null;
  /** '35.85% of Total Portfolio' headline. */
  top10Pct: number | null;
  rows: Array<{ name: string; weight: number | null }>;
};

export type ProductPageSummary = {
  name: string | null;
  cusip: string;
  exchange: string;
  assetClass: string;
  benchmark: string;
  inception: string | null;
  nav: number | null;
  navChange: number | null;
  navChangePct: number | null;
  navAsOfDate: string | null;
  /** Total Fund Assets (Daily), in USD. */
  aumDaily: number | null;
  aumDailyAsOfDate: string | null;
  /** Total Fund Assets (Monthly), in USD. */
  aumMonthly: number | null;
  aumMonthlyAsOfDate: string | null;
  totalHoldings: number | null;
  /** LBMA Gold Price line (AAAU only). */
  lbmaGoldPrice: number | null;
  lbmaGoldPriceAsOfDate: string | null;
  netExpenseRatio: number | null;
  grossExpenseRatio: number | null;
  marketPrice: number | null;
  marketPrice52wkRange: string;
  premiumDiscount: number | null;
  pricingAsOfDate: string | null;
  bidAsk: number | null;
  bidAskSpread30d: number | null;
  premiumDays: number | null;
  atNavDays: number | null;
  discountDays: number | null;
  /** 12 Month Trailing Distribution Rate (percent units). */
  distRate12M: number | null;
  /** Standardized 30-Day Subsidized Yield (percent units). */
  secYieldSubsidized: number | null;
  /** Standardized 30-Day Unsubsidized Yield (percent units). */
  secYieldUnsubsidized: number | null;
  yieldsAsOfDate: string | null;
  navTicker: string;
  iopvTicker: string;
  /** Distributions table, ascending by ex-date, deduplicated. */
  distributions: Distribution[];
  topHoldings: GsTopHoldings | null;
  /** Full daily holdings list of the fund data API (direct path only; null when the answer carries none). */
  allHoldings: GsHoldings | null;
  officialReturns: OfficialReturns;
  /** Which sections of the page are present at all (a heading or labelled value), whether or not their values parsed. */
  sections: PageSections;
  /** True only when the pricing table AND the performance (returns) tables are present: such a page has loaded fully. */
  loadedFully: boolean;
};

export type PageSections = { pricing: boolean; yields: boolean; returns: boolean; distributions: boolean; topHoldings: boolean };
const NO_SECTIONS: PageSections = { pricing: false, yields: false, returns: false, distributions: false, topHoldings: false };

export type Distribution = { epoch: number; amount: number };


type UpdaterConfig = {
  maxFetches: number;
  requestSleep: number;
  aum?: Range;
  ter?: Range;
  dividendYield?: Range;
  secYield?: Range;
  performance: RangeMap;
  totalReturn: RangeMap;
  concurrency: number;
  holdingsPageSize: number;
  historyPageSize: number;
  storeRawDownloads: boolean;
  maxRetries: number;
  tickers: Set<string> | null;
  historyRange: string;
  edgarFallback: boolean;
  skipGoldmanSachs: boolean;
  skipYahoo: boolean;
  secUa: string;
};

const EMPTY_RETURNS: CatalogReturns = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
const EMPTY_PRICE_RETURNS: PriceReturns = { asOfDate: '', mo1: null, qtd: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null };

/** One pacing lane per fund worker (see paceRequests); the r.jina.ai proxy shares one global gate. */
let requestLanes: Record<number, number> = {};
let proxyGateAt = 0;
const laneStore = new AsyncLocalStorage<number>();
let requestSleepSeconds = 1.5;
let secUserAgent = SEC_UA_DEFAULT;
/** One run's SEC state: the two SEC ticker tables (each loaded once) and the N-PORT reader cache (submissions and documents). */
let secState: { funds: Promise<Map<string, NportSeriesRef>> | null; names: Promise<Map<string, string>> | null; reader: Map<string, unknown> } = { funds: null, names: null, reader: new Map() };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function decodeEntities(value: string): string {
  return String(value ?? '')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;|&#x27;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&ndash;|&mdash;/gi, '-')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&reg;/gi, '®')
    .replace(/&trade;/gi, '™')
    .replace(/&copy;/gi, '©')
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(parseInt(code, 16)));
}

function cleanText(value: unknown): string {
  return decodeEntities(String(value ?? ''))
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizeTicker(value: unknown): string {
  return cleanText(value).replace(/[^A-Za-z0-9.-]/g, '').toUpperCase();
}

export function numberOrNull(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const raw = cleanText(value);
  if (!raw || ['-', '--', '—', 'n/a', 'na', 'null', 'none'].includes(raw.toLowerCase())) return null;
  const negative = /^\(.*\)$/.test(raw);
  const normalized = raw.replace(/[($,%\s]/g, '').replace(/[)]/g, '').replace(/,/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

/**
 * First number-looking token of a free-text cell, ignoring date tokens
 * ("09/18/2026 | $23.88" -> 23.88, "3.25% As of 09/17/2026" -> 3.25).
 */
export function firstNumber(value: unknown): number | null {
  const raw = cleanText(value).replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, ' ').replace(/\d{4}-\d{2}-\d{2}/g, ' ');
  const match = /(\(?[-+]?\$?\d[\d,]*(?:\.\d+)?%?\)?)/.exec(raw);
  return match ? numberOrNull(match[1]) : null;
}

/** First US or ISO date token of a free-text cell. */
export function firstDate(value: unknown): string | null {
  const raw = cleanText(value);
  const match = /(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{2}-\d{2})/.exec(raw);
  return match ? toIsoDate(match[1]) : null;
}

export function toIsoDate(value: unknown): string {
  const raw = cleanText(value);
  if (!raw) return '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const us = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(raw);
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  const short = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2})$/.exec(raw);
  if (short) {
    const yy = Number(short[3]);
    return `${yy <= 69 ? 2000 + yy : 1900 + yy}-${short[1].padStart(2, '0')}-${short[2].padStart(2, '0')}`;
  }
  // Month-name and other calendar dates: pure text, the same day in every time zone (shared calendar-dates block)
  return calendarIso(raw) ?? (monthDateToIso(raw) || raw);
}

/**
 * Month-name dates as Goldman Sachs prints them ('Sep 17, 2026', 'August 31,
 * 2026') -> ISO. Used for label as-of dates and inception dates; the
 * Distributions table itself uses numeric MM/DD/YYYY (see firstDate).
 */
export function monthDateToIso(value: unknown): string {
  const raw = cleanText(value);
  const match = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+(\d{4})\b/i.exec(raw);
  if (!match) return '';
  const month = MONTHS.findIndex((name) => name.toLowerCase() === match[1].slice(0, 3).toLowerCase());
  if (month < 0) return '';
  return `${match[3]}-${String(month + 1).padStart(2, '0')}-${String(Number(match[2])).padStart(2, '0')}`;
}

function formatDate(value: string | null | undefined): string {
  const iso = toIsoDate(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso || '—';
  return `${MONTHS[Number(match[2]) - 1]} ${match[3].padStart(2, '0')} ${match[1]}`;
}

function formatUsDate(epoch: number): string {
  const date = new Date(epoch * 1000);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`;
}

function isoToEpoch(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 1000);
}

function formatAumDisplay(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 1e12) return `$${(value / 1e12).toFixed(2)} T`;
  if (Math.abs(value) >= 1e9) return `$${(value / 1e9).toFixed(2)} B`;
  if (Math.abs(value) >= 1e6) return `$${(value / 1e6).toFixed(2)} M`;
  if (Math.abs(value) >= 1e3) return `$${(value / 1e3).toFixed(2)} K`;
  return `$${value.toFixed(2)}`;
}

function parseBoolean(value: string | undefined): boolean {
  return TRUTHY.has(String(value ?? '').trim().toLowerCase());
}

/** Strict: a blank value is the default, anything else must be a nonnegative integer (never a silent fallback). */
function parsePositiveInt(value: string | undefined, fallback: number, name = 'value'): number {
  if (value === undefined || value.trim() === '') return fallback;
  if (!/^\d+$/.test(value.trim()) || !Number.isSafeInteger(Number(value))) throw new Error(`${name}: expected a nonnegative integer, got "${value}"`);
  return Number(value);
}

function parseDecimal(value: string | undefined, fallback: number, name = 'value'): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${name}: expected nonnegative seconds, got "${value}"`);
  return parsed;
}

/** HISTORY_RANGE: `max` (all history) or `Ny` (the last N whole years, N >= 1). */
export function parseHistoryRange(value: string | undefined): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return 'max';
  if (raw === 'max') return raw;
  const match = /^(\d+)y$/.exec(raw);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 100) throw new Error(`HISTORY_RANGE: expected max or Ny (for example 5y), got "${value}"`);
  return `${Number(match[1])}y`;
}

/**
 * Yahoo query for the history window. period1/period2 are explicit because
 * Yahoo ignores `range` whenever `period1` is present (period1=0 meant "all
 * history" for every HISTORY_RANGE).
 */
export function yahooChartQuery(historyRange: string, nowMs = Date.now()): URLSearchParams {
  const range = parseHistoryRange(historyRange);
  const now = new Date(nowMs);
  const years = range === 'max' ? 0 : Number(range.slice(0, -1));
  const period1 = range === 'max' ? 0 : Math.floor(Date.UTC(now.getUTCFullYear() - years, now.getUTCMonth(), now.getUTCDate()) / 1000);
  return new URLSearchParams({ period1: String(period1), period2: String(Math.floor(nowMs / 1000) + 86_400), interval: '1d', events: 'div|split', includeAdjustedClose: 'true' });
}

export function parseRange(value: string, name = 'range'): Range | undefined {
  const raw = String(value ?? '').trim();
  if (!raw || raw === ':') return undefined;
  if ((raw.match(/:/g) || []).length !== 1) throw new Error(`${name}: colon is required exactly once (use min:max)`);
  const [left, right] = raw.split(':').map((part) => part.trim().replace(/[$%]/g, ''));
  const min = left === '' ? undefined : Number(left);
  const max = right === '' ? undefined : Number(right);
  if ((min !== undefined && !Number.isFinite(min)) || (max !== undefined && !Number.isFinite(max))) throw new Error(`${name}: bounds must be numbers`);
  if (min !== undefined && max !== undefined && min > max) throw new Error(`${name}: minimum must not exceed maximum`);
  return { min, max };
}

function parseAumBound(value: string): number | undefined {
  const raw = value.trim().toLowerCase();
  if (!raw) return undefined;
  if (raw in AUM_BOUNDS) return AUM_BOUNDS[raw as keyof typeof AUM_BOUNDS][0];
  const match = /^\$?([0-9]+(?:\.[0-9]+)?)([kmbt]?)$/i.exec(raw);
  if (!match) throw new Error(`AUM: invalid bound "${value}"`);
  const multiplier: Record<string, number> = { '': 1, k: 1e3, m: 1e6, b: 1e9, t: 1e12 };
  return Number(match[1]) * multiplier[match[2].toLowerCase()];
}

export function parseAumRange(value: string): Range | undefined {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw || raw === ':') return undefined;
  if (!raw.includes(':') && raw in AUM_BOUNDS) {
    const [min, max] = AUM_BOUNDS[raw as keyof typeof AUM_BOUNDS];
    return { min, max };
  }
  if ((raw.match(/:/g) || []).length !== 1) throw new Error('AUM: colon is required exactly once (or use a size preset)');
  const [left, right] = raw.split(':');
  const min = left ? parseAumBound(left) : undefined;
  let max = right ? parseAumBound(right) : undefined;
  // Presets on the right are exclusive upper bounds; the UI contract uses the
  // same convention as iShares/SPDR/Fidelity.
  if (right && right in AUM_BOUNDS) max = AUM_BOUNDS[right as keyof typeof AUM_BOUNDS][1];
  if (min !== undefined && max !== undefined && min > max) throw new Error('AUM: minimum must not exceed maximum');
  return { min, max };
}

export function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const result: RangeMap = {};
  for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y'] as ReturnPeriod[]) {
    const value = env[`${prefix}_${period}`];
    if (value !== undefined && value.trim() !== '') {
      const parsed = parseRange(value, `${prefix}_${period}`);
      if (parsed && (parsed.min !== undefined || parsed.max !== undefined)) result[period] = parsed;
    }
  }
  return result;
}

function readTickerSet(value: string | undefined): Set<string> | null {
  const tokens = String(value ?? '').split(/[\s,;]+/).map((token) => token.trim()).filter(Boolean);
  const bad = tokens.filter((token) => !/^[A-Za-z0-9][A-Za-z0-9.-]{0,9}$/.test(token));
  if (bad.length) throw new Error(`TICKERS: not a ticker: ${bad.join(', ')}`);
  const tickers = tokens.map(sanitizeTicker);
  return tickers.length ? new Set(tickers) : null;
}

function requireMin(value: number, min: number, name: string): number {
  if (value < min) throw new Error(`${name}: expected integer >= ${min}`);
  return value;
}

export function readConfig(env: Record<string, string | undefined> = process.env): UpdaterConfig {
  return {
    maxFetches: parsePositiveInt(env.MAX_FETCHES, 0, 'MAX_FETCHES'),
    requestSleep: parseDecimal(env.REQUEST_SLEEP, 1.5, 'REQUEST_SLEEP'),
    aum: parseAumRange(env.AUM ?? ':'),
    ter: parseRange(env.TER ?? ':', 'TER'),
    dividendYield: parseRange(env.DIVIDEND_YIELD ?? ':', 'DIVIDEND_YIELD'),
    secYield: parseRange(env.SEC_YIELD ?? ':', 'SEC_YIELD'),
    performance: parseRanges(env, 'PERFORMANCE'),
    totalReturn: parseRanges(env, 'TOTAL_RETURN'),
    concurrency: requireMin(parsePositiveInt(env.CONCURRENCY, 3, 'CONCURRENCY'), 1, 'CONCURRENCY'),
    holdingsPageSize: requireMin(parsePositiveInt(env.HOLDINGS_PAGE_SIZE, 250, 'HOLDINGS_PAGE_SIZE'), 1, 'HOLDINGS_PAGE_SIZE'),
    historyPageSize: requireMin(parsePositiveInt(env.HISTORY_PAGE_SIZE, 1000, 'HISTORY_PAGE_SIZE'), 1, 'HISTORY_PAGE_SIZE'),
    storeRawDownloads: parseBoolean(env.STORE_RAW_DOWNLOADS),
    maxRetries: requireMin(parsePositiveInt(env.MAX_RETRIES, 2, 'MAX_RETRIES'), 1, 'MAX_RETRIES'),
    tickers: readTickerSet(env.TICKERS),
    historyRange: parseHistoryRange(env.HISTORY_RANGE),
    edgarFallback: !['0', 'false', 'off', 'no', 'n'].includes(String(env.EDGAR_FALLBACK ?? '1').toLowerCase()),
    skipGoldmanSachs: parseBoolean(env.SKIP_GOLDMANSACHS),
    skipYahoo: parseBoolean(env.SKIP_YAHOO),
    secUa: env.SEC_UA?.trim() || SEC_UA_DEFAULT,
  };
}

function rangeMatches(value: number | null | undefined, range?: Range): boolean {
  if (!range) return true;
  if (value === null || value === undefined || !Number.isFinite(value)) return false;
  return (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max);
}

function annualizedToTotal(value: number | null | undefined, years: number): number | null {
  if (value === null || value === undefined || !Number.isFinite(value) || years <= 0) return null;
  return round(((1 + value / 100) ** years - 1) * 100, 2);
}

export { annualizedToTotal };

// ---------------------------------------------------------------------------
// Text normalization: HTML and r.jina.ai markdown -> the same line/cell model
// ---------------------------------------------------------------------------

function absoluteUrl(href: string, base = GS_SITE): string {
  const raw = cleanText(href);
  if (!raw || raw.startsWith('#') || raw.startsWith('javascript:')) return '';
  try {
    return new URL(raw, base).toString();
  } catch {
    return '';
  }
}

/**
 * Turns an HTML document into the same shape r.jina.ai produces: one text line
 * per block, table cells separated by pipes, anchors as `[label](url)`. Every
 * parser below works on this normalized text, so the direct HTML page and the
 * proxied markdown rendering are handled by one code path.
 */
export function htmlToText(html: string): string {
  let text = String(html ?? '');
  if (!/<[a-z][\s\S]*>/i.test(text)) return text;
  text = text.replace(/<!--[\s\S]*?-->/g, ' ');
  text = text.replace(/<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ');
  text = text.replace(/<br\s*\/?>/gi, ' ');
  text = text.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi, (_match, attrs: string, inner: string) => {
    const href = /href\s*=\s*"([^"]*)"|href\s*=\s*'([^']*)'/i.exec(attrs);
    const label = cleanText(inner.replace(/<[^>]+>/g, ' '));
    const url = href ? absoluteUrl(href[1] ?? href[2] ?? '') : '';
    return url && label ? ` [${label}](${url}) ` : ` ${label} `;
  });
  text = text.replace(/<title\b[^>]*>([\s\S]*?)<\/title>/i, (_match, inner: string) => `\nTitle: ${cleanText(inner)}\n`);
  text = text.replace(/<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag, inner: string) => `\n### ${cleanText(inner.replace(/<[^>]+>/g, ' '))}\n`);
  text = text.replace(/<tr\b[^>]*>/gi, '\n| ');
  text = text.replace(/<\/(td|th)>/gi, ' | ');
  text = text.replace(/<\/(tr|p|div|li|table|thead|tbody|section|article|ul|ol|dt|dd|header|footer|label|option|button|caption|figcaption)>/gi, '\n');
  text = text.replace(/<(p|div|li|table|section|article|ul|ol|dt|dd|header|footer|label|caption|figcaption)\b[^>]*>/gi, '\n');
  text = text.replace(/<[^>]+>/g, ' ');
  text = decodeEntities(text);
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Strips the r.jina.ai preamble ("Title:", "URL Source:", "Markdown Content:"). */
export function stripProxyPreamble(text: string): string {
  const source = String(text ?? '');
  const marker = /^Markdown Content:\s*\n/m.exec(source);
  return marker ? source.slice(marker.index + marker[0].length) : source;
}

export type TextLine = { text: string; cells: string[] };

function stripMarkdown(value: string): string {
  return cleanText(
    String(value ?? '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\*\*|__|`/g, '')
      .replace(/^\s*(?:#{1,6}\s+|[*+-]\s+|\d+\.\s+)+/, ''),
  );
}

/** Splits normalized text into lines with their pipe-separated, markdown-free cells. */
export function toTextLines(text: string): TextLine[] {
  const lines: TextLine[] = [];
  for (const raw of String(text ?? '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\|?\s*(?:-{2,}\s*\|\s*)+-{0,}\s*\|?$/.test(line)) continue; // markdown table separator
    const split = line.split('|').map((cell) => stripMarkdown(cell));
    if (split.length > 1 && !split[0]) split.shift();
    if (split.length > 1 && !split[split.length - 1]) split.pop();
    // Placeholder cells ('-', '--') keep their position so tenor and
    // distribution columns never shift; only the pipe ends are trimmed.
    const cells = split.length > 1 ? split : split.filter(Boolean);
    lines.push({ text: stripMarkdown(line.replace(/\|/g, ' ')), cells });
  }
  return lines;
}

function normalizeLabel(value: string): string {
  return cleanText(value).replace(/[:：]+$/, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Finds a labelled value in the line model. Handles the three renderings seen
 * on am.gs.com: a table row (`| Label | | value |`), a heading followed by a
 * value line, and a `Label value` single line. Goldman Sachs glues the as-of
 * date to the label ('Net Asset Valueas of Sep 17, 2026'), so the matcher also
 * accepts the `as of` suffix without a separating space.
 */
export function lookupLabel(lines: TextLine[], label: string | RegExp, opts: { text?: boolean } = {}): { value: string; labelText: string } | null {
  const matcher = (cell: string): boolean => {
    const normalized = normalizeLabel(cell);
    if (label instanceof RegExp) return label.test(cell);
    const wanted = normalizeLabel(label);
    const glued = (base: string): boolean => normalized.startsWith(`${base} (as of`) || normalized.startsWith(`${base} as of`) || normalized.startsWith(`${base}as of`);
    return normalized === wanted || normalized === `${wanted}s` || glued(wanted) || glued(`${wanted}s`);
  };
  for (let index = 0; index < lines.length; index += 1) {
    const { cells } = lines[index];
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex += 1) {
      if (!matcher(cells[cellIndex])) continue;
      const rest = cells.slice(cellIndex + 1).filter((cell) => cell && !/^fund data$/i.test(cell));
      if (rest.length) return { value: rest.join(' | '), labelText: cells[cellIndex] };
      const next = lines[index + 1];
      if (next && next.cells.length && /^fund data\b/i.test(next.text)) {
        return { value: cleanText(next.text.replace(/^fund data\b/i, '')), labelText: cells[cellIndex] };
      }
      // Trailing currency/unit tokens ('99.98USD', '7,877.70MMUSD') are not
      // part of the letter-ending check: they mark values, not labels.
      const probe = next ? next.text.replace(/\s*(MMUSD|USD|MM|%)$/i, '') : '';
      if (next && next.cells.length === 1 && !/[a-z]{3,}\s*\(?[a-z]*\)?$/i.test(probe) && /\d/.test(probe)) {
        return { value: next.text, labelText: cells[cellIndex] };
      }
      // Text-valued labels (Exchange, Asset Class, benchmark, NAV tickers):
      // the value sits on the next line verbatim. A following as-of label is
      // never a value; other bare labels are trusted to always carry values.
      if (opts.text && next && next.cells.length === 1 && next.text && !/as of/i.test(next.text)) {
        return { value: next.text, labelText: cells[cellIndex] };
      }
      return { value: '', labelText: cells[cellIndex] };
    }
  }
  return null;
}

function labelAsOf(found: { value: string; labelText: string } | null): string | null {
  if (!found) return null;
  return firstDate(found.labelText) || firstDate(found.value) || monthDateToIso(found.labelText) || monthDateToIso(found.value) || null;
}

function labelNumber(found: { value: string; labelText: string } | null): number | null {
  return found ? firstNumber(found.value) : null;
}

function labelText(found: { value: string; labelText: string } | null): string {
  if (!found) return '';
  return cleanText(found.value.split('|')[0]);
}

function linkUrls(source: string, pattern: RegExp): string[] {
  const urls = new Set<string>();
  for (const match of String(source ?? '').matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)) if (pattern.test(match[1])) urls.add(decodeEntities(match[1]));
  for (const match of String(source ?? '').matchAll(/href\s*=\s*"([^"]+)"/gi)) {
    const url = absoluteUrl(match[1]);
    if (url && pattern.test(url)) urls.add(url);
  }
  return [...urls];
}

// ---------------------------------------------------------------------------
// Catalog: fund finder (ETFs)
// ---------------------------------------------------------------------------

function canonicalGsFundPage(raw: string, ticker: string): string {
  const absolute = absoluteUrl(raw);
  if (/\/funds\/detail\/PV\d+\//i.test(absolute)) return absolute;
  return GOLDMAN_SACHS_FUNDS.find((seed) => seed.ticker === ticker.toUpperCase())?.fundPage || absolute;
}

function normalizeCategory(value: string): string {
  const raw = cleanText(value).replace(/\s*\/\s*$/, '');
  const known = KNOWN_ASSET_CLASSES.find((item) => item.toLowerCase() === raw.toLowerCase());
  return known || raw || 'ETF';
}

const FINDER_CARD_LINK = /\[([^\]]+?)\]\((https?:\/\/[^)\s]*\/funds\/detail\/(PV\d+)\/([A-Za-z0-9]{9})\/([^)\s]*))\)?/g;

/**
 * Parses the fund finder (HTML or proxied markdown). Each fund appears as a
 * card: an H2 `[Fund Name](https://…/funds/detail/PV<id>/<CUSIP>/<slug>)`
 * link, a ticker line, an asset-class line and a one-row performance table
 * (`[CUSIP](…)` | Symbol | NAV | 1Yr | 3Yr | 5Yr | 10Yr | Inception+date |
 * Frequency | Documents). The finder prints no expense ratios or AUM, so
 * those stay null until the fund-page pass.
 */
/**
 * Normalizes markdown links for card parsing. The rendering proxy usually
 * emits absolute inline links, but some renders use site-relative URLs or
 * reference-style links (`[name][id]` + `[id]: url`); both hide cards from
 * the link pattern, so relatives are absolutized and references inlined.
 * Unknown references and protocol-relative URLs are left untouched.
 */
export function normalizeMarkdownLinks(text: string, base = 'https://am.gs.com'): string {
  const refs = new Map<string, string>();
  for (const match of String(text ?? '').matchAll(/^\s*\[([^\]]+)\]:\s*(\S+)/gm)) refs.set(match[1], match[2]);
  let out = String(text ?? '');
  if (refs.size) out = out.replace(/\[([^\]]+)\]\[([^\]]+)\]/g, (full, label, id) => (refs.has(id) ? `[${label}](${refs.get(id)})` : full));
  return out.replace(/(\[[^\]]*\]\()\/(?!\/)([^)\s]*)\)/g, `$1${base}/$2)`);
}

/**
 * Fund data API finder answer (`fundShareClasses.funds`) -> catalog rows with the same fields the
 * finder cards print: NAV + date (dailyPerformance), the Average Annual Returns column + date
 * (monthlyPerformance), distribution frequency and inception date. The CUSIP is the share-class id.
 * The API carries no page URL: the seed URL is used for a known ticker, otherwise the URL is built
 * from the ids the fund page route needs (/detail/PV<id>/<CUSIP>/<slug>).
 */
export function parseCatalogFunds(rows: unknown): CatalogFund[] {
  const funds = new Map<string, CatalogFund>();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row !== 'object' || row.fundType !== 'ETF') continue;
    const ticker = sanitizeTicker(row.ticker);
    const pv = cleanText(row.pvNumber).toUpperCase();
    const cusip = cleanText(row.shareClassId).toUpperCase();
    const name = cleanText(row.fundName);
    if (!ticker || !/^PV\d+$/.test(pv) || !/^[A-Z0-9]{9}$/.test(cusip) || !name) continue;
    const seed = GOLDMAN_SACHS_FUNDS.find((item) => item.ticker === ticker && item.fundPage.includes(`/detail/${pv}/${cusip}/`));
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const nav = row.dailyPerformance?.nav;
    const monthly = row.monthlyPerformance || {};
    const returns: CatalogReturns = {
      ...EMPTY_RETURNS,
      yr1: numberOrNull(monthly.annualisedReturns1yr),
      yr3: numberOrNull(monthly.annualisedReturns3yr),
      yr5: numberOrNull(monthly.annualisedReturns5yr),
      yr10: numberOrNull(monthly.annualisedReturns10yr),
      sinceInception: numberOrNull(monthly.annualisedReturnsSinceIncept),
    };
    const hasReturns = Object.values(returns).some((value) => value !== null);
    const category = row.marketingAssetClass ? normalizeCategory(cleanText(row.marketingAssetClass)) : 'ETF';
    funds.set(ticker, {
      ticker,
      name,
      category,
      categoryPath: category === 'ETF' ? '' : category,
      inception: apiDate(row.shareClassInceptionDate),
      exchange: '',
      cusip,
      isin: '',
      benchmark: '',
      ter: null,
      grossTer: null,
      nav: numberOrNull(nav?.value),
      close: null,
      premiumDiscount: null,
      netAssets: null,
      dividendYield: null,
      secYield: null,
      asOfDate: apiDate(nav?.asAtDate),
      frequency: cleanText(row.distributionFrequency),
      // The finder prints '--' as the returns date of a fund too young to have returns.
      returnsAsOf: hasReturns ? apiDate(monthly.asAtDate) : null,
      returns,
      fundPage: seed?.fundPage || `${GS_SITE}/en-us/individual/funds/detail/${pv}/${cusip}/${slug}`,
      source: 'goldman',
    });
  }
  if (!funds.size) throw new Error('Goldman Sachs fund finder: no ETF rows found');
  return [...funds.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export function parseCatalogText(text: string): CatalogFund[] {
  // Direct path: the fund data API answer (JSON); fallback path: the rendered finder (HTML or proxy markdown).
  const api = gsApiData(text)?.fundShareClasses;
  if (api) return parseCatalogFunds(api.funds);
  const source =htmlToText(stripProxyPreamble(normalizeMarkdownLinks(text)));
  // Blank-line layout varies per render (the HTML pipeline strips blanks only
  // when tags are present, and some renders add a table separator row); drop
  // blanks so card offsets stay stable across render variants.
  const lines = source.split('\n').filter((line) => line.trim());
  const funds = new Map<string, CatalogFund>();
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    FINDER_CARD_LINK.lastIndex = 0;
    for (const match of line.matchAll(FINDER_CARD_LINK)) {
      const label = cleanText(match[1].replace(/\*\*/g, ''));
      // The CUSIP cell of the performance table links to the same URL; only
      // the H2 fund-name link opens a card.
      if (/^[A-Za-z0-9]{9}$/.test(label)) continue;
      if (!/goldman sachs/i.test(label)) continue;
      const fundPage = match[2];
      const cusip = match[4].toUpperCase();
      const window = lines.slice(index, index + 12);
      const joined = window.join('\n');
      const rowLine = window.find((candidate) => /^\s*\|/.test(candidate) && /\|\s*[A-Z]{3,5}\s*\|/.test(candidate) && /USD/i.test(candidate));
      const cells = (rowLine || '').split('|').map((cell) => stripMarkdown(cell));
      if (cells.length > 1 && !cells[0]) cells.shift();
      if (cells.length > 1 && !cells[cells.length - 1]) cells.pop();
      const ticker = sanitizeTicker(cells[1] || '');
      if (!ticker) continue;
      const categoryLine = window.find((candidate) => /^(EQUITY|FIXED INCOME|COMMODITIES)$/i.test(candidate.trim()));
      const navAsOf = monthDateToIso(/NAV\s*as of\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i.exec(joined)?.[1] || '') || null;
      const returnsAsOfRaw = /Average Annual Returns\s*as of\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4}|--)/i.exec(joined)?.[1] || '';
      const returnsAsOf = returnsAsOfRaw === '--' ? null : monthDateToIso(returnsAsOfRaw) || null;
      const nav = cells[2] ? firstNumber(cells[2]) : null;
      const values = [cells[3], cells[4], cells[5], cells[6]].map((cell) => (cell === undefined ? null : numberOrNull(cell)));
      const inceptionCell = cells[7] || '';
      const sinceInception = firstNumber(inceptionCell.replace(/[A-Za-z]+\s+\d{1,2},?\s+\d{4}/, ' '));
      const inception = monthDateToIso(inceptionCell) || null;
      const frequency = cleanText(cells[8] || '');
      const existing = funds.get(ticker);
      const fund: CatalogFund = existing || {
        ticker,
        name: label,
        category: 'ETF',
        categoryPath: '',
        inception: null,
        exchange: '',
        cusip: '',
        isin: '',
        benchmark: '',
        ter: null,
        grossTer: null,
        nav: null,
        close: null,
        premiumDiscount: null,
        netAssets: null,
        dividendYield: null,
        secYield: null,
        asOfDate: null,
        frequency: '',
        returnsAsOf: null,
        returns: { ...EMPTY_RETURNS },
        fundPage: canonicalGsFundPage(fundPage, ticker),
        source: 'goldman',
      };
      if (label.length > fund.name.length) fund.name = label;
      if (categoryLine) { fund.category = normalizeCategory(categoryLine); fund.categoryPath = fund.category; }
      if (cusip) fund.cusip = cusip;
      if (nav !== null) fund.nav = nav;
      if (navAsOf) fund.asOfDate = navAsOf;
      if (frequency) fund.frequency = frequency;
      if (inception) fund.inception = inception;
      const [yr1, yr3, yr5, yr10] = values;
      if (yr1 !== null) fund.returns.yr1 = yr1;
      if (yr3 !== null) fund.returns.yr3 = yr3;
      if (yr5 !== null) fund.returns.yr5 = yr5;
      if (yr10 !== null) fund.returns.yr10 = yr10;
      if (sinceInception !== null) fund.returns.sinceInception = sinceInception;
      if (returnsAsOf) fund.returnsAsOf = returnsAsOf;
      funds.set(ticker, fund);
    }
  }
  if (!funds.size) throw new Error('Goldman Sachs fund finder: no ETF rows found');
  return [...funds.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

/** Universe seed rows as catalog entries (finder backfill). */
export function seedCatalogFunds(): CatalogFund[] {
  return GOLDMAN_SACHS_FUNDS.map((seed) => ({
    ticker: seed.ticker,
    name: seed.name,
    category: normalizeCategory(seed.category),
    categoryPath: normalizeCategory(seed.category),
    inception: monthDateToIso(seed.inceptionDate) || null,
    exchange: '',
    cusip: seed.cusip.toUpperCase(),
    isin: '',
    benchmark: '',
    ter: null,
    grossTer: null,
    nav: null,
    close: null,
    premiumDiscount: null,
    netAssets: null,
    dividendYield: null,
    secYield: null,
    asOfDate: null,
    frequency: '',
    returnsAsOf: null,
    returns: { ...EMPTY_RETURNS },
    fundPage: seed.fundPage,
    source: 'seed' as const,
  }));
}

// ---------------------------------------------------------------------------
// HTTP layer
// ---------------------------------------------------------------------------

/**
 * Request pacing. Direct requests (Goldman Sachs, SEC, Yahoo) are paced per
 * worker lane: each of the CONCURRENCY fund workers spaces its own request
 * starts by REQUEST_SLEEP, so CONCURRENCY multiplies throughput. The lane is
 * taken from the worker (AsyncLocalStorage) and its slot is reserved
 * synchronously, before any await, so two requests can never claim one slot.
 * Only the rate-limited r.jina.ai proxy keeps one global gate (>= 3.2 s
 * between request starts).
 */
export function paceRequests(proxy = false): Promise<void> {
  const now = Date.now();
  let at: number;
  if (proxy) {
    at = Math.max(now, proxyGateAt);
    proxyGateAt = at + Math.max(requestSleepSeconds, PROXY_SLEEP_SECONDS) * 1000;
  } else {
    const lane = laneStore.getStore() ?? -1; // -1: requests made outside any worker (catalog, SEC tables)
    at = Math.max(now, requestLanes[lane] ?? 0);
    requestLanes[lane] = at + Math.max(0, requestSleepSeconds * 1000);
  }
  return at > now ? sleep(at - now) : Promise.resolve();
}

/** Runs `fn` with its requests paced on the given lane. */
export function runOnLane<T>(lane: number, fn: () => Promise<T>): Promise<T> {
  return laneStore.run(lane, fn);
}

/** Resets all pacing state (start of a run, and tests). */
export function resetPacing(sleepSeconds: number): void {
  requestSleepSeconds = sleepSeconds;
  requestLanes = {};
  proxyGateAt = 0;
}

/** One attempt (headers AND body) may take this long before it is aborted and retried. */
let REQUEST_TIMEOUT_MS = 45_000;
let RETRY_BASE_MS = 800;
export function setFetchTuningForTests(timeoutMs: number, retryBaseMs: number): void {
  REQUEST_TIMEOUT_MS = timeoutMs;
  RETRY_BASE_MS = retryBaseMs;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function retryable(error: unknown): boolean {
  if (error instanceof HttpError) return error.status === 403 || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500;
  return true;
}

function isProxyUrl(url: string): boolean {
  return url.startsWith(PROXY_PREFIX);
}

export function proxyUrl(url: string): string {
  return `${PROXY_PREFIX}${url}`;
}

export async function fetchText(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}, init: { method?: 'GET' | 'POST'; body?: string } = {}): Promise<string> {
  let lastError: unknown = new Error('no request attempted');
  const proxy = isProxyUrl(url);
  // The proxy is rate limited: at most one retry there, whatever MAX_RETRIES says.
  const retries = proxy ? Math.min(config.maxRetries, 1) : config.maxRetries;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await paceRequests(proxy);
      // The signal covers connecting, the headers AND reading the body (both reads below are inside the attempt).
      const response = await fetch(url, { method: init.method ?? 'GET', body: init.body, headers: { 'User-Agent': secUserAgent, Accept: '*/*', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) {
        const snippet = cleanText((await response.text().catch(() => '')).replace(/<[^>]+>/g, ' ')).slice(0, 160);
        throw new HttpError(response.status, `${response.status} ${response.statusText}${snippet ? ` - ${snippet}` : ''}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !retryable(error)) break;
      const rateLimited = error instanceof HttpError && error.status === 429;
      await sleep(Math.min(60_000, (rateLimited ? 12_000 : RETRY_BASE_MS) * 2 ** attempt));
    }
  }
  const timedOut = lastError instanceof Error && /timed out|TimeoutError|aborted/i.test(`${lastError.name} ${lastError.message}`);
  throw new Error(`${label}: ${timedOut ? `no complete response within ${REQUEST_TIMEOUT_MS / 1000}s (${lastError instanceof Error ? lastError.message : String(lastError)})` : lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function fetchJson(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}): Promise<JsonRecord> {
  const text = await fetchText(url, label, config, { Accept: 'application/json', ...headers });
  try {
    return JSON.parse(text) as JsonRecord;
  } catch {
    throw new Error(`${label}: response was not JSON`);
  }
}

let issuerDirectDenials = 0;
let issuerDirectDisabled = false;
const ISSUER_DIRECT_DENIAL_LIMIT = 2;

/** Test hook: the direct-denial latch (workers run concurrently, so the state is one latch, not a reset-on-success counter). */
export function recordIssuerDirectResult(denied: boolean): boolean {
  if (denied) {
    issuerDirectDenials += 1;
    if (issuerDirectDenials >= ISSUER_DIRECT_DENIAL_LIMIT) issuerDirectDisabled = true;
  } else if (!issuerDirectDisabled) {
    issuerDirectDenials = 0;
  }
  return issuerDirectDisabled;
}
const ISSUER_PROXY_NOTICE = `[ ${'issuer'.padEnd(9)}] direct requests are denied from this network; using the read-only rendering proxy for the rest of the run`;
export function resetIssuerDirectState(): void { issuerDirectDenials = 0; issuerDirectDisabled = false; }

/**
 * Issuer documents: one direct request with a browser-like User-Agent first,
 * then the same public URL through the read-only rendering proxy. The issuer
 * CDN answers datacenter clients with "Access Denied" (HTTP 403); after two
 * such denials in a run (one latch shared by all workers; a success from a
 * request that was already in flight never re-enables it) the direct attempt
 * is skipped to keep the run short.
 * The proxy itself sits behind Cloudflare and challenges browser User-Agents,
 * so proxy requests declare the plain feed User-Agent. `validate` rejects
 * bot-wall/HTML error pages so that the fallback is taken instead of parsing
 * garbage.
 */
/** Short text preview for fetch diagnostics (reveals rate-limit and bot-wall bodies). */
function responseSnippet(text: string): string {
  const snippet = cleanText(String(text ?? '').replace(/<[^>]+>/g, ' ')).slice(0, 200);
  return snippet ? `"${snippet}"` : '(empty body)';
}

async function fetchIssuerText(url: string, label: string, config: UpdaterConfig, validate: (text: string) => boolean, accept = 'text/html,application/xhtml+xml,text/csv,text/plain;q=0.9,*/*;q=0.8', options: { cache?: boolean; direct?: () => Promise<string> } = {}): Promise<{ text: string; via: 'direct' | 'proxy' }> {
  let lastError: unknown = new Error('direct request skipped (issuer CDN denies this network)');
  if (!issuerDirectDisabled) {
    try {
      // `direct` replaces the GET of the public page (the fund data API the page itself reads).
      const text = options.direct ? await options.direct() : await fetchText(url, label, { ...config, maxRetries: 0 }, { 'User-Agent': BROWSER_UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' });
      if (validate(text)) {
        recordIssuerDirectResult(false);
        return { text, via: 'direct' };
      }
      lastError = new Error(`direct response did not contain the expected content (${text.length} chars: ${responseSnippet(text)})`);
    } catch (error) {
      lastError = error;
      if (/\b403\b/.test(error instanceof Error ? error.message : String(error))) {
        const wasDisabled = issuerDirectDisabled;
        // Printed through outputNote so it never lands between fund lines; main reports the switch before the fund loop.
        if (recordIssuerDirectResult(true) && !wasDisabled) outputNote(ISSUER_PROXY_NOTICE);
      }
    }
  }
  // The proxy is rate limited: ONE attempt plus at most one retry in total, whether the first
  // attempt failed in transport or returned a truncated/throttled render. fetchText itself does
  // not retry here (maxRetries 0), so a fund page costs at most two proxy requests.
  let proxyError: unknown = new Error('proxy request skipped');
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const headers: Record<string, string> = { 'User-Agent': secUserAgent, Accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.8' };
      if (options.cache === false) headers['X-No-Cache'] = 'true';
      const text = stripProxyPreamble(await fetchText(proxyUrl(url), `${label} (proxy)`, { ...config, maxRetries: 0 }, headers));
      if (validate(text)) return { text, via: 'proxy' };
      proxyError = new Error(`proxy response did not contain the expected content (${text.length} chars: ${responseSnippet(text)})`);
      if (attempt < 2) outputNote(`${label} (proxy): unexpected content, retrying once after a short backoff`);
    } catch (error) {
      proxyError = error;
      if (error instanceof Error && /\b(400|401|404|410)\b/.test(error.message)) break;
      if (attempt < 2) outputNote(`${label} (proxy): ${error instanceof Error ? error.message : String(error)}, retrying once after a short backoff`);
    }
    if (attempt < 2) await sleep(Math.min(8000, RETRY_BASE_MS * 10));
  }
  const first = lastError instanceof Error ? lastError.message : String(lastError);
  const second = proxyError instanceof Error ? proxyError.message : String(proxyError);
  throw new Error(`${label}: ${first}; ${second}`);
}

// ---------------------------------------------------------------------------
// Fund data API (direct path of the finder and the fund pages)
// ---------------------------------------------------------------------------

/** One direct POST to the fund data API (no retry here: the caller falls back to the rendering proxy). */
function fetchGsApi(query: string, variables: JsonRecord, label: string, config: UpdaterConfig): Promise<string> {
  const headers = { 'User-Agent': BROWSER_UA, Accept: 'application/json', 'Content-Type': 'application/json', 'Accept-Language': 'en-US,en;q=0.9', Origin: GS_SITE };
  return fetchText(GS_FUNDS_API, label, { ...config, maxRetries: 0 }, headers, { method: 'POST', body: JSON.stringify({ query, variables }) });
}

/** The fund-finder request with the ETF filter (the variables the finder page sends). */
export function gsFinderVariables(): JsonRecord {
  return { fundRequest: { ...GS_REQUEST_LOCALE, offset: 0, limit: 200, sortBy: 'FN', sortOrder: 'ASC', filterParam: { funds: ['ETF'], searchText: '' } } };
}

/** The fund-detail request for a fund page URL (/funds/detail/PV<id>/<CUSIP>/<slug>), or null when the URL carries no ids. */
export function gsDetailVariables(fundPage: string): JsonRecord | null {
  const match = /\/funds\/detail\/(PV\d+)\/([A-Za-z0-9]{9})(?:\/|$)/i.exec(String(fundPage ?? ''));
  return match ? { fundDetailRequest: { ...GS_REQUEST_LOCALE, pvNumber: match[1].toUpperCase(), shareClassId: match[2].toUpperCase() } } : null;
}

/** The `data` object of a fund data API answer, or null for anything else (HTML, markdown, a GraphQL error answer). */
export function gsApiData(text: string): JsonRecord | null {
  const raw = String(text ?? '').trimStart();
  if (!raw.startsWith('{')) return null;
  try {
    const payload = JSON.parse(raw) as JsonRecord;
    if (Array.isArray(payload.errors) && payload.errors.length) return null;
    return payload.data && typeof payload.data === 'object' ? (payload.data as JsonRecord) : null;
  } catch {
    return null;
  }
}

/** True for a fund-detail answer of exactly this ticker (identity check). */
export function isGsFundDetail(text: string, ticker: string): boolean {
  const detail = gsApiData(text)?.fundsDetail;
  return Boolean(detail) && cleanText(detail.ticker).toUpperCase() === ticker.toUpperCase();
}

/** True for a fund-finder answer that lists at least one ETF. */
export function isGsFinder(text: string): boolean {
  const funds = gsApiData(text)?.fundShareClasses?.funds;
  return Array.isArray(funds) && funds.some((fund: JsonRecord) => fund?.fundType === 'ETF' && fund?.ticker && fund?.pvNumber);
}

// ---------------------------------------------------------------------------
// Fund page
// ---------------------------------------------------------------------------

function emptyReturnRow(asOfDate = ''): OfficialReturnRow {
  return { asOfDate, mo1: null, mo3: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null };
}

function returnRowFromLabeledCells(headers: string[], values: Array<number | null>, asOfDate: string): OfficialReturnRow {
  const row = emptyReturnRow(asOfDate);
  const slot = (header: string): Exclude<keyof OfficialReturnRow, 'asOfDate'> | null => {
    const key = header.toLowerCase().replace(/[\s.]+/g, '');
    if (key === 'sinceinception') return 'siAnn';
    if (key === '1mth' || key === '1month') return 'mo1';
    if (key === '3mth' || key === '3month') return 'mo3';
    if (key === 'ytd') return 'ytd';
    if (key === '1yr' || key === '1year') return 'yr1';
    if (key === '3yr' || key === '3year') return 'cagr3y';
    if (key === '5yr' || key === '5year') return 'cagr5y';
    if (key === '10yr' || key === '10year') return 'cagr10y';
    return null;
  };
  headers.forEach((header, index) => {
    const field = slot(header);
    if (field) row[field] = values[index] ?? null;
  });
  return row;
}

/**
 * Reads the Performance section. Goldman Sachs prints four value tables after
 * the tab anchors: a Cumulative table (Since Inception cumulative, 1Mth, 3Mth,
 * 6Mth, YTD), an Annualized table (1Yr, 3Yr, 5Yr, 10Yr), an Average Annualized
 * table (the standardized month-end subset — the only place the annualized
 * since-inception value appears) and a Quarterly Annualized table
 * (quarter-end). Each carries a `NAV` and a `Market Price…` row plus index
 * rows that are ignored. A Calendar Year Returns table (year columns) follows
 * and is skipped. Tenors map by header label because the quarterly table only
 * prints the tenors the fund actually has.
 */
export function parseOfficialReturns(lines: TextLine[], ticker: string): OfficialReturns {
  void ticker;
  const result: OfficialReturns = { monthEnd: { nav: null, marketPrice: null }, quarterEnd: { nav: null, marketPrice: null } };
  const anchorDate = (kind: RegExp): string => {
    for (const line of lines) {
      const match = kind.exec(line.text);
      if (match) {
        const asOf = firstDate(line.text) || monthDateToIso(line.text);
        if (asOf) return asOf;
      }
    }
    return '';
  };
  const cumulativeAsOf = anchorDate(/Cumulative Returns/i) || anchorDate(/Annualized Returns/i);
  const annualizedAsOf = anchorDate(/Average Annualized Returns/i) || anchorDate(/Annualized Returns/i);
  const quarterlyAsOf = anchorDate(/Quarterly Annualized Returns/i);
  type ValueTable = { headers: string[]; nav: Array<number | null> | null; marketPrice: Array<number | null> | null };
  const cumulative: ValueTable[] = [];
  const annualized: ValueTable[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const cells = lines[index].cells;
    if (cells.length < 3 || cells[0].toLowerCase() !== 'label') continue;
    const headers = cells.slice(1);
    if (headers.some((header) => /^\d{4}$/.test(header.trim()))) continue; // calendar years
    if (!headers.some((header) => /mth|month|yr|year|ytd|since inception/i.test(header))) continue;
    const table: ValueTable = { headers, nav: null, marketPrice: null };
    for (let next = index + 1; next < lines.length; next += 1) {
      const row = lines[next].cells;
      if (!row.length || row[0].toLowerCase() === 'label') break;
      if (row.length < 2) continue;
      const values = row.slice(1, headers.length + 1).map((cell) => numberOrNull(cell));
      if (/^nav$/i.test(row[0])) { if (!table.nav) table.nav = values; }
      else if (/market price/i.test(row[0])) { if (!table.marketPrice) table.marketPrice = values; }
      else if (table.nav && table.marketPrice) break;
    }
    if (!table.nav && !table.marketPrice) continue;
    (headers.some((header) => /mth|month/i.test(header)) ? cumulative : annualized).push(table);
  }
  const monthly = emptyReturnRow(annualizedAsOf || cumulativeAsOf);
  let monthlySeen = false;
  for (const table of cumulative) {
    const nav = table.nav ? returnRowFromLabeledCells(table.headers, table.nav, cumulativeAsOf) : null;
    const mp = table.marketPrice ? returnRowFromLabeledCells(table.headers, table.marketPrice, cumulativeAsOf) : null;
    if (nav) { monthly.mo1 = nav.mo1; monthly.mo3 = nav.mo3; monthly.ytd = nav.ytd; monthlySeen = true; }
    if (mp && !result.monthEnd.marketPrice) result.monthEnd.marketPrice = { ...emptyReturnRow(cumulativeAsOf), mo1: mp.mo1, mo3: mp.mo3, ytd: mp.ytd };
    else if (mp && result.monthEnd.marketPrice) { result.monthEnd.marketPrice.mo1 = mp.mo1; result.monthEnd.marketPrice.mo3 = mp.mo3; result.monthEnd.marketPrice.ytd = mp.ytd; }
  }
  // Year-tenor tables arrive in page order: Annualized, Average Annualized,
  // Quarterly Annualized. The middle table only contributes the annualized
  // since-inception value (its 1Yr/5Yr/10Yr repeat the Annualized table).
  const [annualizedTable, avgAnnualizedTable, quarterlyTable] = annualized.length >= 3 ? [annualized[0], annualized[1], annualized[2]] : [annualized[0], null, annualized[1]];
  if (annualizedTable) {
    const nav = annualizedTable.nav ? returnRowFromLabeledCells(annualizedTable.headers, annualizedTable.nav, annualizedAsOf) : null;
    const mp = annualizedTable.marketPrice ? returnRowFromLabeledCells(annualizedTable.headers, annualizedTable.marketPrice, annualizedAsOf) : null;
    if (nav) { monthly.yr1 = nav.yr1; monthly.cagr3y = nav.cagr3y; monthly.cagr5y = nav.cagr5y; monthly.cagr10y = nav.cagr10y; monthlySeen = true; }
    if (mp) {
      const target = result.monthEnd.marketPrice || emptyReturnRow(annualizedAsOf);
      target.yr1 = mp.yr1; target.cagr3y = mp.cagr3y; target.cagr5y = mp.cagr5y; target.cagr10y = mp.cagr10y;
      result.monthEnd.marketPrice = target;
    }
  }
  if (avgAnnualizedTable) {
    const nav = avgAnnualizedTable.nav ? returnRowFromLabeledCells(avgAnnualizedTable.headers, avgAnnualizedTable.nav, annualizedAsOf) : null;
    const mp = avgAnnualizedTable.marketPrice ? returnRowFromLabeledCells(avgAnnualizedTable.headers, avgAnnualizedTable.marketPrice, annualizedAsOf) : null;
    if (nav?.siAnn !== null && nav?.siAnn !== undefined) { monthly.siAnn = nav.siAnn; monthlySeen = true; }
    if (mp?.siAnn !== null && mp?.siAnn !== undefined && result.monthEnd.marketPrice) result.monthEnd.marketPrice.siAnn = mp.siAnn;
  }
  if (quarterlyTable) {
    if (quarterlyTable.nav) result.quarterEnd.nav = returnRowFromLabeledCells(quarterlyTable.headers, quarterlyTable.nav, quarterlyAsOf);
    if (quarterlyTable.marketPrice) result.quarterEnd.marketPrice = returnRowFromLabeledCells(quarterlyTable.headers, quarterlyTable.marketPrice, quarterlyAsOf);
  }
  if (monthlySeen) result.monthEnd.nav = monthly;
  return result;
}

/**
 * Official fund name: the page heading (`# Goldman Sachs … ETF`) first, then
 * the document title (which carries `| <TICKER> | Class …` suffix segments).
 */
export function parseFundName(source: string, ticker: string): string | null {
  void ticker;
  const patterns = [
    /^#{1,3}\s+(?:\*\*)?(Goldman Sachs[^\n|]*?\bETF\b[^\n|]*)$/im,
    /^Title:\s*(Goldman Sachs[^\n|]*?\bETF\b[^\n|]*)/im,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(source);
    if (!match) continue;
    const cleaned = cleanText(match[1].replace(/\*\*/g, '')).replace(/\s*\|\s*.*$/, '').replace(/\s*Goldman Sachs Asset Management$/i, '');
    if (cleaned) return cleaned;
  }
  return null;
}

/**
 * Distributions table -> ascending {epoch, amount} list. The page prints the
 * newest row first, repeats one row verbatim and renders a placeholder row of
 * `--` cells once a year, so rows are deduplicated and empty amounts skipped.
 */
export function parseGsDistributions(lines: TextLine[]): Distribution[] {
  let headerIndex = -1;
  let exIndex = 0;
  let amountIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const cells = lines[index].cells;
    const lower = cells.map((cell) => cell.toLowerCase());
    if (!lower.includes('ex-date')) continue;
    const amount = lower.findIndex((cell) => cell === '$ amount' || cell === 'amount');
    const fallback = lower.findIndex((cell) => cell === 'distributions');
    if (amount < 0 && fallback < 0) continue;
    headerIndex = index;
    exIndex = lower.indexOf('ex-date');
    amountIndex = amount >= 0 ? amount : fallback;
    break;
  }
  if (headerIndex < 0) return [];
  const seen = new Set<string>();
  const result: Distribution[] = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const cells = lines[index].cells;
    if (!cells.length) continue;
    if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cells[exIndex] || '')) break;
    const epoch = isoToEpoch(toIsoDate(cells[exIndex]));
    const amount = numberOrNull(cells[amountIndex]);
    if (epoch === null || amount === null || amount <= 0) continue;
    const key = `${epoch}:${amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ epoch, amount: round(amount, 6) });
  }
  result.sort((a, b) => a.epoch - b.epoch);
  return result;
}

/**
 * Top 10 Holdings block -> names + weights. Rows render as `| Name | x.xx% |`
 * pairs followed by an `Others` row; the headline states the top-10 share of
 * the portfolio ('35.85% of Total Portfolio').
 */
export function parseGsTopHoldings(lines: TextLine[]): GsTopHoldings | null {
  const anchor = lines.findIndex((line) => /top 10 holdings/i.test(line.text));
  if (anchor < 0) return null;
  const asOfDate = firstDate(lines[anchor].text) || monthDateToIso(lines[anchor].text) || null;
  let top10Pct: number | null = null;
  const rows: Array<{ name: string; weight: number | null }> = [];
  for (let index = anchor + 1; index < lines.length && rows.length < 10; index += 1) {
    const line = lines[index];
    const headline = /([\d.]+)%\s*of total portfolio/i.exec(line.text);
    if (headline) { top10Pct = numberOrNull(headline[1]); continue; }
    if (line.cells.length < 2) continue;
    const weightCell = line.cells[line.cells.length - 1];
    if (!/^[-+]?[\d,.]+%$/.test(weightCell)) continue;
    const name = cleanText(line.cells.slice(0, -1).join(' '));
    if (!name || /^others$/i.test(name)) break;
    rows.push({ name, weight: numberOrNull(weightCell) });
  }
  if (!rows.length) return null;
  return { asOfDate, top10Pct, rows };
}

/** '15,098.52MMUSD' -> USD; plain numbers pass through unchanged. */
export function aumToUsd(value: string): number | null {
  const amount = firstNumber(value);
  if (amount === null) return null;
  const raw = cleanText(value).toUpperCase();
  if (/MMUSD|MM\b|MUSD|MILLION/.test(raw)) return amount * 1e6;
  if (/(?<!M)M?BUSD|BN\b|BILLION/.test(raw)) return amount * 1e9;
  if (/KUSD|\bK\b|THOUSAND/.test(raw)) return amount * 1e3;
  return amount;
}

function emptyProductSummary(): ProductPageSummary {
  return {
    name: null, cusip: '', exchange: '', assetClass: '', benchmark: '', inception: null,
    nav: null, navChange: null, navChangePct: null, navAsOfDate: null,
    aumDaily: null, aumDailyAsOfDate: null, aumMonthly: null, aumMonthlyAsOfDate: null,
    totalHoldings: null, lbmaGoldPrice: null, lbmaGoldPriceAsOfDate: null,
    netExpenseRatio: null, grossExpenseRatio: null,
    marketPrice: null, marketPrice52wkRange: '', premiumDiscount: null, pricingAsOfDate: null,
    bidAsk: null, bidAskSpread30d: null,
    premiumDays: null, atNavDays: null, discountDays: null,
    distRate12M: null, secYieldSubsidized: null, secYieldUnsubsidized: null, yieldsAsOfDate: null,
    navTicker: '', iopvTicker: '', distributions: [], topHoldings: null, allHoldings: null,
    officialReturns: { monthEnd: { nav: null, marketPrice: null }, quarterEnd: { nav: null, marketPrice: null } },
    sections: { ...NO_SECTIONS }, loadedFully: false,
  };
}

/** A fund data API text value; the API's placeholders ('N/A', '--') are no value. */
function apiText(value: unknown): string {
  const text = cleanText(value);
  return /^(?:n\/a|na|-+|—)$/i.test(text) ? '' : text;
}

/** A fund data API date ('2026-10-15') -> ISO, anything else -> null. */
function apiDate(value: unknown): string | null {
  const iso = toIsoDate(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

/** A decimal string as published, without float noise ('-8.729369935E7' -> '-87293699.35'); '' when absent. */
function apiNumberText(value: unknown): string {
  const number = numberOrNull(value);
  return number === null ? '' : String(Number(number.toPrecision(15)));
}

/**
 * The fund data API `allHoldings` list (the All Holdings table of the fund page, daily) -> holdings
 * sheet rows with the shared columns plus ISIN and SEDOL. Weight is the issuer's own portfolio
 * percentage, Market Value its USD market value, Shares Held its share or par amount. The API's
 * ticker of a bond is the issuer's equity ticker (a JNJ bond says JNJ), so positions with a coupon
 * or a maturity date get '-' and are keyed by their identifier, as the N-PORT sheets were. The API
 * publishes no asset category: that column stays empty rather than guessed. Rows stay in the
 * issuer's order, duplicates included (the issuer lists them). Null when the answer has no list.
 */
export function parseGsAllHoldings(value: unknown): GsHoldings | null {
  const block = value && typeof value === 'object' ? (value as JsonRecord) : null;
  const list = Array.isArray(block?.holdings) ? (block?.holdings as unknown[]).filter((row): row is JsonRecord => Boolean(row) && typeof row === 'object') : [];
  if (!block || !list.length) return null;
  const ordered = list.map((row, index) => ({ row, index })).sort((a, b) => (numberOrNull(a.row.order) ?? a.index) - (numberOrNull(b.row.order) ?? b.index) || a.index - b.index);
  const bond = list.some((row) => numberOrNull(row.coupon) !== null || apiDate(row.maturityDate) !== null);
  const rows = ordered.map(({ row }) => {
    const debt = numberOrNull(row.coupon) !== null || apiDate(row.maturityDate) !== null;
    const out: JsonRecord = {
      Name: apiText(row.holding),
      Ticker: debt ? '-' : apiText(row.ticker) || '-',
      Identifier: apiText(row.cusip) || apiText(row.isin) || apiText(row.sedol),
      Weight: apiNumberText(row.portfolio),
      'Market Value': apiNumberText(row.marketValue),
      'Shares Held': apiNumberText(row.numberOfShares),
      'Asset Category': '',
    };
    if (bond) { out.Coupon = apiNumberText(row.coupon); out.Maturity = apiDate(row.maturityDate) || ''; }
    out.ISIN = apiText(row.isin);
    out.SEDOL = apiText(row.sedol);
    return out;
  }).filter((row) => row.Name || row.Identifier);
  if (!rows.length) return null;
  return { asOfDate: apiDate(block.asAtDate), headers: [...(bond ? BOND_HOLDINGS_HEADERS : HOLDINGS_HEADERS), ...GS_HOLDINGS_EXTRA_HEADERS], rows };
}

/**
 * Fund data API answer (`fundsDetail`) -> the same summary the page parser builds. Mapping of the
 * page labels: quickStats netAssetValue / totalFundAssetsDaily / totalFundAssetsMonthly /
 * noOfHoldings / lbmaGoldPrice (Quick Stats), feesAndExpenses net/grossExpensesRatio (Fees &
 * Expenses), pricingTable marketPrice / premiumDiscount / bidAsk / dayMedianBidAskSpread (Pricing
 * Table), the four returns tables keyed by row id (nav, marketPrice[Returns]), yield
 * twelveMthTrailingYield / thirtyDayYield[Un]Subsidized, distributions (expirationDate is the
 * Ex-Date column, total the $ Amount column), premiumsAndDiscount (first quarter = the tab the
 * page opens on) and topHoldings. The API answer is complete by definition, so every section is
 * present: a null there is an honest absence, never a partial render.
 */
export function parseFundDetail(detail: JsonRecord, ticker: string, now: Date = new Date()): ProductPageSummary {
  void ticker;
  const summary = emptyProductSummary();
  const list = (value: unknown): JsonRecord[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') : []);
  const stat = (items: unknown, label: string): JsonRecord | null => list(items).find((item) => item.label === label) || null;
  const value = (item: JsonRecord | null): number | null => (item ? numberOrNull(item.value) : null);
  const quick = detail.quickStats;
  const nav = stat(quick, 'netAssetValue');
  const aumDaily = stat(quick, 'totalFundAssetsDaily');
  const aumMonthly = stat(quick, 'totalFundAssetsMonthly');
  const lbma = stat(quick, 'lbmaGoldPrice');
  const money = (item: JsonRecord | null): number | null => (item && numberOrNull(item.value) !== null ? aumToUsd(`${cleanText(item.value)}${cleanText(item.suffix)}${cleanText(item.currency)}`) : null);
  const pricing = detail.pricingTable;
  const marketPrice = stat(pricing, 'marketPrice');
  const premium = stat(pricing, 'premiumDiscount');
  const yields = detail.yield;
  const distRate = stat(yields, 'twelveMthTrailingYield');
  const secSub = stat(yields, 'thirtyDayYieldSubsidized');
  const secUnsub = stat(yields, 'thirtyDayYieldUnSubsidized');
  const yieldsAsOfDate = apiDate(distRate?.asAtDate) || apiDate(secSub?.asAtDate) || apiDate(secUnsub?.asAtDate);
  // Same guard as the page parser: a yields block dated after today is never published.
  const yieldsValid = yieldsAsOfDate === null || yieldsAsOfDate <= now.toISOString().slice(0, 10);

  // Returns tables: rows keyed by id ('nav', 'marketPriceReturns' / 'marketPrice', benchmark rows ignored).
  const tenorCells = (row: JsonRecord): { headers: string[]; values: Array<number | null> } => {
    const map: Array<[string, string]> = [['oneMth', '1Mth'], ['threeMth', '3Mth'], ['ytd', 'YTD'], ['oneYr', '1Yr'], ['threeYr', '3Yr'], ['fiveYr', '5Yr'], ['tenYr', '10Yr'], ['sinceInception', 'Since Inception']];
    const present = map.filter(([key]) => key in row);
    return { headers: present.map(([, header]) => header), values: present.map(([key]) => numberOrNull(row[key])) };
  };
  const tableRow = (table: unknown, kind: 'nav' | 'marketPrice', asOf: string): OfficialReturnRow | null => {
    const row = list(table).find((item) => (kind === 'nav' ? item.id === 'nav' : item.id === 'marketPrice' || item.id === 'marketPriceReturns'));
    if (!row) return null;
    const { headers, values } = tenorCells(row);
    return returnRowFromLabeledCells(headers, values, asOf);
  };
  const cumulativeAsOf = apiDate(detail.cumulativeReturnsAsAtDate) || apiDate(detail.annualizedReturnsAsAtDate) || '';
  const annualizedAsOf = apiDate(detail.averageAnnualizedReturnsAsAtDate) || apiDate(detail.annualizedReturnsAsAtDate) || '';
  const quarterlyAsOf = apiDate(detail.quarterlyAnnualizedReturnsAsAtDate) || '';
  const officialReturns: OfficialReturns = { monthEnd: { nav: null, marketPrice: null }, quarterEnd: { nav: null, marketPrice: null } };
  for (const kind of ['nav', 'marketPrice'] as const) {
    const cumulative = tableRow(detail.cumulativeReturns, kind, cumulativeAsOf);
    const annualized = tableRow(detail.annualizedReturns, kind, annualizedAsOf);
    const average = tableRow(detail.averageAnnualizedReturns, kind, annualizedAsOf);
    // The page parser's rules: month tenors from the Cumulative table, year tenors from the Annualized
    // table, the annualized since-inception value only from the Average Annualized table.
    if (cumulative || annualized || average) {
      const row = emptyReturnRow(kind === 'nav' ? annualizedAsOf || cumulativeAsOf : cumulativeAsOf || annualizedAsOf);
      if (cumulative) { row.mo1 = cumulative.mo1; row.mo3 = cumulative.mo3; row.ytd = cumulative.ytd; }
      if (annualized) { row.yr1 = annualized.yr1; row.cagr3y = annualized.cagr3y; row.cagr5y = annualized.cagr5y; row.cagr10y = annualized.cagr10y; }
      if (average) row.siAnn = average.siAnn;
      officialReturns.monthEnd[kind] = row;
    }
    officialReturns.quarterEnd[kind] = tableRow(detail.quarterlyAnnualizedReturns, kind, quarterlyAsOf);
  }

  const seen = new Set<string>();
  const distributions: Distribution[] = [];
  for (const row of list(detail.distributions)) {
    const epoch = isoToEpoch(toIsoDate(row.expirationDate));
    const amount = numberOrNull(row.total);
    if (epoch === null || amount === null || amount <= 0) continue;
    const key = `${epoch}:${amount}`;
    if (seen.has(key)) continue; // the API repeats some rows verbatim, like the page table
    seen.add(key);
    distributions.push({ epoch, amount: round(amount, 6) });
  }
  distributions.sort((a, b) => a.epoch - b.epoch);

  const topSeries = list(detail.topHoldings?.data?.series)[0];
  const topRows = list(topSeries?.dataset).map((item) => ({ name: cleanText(item.name), weight: numberOrNull(item.y) })).filter((row) => row.name).slice(0, 10);
  const topWeights = topRows.map((row) => row.weight);
  // The page headline ('x% of Total Portfolio') is the sum of the ten published weights.
  const top10Pct = topWeights.length && topWeights.every((weight) => weight !== null) ? round(topWeights.reduce((sum: number, weight) => sum + (weight ?? 0), 0), 2) : null;
  const topHoldings: GsTopHoldings | null = topRows.length ? { asOfDate: apiDate(detail.topHoldings?.asAtDate), top10Pct, rows: topRows } : null;

  const firstQuarter = list(detail.premiumsAndDiscount?.quarterInsights)[0];
  const insight = (label: string): number | null => numberOrNull(list(firstQuarter?.insights).find((item) => normalizeLabel(cleanText(item.label)) === label)?.value);
  const cusip = cleanText(detail.cusip).toUpperCase();
  const range = stat(pricing, 'marketPriceWeekRange');
  // Partial answers happen (seen once on 2026-10-18: the month-end tables came back empty while the
  // quarterly one did not). The Cumulative table exists for every fund with any returns (a fund under
  // one year has no Annualized table, a brand-new fund has no table at all), so returns count as
  // present when it has rows or when no returns table has any; a missing Cumulative table next to
  // other returns tables is partial and, like a partial page render, keeps the published returns.
  const returnTables = [detail.cumulativeReturns, detail.annualizedReturns, detail.averageAnnualizedReturns, detail.quarterlyAnnualizedReturns].map((table) => list(table).length > 0);
  const returnsPresent = returnTables[0] || returnTables.every((present) => !present);
  const sections: PageSections = { pricing: list(pricing).length > 0, yields: true, returns: returnsPresent, distributions: true, topHoldings: true };
  return {
    ...summary,
    sections,
    loadedFully: sections.pricing && sections.returns,
    name: cleanText(detail.fundName) || null,
    cusip: /^[A-Z0-9]{9}$/.test(cusip) ? cusip : '',
    exchange: apiText(detail.exchange),
    assetClass: detail.marketingAssetClass ? normalizeCategory(cleanText(detail.marketingAssetClass)) : '',
    benchmark: apiText(detail.benchmark),
    inception: apiDate(detail.fundInceptionDate),
    nav: value(nav),
    navChange: nav ? numberOrNull(nav.upDownValue) : null,
    navChangePct: nav ? numberOrNull(nav.upDownPctValue) : null,
    navAsOfDate: apiDate(nav?.asAtDate),
    aumDaily: money(aumDaily),
    aumDailyAsOfDate: apiDate(aumDaily?.asAtDate),
    aumMonthly: money(aumMonthly),
    aumMonthlyAsOfDate: apiDate(aumMonthly?.asAtDate),
    totalHoldings: value(stat(quick, 'noOfHoldings')),
    lbmaGoldPrice: value(lbma),
    lbmaGoldPriceAsOfDate: apiDate(lbma?.asAtDate),
    netExpenseRatio: value(stat(detail.feesAndExpenses, 'netExpensesRatio')),
    grossExpenseRatio: value(stat(detail.feesAndExpenses, 'grossExpensesRatio')),
    marketPrice: value(marketPrice),
    marketPrice52wkRange: range ? cleanText(range.value) : '',
    premiumDiscount: value(premium),
    pricingAsOfDate: apiDate(marketPrice?.asAtDate) || apiDate(premium?.asAtDate),
    bidAsk: value(stat(pricing, 'bidAsk')),
    bidAskSpread30d: value(stat(pricing, 'dayMedianBidAskSpread')),
    premiumDays: insight('number of days at premium'),
    atNavDays: insight('number of days at nav'),
    discountDays: insight('number of days at discount'),
    distRate12M: yieldsValid ? value(distRate) : null,
    secYieldSubsidized: yieldsValid ? value(secSub) : null,
    secYieldUnsubsidized: yieldsValid ? value(secUnsub) : null,
    yieldsAsOfDate: yieldsValid ? yieldsAsOfDate : null,
    navTicker: apiText(detail.navTicker),
    iopvTicker: apiText(detail.intradayNavTicker),
    distributions,
    topHoldings,
    allHoldings: parseGsAllHoldings(detail.allHoldings),
    officialReturns,
  };
}

export function parseProductPage(text: string, ticker: string, now: Date = new Date()): ProductPageSummary {
  // Direct path: the fund data API answer (JSON); fallback path: the rendered page (HTML or proxy markdown).
  const detail = gsApiData(text)?.fundsDetail;
  if (detail) return parseFundDetail(detail, ticker, now);
  const source = htmlToText(stripProxyPreamble(text));
  const lines = toTextLines(source);
  const upper = ticker.toUpperCase();
  const empty = emptyProductSummary();
  if (!lines.length) return empty;
  const name = parseFundName(source, upper);
  const nav = lookupLabel(lines, 'Net Asset Value');
  const aumDaily = lookupLabel(lines, 'Total Fund Assets (Daily)') || lookupLabel(lines, /Total Fund Assets.*Daily/i);
  const aumMonthly = lookupLabel(lines, 'Total Fund Assets (Monthly)') || lookupLabel(lines, /Total Fund Assets.*Monthly/i);
  const holdingsCount = lookupLabel(lines, 'Number of Holdings');
  const lbma = lookupLabel(lines, 'LBMA Gold Price');
  const assetClass = lookupLabel(lines, 'Asset Class', { text: true });
  const inception = lookupLabel(lines, 'Fund Inception Date');
  const benchmark = lookupLabel(lines, 'Benchmark / Comparative Index', { text: true });
  const exchange = lookupLabel(lines, 'Exchange', { text: true });
  const netTer = lookupLabel(lines, 'Net Expense Ratio');
  const grossTer = lookupLabel(lines, 'Gross Expense Ratio');
  const marketPrice = lookupLabel(lines, 'Market Price');
  const range52 = lookupLabel(lines, /Market Price 52.*Range/i);
  const premium = lookupLabel(lines, 'Premium Discount') || lookupLabel(lines, /Premium.?Discount/i);
  const bidAsk = lookupLabel(lines, 'Bid/Ask');
  const spread = lookupLabel(lines, '30-Day Median Bid/Ask Spread') || lookupLabel(lines, /Median Bid\/Ask Spread/i);
  const premiumDays = lookupLabel(lines, 'Number of days at Premium');
  const atNavDays = lookupLabel(lines, 'Number of days at NAV');
  const discountDays = lookupLabel(lines, 'Number of days at Discount');
  const distRate = lookupLabel(lines, '12 Month Trailing Distribution Rate') || lookupLabel(lines, /Trailing Distribution Rate/i);
  const secSub = lookupLabel(lines, 'Standardized 30-Day Subsidized Yields') || lookupLabel(lines, /\bSubsidized Yields?/i);
  const secUnsub = lookupLabel(lines, 'Standardized 30-Day Unsubsidized Yields') || lookupLabel(lines, /\bUnsubsidized Yields?/i);
  const cusip = lookupLabel(lines, 'CUSIP');
  const navTicker = lookupLabel(lines, 'Nav Ticker', { text: true });
  const iopvTicker = lookupLabel(lines, 'Intraday Nav Ticker', { text: true });
  const cusipText = labelText(cusip).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  // The day-change line ('1.61 (1.12%)') follows the NAV value line.
  let navChange: number | null = null;
  let navChangePct: number | null = null;
  if (nav) {
    const labelIndex = lines.findIndex((line) => line.cells.some((cell) => normalizeLabel(cell).startsWith('net asset value')));
    for (let index = labelIndex + 1; index >= 0 && index < Math.min(lines.length, labelIndex + 4); index += 1) {
      const match = /^([-+]?[\d,.]+)\s*\(([-+]?[\d.]+)%\)$/.exec(lines[index].text);
      if (match) { navChange = numberOrNull(match[1]); navChangePct = numberOrNull(match[2]); break; }
    }
  }
  const headerCategory = lines.find((line) => /^(EQUITY|FIXED INCOME|COMMODITIES)$/i.test(line.text))?.text || '';
  const yieldsAsOfDate = labelAsOf(distRate) || labelAsOf(secSub);
  // A yields block dated after today is a misparsed section (seen: a December
  // estimate block read as the 30-day yield with a 100% value); drop the whole
  // trio rather than publish a fabricated yield.
  const yieldsValid = yieldsAsOfDate === null || yieldsAsOfDate <= now.toISOString().slice(0, 10);
  const officialReturns = parseOfficialReturns(lines, upper);
  const distributions = parseGsDistributions(lines);
  const topHoldings = parseGsTopHoldings(lines);
  // Page-loaded check: the pricing table (Market Price / Premium Discount / Bid/Ask labels) and the performance
  // tables (a Cumulative / Annualized Returns heading or a parsed returns table) must both be present. A page
  // missing either came back partial (rendering proxy), so what it lacks is unknown, not an honest absence.
  const sections: PageSections = {
    // a label line of its own or one carrying its as-of date: the returns tables also have 'Market Price' rows with percentages
    pricing: lines.some((line) => line.cells.some((cell) => /^(market price(?! returns)|premium.?discount|bid\/ask|30-day median)/i.test(normalizeLabel(cell)) && (line.cells.length === 1 || /as ?of/i.test(cell)))),
    yields: Boolean(distRate || secSub || secUnsub),
    returns: Boolean(officialReturns.monthEnd.nav || officialReturns.monthEnd.marketPrice || officialReturns.quarterEnd.nav) || lines.some((line) => /(Cumulative|Average Annualized|Quarterly Annualized|Annualized) Returns/i.test(line.text)),
    distributions: distributions.length > 0 || lines.some((line) => /^ex-date$/i.test(line.cells[0] || '')),
    topHoldings: topHoldings !== null || lines.some((line) => /top 10 holdings/i.test(line.text)),
  };
  return {
    ...empty,
    sections,
    loadedFully: sections.pricing && sections.returns,
    name,
    cusip: /^[A-Z0-9]{9}$/.test(cusipText) ? cusipText : '',
    exchange: labelText(exchange),
    assetClass: labelText(assetClass) || normalizeCategory(headerCategory),
    benchmark: labelText(benchmark),
    inception: monthDateToIso(labelText(inception)) || firstDate(labelText(inception)) || null,
    nav: labelNumber(nav),
    navChange,
    navChangePct,
    navAsOfDate: labelAsOf(nav),
    aumDaily: aumDaily ? aumToUsd(aumDaily.value) : null,
    aumDailyAsOfDate: labelAsOf(aumDaily),
    aumMonthly: aumMonthly ? aumToUsd(aumMonthly.value) : null,
    aumMonthlyAsOfDate: labelAsOf(aumMonthly),
    totalHoldings: labelNumber(holdingsCount),
    lbmaGoldPrice: labelNumber(lbma),
    lbmaGoldPriceAsOfDate: labelAsOf(lbma),
    netExpenseRatio: labelNumber(netTer),
    grossExpenseRatio: labelNumber(grossTer),
    marketPrice: sections.pricing ? labelNumber(marketPrice) : null,
    marketPrice52wkRange: sections.pricing ? cleanText(labelText(range52).replace(/USD$/i, '')) : '',
    premiumDiscount: sections.pricing ? labelNumber(premium) : null,
    pricingAsOfDate: sections.pricing ? labelAsOf(marketPrice) || labelAsOf(premium) : null,
    bidAsk: sections.pricing ? labelNumber(bidAsk) : null,
    bidAskSpread30d: sections.pricing ? labelNumber(spread) : null,
    premiumDays: labelNumber(premiumDays),
    atNavDays: labelNumber(atNavDays),
    discountDays: labelNumber(discountDays),
    distRate12M: yieldsValid ? labelNumber(distRate) : null,
    secYieldSubsidized: yieldsValid ? labelNumber(secSub) : null,
    secYieldUnsubsidized: yieldsValid ? labelNumber(secUnsub) : null,
    yieldsAsOfDate: yieldsValid ? yieldsAsOfDate : null,
    navTicker: labelText(navTicker),
    iopvTicker: labelText(iopvTicker),
    distributions,
    topHoldings,
    officialReturns,
  };
}

// ---------------------------------------------------------------------------
// CSV parsing (shared helper; the issuer publishes no holdings CSV)
// ---------------------------------------------------------------------------

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.trim() !== '')) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== '')) rows.push(row);
  return rows;
}

/** ISIN for a U.S. CUSIP: `US` + CUSIP + Luhn check digit (labelled derived in meta.json). */
export function isinFromCusip(cusip: string): string {
  const base = cleanText(cusip).toUpperCase();
  if (!/^[A-Z0-9]{9}$/.test(base)) return '';
  const digits = `US${base}`.split('').map((char) => (/[0-9]/.test(char) ? char : String(char.charCodeAt(0) - 55))).join('');
  let sum = 0;
  let double = true;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = Number(digits[i]);
    if (double) { value *= 2; if (value > 9) value -= 9; }
    sum += value;
    double = !double;
  }
  return `US${base}${(10 - (sum % 10)) % 10}`;
}

// ---------------------------------------------------------------------------
// SEC EDGAR Form N-PORT-P fallback: the shared nport-reader block at the end of this file finds, reads and checks the filing
// ---------------------------------------------------------------------------

function secHeaders(): Record<string, string> {
  return { 'User-Agent': secUserAgent, Accept: 'application/json, application/xml, text/xml, text/plain' };
}

/** A fresh SEC state for a run (main and tests). */
export function resetSecState(): void {
  secState = { funds: null, names: null, reader: new Map() };
}

/** SEC's ticker -> registrant CIK + series id table, loaded once per run (a failed load is asked again by the next fund). */
function loadFundTickerTable(config: UpdaterConfig): Promise<Map<string, NportSeriesRef>> {
  if (!secState.funds) {
    const loading = fetchJson(SEC_FUND_TICKERS_URL, '[edgar   ] fund ticker table', config, secHeaders()).then((payload) => parseSecFundTickers(payload));
    secState.funds = loading;
    loading.catch(() => { if (secState.funds === loading) secState.funds = null; });
  }
  return secState.funds;
}

/** SEC's company name -> ticker table for the N-PORT rows, loaded once per run. */
function loadCompanyNames(config: UpdaterConfig): Promise<Map<string, string>> {
  if (!secState.names) {
    const loading = fetchJson(SEC_COMPANY_TICKERS_URL, '[edgar   ] company ticker table', config, secHeaders()).then((payload) => parseSecCompanyNames(payload));
    secState.names = loading;
    loading.catch(() => { if (secState.names === loading) secState.names = null; });
  }
  return secState.names;
}

/** Nasdaq Trader symbol directories for the N-PORT rows (shared nport-reader `readUsListings`), loaded once per run: a row with a
 * foreign ISIN keeps a ticker only for the company's own U.S. listing in U.S. dollars (Linde, NXP, IMAX). null when either failed. */
let usListings: Promise<Map<string, string> | null> | null = null;
function loadUsListings(getText: (url: string, label: string) => Promise<string>): Promise<Map<string, string> | null> {
  if (!usListings) usListings = readUsListings(getText);
  return usListings;
}

/** A holdings line whose API ticker needs SEC's company table: a ticker on a foreign (non-U.S., non-Puerto Rico) ISIN. */
export function gsNeedsNameCheck(row: JsonRecord): boolean {
  const isin = String(row.ISIN ?? '').toUpperCase();
  return String(row.Ticker ?? '-') !== '-' && /^[A-Z]{2}[0-9A-Z]{9}[0-9]$/.test(isin) && !/^(US|PR)/.test(isin);
}

/**
 * Holdings tickers, a bare symbol only for a U.S. listing (brand ticker hygiene): the API ticker of a foreign line is its local
 * code (MRK = Merck KGaA on Xetra, III, KPN, 2330), which would merge it with the U.S. company of that symbol. A ticker stays on
 * a U.S. or Puerto Rico ISIN (ADRs and CINS issues included) or a U.S. CUSIP with no ISIN, and on a foreign ISIN only when SEC's
 * company table (`names`, parseSecCompanyNames) lists that same ticker for the same company (Accenture, Linde, Eaton trade in
 * the U.S. under their own symbol) and the Nasdaq Trader directories (`listings`, shared nport-reader `nportUsListed`) list it
 * as that company's own shares, not as depositary or New York registry shares of another line: the London Shell line is not
 * the SHEL ADR, Xetra SAP not the SAP ADR, Amsterdam ASML not the New York shares (Q33). Without listings no foreign line keeps
 * its ticker. Futures (no ISIN), contra lines (000 codes) and currency cash get '-'.
 */
export function gsListedTickers(rows: ReadonlyArray<JsonRecord>, names: Map<string, string> | null, listings: Map<string, string> | null = null): JsonRecord[] {
  const keysOf = new Map<string, string[]>();
  if (names) names.forEach((ticker, key) => keysOf.set(ticker, (keysOf.get(ticker) || []).concat(key)));
  /** SEC lists `ticker` for this company: the same name key, or (an API name cut short, two words or more) a key starting with it. */
  const secListed = (name: unknown, ticker: string): boolean => {
    const keys = keysOf.get(ticker) || [];
    // nportNameKey already reads PUBLIC LIMITED COMPANY as plc and N.V. as NV (shared block)
    const key = nportNameKey(name);
    const core = key.replace(/ CL [A-Z]$/, '');
    return Boolean(core) && (keys.indexOf(key) >= 0 || keys.indexOf(core) >= 0 || (core.split(' ').length >= 2 && keys.some((secKey) => secKey.indexOf(core) === 0)));
  };
  return rows.map((row) => {
    const ticker = String(row.Ticker ?? '-');
    if (ticker === '-') return row;
    const isin = String(row.ISIN ?? '').toUpperCase();
    const cash = /^[A-Z]{3}$/.test(ticker) && /\b(DOLLAR|CURRENCY|CASH)\b/i.test(String(row.Name ?? ''));
    let listed = false;
    if (cash) listed = false;
    else if (/^(US|PR)[0-9A-Z]{9}[0-9]$/.test(isin)) listed = true;
    else if (gsNeedsNameCheck(row)) listed = secListed(row.Name, ticker) && nportUsListed(listings, ticker, row.Name);
    else listed = !isin && /^[0-9]{3}[0-9A-Z]{5}[0-9]$/.test(String(row.Identifier ?? ''));
    return listed ? row : { ...row, Ticker: '-' };
  });
}

/**
 * The Goldman Sachs holdings sheet of an N-PORT filing: HOLDINGS_HEADERS, plus Coupon and Maturity when the filing holds debt.
 * A missing number stays empty (never 0), a missing text is '-'; tickers come from nportTickers (U.S. equities only).
 */
export function nportHoldingsSheet(filing: NportFiling, tickers: ReadonlyArray<string>): { headers: string[]; rows: JsonRecord[] } {
  const debt = filing.positions.some((position) => Boolean(position.maturity) || position.coupon !== null);
  const rows = filing.positions.map((position, index) => ({
    Name: position.name || '-',
    Ticker: tickers[index] || '-',
    Identifier: nportIdentifier(position) || '-',
    Weight: nportCell(position.weight),
    'Market Value': nportCell(position.value, 2),
    'Shares Held': nportCell(position.balance),
    'Asset Category': position.assetCat || '-',
    ...(debt ? { Coupon: nportCell(position.coupon), Maturity: position.maturity || '-' } : {}),
  }));
  return { headers: debt ? BOND_HOLDINGS_HEADERS : HOLDINGS_HEADERS, rows };
}

/**
 * N-PORT series refs for tickers the SEC fund-ticker map does not (yet) list,
 * e.g. recently listed or converted share classes. Look the Series ID up on
 * the trust's filing list (CIK 0001479026, type NPORT-P): open the fund's most
 * recent filing and copy its Series ID; remove the entry once the map catches
 * up. https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001479026&type=NPORT-P
 */
const SEC_SERIES_OVERRIDES: Record<string, NportSeriesRef> = {
};

// ---------------------------------------------------------------------------
// Yahoo Finance chart: history, dividends, derived returns
// ---------------------------------------------------------------------------

export function parseChart(payload: JsonRecord): ParsedChart {
  const result = payload?.chart?.result?.[0];
  if (!result) throw new Error('Yahoo chart returned no result');
  const timestamps: number[] = Array.isArray(result.timestamp) ? result.timestamp : [];
  const quote = result.indicators?.quote?.[0] || {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
  const days: ChartDay[] = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const close = numberOrNull(quote.close?.[i]);
    if (close === null) continue;
    const adjClose = numberOrNull(adjusted[i]) ?? close;
    days.push({ date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10), close, adjClose, volume: numberOrNull(quote.volume?.[i]) ?? 0 });
  }
  const dividends: Array<{ epoch: number; amount: number }> = [];
  for (const [epoch, item] of Object.entries(result.events?.dividends || {})) {
    const amount = numberOrNull((item as JsonRecord)?.amount);
    if (amount !== null) dividends.push({ epoch: Number(epoch), amount });
  }
  dividends.sort((a, b) => a.epoch - b.epoch);
  return {
    days,
    dividends,
    exchangeName: cleanText(result.meta?.exchangeName || result.meta?.fullExchangeName),
    regularMarketPrice: numberOrNull(result.meta?.regularMarketPrice),
    regularMarketTime: numberOrNull(result.meta?.regularMarketTime),
    firstTradeDate: numberOrNull(result.meta?.firstTradeDate),
  };
}

function pctChange(start: number | null, end: number | null): number | null {
  if (start === null || end === null || start === 0) return null;
  return round((end / start - 1) * 100, 2);
}

function annualized(start: number | null, end: number | null, years: number): number | null {
  if (start === null || end === null || start <= 0 || end <= 0 || years <= 0) return null;
  return round(((end / start) ** (1 / years) - 1) * 100, 2);
}

function anchor(days: ChartDay[], target: Date): ChartDay | null {
  let found: ChartDay | null = null;
  for (const day of days) {
    if (new Date(`${day.date}T00:00:00Z`) <= target) found = day;
    else break;
  }
  return found;
}

export function priceReturns(days: ChartDay[], now = new Date()): PriceReturns {
  const ordered = [...days].sort((a, b) => a.date.localeCompare(b.date));
  const last = ordered[ordered.length - 1];
  if (!last) return { ...EMPTY_PRICE_RETURNS };
  const date = new Date(`${last.date}T00:00:00Z`);
  const target = (years: number) => new Date(date.getTime() - years * 365.25 * 86_400_000);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const quarterStartMonth = Math.floor(date.getUTCMonth() / 3) * 3;
  const quarterStart = new Date(Date.UTC(date.getUTCFullYear(), quarterStartMonth, 1));
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, date.getUTCDate()));
  const start = (d: ChartDay | null) => d?.adjClose ?? null;
  const end = last.adjClose;
  const spanYears = ordered.length > 1 ? (date.getTime() - new Date(`${ordered[0].date}T00:00:00Z`).getTime()) / (365.25 * 86_400_000) : 0;
  void now;
  return {
    asOfDate: last.date,
    mo1: pctChange(start(anchor(ordered, monthStart)), end),
    qtd: pctChange(start(anchor(ordered, quarterStart)), end),
    ytd: pctChange(start(anchor(ordered, yearStart)), end),
    yr1: pctChange(start(anchor(ordered, target(1))), end),
    cagr3y: annualized(start(anchor(ordered, target(3))), end, 3),
    cagr5y: annualized(start(anchor(ordered, target(5))), end, 5),
    cagr10y: annualized(start(anchor(ordered, target(10))), end, 10),
    // Annualizing a sub-year span fabricates triple-digit SI figures for newly
    // listed funds; the issuer prints '--' until a full year of history exists.
    siAnn: spanYears >= 1 ? annualized(ordered[0].adjClose, end, spanYears) : null,
  };
}

/**
 * Payment cadence from the ex-date gaps of the most recent distributions. The
 * median gap (not the mean) keeps a year-end special distribution from turning
 * a quarterly payer into "Irregular".
 */
export function inferDistributionFrequency(dividends: Array<{ epoch: number; amount: number }>): { frequency: string; paymentsPerYear: number | null } {
  if (!dividends.length) return { frequency: 'None', paymentsPerYear: null };
  if (dividends.length < 2) return { frequency: 'Unknown', paymentsPerYear: null };
  const recent = [...dividends].sort((a, b) => a.epoch - b.epoch).slice(-9);
  const gaps = recent.slice(1).map((item, index) => (item.epoch - recent[index].epoch) / 86_400).filter((gap) => gap > 0).sort((a, b) => a - b);
  if (!gaps.length) return { frequency: 'Unknown', paymentsPerYear: null };
  const median = gaps.length % 2 ? gaps[(gaps.length - 1) / 2] : (gaps[gaps.length / 2 - 1] + gaps[gaps.length / 2]) / 2;
  if (median <= 45) return { frequency: 'Monthly', paymentsPerYear: 12 };
  if (median <= 135) return { frequency: 'Quarterly', paymentsPerYear: 4 };
  if (median <= 270) return { frequency: 'Semi-Annual', paymentsPerYear: 2 };
  if (median <= 500) return { frequency: 'Annual', paymentsPerYear: 1 };
  return { frequency: 'Irregular', paymentsPerYear: null };
}

/** Sortable coded label written into index.json (mirrors the client-side formatter). */
export function frequencyCodeLabel(value: unknown): string {
  const raw = String(value ?? '').trim();
  const normalized = raw.toLowerCase().replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ');
  if (!normalized || normalized === '-' || normalized === '—') return '00 - None';
  if (normalized === 'monthly') return '01 - Monthly';
  if (normalized === 'quarterly') return '04 - Quarterly';
  if (normalized === 'semi-annual' || normalized === 'semi-annually' || normalized === 'semiannual') return '06 - Semi-annually';
  if (normalized === 'annual' || normalized === 'annually') return '12 - Annually';
  if (normalized === 'none') return '00 - None';
  if (normalized === 'unknown') return '00 - Unknown';
  if (normalized === 'irregular') return '99 - Irregular';
  return raw;
}

/** Payments per year for an official finder frequency (Monthly/Quarterly/Annual…). */
export function paymentsPerYearForFrequency(frequency: unknown): number | null {
  const raw = String(frequency ?? '').trim().toLowerCase().replace(/[‐‑‒–—]/g, '-');
  if (raw === 'monthly') return 12;
  if (raw === 'quarterly') return 4;
  if (raw === 'semi-annual' || raw === 'semi-annually' || raw === 'semiannual') return 2;
  if (raw === 'annual' || raw === 'annually') return 1;
  return null;
}

/**
 * Payment frequency for the feed. The finder prints the official Distribution
 * Frequency for every fund (including 'None' for the physical gold trust), so
 * it wins; otherwise the inferred cadence wins unless it is 'Unknown' (fewer
 * than two distributions), in which case the previously published value is
 * kept so a thin dividend history never clobbers a known cadence with
 * 'Unknown'.
 */
export function selectDistributionFrequency(finderFrequency: unknown, inferredFrequency: string, dividendCount: number, previousFrequency: unknown): string {
  const finder = typeof finderFrequency === 'string' ? finderFrequency.trim() : '';
  if (finder && finder !== '—') return finder;
  if (dividendCount > 0 && inferredFrequency !== 'Unknown') return inferredFrequency;
  const previous = typeof previousFrequency === 'string' ? previousFrequency.trim() : '';
  return previous || '—';
}

function lastCompletedQuarterEnd(now = new Date()): string {
  const month = now.getUTCMonth();
  const quarterEndMonth = Math.floor(month / 3) * 3 - 1;
  const year = quarterEndMonth < 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const normalizedMonth = (quarterEndMonth + 12) % 12;
  const day = new Date(Date.UTC(year, normalizedMonth + 1, 0));
  return day.toISOString().slice(0, 10);
}

export const DERIVED_RETURNS_BASIS = 'estimated from Yahoo Finance adjusted market-price closes (chart API), not official Goldman Sachs NAV returns; performanceAsOf is the last close date';
export const OFFICIAL_RETURNS_BASIS = 'official Goldman Sachs fund-page NAV returns (month-end table; performanceAsOf is its date); periods the page does not publish stay null and are never estimated from market prices';

/** Which definition stands behind `dividendYield`; null exactly when the yield is null. */
export const YIELD_BASIS_CODES = ['official-trailing-12m', 'official-distribution-rate', 'official-other', 'computed-trailing-12m', 'indicated'] as const;
export type YieldBasis = (typeof YIELD_BASIS_CODES)[number];
export const isYieldBasis = (value: unknown): value is YieldBasis => typeof value === 'string' && (YIELD_BASIS_CODES as readonly string[]).includes(value);

/**
 * Code for a published `yields.dividendYieldKind` text (meta.json). Every text this updater writes is listed:
 * the fund page's 12 Month Trailing Distribution Rate (also when carried from a previous run) -> official-trailing-12m,
 * the updater's own estimate -> indicated. An unknown text cannot be proven provider-published -> indicated.
 */
export function yieldBasisFromKind(kind: unknown, yieldValue: number | null): YieldBasis | null {
  if (yieldValue === null) return null;
  const text = String(kind ?? '');
  if (text.startsWith('12 Month Trailing') || text.startsWith('carried from the previous run (official fund page)')) return 'official-trailing-12m';
  if (text.startsWith('indicated')) return 'indicated';
  return 'indicated';
}

/** Code stored in a published meta.json: its own `dividendYieldBasis` when valid, else mapped from the kind text. */
export function yieldBasisFromYields(yields: JsonRecord | undefined | null): YieldBasis | null {
  const value = numberOrNull(yields?.dividendYield);
  if (value === null) return null;
  return isYieldBasis(yields?.dividendYieldBasis) ? yields.dividendYieldBasis : yieldBasisFromKind(yields?.dividendYieldKind, value);
}

export function deriveMetrics(effective: PriceReturns, fund: CatalogFund, dividends: Distribution[], frequency: { paymentsPerYear: number | null }, price: number | null, official: boolean): JsonRecord {
  const latest = dividends[dividends.length - 1];
  const indicated = fund.dividendYield ?? (latest && frequency.paymentsPerYear && price ? round((latest.amount * frequency.paymentsPerYear / price) * 100, 2) : null);
  return {
    ytd: effective.ytd,
    tr1y: effective.yr1,
    tr3y: annualizedToTotal(effective.cagr3y, 3),
    tr5y: annualizedToTotal(effective.cagr5y, 5),
    tr10y: annualizedToTotal(effective.cagr10y, 10),
    cagr3y: effective.cagr3y,
    cagr5y: effective.cagr5y,
    cagr10y: effective.cagr10y,
    siAnn: effective.siAnn,
    dividendYield: indicated,
    dividendYieldText: indicated === null ? '—' : `${indicated.toFixed(2)}%`,
    // fund.dividendYield is only ever set from the official fund page (fresh, retained or carried); anything else is the estimate
    dividendYieldBasis: indicated === null ? null : fund.dividendYield !== null ? 'official-trailing-12m' : 'indicated',
    secYield: fund.secYield,
    secYieldText: fund.secYield === null ? '—' : `${fund.secYield.toFixed(2)}%`,
    returnsBasis: official ? OFFICIAL_RETURNS_BASIS : DERIVED_RETURNS_BASIS,
    performanceAsOf: performanceAsOf(effective.asOfDate),
  };
}

/** ISO date the returns are as of (issuer table date, or last Yahoo close when derived); null when unknown. Never the NAV date. */
export function performanceAsOf(value: unknown): string | null {
  const iso = toIsoDate(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
}

// Yahoo's adjusted close is float32 and its last digits move with the request's period2, so a value
// sitting on a cent boundary (31.544998 vs 31.545001) flips between runs. Within that noise the
// published cent is kept: a rerun with the same source data changes nothing.
export const ADJ_CLOSE_NOISE = 1e-4;

export function historyRows(days: ChartDay[], published: JsonRecord[] = []): JsonRecord[] {
  // Yahoo recomputes the split/dividend-adjusted close on every request; storing
  // the raw float lets the last digit or two jitter between otherwise identical
  // requests, making every history row (and the fund) look "updated" on every
  // single run. Rounding to 2 decimals is well past any meaningful price
  // precision and absorbs that jitter; the published cent covers a cent boundary.
  const prior = new Map(published.map((row) => [toIsoDate(row.Date), row]));
  return days.map((day) => {
    let adjClose = String(round(day.adjClose, 2));
    const row = prior.get(day.date);
    const priorAdj = row ? numberOrNull(row['Adj Close']) : null;
    if (row && priorAdj !== null && adjClose !== String(row['Adj Close']) && Math.abs(day.adjClose - priorAdj) <= 0.005 + ADJ_CLOSE_NOISE) adjClose = String(row['Adj Close']);
    return { Date: formatDate(day.date), Close: String(day.close), 'Adj Close': adjClose, Volume: String(day.volume) };
  });
}

function distributionRows(dividends: Distribution[]): string[][] {
  return dividends.map((item) => [formatUsDate(item.epoch), String(round(item.amount, 6))]);
}

/**
 * Official NAV returns replace the Yahoo market-price estimate as a whole: a
 * period the page does not publish stays null (never filled from market
 * prices), so one metrics row carries exactly one basis. Only `qtd` stays
 * derived (the page publishes 3-month, not quarter-to-date); it is not part
 * of metrics.
 */
export function mergeOfficialReturns(derived: PriceReturns, official: OfficialReturnRow | null): PriceReturns {
  if (!official) return derived;
  return {
    ...derived,
    asOfDate: official.asOfDate || derived.asOfDate,
    mo1: official.mo1,
    qtd: derived.qtd,
    ytd: official.ytd,
    yr1: official.yr1,
    cagr3y: official.cagr3y,
    cagr5y: official.cagr5y,
    cagr10y: official.cagr10y,
    siAnn: official.siAnn,
  };
}

function returnRowJson(row: OfficialReturnRow | null): JsonRecord | null {
  if (!row) return null;
  const text = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)}%`);
  return {
    asOfDate: row.asOfDate ? formatDate(row.asOfDate) : '—',
    mo1: row.mo1, mo1Text: text(row.mo1),
    mo3: row.mo3, mo3Text: text(row.mo3),
    ytd: row.ytd, ytdText: text(row.ytd),
    yr1: row.yr1, yr1Text: text(row.yr1),
    yr3: row.cagr3y, yr3Text: text(row.cagr3y),
    yr5: row.cagr5y, yr5Text: text(row.cagr5y),
    yr10: row.cagr10y, yr10Text: text(row.cagr10y),
    sinceInception: row.siAnn, sinceInceptionText: text(row.siAnn),
  };
}

// ---------------------------------------------------------------------------
// Previous feed access + writers
// ---------------------------------------------------------------------------

function parsePreviousFund(ticker: string, row: JsonRecord): CatalogFund {
  const metrics = row.metrics || {};
  const monthEnd = row.returns?.monthEnd || {};
  const seed = GOLDMAN_SACHS_FUNDS.find((item) => item.ticker === ticker);
  return {
    ticker,
    name: String(row.name || seed?.name || ticker),
    category: String(row.category || seed?.category || 'ETF'),
    categoryPath: String(row.category || seed?.category || 'ETF'),
    inception: toIsoDate(row.inceptionDate) || (seed ? monthDateToIso(seed.inceptionDate) : null) || null,
    exchange: String(row.exchange || ''),
    cusip: String(row.cusip || seed?.cusip || ''),
    isin: String(row.isin || ''),
    benchmark: '',
    ter: numberOrNull(row.terValue),
    grossTer: null,
    nav: numberOrNull(row.navValue),
    close: numberOrNull(row.closePriceValue),
    premiumDiscount: numberOrNull(row.premiumDiscountValue),
    netAssets: numberOrNull(row.aumValue),
    // only an official yield counts here: it is what deriveMetrics labels official-trailing-12m (an indicated one is recomputed)
    dividendYield: metrics.dividendYieldBasis === 'official-trailing-12m' ? numberOrNull(metrics.dividendYield) : null,
    secYield: numberOrNull(metrics.secYield),
    asOfDate: null,
    frequency: String(row.distributions?.frequency || ''),
    returnsAsOf: toIsoDate(monthEnd.asOfDate) || null,
    returns: { ytd: numberOrNull(monthEnd.ytd), yr1: numberOrNull(monthEnd.yr1), yr3: numberOrNull(monthEnd.yr3), yr5: numberOrNull(monthEnd.yr5), yr10: numberOrNull(monthEnd.yr10), sinceInception: numberOrNull(monthEnd.sinceInception) },
    fundPage: String(row.fundPage || seed?.fundPage || ''),
    source: 'previous index',
  };
}

async function readPreviousIndex(): Promise<Map<string, JsonRecord>> {
  const map = new Map<string, JsonRecord>();
  try {
    const data = JSON.parse(await readFile(INDEX_FILE, 'utf8')) as JsonRecord;
    for (const row of Array.isArray(data.funds) ? data.funds : []) if (row?.ticker) map.set(String(row.ticker), row);
  } catch {
    // No published index yet: the per-fund files below still count.
  }
  return map;
}

/** Index row rebuilt from a published funds/<TICKER>/meta.json (for funds missing from a shrunken index). */
export function indexRowFromMeta(meta: JsonRecord): JsonRecord | null {
  const ticker = sanitizeTicker(String(meta?.ticker ?? ''));
  if (!ticker) return null;
  const monthEnd = meta.returns?.monthEnd || {};
  const yields = meta.yields || {};
  const text = (value: unknown) => (typeof value === 'string' && value ? value : '—');
  return {
    ticker,
    name: String(meta.name || ticker),
    category: String(meta.category || 'ETF'),
    fundPage: String(meta.source?.fundPage || ''),
    dataFile: `./funds/${ticker}/meta.json`,
    cusip: meta.identifiers?.cusip || null,
    isin: meta.identifiers?.isin || null,
    ter: text(meta.expenseRatio?.display),
    terValue: numberOrNull(meta.expenseRatio?.value),
    terGross: numberOrNull(meta.expenseRatio?.gross) === null ? '—' : `${numberOrNull(meta.expenseRatio?.gross)}%`,
    terGrossValue: numberOrNull(meta.expenseRatio?.gross),
    nav: text(meta.nav?.display),
    navValue: numberOrNull(meta.nav?.value),
    aum: text(meta.aum?.display),
    aumValue: numberOrNull(meta.aum?.value),
    asOfDate: text(meta.nav?.asOfDate),
    inceptionDate: '—',
    exchange: String(meta.identifiers?.exchange || ''),
    closePrice: text(meta.marketPrice?.display),
    closePriceValue: numberOrNull(meta.marketPrice?.value),
    premiumDiscount: text(meta.premiumDiscount?.display),
    premiumDiscountValue: numberOrNull(meta.premiumDiscount?.value),
    frequencyCode: text(meta.distributions?.frequencyCode),
    distributions: { frequency: meta.distributions?.frequency || '—', exDate: '—', dividend: '—' },
    returns: meta.returns || {},
    metrics: {
      ytd: numberOrNull(monthEnd.ytd), tr1y: numberOrNull(monthEnd.yr1), tr3y: annualizedToTotal(numberOrNull(monthEnd.yr3), 3), tr5y: annualizedToTotal(numberOrNull(monthEnd.yr5), 5), tr10y: annualizedToTotal(numberOrNull(monthEnd.yr10), 10),
      cagr3y: numberOrNull(monthEnd.yr3), cagr5y: numberOrNull(monthEnd.yr5), cagr10y: numberOrNull(monthEnd.yr10), siAnn: numberOrNull(monthEnd.sinceInception),
      dividendYield: numberOrNull(yields.dividendYield), dividendYieldText: text(yields.dividendYieldText), dividendYieldBasis: yieldBasisFromYields(yields),
      secYield: numberOrNull(yields.secYield), secYieldText: text(yields.secYieldText),
      returnsBasis: String(meta.returns?.derivedFrom || OFFICIAL_RETURNS_BASIS),
      performanceAsOf: performanceAsOf(monthEnd.asOfDate),
    },
    holdings: numberOrNull(meta.holdings?.totalRows) ?? 0,
    history: numberOrNull(meta.history?.totalRows) ?? 0,
  };
}

/** Every fund the feed already knows: the published index rows plus every per-fund meta.json (index rows win). */
async function readKnownFunds(): Promise<Map<string, JsonRecord>> {
  const known = await readPreviousIndex();
  try {
    for (const entry of await readdir(new URL('funds/', API_ROOT), { withFileTypes: true })) {
      if (!entry.isDirectory() || known.has(entry.name)) continue;
      const meta = await readPreviousMeta(entry.name);
      const row = meta ? indexRowFromMeta(meta) : null;
      if (row) known.set(String(row.ticker), row);
    }
  } catch {
    // No funds/ directory yet.
  }
  return known;
}

/** Published rows plus refreshed rows (refreshed win), sorted by ticker: a bounded run can only add or refresh, never drop. */
export function mergePublishedRows(known: Map<string, JsonRecord>, refreshed: JsonRecord[]): JsonRecord[] {
  const merged = new Map(known);
  for (const row of refreshed) merged.set(String(row.ticker), row);
  return [...merged.values()].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
}

async function readPreviousMeta(ticker: string): Promise<JsonRecord | null> {
  try {
    return JSON.parse(await readFile(new URL(`funds/${ticker}/meta.json`, API_ROOT), 'utf8')) as JsonRecord;
  } catch {
    return null;
  }
}

async function readPreviousSheet(ticker: string, kind: 'holdings' | 'history'): Promise<JsonRecord[]> {
  const meta = await readPreviousMeta(ticker);
  const pages = meta?.[kind]?.pages;
  if (!Array.isArray(pages)) return [];
  const rows: JsonRecord[] = [];
  for (const page of pages) {
    try {
      const pagePath = String(page).includes('/') ? String(page) : `${kind}/${page}`;
      const data = JSON.parse(await readFile(new URL(`funds/${ticker}/${pagePath}`, API_ROOT), 'utf8')) as JsonRecord;
      if (Array.isArray(data.rows)) rows.push(...data.rows);
    } catch {
      // Keep the rows already recovered from earlier pages.
    }
  }
  return rows;
}

async function readPreviousHeaders(ticker: string, kind: 'holdings' | 'history'): Promise<string[] | null> {
  const meta = await readPreviousMeta(ticker);
  const first = Array.isArray(meta?.[kind]?.pages) ? meta[kind].pages[0] : null;
  if (!first) return null;
  try {
    const pagePath = String(first).includes('/') ? String(first) : `${kind}/${first}`;
    const data = JSON.parse(await readFile(new URL(`funds/${ticker}/${pagePath}`, API_ROOT), 'utf8')) as JsonRecord;
    return Array.isArray(data.headers) ? data.headers : null;
  } catch {
    return null;
  }
}

// Comparing raw text would treat a run that only refreshed generatedAt (with
// every fund's actual data unchanged) as a real change and rewrite the file
// every time. Compare with both timestamps stripped instead.
export function samePublishedContent(previous: string, value: unknown): boolean {
  const withoutRunTimestamp = (item: unknown): unknown => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const { generatedAt, savedAt, ...content } = item as Record<string, unknown>;
    return content;
  };
  try {
    return JSON.stringify(withoutRunTimestamp(JSON.parse(previous))) === JSON.stringify(withoutRunTimestamp(value));
  } catch { return false; }
}

/** Temp file + rename in the same directory: a crash never leaves a half-written JSON file. */
async function writeAtomic(file: URL, text: string): Promise<void> {
  await mkdir(new URL('.', file), { recursive: true });
  const temp = new URL(`${file.pathname.split('/').pop()}.tmp-${process.pid ?? 0}`, new URL('.', file));
  try {
    await writeFile(temp, text, 'utf8');
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function writeIfChanged(file: URL, value: unknown): Promise<boolean> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    const previous = await readFile(file, 'utf8');
    if (previous === text || samePublishedContent(previous, value)) return false;
  } catch {
    // New file.
  }
  await writeAtomic(file, text);
  return true;
}

/** Writes the pages of one sheet (never deletes). Stale pages are pruned by prunePages AFTER the new meta.json is written. */
async function writePages(fundDir: URL, ticker: string, kind: 'holdings' | 'history', headers: string[], rows: JsonRecord[], pageSize: number, asOfDate: string | null, source: string): Promise<JsonRecord> {
  const dir = new URL(`${kind}/`, fundDir);
  const pageCount = rows.length ? Math.ceil(rows.length / pageSize) : 0;
  const kept = new Set<string>();
  for (let page = 0; page < pageCount; page += 1) {
    const name = `${String(page + 1).padStart(3, '0')}.json`;
    kept.add(name);
    await writeIfChanged(new URL(name, dir), { ticker, page: page + 1, pageSize, totalRows: rows.length, headers, rows: rows.slice(page * pageSize, (page + 1) * pageSize) });
  }
  return { pages: [...kept].sort().map((name) => `${kind}/${name}`), pageSize, totalRows: rows.length, ...(kind === 'holdings' ? { asOfDate, asOf: asOfDate ? formatDate(asOfDate) : '—', source } : { asOf: asOfDate ? formatDate(asOfDate) : '—', source }) };
}

/** Removes page files that the manifest no longer lists (run after meta.json points at the new pages). */
async function prunePages(fundDir: URL, kind: 'holdings' | 'history', manifest: JsonRecord): Promise<void> {
  const dir = new URL(`${kind}/`, fundDir);
  const keep = new Set((manifest.pages as string[]).map((page) => page.split('/').pop()));
  try {
    for (const name of await readdir(dir)) if ((name.endsWith('.json') || name.includes('.tmp-')) && !keep.has(name)) await rm(new URL(name, dir), { force: true });
  } catch {
    // No directory: nothing to prune.
  }
}

/** Filters that need nothing but the catalog row: TICKERS, and TER when the catalog already carries a value (otherwise TER is judged after the fund page is read). */
function catalogFilterReasons(fund: CatalogFund, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  if (config.tickers && !config.tickers.has(fund.ticker)) reasons.push('TICKERS');
  if (fund.ter !== null && !rangeMatches(fund.ter, config.ter)) reasons.push('TER');
  return reasons;
}

export function postFetchFilterReasons(fund: CatalogFund, metrics: JsonRecord, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  if (!rangeMatches(fund.ter, config.ter)) reasons.push('TER');
  if (!rangeMatches(fund.netAssets, config.aum)) reasons.push('AUM');
  if (!rangeMatches(numberOrNull(metrics.dividendYield), config.dividendYield)) reasons.push('DIVIDEND_YIELD');
  if (!rangeMatches(numberOrNull(metrics.secYield), config.secYield)) reasons.push('SEC_YIELD');
  const annual: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.tr1y, '3Y': metrics.cagr3y, '5Y': metrics.cagr5y, '10Y': metrics.cagr10y };
  const cumulative: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.tr1y, '3Y': metrics.tr3y, '5Y': metrics.tr5y, '10Y': metrics.tr10y };
  // A bounded range excludes a fund with no figure (rangeMatches is false for null).
  for (const [period, range] of Object.entries(config.performance) as [ReturnPeriod, Range][]) if (!rangeMatches(annual[period], range)) reasons.push(`PERFORMANCE_${period}`);
  for (const [period, range] of Object.entries(config.totalReturn) as [ReturnPeriod, Range][]) if (!rangeMatches(cumulative[period], range)) reasons.push(`TOTAL_RETURN_${period}`);
  return reasons;
}

// ---------------------------------------------------------------------------
// Index rows: metrics contract, dataFile, placeholders
// ---------------------------------------------------------------------------

const METRIC_KEYS = ['ytd', 'tr1y', 'tr3y', 'tr5y', 'tr10y', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn', 'dividendYield', 'dividendYieldText', 'dividendYieldBasis', 'secYield', 'secYieldText', 'returnsBasis', 'performanceAsOf'] as const;
export const NO_DATA_BASIS = 'no data published for this fund yet; the next successful update fills it';

/** Every row carries the full metrics key set: numbers in percent, null (never 0) for unavailable, text '—' for missing text, and a non-empty returnsBasis. */
export function withMetricsContract<T extends JsonRecord>(row: T): T {
  const source: JsonRecord = row.metrics && typeof row.metrics === 'object' ? row.metrics : {};
  const metrics: JsonRecord = { ...source };
  delete metrics.null;
  for (const key of METRIC_KEYS) if (metrics[key] === undefined) metrics[key] = null;
  for (const key of ['dividendYieldText', 'secYieldText'] as const) if (metrics[key] === null) metrics[key] = '—';
  // the code travels with its yield: null exactly when the yield is null; a yield without a valid code is an unverified estimate
  metrics.dividendYieldBasis = numberOrNull(metrics.dividendYield) === null ? null : isYieldBasis(metrics.dividendYieldBasis) ? metrics.dividendYieldBasis : 'indicated';
  if (typeof metrics.returnsBasis !== 'string' || !metrics.returnsBasis.trim()) metrics.returnsBasis = String(row.returns?.derivedFrom || NO_DATA_BASIS);
  const ordered: JsonRecord = {};
  for (const key of METRIC_KEYS) ordered[key] = metrics[key];
  for (const [key, value] of Object.entries(metrics)) if (!(key in ordered)) ordered[key] = value;
  return { ...row, metrics: ordered };
}

/** Index row for a catalog fund that has no published data yet: no meta.json, so dataFile is null. */
export function placeholderRow(fund: Pick<CatalogFund, 'ticker' | 'name' | 'category' | 'fundPage' | 'cusip' | 'isin'>): JsonRecord {
  return withMetricsContract({
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    fundPage: fund.fundPage,
    dataFile: null,
    cusip: fund.cusip || null,
    isin: fund.isin || null,
    ter: '—', terValue: null, terGross: '—', terGrossValue: null,
    nav: '—', navValue: null, aum: '—', aumValue: null,
    asOfDate: '—', inceptionDate: '—', exchange: '',
    closePrice: '—', closePriceValue: null, premiumDiscount: '—', premiumDiscountValue: null,
    frequencyCode: '00 - Unknown',
    distributions: { frequency: '—', exDate: '—', dividend: '—' },
    returns: {},
    holdings: 0,
    history: 0,
  });
}

/** dataFile points at a meta.json that exists, or is null; the metrics contract holds; gross TER keys exist. */
async function finalizeRow(row: JsonRecord): Promise<JsonRecord> {
  const exists = Boolean(await readPreviousMeta(String(row.ticker)));
  const meta = exists ? await readPreviousMeta(String(row.ticker)) : null;
  const rowMetrics: JsonRecord = row.metrics && typeof row.metrics === 'object' ? row.metrics : {};
  // A published row from before the key existed takes its code from the fund's meta.json (the yield is the same one).
  const fromMeta = !isYieldBasis(rowMetrics.dividendYieldBasis) && numberOrNull(rowMetrics.dividendYield) !== null && numberOrNull(meta?.yields?.dividendYield) === numberOrNull(rowMetrics.dividendYield) ? yieldBasisFromYields(meta?.yields) : null;
  const next: JsonRecord = withMetricsContract({ ...row, ...(fromMeta ? { metrics: { ...rowMetrics, dividendYieldBasis: fromMeta } } : {}), dataFile: exists ? `./funds/${row.ticker}/meta.json` : null });
  if (next.terGrossValue === undefined) { next.terGross = '—'; next.terGrossValue = null; }
  return next;
}

// ---------------------------------------------------------------------------
// Per-fund pipeline
// ---------------------------------------------------------------------------

const OFFICIAL_PRICING_SOURCE = 'official fund page Pricing Table';
const PROVIDER_LABEL = 'Goldman Sachs Asset Management fund finder + official fund data API (fund page figures, Distributions table, daily All Holdings) + SEC EDGAR Form N-PORT-P holdings fallback + Yahoo Finance public chart API';
const GS_HOLDINGS_SOURCE = 'Goldman Sachs fund data API All Holdings (am.gs.com/services/funds, daily';

/** A published returns block (returnRowJson shape) back as an official row; null when it carries no figure. */
function officialRowFromPublished(block: any): OfficialReturnRow | null {
  if (!block || typeof block !== 'object') return null;
  const asOf = toIsoDate(block.asOfDate);
  const row: OfficialReturnRow = {
    asOfDate: /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : '',
    mo1: numberOrNull(block.mo1), mo3: numberOrNull(block.mo3), ytd: numberOrNull(block.ytd), yr1: numberOrNull(block.yr1),
    cagr3y: numberOrNull(block.yr3), cagr5y: numberOrNull(block.yr5), cagr10y: numberOrNull(block.yr10), siAnn: numberOrNull(block.sinceInception),
  };
  return [row.mo1, row.mo3, row.ytd, row.yr1, row.cagr3y, row.cagr5y, row.cagr10y, row.siAnn].some((value) => value !== null) ? row : null;
}

/**
 * A fund page that came back partial (the rendering proxy dropped sections: see `loadedFully`) says nothing
 * about the sections it lacks. Every section that was published as official before and is absent from such a page
 * counts as a FAILED read: its previous official block is restored into `summary`/`fund` as one unit (values with
 * their dates, basis and sources), so the normal build below republishes it unchanged instead of flipping to
 * Yahoo-derived values or null. A page that loaded fully and lacks a field is an honest null and never gets here.
 * Returns the names of the kept sections.
 */
function retainPublishedSections(summary: ProductPageSummary, fund: CatalogFund, previousMeta: JsonRecord | null): string[] {
  if (summary.loadedFully || !previousMeta) return [];
  const kept: string[] = [];
  const pricing = previousMeta.marketPrice;
  if (!summary.sections.pricing && pricing?.source === OFFICIAL_PRICING_SOURCE && numberOrNull(pricing.value) !== null) {
    const asOf = toIsoDate(pricing.asOfDate);
    summary.marketPrice = numberOrNull(pricing.value);
    summary.pricingAsOfDate = /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null;
    fund.close = summary.marketPrice;
    if (previousMeta.premiumDiscount?.source === OFFICIAL_PRICING_SOURCE) {
      summary.premiumDiscount = numberOrNull(previousMeta.premiumDiscount.value);
      fund.premiumDiscount = summary.premiumDiscount;
    }
    const facts = previousMeta.fundFacts || {};
    summary.bidAsk = numberOrNull(facts.bidAskMidpoint);
    summary.premiumDays = numberOrNull(facts.premiumDays);
    summary.atNavDays = numberOrNull(facts.atNavDays);
    summary.discountDays = numberOrNull(facts.discountDays);
    kept.push('pricing table');
  }
  const yields = previousMeta.yields || {};
  const officialYield = (kind: unknown, prefix: string) => typeof kind === 'string' && kind.startsWith(prefix);
  const keepDist = (officialYield(yields.dividendYieldKind, '12 Month Trailing') || yields.dividendYieldBasis === 'official-trailing-12m') && numberOrNull(yields.distributionRate) !== null;
  const keepSec = officialYield(yields.secYieldKind, 'Standardized 30-Day') && numberOrNull(yields.secYield) !== null;
  if (!summary.sections.yields && (keepDist || keepSec)) {
    if (keepDist) { summary.distRate12M = numberOrNull(yields.distributionRate); fund.dividendYield = summary.distRate12M; }
    if (keepSec) { summary.secYieldSubsidized = numberOrNull(yields.secYield); fund.secYield = summary.secYieldSubsidized; }
    summary.yieldsAsOfDate = monthDateToIso(String(keepDist ? yields.dividendYieldKind : yields.secYieldKind).replace(/^.*?\bas of /, '')) || null;
    kept.push('yields');
  }
  const monthEnd = officialRowFromPublished(previousMeta.returns?.monthEnd);
  if (!summary.sections.returns && previousMeta.returns?.derivedFrom === OFFICIAL_RETURNS_BASIS && monthEnd) {
    summary.officialReturns = {
      monthEnd: { nav: monthEnd, marketPrice: officialRowFromPublished(previousMeta.officialMarketPriceReturns?.monthEnd) },
      quarterEnd: { nav: officialRowFromPublished(previousMeta.returns?.quarterEnd), marketPrice: officialRowFromPublished(previousMeta.officialMarketPriceReturns?.quarterEnd) },
    };
    kept.push('month-end returns');
  }
  if (!summary.sections.distributions && String(previousMeta.distributions?.source || '').startsWith('official fund-page Distributions table') && Array.isArray(previousMeta.distributions?.rows) && previousMeta.distributions.rows.length) {
    kept.push('distributions');
  }
  const top = previousMeta.topHoldings;
  if (!summary.sections.topHoldings && !summary.topHoldings && top && Array.isArray(top.rows) && top.rows.length) {
    const asOf = toIsoDate(top.asOfDate);
    summary.topHoldings = { asOfDate: /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null, top10Pct: numberOrNull(top.top10Pct), rows: top.rows };
    kept.push('top holdings');
  }
  return kept;
}

async function processFund(fund: CatalogFund, config: UpdaterConfig, previous: JsonRecord = {}): Promise<JsonRecord> {
  const reasons = catalogFilterReasons(fund, config);
  if (reasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: reasons };
  }
  // The fund is computed completely in memory and written once, at the end (step 6). Nothing is
  // created on disk before that, so a filtered-out or failed fund leaves no empty funds/<T>/ directory.
  const fundDir = new URL(`funds/${fund.ticker}/`, API_ROOT);
  const previousMeta = await readPreviousMeta(fund.ticker);

  // 1. Official fund page (required unless SKIP_GOLDMANSACHS) -------------------
  // A fund is either fully updated or fully kept from before: when a required source (the fund page
  // or the Yahoo chart) fails, this function throws and nothing of the fund is written.
  let summary: ProductPageSummary | null = null;
  let productVia: 'direct' | 'proxy' | null = null;
  let productFromApi = false;
  if (!config.skipGoldmanSachs) {
    if (!fund.fundPage) throw new Error('no official fund page URL; kept the published data');
    if (fund.source === 'previous index') {
      // Rebuilt from the published row: nothing of it may stand in for a value the fresh page leaves out.
      Object.assign(fund, { ter: null, grossTer: null, nav: null, close: null, premiumDiscount: null, netAssets: null, dividendYield: null, secYield: null, asOfDate: null, returnsAsOf: null, returns: { ...EMPTY_RETURNS } });
    }
    try {
      // Direct: the fund data API the page reads (identity-checked by ticker); a server-rendered page still
      // validates too. Fallback: the rendered public page through the read-only proxy.
      const label = `[product ] ${fund.ticker}`;
      const variables = gsDetailVariables(fund.fundPage);
      const page = await fetchIssuerText(fund.fundPage, label, config, (text) => isGsFundDetail(text, fund.ticker) || (!gsApiData(text) && /Net Asset Value|Total Fund Assets|Fund Inception Date/i.test(text)), undefined, { cache: false, direct: variables ? () => fetchGsApi(GS_DETAIL_QUERY, variables, label, config) : undefined });
      productVia = page.via;
      productFromApi = page.via === 'direct' && gsApiData(page.text) !== null;
      summary = parseProductPage(page.text, fund.ticker);
      if (config.storeRawDownloads) {
        const raw = new URL('raw/', API_ROOT);
        await mkdir(raw, { recursive: true });
        await writeFile(new URL(`${fund.ticker}-fund-page.${page.via === 'proxy' ? 'md' : gsApiData(page.text) ? 'json' : 'html'}`, raw), page.text, 'utf8');
      }
      if (summary.name) fund.name = summary.name;
      if (summary.cusip) fund.cusip = summary.cusip;
      if (summary.exchange) fund.exchange = summary.exchange;
      if (summary.benchmark) fund.benchmark = summary.benchmark;
      if ((!fund.category || fund.category === 'ETF') && summary.assetClass) { fund.category = summary.assetClass; fund.categoryPath = summary.assetClass; }
      if (summary.inception) fund.inception = summary.inception;
      if (summary.nav !== null) fund.nav = summary.nav;
      if (summary.aumDaily !== null) fund.netAssets = summary.aumDaily;
      else if (summary.aumMonthly !== null) fund.netAssets = summary.aumMonthly;
      if (summary.netExpenseRatio !== null) fund.ter = summary.netExpenseRatio;
      if (summary.grossExpenseRatio !== null) fund.grossTer = summary.grossExpenseRatio;
      if (summary.marketPrice !== null) fund.close = summary.marketPrice;
      if (summary.premiumDiscount !== null) fund.premiumDiscount = summary.premiumDiscount;
      if (summary.secYieldSubsidized !== null) fund.secYield = summary.secYieldSubsidized;
      if (summary.distRate12M !== null) fund.dividendYield = summary.distRate12M;
      if (summary.navAsOfDate) fund.asOfDate = summary.navAsOfDate;
    } catch (error) {
      throw new Error(`official fund page unavailable (${error instanceof Error ? error.message : String(error)}); kept the published data`);
    }
  }
  // A partial page keeps what was published as official (one `[ kept ]` notice per fund naming the sections).
  const keptSections = summary ? retainPublishedSections(summary, fund, previousMeta) : [];
  if (keptSections.length) console.log(`[ ${'kept'.padEnd(9)}] ${fund.ticker}: fund page came back partial, kept the published ${keptSections.join(', ')}`);
  // Only with SKIP_GOLDMANSACHS (no page read at all) the published fee and yield stand in; a page
  // that was read and omits a value is an honest null and is never refilled from the previous run.
  const carry = !summary;
  const previousMetrics = (previous.metrics as JsonRecord | undefined) || {};
  const previousYields = (previousMeta?.yields as JsonRecord | undefined) || {};
  if (carry) {
    if (fund.ter === null) fund.ter = numberOrNull(previous.terValue);
    if (fund.grossTer === null) fund.grossTer = numberOrNull((previousMeta?.expenseRatio as JsonRecord | undefined)?.gross);
    if (fund.secYield === null && String(previousYields.secYieldKind || '').startsWith('Standardized 30-Day')) fund.secYield = numberOrNull(previousMetrics.secYield);
    if (fund.dividendYield === null && (String(previousYields.dividendYieldKind || '').startsWith('12 Month Trailing') || previousYields.dividendYieldBasis === 'official-trailing-12m')) fund.dividendYield = numberOrNull(previousMetrics.dividendYield);
  }
  if (!fund.isin && fund.cusip) fund.isin = isinFromCusip(fund.cusip);

  // 2. Holdings: fund data API allHoldings -> N-PORT-P (EDGAR_FALLBACK) -> previous run ----------
  // The fund data API answer carries the fund page's All Holdings table (daily, every position). It
  // arrives with the identity-checked fund answer; an older list than the published one never
  // replaces it. Only when it is missing (proxy rendering, an empty or failed list) the public SEC
  // N-PORT-P filing is tried, which is months older and so never replaces published daily holdings
  // (strictly newer only, shared nport-reader block); otherwise the published sheet is kept as it is.
  let holdingsRows: JsonRecord[] = [];
  let holdingsHeaders: string[] = HOLDINGS_HEADERS;
  let holdingsAsOf: string | null = null;
  let holdingsSource = 'not available (no fund data API holdings list and no public SEC filing)';
  let holdingsDownload: string | null = null;
  let marketValueBasis: string | null = null;
  let nport: NportFiling | null = null;
  const apiHoldings = summary?.allHoldings ?? null;
  if (apiHoldings) {
    const published = toIsoDate(previousMeta?.holdings?.asOfDate ?? '');
    const stale = apiHoldings.asOfDate !== null && /^\d{4}-\d{2}-\d{2}$/.test(published) && apiHoldings.asOfDate < published;
    if (stale) outputNote(`[ ${'holdings'.padEnd(9)}] ${fund.ticker}: fund data API list ${apiHoldings.asOfDate} is older than the published holdings ${published}; keeping the published holdings`);
    else if (apiHoldings.rows.some(gsNeedsNameCheck) && !(await loadCompanyNames(config).catch(() => null))) {
      // a foreign line's ticker cannot be checked without SEC's company table: the published sheet stays, never local codes
      outputNote(`[ ${'holdings'.padEnd(9)}] ${fund.ticker}: SEC company ticker table unavailable, keeping the published holdings`);
    } else {
      const foreignLines = apiHoldings.rows.some(gsNeedsNameCheck);
      holdingsRows = gsListedTickers(apiHoldings.rows, foreignLines ? await loadCompanyNames(config) : null, foreignLines ? await loadUsListings((url, label) => fetchText(url, `[holdings] ${label}`, config, secHeaders())) : null);
      holdingsHeaders = apiHoldings.headers;
      holdingsAsOf = apiHoldings.asOfDate;
      holdingsDownload = fund.fundPage;
      holdingsSource = `${GS_HOLDINGS_SOURCE}${apiHoldings.asOfDate ? `, as of ${apiHoldings.asOfDate}` : ''})`;
      marketValueBasis = 'Goldman Sachs fund data API market value (USD)';
    }
  }
  if (!holdingsRows.length && config.edgarFallback) {
    try {
      // the fund's own newest filing, read only when strictly newer than the published holdings (shared nport-reader block)
      const ref = (await loadFundTickerTable(config)).get(fund.ticker) || SEC_SERIES_OVERRIDES[fund.ticker] || null;
      const read = ref
        ? await readNportHoldings({ ticker: fund.ticker, cik: ref.cik, seriesId: ref.seriesId }, { asOf: previousMeta?.holdings?.asOfDate, rows: numberOrNull(previousMeta?.holdings?.totalRows) ?? 0 }, (url, label) => fetchText(url, `[nport   ] ${label}`, config, secHeaders()), { cache: secState.reader })
        : { problem: `${fund.ticker}: not in the SEC fund ticker table` };
      if ('problem' in read) outputNote(`[ ${'nport'.padEnd(9)}] ${read.problem}`);
      else {
        const sheet = nportHoldingsSheet(read.filing, nportTickers(read.filing.positions, await loadCompanyNames(config).catch(() => null), await loadUsListings((url, label) => fetchText(url, `[nport   ] ${label}`, config, secHeaders()))));
        holdingsRows = sheet.rows;
        holdingsHeaders = sheet.headers;
        holdingsAsOf = read.filing.repPdDate || null;
        nport = read.filing;
        holdingsDownload = read.url;
        holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${read.candidate.accession}, report period ${read.filing.repPdDate || 'n/a'})`;
        marketValueBasis = 'SEC Form N-PORT-P reported value (valUSD)';
      }
    } catch (error) {
      outputNote(`[ ${'nport'.padEnd(9)}] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const holdingsFresh = holdingsRows.length > 0; // fund data API or N-PORT; false when the previous sheet is re-read below
  if (!holdingsRows.length) {
    holdingsRows = await readPreviousSheet(fund.ticker, 'holdings');
    holdingsHeaders = (await readPreviousHeaders(fund.ticker, 'holdings')) || holdingsHeaders;
    holdingsAsOf = previousMeta?.holdings?.asOfDate || null;
    holdingsSource = previousMeta?.holdings?.source || holdingsSource;
    holdingsDownload = previousMeta?.source?.holdingsDownload || holdingsDownload;
    marketValueBasis = previousMeta?.holdings?.marketValueBasis || marketValueBasis;
  }

  // 3. Distributions: fund-page table -> Yahoo dividends -> previous run ------
  let dividends: Distribution[] = summary?.distributions || [];
  let distributionsSource = 'not available';
  const distributionsDownload: string | null = null;
  if (dividends.length) distributionsSource = `official fund-page Distributions table (distribution per share${productVia === 'proxy' ? ', via read-only rendering proxy' : ''})`;

  // 4. Yahoo chart: history + dividend fallback --------------------------------
  let chart: ParsedChart | null = null;
  let days: ChartDay[] = [];
  let historySource = 'Yahoo Finance public chart API (adjusted close)';
  if (!config.skipYahoo) {
    try {
      // Explicit period1/period2 (HISTORY_RANGE=Ny really shrinks the window; Yahoo ignores `range` next to period1).
      const query = yahooChartQuery(config.historyRange);
      const payload = await fetchJson(`${YAHOO_CHART_URL}/${encodeURIComponent(fund.ticker)}?${query.toString()}`, `[chart   ] ${fund.ticker}`, config, { 'User-Agent': 'Mozilla/5.0' });
      const fetched = parseChart(payload);
      // A HISTORY_RANGE window never shrinks the published history (and with it 3y, 5y, 10y and since inception)
      chart = config.historyRange !== 'max' ? mergeWindowedChart(fetched, await readPreviousSheet(fund.ticker, 'history'), Array.isArray(previousMeta?.distributions?.rows) ? previousMeta.distributions.rows : []) : fetched;
      if (!chart) throw new Error(`chart window does not join the published history (${config.historyRange})`);
      days = chart.days;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Yahoo answers HTTP 404 / "no result" for a symbol it has no chart for: that is an honest empty
      // history (the published rows stay), not a failed source. Everything else fails the whole fund.
      if (!/\b404\b|no result/i.test(message)) throw new Error(`Yahoo chart unavailable (${message}); kept the published data`);
      outputNote(`[ ${'chart'.padEnd(9)}] ${fund.ticker}: ${message}`);
    }
  }
  const previousHistory = await readPreviousSheet(fund.ticker, 'history');
  if (!days.length) {
    days = previousHistory.map((row) => ({ date: toIsoDate(row.Date), close: numberOrNull(row.Close) || 0, adjClose: numberOrNull(row['Adj Close']) || numberOrNull(row.Close) || 0, volume: numberOrNull(row.Volume) || 0 })).filter((row) => row.date && row.close > 0);
    if (previousHistory.length) historySource = previousMeta?.history?.source || 'previous run';
  }
  // Returns are derived from the same kept cents the history pages publish, so Yahoo's float noise
  // can flip neither a stored Adj Close nor a stored return.
  const history = historyRows(days, previousHistory);
  days = days.map((day, i) => ({ ...day, adjClose: numberOrNull(history[i]['Adj Close']) ?? day.adjClose }));
  if (!dividends.length && !keptSections.includes('distributions') && chart?.dividends.length) {
    dividends = chart.dividends.map((item) => ({ epoch: item.epoch, amount: round(item.amount, 6) }));
    distributionsSource = 'Yahoo Finance chart dividend events (fund-page Distributions table unavailable)';
  }
  let distributionTable: string[][] = dividends.length ? distributionRows(dividends) : [];
  if (!distributionTable.length && Array.isArray(previousMeta?.distributions?.rows) && previousMeta.distributions.rows.length) {
    distributionTable = previousMeta.distributions.rows;
    distributionsSource = previousMeta.distributions.source || 'previous run';
    dividends = distributionTable.map((row) => ({ epoch: isoToEpoch(toIsoDate(row[0])) ?? 0, amount: numberOrNull(row[1]) ?? 0 })).filter((item) => item.epoch > 0 && item.amount > 0);
  }

  // 5. Returns + metrics --------------------------------------------------------
  const inferred = inferDistributionFrequency(dividends);
  const distributionFrequency = selectDistributionFrequency(fund.frequency, inferred.frequency, dividends.length, previousMeta?.distributions?.frequency);
  const paymentsPerYear = paymentsPerYearForFrequency(distributionFrequency) ?? inferred.paymentsPerYear;
  const latest = dividends[dividends.length - 1] || null;
  const derived = priceReturns(days);
  let officialMonthly = summary?.officialReturns.monthEnd.nav || null;
  // The finder prints Since Inception next to the inception date in the same
  // row, so its SI always annualizes from the displayed inception; converted
  // funds' detail pages annualize from the (much later) ETF inception instead.
  // The finder value therefore wins whenever the finder card parsed.
  if (officialMonthly && fund.returns.sinceInception !== null) {
    officialMonthly = { ...officialMonthly, siAnn: fund.returns.sinceInception };
  }
  // Official values rebuilt from the published row count as official only when that row was official too
  // (the returns then travel with their own basis and date; an older mixed or derived row is recomputed).
  const publishedWasOfficial = fund.source !== 'previous index' || previousMetrics.returnsBasis === OFFICIAL_RETURNS_BASIS;
  if (!officialMonthly && publishedWasOfficial && (fund.returns.yr1 !== null || fund.returns.yr3 !== null || fund.returns.yr5 !== null || fund.returns.yr10 !== null || fund.returns.sinceInception !== null)) {
    // No fund page in this run (SKIP_GOLDMANSACHS): the catalog row carries the same month-end series.
    officialMonthly = { asOfDate: fund.returnsAsOf || '', mo1: null, mo3: null, ytd: fund.returns.ytd, yr1: fund.returns.yr1, cagr3y: fund.returns.yr3, cagr5y: fund.returns.yr5, cagr10y: fund.returns.yr10, siAnn: fund.returns.sinceInception };
  }
  const officialQuarterly = summary?.officialReturns.quarterEnd.nav || null;
  const merged = mergeOfficialReturns(derived, officialMonthly);
  // the shared "younger than one year" rule: no horizon the fund is too young for, official or derived
  const effective = withoutYoungReturns(merged, fund.inception, merged.asOfDate, { yr1: 1, cagr3y: 3, cagr5y: 5, cagr10y: 10, siAnn: 1 });
  const marketPrice = summary?.marketPrice ?? chart?.regularMarketPrice ?? (days.length ? days[days.length - 1].close : carry ? numberOrNull(previous.closePriceValue) : null);
  const nav = fund.nav ?? (carry ? numberOrNull(previous.navValue) : null);
  const metrics = deriveMetrics(effective, fund, dividends, { paymentsPerYear }, nav ?? marketPrice, Boolean(officialMonthly));
  const skipReasons = postFetchFilterReasons(fund, metrics, config);
  if (skipReasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: skipReasons };
  }
  // A new fund (nothing published) that no source answered (no fund page read, no fresh holdings, no Yahoo closes) is not
  // published as an empty meta.json: it fails and keeps its catalog-only index row (dataFile null).
  if (!previousMeta && !summary && !holdingsFresh && !(chart && chart.days.length)) throw new Error('no source answered (fund page, holdings and Yahoo chart); no data published for this fund yet');
  // Fresh holdings that look broken (no weight column, non-numeric weights, a bad weight sum, half the rows gone) never replace
  // the published ones; a fund with nothing published is not written. Checked after the filters: a skipped fund never fails.
  const publishedWeights = holdingsFresh && previousMeta ? holdingsWeightCount((await readPreviousHeaders(fund.ticker, 'holdings')) || HOLDINGS_HEADERS, await readPreviousSheet(fund.ticker, 'holdings')) : null;
  const holdingsProblem = holdingsFresh
    ? holdingsGuard(holdingsHeaders, holdingsRows, numberOrNull(previousMeta?.holdings?.totalRows), HOLDINGS_GUARD_RELAX[fund.ticker] ?? HOLDINGS_GUARD_RELAX['*'] ?? [], publishedWeights)
    : null;
  if (holdingsProblem) throw new Error(`holdings guard: ${holdingsProblem}; ${previousMeta ? 'kept the published data' : 'no data published for this fund yet'}`);

  // 6. Write sheets, meta.json and the index row --------------------------------
  const historyAsOf = derived.asOfDate || previousMeta?.history?.asOf || null;
  const holdingManifest = await writePages(fundDir, fund.ticker, 'holdings', holdingsHeaders, holdingsRows, config.holdingsPageSize, holdingsAsOf, holdingsSource);
  if (marketValueBasis) holdingManifest.marketValueBasis = marketValueBasis;
  if (summary?.totalHoldings !== null && summary?.totalHoldings !== undefined) holdingManifest.publishedTotalHoldings = summary.totalHoldings;
  const historyManifest = await writePages(fundDir, fund.ticker, 'history', historyHeaders(), history, config.historyPageSize, historyAsOf, historySource);
  const premiumDiscount = fund.premiumDiscount ?? (nav && marketPrice ? round((marketPrice / nav - 1) * 100, 2) : carry ? numberOrNull(previous.premiumDiscountValue) : null);
  const netAssets = fund.netAssets ?? nport?.netAssets ?? (carry ? numberOrNull(previous.aumValue) : null);
  const asOfDate = fund.asOfDate || (carry ? toIsoDate(previous.asOfDate) : '') || null;
  const asOfLabel = asOfDate ? formatDate(asOfDate) : chart?.regularMarketTime ? formatDate(new Date(chart.regularMarketTime * 1000).toISOString().slice(0, 10)) : '—';
  const marketPriceAsOfLabel = summary?.pricingAsOfDate ? formatDate(summary.pricingAsOfDate) : chart?.regularMarketTime ? formatDate(new Date(chart.regularMarketTime * 1000).toISOString().slice(0, 10)) : (days.length ? formatDate(days[days.length - 1].date) : asOfLabel);
  const text = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)}%`);
  const returns: JsonRecord = {
    derivedFrom: officialMonthly ? OFFICIAL_RETURNS_BASIS : DERIVED_RETURNS_BASIS,
    monthEnd: {
      asOfDate: effective.asOfDate ? formatDate(effective.asOfDate) : '—',
      mo1: effective.mo1, mo1Text: text(effective.mo1),
      mo3: officialMonthly?.mo3 ?? null, mo3Text: text(officialMonthly?.mo3 ?? null),
      qtd: effective.qtd, qtdText: text(effective.qtd),
      ytd: effective.ytd, ytdText: text(effective.ytd),
      yr1: effective.yr1, yr1Text: text(effective.yr1),
      yr3: effective.cagr3y, yr3Text: text(effective.cagr3y),
      yr5: effective.cagr5y, yr5Text: text(effective.cagr5y),
      yr10: effective.cagr10y, yr10Text: text(effective.cagr10y),
      sinceInception: effective.siAnn, sinceInceptionText: text(effective.siAnn),
    },
    quarterEnd: officialQuarterly ? {
      asOfDate: officialQuarterly.asOfDate ? formatDate(officialQuarterly.asOfDate) : formatDate(lastCompletedQuarterEnd()),
      ytd: null,
      yr1: officialQuarterly.yr1,
      yr3: officialQuarterly.cagr3y,
      yr5: officialQuarterly.cagr5y,
      yr10: officialQuarterly.cagr10y,
      sinceInception: officialQuarterly.siAnn,
    } : { asOfDate: formatDate(lastCompletedQuarterEnd()), ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null },
  };

  const pageSuppliedTer = (summary?.netExpenseRatio ?? null) !== null;
  const pageSuppliedSecYield = (summary?.secYieldSubsidized ?? null) !== null;
  const pageSuppliedDistRate = (summary?.distRate12M ?? null) !== null;
  const meta: JsonRecord = {
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    categoryPath: fund.categoryPath || fund.category,
    source: {
      fundPage: fund.fundPage,
      officialProductPage: fund.fundPage,
      productPageRendering: productVia ? (productVia === 'proxy' ? 'read-only rendering proxy (r.jina.ai) of the official fund page' : productFromApi ? 'official fund data API behind the fund page (am.gs.com/services/funds, direct)' : 'official fund page (direct)') : 'not fetched in this run',
      productPageAsOf: summary?.navAsOfDate ? formatDate(summary.navAsOfDate) : null,
      holdingsDownload,
      distributionsDownload,
      navHistoryDownload: null,
      pricesDownload: null,
      yahooChart: `${YAHOO_CHART_URL}/${encodeURIComponent(fund.ticker)}`,
      holdingsSource,
      historySource,
      distributionsSource,
      provider: PROVIDER_LABEL,
    },
    identifiers: { cusip: fund.cusip || null, isin: fund.isin || null, isinBasis: fund.isin ? (fund.cusip && fund.isin === isinFromCusip(fund.cusip) ? 'derived from the published CUSIP (US prefix + check digit)' : 'previous run') : null, indexTicker: fund.benchmark || null, exchange: fund.exchange || null, morningstarCategory: null, navTicker: summary?.navTicker || null, iopvTicker: summary?.iopvTicker || null },
    expenseRatio: { display: fund.ter === null ? '—' : `${fund.ter}%`, value: fund.ter, gross: fund.grossTer, kind: pageSuppliedTer || fund.ter === null ? 'Net Expense Ratio published on the official fund page (gross expense ratio in `gross`)' : 'Net Expense Ratio carried from the previous run (official fund page)' },
    nav: { display: nav === null ? '—' : `$${nav.toFixed(2)}`, value: nav, asOfDate: summary?.navAsOfDate ? formatDate(summary.navAsOfDate) : asOfLabel },
    marketPrice: { display: marketPrice === null ? '—' : `$${marketPrice.toFixed(2)}`, value: marketPrice, asOfDate: marketPriceAsOfLabel, source: summary?.marketPrice !== null && summary?.marketPrice !== undefined ? OFFICIAL_PRICING_SOURCE : chart ? 'Yahoo Finance last regular-session price' : 'previous run' },
    premiumDiscount: { display: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`, value: premiumDiscount, asOfDate: summary?.pricingAsOfDate ? formatDate(summary.pricingAsOfDate) : asOfLabel, source: fund.premiumDiscount !== null ? OFFICIAL_PRICING_SOURCE : 'computed from market price / fund-page NAV' },
    aum: { display: formatAumDisplay(netAssets), value: netAssets, asOfDate: summary?.aumDailyAsOfDate ? formatDate(summary.aumDailyAsOfDate) : summary?.aumMonthlyAsOfDate ? formatDate(summary.aumMonthlyAsOfDate) : (nport?.repPdDate ? formatDate(nport.repPdDate) : asOfLabel), source: summary?.aumDaily !== null && summary?.aumDaily !== undefined ? 'official fund page Total Fund Assets (Daily)' : summary?.aumMonthly !== null && summary?.aumMonthly !== undefined ? 'official fund page Total Fund Assets (Monthly)' : nport ? `SEC Form N-PORT-P net assets (${nport.repPdDate || 'n/a'})` : 'previous run' },
    fundFacts: { sharesOutstanding: null, portfolioTurnover: null, publishedTotalHoldings: summary?.totalHoldings ?? null, bidAskMidpoint: summary?.bidAsk ?? null, lbmaGoldPrice: summary?.lbmaGoldPrice ?? null, lbmaGoldPriceAsOf: summary?.lbmaGoldPriceAsOfDate ? formatDate(summary.lbmaGoldPriceAsOfDate) : null, premiumDays: summary?.premiumDays ?? null, atNavDays: summary?.atNavDays ?? null, discountDays: summary?.discountDays ?? null },
    yields: {
      dividendYield: metrics.dividendYield,
      dividendYieldText: metrics.dividendYieldText,
      dividendYieldBasis: metrics.dividendYieldBasis,
      dividendYieldKind: pageSuppliedDistRate ? `12 Month Trailing Distribution Rate published on the official fund page${summary?.yieldsAsOfDate ? ` as of ${formatDate(summary.yieldsAsOfDate)}` : ''}` : fund.dividendYield !== null ? 'carried from the previous run (official fund page)' : 'indicated (latest distribution x inferred payments per year / NAV)',
      distributionRate: summary?.distRate12M ?? null,
      secYield: metrics.secYield,
      secYieldText: metrics.secYieldText,
      secYieldKind: pageSuppliedSecYield ? `Standardized 30-Day Subsidized Yield published on the official fund page${summary?.yieldsAsOfDate ? ` as of ${formatDate(summary.yieldsAsOfDate)}` : ''}` : fund.secYield !== null ? 'carried from the previous run (official fund page)' : 'not published on the official fund page for this fund',
    },
    returns,
    officialMarketPriceReturns: summary ? { monthEnd: returnRowJson(summary.officialReturns.monthEnd.marketPrice), quarterEnd: returnRowJson(summary.officialReturns.quarterEnd.marketPrice) } : null,
    distributions: { frequency: distributionFrequency, frequencyCode: frequencyCodeLabel(distributionFrequency), paymentsPerYear, source: distributionsSource, headers: ['Ex-Date', 'Amount'], rows: distributionTable },
    topHoldings: summary?.topHoldings ? { asOfDate: summary.topHoldings.asOfDate ? formatDate(summary.topHoldings.asOfDate) : '—', asOf: summary.topHoldings.asOfDate ? formatDate(summary.topHoldings.asOfDate) : '—', top10Pct: summary.topHoldings.top10Pct, rows: summary.topHoldings.rows } : null,
    holdings: holdingManifest,
    history: historyManifest,
  };
  // Order: pages (above), then meta.json, then stale pages are removed, then the index row (written by the caller).
  await writeIfChanged(new URL('meta.json', fundDir), meta);
  await prunePages(fundDir, 'holdings', holdingManifest);
  await prunePages(fundDir, 'history', historyManifest);

  return {
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    fundPage: fund.fundPage,
    dataFile: `./funds/${fund.ticker}/meta.json`,
    cusip: fund.cusip || null,
    isin: fund.isin || null,
    // terValue = NET expense ratio (after waivers), terGrossValue = GROSS when the page publishes it.
    ter: fund.ter === null ? '—' : `${fund.ter}%`,
    terValue: fund.ter,
    terGross: fund.grossTer === null ? '—' : `${fund.grossTer}%`,
    terGrossValue: fund.grossTer,
    nav: nav === null ? '—' : `$${nav.toFixed(2)}`,
    navValue: nav,
    aum: formatAumDisplay(netAssets),
    aumValue: netAssets,
    asOfDate: asOfLabel,
    inceptionDate: fund.inception ? formatDate(fund.inception) : chart?.firstTradeDate ? formatDate(new Date(chart.firstTradeDate * 1000).toISOString().slice(0, 10)) : (carry ? previous.inceptionDate : '') || '—',
    exchange: fund.exchange || chart?.exchangeName || (carry ? previous.exchange : '') || '',
    closePrice: marketPrice === null ? '—' : `$${marketPrice.toFixed(2)}`,
    closePriceValue: marketPrice,
    premiumDiscount: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`,
    premiumDiscountValue: premiumDiscount,
    frequencyCode: frequencyCodeLabel(distributionFrequency),
    distributions: { frequency: distributionFrequency, exDate: latest ? formatUsDate(latest.epoch) : '—', dividend: latest ? String(round(latest.amount, 6)) : '—' },
    returns,
    metrics,
    holdings: holdingsRows.length,
    history: history.length,
  };
}

function historyHeaders(): string[] {
  return ['Date', 'Close', 'Adj Close', 'Volume'];
}

function configLines(config: UpdaterConfig): string[] {
  return [
    `MAX_FETCHES=${config.maxFetches || 'all'}`,
    `REQUEST_SLEEP=${config.requestSleep}s`,
    `CONCURRENCY=${config.concurrency}`,
    `AUM=${config.aum ? JSON.stringify(config.aum) : '—'}`,
    `TER=${config.ter ? JSON.stringify(config.ter) : '—'}`,
    `TICKERS=${config.tickers ? [...config.tickers].join(',') : 'all'}`,
    `EDGAR_FALLBACK=${config.edgarFallback}`,
    `HISTORY_RANGE=${config.historyRange}`,
  ];
}

const USAGE = `
Goldman Sachs ETF static data updater

Sources:
  catalog       Goldman Sachs Asset Management fund finder, ETFs only (official
                page; read-only r.jina.ai rendering fallback when a
                non-browser request is refused), pinned by
                the universe seed in this file
  fund page     official per-fund page: Quick Stats, Key Facts, Fees &
                Expenses, Pricing Table, Cumulative/Annualized/Quarterly
                returns, Rate, Distributions table, top-10 holdings
  holdings      the fund page's All Holdings list from the fund data API
                (daily, every position); SEC EDGAR Form N-PORT-P for the
                exact series only when that list is missing (EDGAR_FALLBACK)
  distributions Distributions table on the official fund page (Yahoo
                dividend events as the fallback)
  history       Yahoo Finance public chart API (adjusted market-price closes)

Controls (all filters use AND logic). Defaults live in
scripts/update-data.config.json; precedence is file < advanced JSON < nonblank
workflow inputs < environment variables, resolved by one shared resolveControls:
  MAX_FETCHES=0       all eligible funds; positive value is a resumable batch
  REQUEST_SLEEP=2     seconds between request starts of one worker (r.jina.ai proxy requests: one global gate, >= 3.2s)
  CONCURRENCY=2       parallel fund workers; each worker paces its own requests by REQUEST_SLEEP
  AUM=:
  TER=:
  DIVIDEND_YIELD=:    12 Month Trailing Distribution Rate percent min:max
  SEC_YIELD=:         published 30-day SEC yield percent min:max
  TICKERS="GSLC GBIL"  optional ticker allowlist
  PERFORMANCE_YTD|1Y|3Y|5Y|10Y=min:max   annualized ranges
  TOTAL_RETURN_YTD|1Y|3Y|5Y|10Y=min:max cumulative ranges
  HOLDINGS_PAGE_SIZE=250
  HISTORY_PAGE_SIZE=1000
  HISTORY_RANGE=max   max or Ny (last N years): an explicit Yahoo period1/period2 window
  MAX_RETRIES=2       retries after the initial request (integer >= 1)
  STORE_RAW_DOWNLOADS=off
  SEC_UA=             SEC User-Agent override (declare a contact; blank uses the built-in descriptor)
  VERBOSE=off         print per-fund retry and fallback notices
  USE_SYSTEM_CA=auto  TLS trust store: auto restarts once with --use-system-ca on an untrusted-certificate error, true always, false never
  EDGAR_FALLBACK=true SEC N-PORT-P holdings when the fund data API list is missing
  SKIP_GOLDMANSACHS=off use the previously published catalog/fund-page data
  SKIP_YAHOO=off      keep previously published history when possible

Examples:
  TICKERS="GSLC GBIL AAAU" ./scripts/update-data.ts
  AUM="large:" TER=":0.10" ./scripts/update-data.ts
  PERFORMANCE_3Y="10:" TOTAL_RETURN_1Y="15:" ./scripts/update-data.ts
`;

/** The run stops taking new funds after this long and still writes the index (the workflow allows 30 minutes). */
export const SOFT_DEADLINE_MS = 25 * 60 * 1000;

const isoNow = (): string => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Funds in ticker order starting right after the cursor (wrapping); a cursor outside the set still positions by ticker order. */
export function rotateAfterCursor<T extends { ticker: string }>(funds: T[], cursor: string): T[] {
  if (!cursor) return funds;
  return funds.filter((fund) => fund.ticker.localeCompare(cursor) > 0).concat(funds.filter((fund) => fund.ticker.localeCompare(cursor) <= 0));
}

export type MainOptions = { apiRoot?: URL; deadlineMs?: number };

export async function main(env: Record<string, string | undefined> = process.env, options: MainOptions = {}): Promise<void> {
  const controls = await runtimeControls(env);
  if (env === process.env && controls.VERBOSE !== undefined) process.env.VERBOSE = controls.VERBOSE;
  installSystemCa((controls.USE_SYSTEM_CA ?? 'auto').toLowerCase());
  const config = readConfig(controls);
  if (options.apiRoot) setApiRootForTests(options.apiRoot);
  const startedAt = Date.now();
  const deadlineAt = startedAt + (options.deadlineMs ?? SOFT_DEADLINE_MS);
  secUserAgent = config.secUa;
  resetPacing(config.requestSleep);
  resetIssuerDirectState();
  resetSecState();
  outputPrintConfig('Goldman-Sachs', config);

  const previous = await readKnownFunds();
  const catalog = new Map<string, CatalogFund>();
  let catalogSource = 'previous api/goldmansachs/index.json';
  let finderRead = false;
  if (!config.skipGoldmanSachs) {
    try {
      // Direct: the finder's fund data API query (ETF filter); fallback: the rendered finder through the proxy.
      const finderLabel = '[catalog ] fund finder';
      const fetched = await fetchIssuerText(GS_CATALOG_URL, finderLabel, config, (text) => isGsFinder(text) || (/\/funds\/detail\/PV\d+\//i.test(text) && /Average Annual Returns|Distribution Frequency/i.test(text)), undefined, { cache: false, direct: () => fetchGsApi(GS_FINDER_QUERY, gsFinderVariables(), finderLabel, config) });
      const parsed = parseCatalogText(fetched.text);
      for (const fund of parsed) catalog.set(fund.ticker, fund);
      finderRead = parsed.length > 0;
      catalogSource = fetched.via === 'proxy' ? 'Goldman Sachs Asset Management fund finder via read-only rendering proxy' : 'Goldman Sachs Asset Management fund finder';
      if (config.storeRawDownloads) {
        const raw = new URL('raw/', API_ROOT);
        await mkdir(raw, { recursive: true });
        await writeFile(new URL(`fund-finder-${new Date().toISOString().slice(0, 10)}.${fetched.via === 'proxy' ? 'md' : gsApiData(fetched.text) ? 'json' : 'html'}`, raw), fetched.text, 'utf8');
      }
    } catch (error) {
      console.warn(`[ ${'catalog'.padEnd(9)}] ${(error instanceof Error ? error.message : String(error)).replace(/^\[[^\]]*\] ?/, '')} - keeping the published feed`);
    }
  }
  // The checked-in universe seed pins the catalog: seed funds the live finder
  // did not return (card layout drift, pagination) still refresh by URL, and
  // live-only tickers are kept so new listings are never dropped silently.
  const seeds = seedCatalogFunds();
  for (const seed of seeds) if (!catalog.has(seed.ticker)) catalog.set(seed.ticker, seed);
  // The live catalog (finder plus seed; null when the finder was not read): a catalog-only row it no longer lists is dropped, never retried.
  const live = finderRead ? Array.from(catalog.keys()) : null;
  // Funds already published (index rows and funds/*/meta.json) always stay known, even when the live finder or the seed misses them.
  for (const [ticker, row] of previous) if (!catalog.has(ticker) && (!live || row.dataFile)) catalog.set(ticker, parsePreviousFund(ticker, row));

  const universe = [...catalog.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  if (!universe.length) throw new Error('No catalog rows available. Run this where am.gs.com is reachable or seed api/goldmansachs/index.json first.');
  console.log(`[ ${'catalog'.padEnd(9)}] ${universe.length} Goldman Sachs ETFs (${catalogSource})`);

  // Q27: a TICKERS entry outside the live catalog (and the seed) and the published funds stops the run before any fund request
  assertKnownTickers(config.tickers ? Array.from(config.tickers) : null, knownTickers(live, Array.from(previous.values())).concat(seeds.map((seed) => seed.ticker)), 'the Goldman Sachs ETF catalog or published feed');

  // MAX_FETCHES batches walk the filtered set (TICKERS and catalog-level filters) in ticker order from the
  // saved cursor and wrap around. A TICKERS run is an explicit selection: it never reads, moves or deletes the cursor.
  // A closed fund is dropped here, before any per-fund request and before the MAX_FETCHES budget: never fetched, guarded or reported.
  const filtered = withoutClosedFunds(universe.filter((fund) => !catalogFilterReasons(fund, config).length), (fund) => fund.ticker, CLOSED_FUNDS);
  const useCursor = !config.tickers;
  let state: JsonRecord = {};
  if (useCursor) { try { state = JSON.parse(await readFile(STATE_FILE, 'utf8')) as JsonRecord; } catch { state = {}; } }
  const cursor = useCursor && typeof state.cursor === 'string' ? state.cursor : '';
  const ordered = rotateAfterCursor(filtered, cursor);
  const candidates = config.maxFetches > 0 ? ordered.slice(0, config.maxFetches) : ordered;
  if (cursor) console.log(`[ ${'cursor'.padEnd(9)}] resuming after ${cursor}`);

  const queue = candidates.slice();
  const finished = new Set<string>();
  const results: JsonRecord[] = [];
  let failures = 0;
  let deadlineHit = false;
  outputPrintFilter(filtered.length, universe.length, outputHasOutputFilters(config));
  if (issuerDirectDisabled && !outputVerbose()) console.warn(ISSUER_PROXY_NOTICE);
  const output = outputCreateReporter(API_ROOT, candidates.length);
  const worker = async (): Promise<void> => {
    for (;;) {
      if (Date.now() > deadlineAt) { deadlineHit = true; return; }
      const fund = queue.shift();
      if (!fund) return;
      const before = await output.before(fund.ticker);
      try {
        // A catalog-only row (dataFile null: nothing published yet) is no published state: its placeholders never stand in for data.
        const published = previous.get(fund.ticker);
        const row = await processFund(fund, config, published && published.dataFile !== null ? published : {});
        if (row.__skipped) {
          await output.result(fund.ticker, before, 'skipped', (row.__skipReasons || ['not eligible']).join(', '));
        } else {
          results.push(row);
          await output.result(fund.ticker, before);
        }
      } catch (error) {
        failures += 1;
        await output.result(fund.ticker, before, 'failed', error instanceof Error ? error.message : String(error));
      }
      finished.add(fund.ticker);
    }
  };
  // One pacing lane per worker (see paceRequests).
  await Promise.all(Array.from({ length: config.concurrency }, (_, lane) => runOnLane(lane, worker)));
  if (deadlineHit) console.log(`[ ${'deadline'.padEnd(9)}] soft deadline reached after ${Math.round((Date.now() - startedAt) / 1000)}s: ${queue.length} fund(s) left for the next run`);

  // Every known fund keeps its published row (a filtered, bounded, failed or interrupted run never drops one);
  // refreshed rows replace their old ones; catalog funds without data get a placeholder row (dataFile null).
  const merged = new Map<string, JsonRecord>(withoutStalePlaceholders(Array.from(previous.values()), live).map((row) => [String(row.ticker), row] as [string, JsonRecord]));
  for (const fund of universe) if (!merged.has(fund.ticker)) merged.set(fund.ticker, placeholderRow(fund));
  for (const row of results) merged.set(String(row.ticker), row);
  const finalized: JsonRecord[] = [];
  for (const row of [...merged.values()].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)))) finalized.push(await finalizeRow(row));
  const funds = markClosedFunds(finalized, CLOSED_FUNDS);
  const counts = { funds: funds.length, holdings: funds.reduce((sum, row) => sum + (numberOrNull(row.holdings) || 0), 0), history: funds.reduce((sum, row) => sum + (numberOrNull(row.history) || 0), 0) };
  // The index is written last, after every fund's files.
  await writeIfChanged(INDEX_FILE, {
    generatedAt: isoNow(),
    source: {
      provider: 'Goldman Sachs Asset Management, U.S.-listed ETFs',
      market: 'us',
      site: GS_SITE,
      catalog: GS_CATALOG_URL,
      catalogFallback: proxyUrl(GS_CATALOG_URL),
      holdings: 'Goldman Sachs fund data API All Holdings per fund (daily; SEC EDGAR Form N-PORT-P fallback)',
      distributions: 'official fund-page Distributions table per fund (Yahoo dividend events fallback)',
      history: 'Yahoo Finance public chart API (adjusted close)',
    },
    counts,
    funds,
  });
  // Q28: a fund is announced on its first successful publish (a catalog-only row is not published), new catalog-only rows as pending
  const newFunds = newFundsLines(newFundsReport(Array.from(previous.values()), funds));
  for (const line of newFunds) console.log(line);
  if (newFunds.length && env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `### NEW FUNDS\n\n${newFunds.join('\n')}\n`, 'utf8');
  if (useCursor) {
    // The cursor is the last fund of the contiguous prefix of this batch that finished (completion order does not
    // matter). A full pass that finished clears it; a bounded or interrupted batch resumes after it.
    let prefix = 0;
    while (prefix < candidates.length && finished.has(candidates[prefix].ticker)) prefix += 1;
    const next = prefix === 0 ? (cursor || null) : config.maxFetches === 0 && prefix >= ordered.length ? null : candidates[prefix - 1].ticker;
    await writeIfChanged(STATE_FILE, { cursor: next, savedAt: isoNow() });
  }
  console.log(output.summary(startedAt));
  console.log(outputCounts(counts.funds, counts.holdings, counts.history));
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `### Goldman Sachs data update\n\n- updated: ${results.length}\n- failed: ${failures}\n- counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows\n`, 'utf8');
  if (finished.size > 0 && failures === finished.size) {
    console.error(`[ ${'failed'.padEnd(9)}] every selected fund failed`);
    process.exitCode = 1;
  }
}

// Config file defaults and explicit overrides: allowlisted scalar controls only,
// so GitHub Actions and the CLI resolve them through one code path without
// interpolating user input into bash. Precedence: config file < advanced JSON <
// nonblank inputs < environment.
export const CONTROL_NAMES = [
  'MAX_FETCHES', 'REQUEST_SLEEP', 'CONCURRENCY', 'AUM', 'TER', 'DIVIDEND_YIELD', 'SEC_YIELD', 'TICKERS',
  'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'HISTORY_RANGE', 'STORE_RAW_DOWNLOADS', 'MAX_RETRIES', 'SEC_UA',
  'EDGAR_FALLBACK', 'SKIP_YAHOO', 'SKIP_GOLDMANSACHS', 'VERBOSE', 'USE_SYSTEM_CA',
  ...['PERFORMANCE', 'TOTAL_RETURN'].flatMap((prefix) => ['YTD', '1Y', '3Y', '5Y', '10Y'].map((period) => `${prefix}_${period}`)),
] as const;
export type ControlName = (typeof CONTROL_NAMES)[number];
/** Environment aliases that keep working through the resolver. */
const CONTROL_ALIASES: Partial<Record<(typeof CONTROL_NAMES)[number], string>> = { HISTORY_PAGE_SIZE: 'HISTORICAL_PAGE_SIZE' };
export const CONFIG_FILE_URL = new URL('./update-data.config.json', import.meta.url);

export function resolveControls(
  file: unknown = {},
  advanced: unknown = {},
  inputs: unknown = {},
  env: Record<string, string | undefined> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  const known = new Set<string>(CONTROL_NAMES);
  const apply = (value: unknown, skipEmpty = false): void => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Configuration must be a JSON object');
    for (const [key, raw] of Object.entries(value)) {
      if (!known.has(key)) throw new Error(`Unknown updater control: ${key}`);
      if (skipEmpty && (raw === '' || raw === undefined || raw === null)) continue;
      if (!['string', 'number', 'boolean'].includes(typeof raw)) throw new Error(`${key}: expected string, number or boolean`);
      const text = String(raw);
      if (/[\r\n\0]/.test(text)) throw new Error(`${key}: multiline/control characters are not allowed`);
      result[key] = text;
    }
  };
  apply(file);
  apply(advanced);
  apply(inputs, true);
  for (const key of CONTROL_NAMES) {
    // GOLDMANSACHS_<NAME> beats <NAME>, which beats the legacy alias; an explicitly empty value wins like any other.
    const alias = CONTROL_ALIASES[key];
    const value = env[`GOLDMANSACHS_${key}`] ?? env[key] ?? (alias ? env[alias] : undefined);
    if (value !== undefined) apply({ [key]: value });
  }
  for (const key of ['MAX_FETCHES', 'CONCURRENCY', 'HOLDINGS_PAGE_SIZE', 'HISTORY_PAGE_SIZE', 'MAX_RETRIES']) {
    const v = result[key];
    if (v === undefined || v.trim() === '') continue;
    const min = key === 'MAX_FETCHES' ? 0 : 1;
    if (!/^\d+$/.test(v.trim()) || !Number.isSafeInteger(Number(v)) || Number(v) < min) throw new Error(`${key}: expected integer >= ${min}`);
  }
  const sleep = result.REQUEST_SLEEP;
  if (sleep && sleep.trim() && (!Number.isFinite(Number(sleep)) || Number(sleep) < 0)) throw new Error('REQUEST_SLEEP: expected nonnegative seconds');
  for (const key of ['STORE_RAW_DOWNLOADS', 'EDGAR_FALLBACK', 'SKIP_YAHOO', 'SKIP_GOLDMANSACHS', 'VERBOSE']) {
    if (result[key] && !/^(0|1|true|false|yes|no|y|n|on|off)$/i.test(result[key])) throw new Error(`${key}: expected boolean`);
  }
  if (result.HISTORY_RANGE !== undefined && result.HISTORY_RANGE.trim()) parseHistoryRange(result.HISTORY_RANGE);
  if (result.USE_SYSTEM_CA !== undefined && !/^(auto|true|false)$/i.test(result.USE_SYSTEM_CA)) throw new Error('USE_SYSTEM_CA: expected auto, true or false');
  readConfig(result); // validate every min:max filter before any request or write
  return result;
}

export async function runtimeControls(env: Record<string, string | undefined> = process.env): Promise<Record<string, string>> {
  let file: unknown = {};
  try { file = JSON.parse(await readFile(CONFIG_FILE_URL, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return resolveControls(file, {}, {}, env);
}

if ((import.meta as { main?: boolean }).main) {
  if (process.argv.some((arg) => ['-h', '--help', 'help'].includes(arg))) console.log(USAGE.trim());
  else await main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}

// <holdings-guard> shared block of .claude/tools/etfs/etf-std/holdings-guard.block.ts, applied by apply-holdings-guard.ts: never edit it in one repo
/**
 * Sanity check of a fund's new holdings before they replace the published ones. Returns why they must be rejected
 * (the caller then keeps the fund's previous state and reports it as failed), or null when they may be written.
 * An empty sheet passes only when nothing was published before. Otherwise a Name and a weight column (Weight,
 * Weight (%) or Market Weight) are required, >= 80% of the rows carry a numeric weight, the weights add up to
 * 50..150 and the sheet keeps >= 50% of the previously published rows. `relax` switches off the checks a fund
 * legitimately fails: 'numeric' and 'sum' (geared, inverse, futures, look-through, top-N lists) and 'count'. No relax lets
 * a sheet without a single numeric weight replace a published sheet that had numeric weights (`previousWeights`: how many
 * rows of the published sheet carry a numeric weight, see holdingsWeightCount; open-items etfs Q24).
 * Rows are arrays in header order or objects keyed by the header text. A fund in the brand's CLOSED_FUNDS never reaches the guard.
 */
export function holdingsGuard(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, previousRows: number | null | undefined, relax: ReadonlyArray<string> = [], previousWeights: number | null = null): string | null {
  const previous = Number(previousRows) > 0 ? Number(previousRows) : 0;
  if (!rows.length) return previous ? `no holdings rows (${previous} published)` : null;
  const names = headers.map((header) => String(header).trim().toLowerCase());
  const nameAt = names.indexOf('name');
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  if (nameAt < 0 || weightAt < 0) return `no ${nameAt < 0 ? 'Name' : 'weight'} column (headers: ${headers.join(', ') || 'none'})`;
  const weights = holdingsGuardWeights(headers, rows, weightAt);
  const numeric = weights.count;
  const sum = weights.sum;
  if (numeric === 0 && Number(previousWeights) > 0) return `no row has a numeric weight, the published sheet had ${Number(previousWeights)}`;
  if (relax.indexOf('numeric') < 0 && numeric < rows.length * 0.8) return `only ${numeric} of ${rows.length} rows have a numeric weight`;
  if (relax.indexOf('sum') < 0 && (sum < 50 || sum > 150)) return `weights add up to ${sum.toFixed(2)}, outside 50..150`;
  if (relax.indexOf('count') < 0 && previous && rows.length < previous * 0.5) return `${rows.length} rows, less than half of the ${previous} published`;
  return null;
}

/** How many rows carry a numeric weight (Weight, Weight (%) or Market Weight column), 0 without such a column: pass it for the published sheet as holdingsGuard's previousWeights. */
export function holdingsWeightCount(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>): number {
  const names = headers.map((header) => String(header).trim().toLowerCase());
  let weightAt = names.indexOf('weight');
  if (weightAt < 0) weightAt = names.indexOf('weight (%)');
  if (weightAt < 0) weightAt = names.indexOf('market weight');
  return weightAt < 0 ? 0 : holdingsGuardWeights(headers, rows, weightAt).count;
}

/** Count and sum of the numeric weights in column weightAt; rows are arrays in header order or objects keyed by the header text. */
function holdingsGuardWeights(headers: ReadonlyArray<string>, rows: ReadonlyArray<unknown>, weightAt: number): { count: number; sum: number } {
  let count = 0;
  let sum = 0;
  for (let i = 0; i < rows.length; i++) {
    const row: any = rows[i];
    const weight = holdingsGuardNumber(Array.isArray(row) ? row[weightAt] : row && typeof row === 'object' ? row[headers[weightAt]] : undefined);
    if (weight !== null) {
      count++;
      sum += weight;
    }
  }
  return { count, sum };
}

/** A weight cell as a number: %, $, commas and spaces are ignored, (x) is negative; null when it is no plain number (a zero-width character inside counts as broken). */
function holdingsGuardNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let text = String(value === null || value === undefined ? '' : value).replace(/[ \t ,%$]/g, '').replace(/−/g, '-');
  const negative = /^\(.*\)$/.test(text);
  if (negative) text = text.slice(1, -1);
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  return negative ? -Number(text) : Number(text);
}

/** A fund its issuer closed (liquidated, delisted or merged away), confirmed from an official source: an SEC filing or the issuer's notice. */
export type ClosedFund = { ticker: string; closed: string; source: string };

/**
 * The brand's CLOSED_FUNDS entry for a ticker, or null. A closed fund is never fetched, never guarded and never reported failed: it keeps
 * its last published data and its index row carries `status: 'closed'`, `closedDate` and `closedSource`. A malformed entry throws, so a
 * typo (no ISO date, no https source) never ships.
 */
export function closedFund(list: ReadonlyArray<ClosedFund>, ticker: unknown): ClosedFund | null {
  const wanted = String(ticker === null || ticker === undefined ? '' : ticker).trim().toUpperCase();
  let found: ClosedFund | null = null;
  for (let i = 0; i < list.length; i++) {
    const fund = list[i];
    if (!/^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(fund.ticker) || !/^\d{4}-\d{2}-\d{2}$/.test(fund.closed) || !/^https:\/\/\S+$/.test(fund.source)) throw new Error(`CLOSED_FUNDS: ${fund.ticker} needs an upper-case ticker, an ISO closing date and an https source`);
    if (fund.ticker === wanted) found = fund;
  }
  return found;
}

/** The index rows with every closed fund marked (`status: 'closed'`, `closedDate`, `closedSource`); other rows are returned as they are. */
export function markClosedFunds<T extends object>(rows: ReadonlyArray<T>, list: ReadonlyArray<ClosedFund>): T[] {
  return rows.map((row) => {
    const fund = closedFund(list, (row as { ticker?: unknown }).ticker);
    return fund ? ({ ...row, status: 'closed', closedDate: fund.closed, closedSource: fund.source } as T) : row;
  });
}

/** A run's queue without the closed funds, which are named once in the log: they are neither fetched nor counted as failed. */
export function withoutClosedFunds<T>(queue: ReadonlyArray<T>, tickerOf: (item: T) => string, list: ReadonlyArray<ClosedFund>): T[] {
  const closed: string[] = [];
  const open: T[] = [];
  for (let i = 0; i < queue.length; i++) {
    if (closedFund(list, tickerOf(queue[i]))) closed.push(tickerOf(queue[i]));
    else open.push(queue[i]);
  }
  if (closed.length) console.log(`[ closed   ] ${closed.join(', ')}: closed by the issuer, published data kept`);
  return open;
}
// </holdings-guard>

// <nport-reader> shared block of .claude/tools/etfs/etf-std/nport-reader.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * SEC EDGAR Form N-PORT-P holdings reader (open-items etfs ETF-H2), one copy for every brand. Pure functions plus one reader
 * that takes the brand's own `getText(url, label)` (its SEC User-Agent, timeout, retries and pacing). Rules it enforces:
 * - identifiers come from the position itself: `<cusip>` text (or a `value` attribute), `<isin value>`, `<ticker value>`,
 *   `<other value>`; a derivative's reference instrument (inside `<derivativeInfo>`) never lends its identifiers to the position
 * - CUSIP `000000000` and `N/A` are missing; a missing weight or value is null (an empty cell), never 0
 * - a ticker only for a common-stock row (assetCat EC, not a CVR, right, warrant or escrow line) traded in USD with a U.S.
 *   ISIN or none, or with a foreign ISIN when the Nasdaq Trader directories list that ticker for the same company (a U.S.
 *   listing such as Linde, NXP, IMAX); renamed issuers through `nportRenamedIssuers`; never one ticker on two different
 *   securities (`nportTickers`)
 * - identity: the filing must name the fund's own series id, or, with no series id known, the fund's name (`nportIdentity`)
 * - freshness: the report period must be strictly newer than the published holdings (`nportIsFresh`)
 * - filings come newest report period first from the registrant's own archive folder, never from the filer agent's CIK
 *   (the accession number prefix)
 */
export type NportPosition = {
  name: string;
  title: string;
  lei: string;
  cusip: string;
  isin: string;
  ticker: string;
  other: string;
  otherDesc: string;
  balance: number | null;
  units: string;
  currency: string;
  /** valUSD, null when the filing has none */
  value: number | null;
  /** pctVal: percent of net assets (0.5 = 0.5%), null when the filing has none */
  weight: number | null;
  payoff: string;
  assetCat: string;
  issuerCat: string;
  country: string;
  /** derivCat of the position's derivativeInfo (FUT, FWD, SWP, OPT, ...), empty for a security */
  derivative: string;
  /** debtSec annualizedRt and maturityDt (ISO), null and '' for a non-debt row */
  coupon: number | null;
  maturity: string;
};

export type NportFiling = {
  seriesId: string;
  seriesName: string;
  regName: string;
  regCik: string;
  /** report period end (genInfo repPdDate) as ISO, '' when missing */
  repPdDate: string;
  netAssets: number | null;
  totalAssets: number | null;
  positions: NportPosition[];
};

export type NportCandidate = { accession: string; filed: string; period: string; cik: string };
export type NportSeriesRef = { cik: string; seriesId: string; classId: string };

/** XML text: entities decoded, tags dropped, whitespace collapsed. */
function nportText(raw: string): string {
  return String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m: string, dec: string) => String.fromCharCode(Number(dec)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/** Text of the first `<tag>` (any namespace prefix) in `xml`, '' when absent. */
function nportTag(xml: string, tag: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z0-9_.-]+:)?${tag}>`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** The `attribute` of the first `<tag ...>` (any namespace prefix) in `xml`, '' when absent. */
function nportAttr(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:[A-Za-z0-9_.-]+:)?${tag}\\s[^>]*?\\b${attribute}\\s*=\\s*"([^"]*)"`, 'i').exec(xml);
  return match ? nportText(match[1]) : '';
}

/** A plain decimal or exponent number, null for an empty, N/A or broken cell. */
function nportNumber(raw: string): number | null {
  const text = String(raw).replace(/[\s,]/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(text)) return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/** An identifier code, '' for N/A, NONE and all zeros (CUSIP 000000000 means "no CUSIP"). */
function nportCode(raw: string): string {
  const text = String(raw).trim().toUpperCase();
  return !text || /^(N\/?A|NONE|-+|0+)$/.test(text) ? '' : text;
}

/** ISO date of an N-PORT date (YYYY-MM-DD, possibly with a time), '' otherwise. */
function nportIso(raw: unknown): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(raw === null || raw === undefined ? '' : raw).trim());
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

/** One N-PORT-P primary_doc.xml (or the full submission .txt that embeds it) as series facts and positions. */
export function parseNportFiling(xml: string): NportFiling {
  const text = String(xml === null || xml === undefined ? '' : xml);
  const genInfo = /<(?:[A-Za-z0-9_.-]+:)?genInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?genInfo>/i.exec(text);
  const fundInfo = /<(?:[A-Za-z0-9_.-]+:)?fundInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?fundInfo>/i.exec(text);
  const gen = genInfo ? genInfo[1] : '';
  const fund = fundInfo ? fundInfo[1].replace(/<(?:[A-Za-z0-9_.-]+:)?returnInfo\b[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?returnInfo>/gi, ' ') : '';
  const positions: NportPosition[] = [];
  const blocks = /<(?:[A-Za-z0-9_.-]+:)?invstOrSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?invstOrSec>/gi;
  let block: RegExpExecArray | null;
  while ((block = blocks.exec(text)) !== null) {
    const raw = block[1];
    const derivativeInfo = /<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/i.exec(raw);
    // The reference instrument of a derivative (SPY for a SPY option, a bond for a CDS) is another security: drop it first.
    const own = raw.replace(/<(?:[A-Za-z0-9_.-]+:)?derivativeInfo\b[^>]*>[\s\S]*?<\/(?:[A-Za-z0-9_.-]+:)?derivativeInfo>/gi, ' ');
    const identifiers = /<(?:[A-Za-z0-9_.-]+:)?identifiers\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?identifiers>/i.exec(own);
    const ids = identifiers ? identifiers[1] : '';
    const debt = /<(?:[A-Za-z0-9_.-]+:)?debtSec\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_.-]+:)?debtSec>/i.exec(own);
    const name = nportTag(own, 'name');
    positions.push({
      name: name && !/^N\/?A$/i.test(name) ? name : nportTag(own, 'title'),
      title: nportTag(own, 'title'),
      lei: nportCode(nportTag(own, 'lei')),
      cusip: nportCode(nportTag(own, 'cusip') || nportAttr(ids, 'cusip', 'value')),
      isin: nportCode(nportAttr(ids, 'isin', 'value')),
      ticker: nportCode(nportAttr(ids, 'ticker', 'value')),
      other: nportCode(nportAttr(ids, 'other', 'value')),
      otherDesc: nportAttr(ids, 'other', 'otherDesc'),
      balance: nportNumber(nportTag(own, 'balance')),
      units: nportTag(own, 'units'),
      currency: (nportTag(own, 'curCd') || nportAttr(own, 'currencyConditional', 'curCd')).toUpperCase(),
      value: nportNumber(nportTag(own, 'valUSD')),
      weight: nportNumber(nportTag(own, 'pctVal')),
      payoff: nportTag(own, 'payoffProfile'),
      assetCat: (nportTag(own, 'assetCat') || nportAttr(own, 'assetConditional', 'assetCat')).toUpperCase(),
      issuerCat: (nportTag(own, 'issuerCat') || nportAttr(own, 'issuerConditional', 'issuerCat')).toUpperCase(),
      country: nportTag(own, 'invCountry').toUpperCase(),
      derivative: derivativeInfo ? (/\bderivCat\s*=\s*"([^"]*)"/i.exec(derivativeInfo[1]) || ['', 'OTHER'])[1].toUpperCase() : '',
      coupon: debt ? nportNumber(nportTag(debt[1], 'annualizedRt')) : null,
      maturity: debt ? nportIso(nportTag(debt[1], 'maturityDt')) : '',
    });
  }
  return {
    seriesId: nportTag(gen, 'seriesId').toUpperCase(),
    seriesName: nportTag(gen, 'seriesName'),
    regName: nportTag(gen, 'regName'),
    regCik: nportTag(gen, 'regCik').replace(/\D/g, ''),
    repPdDate: nportIso(nportTag(gen, 'repPdDate')),
    netAssets: nportNumber(nportTag(fund, 'netAssets')),
    totalAssets: nportNumber(nportTag(fund, 'totAssets')),
    positions,
  };
}

/**
 * A number as sheet text: '' for null, no exponent, at most `digits` decimals (trailing zeros dropped), and no binary float
 * artifact: `115797518.01` stays `115797518.01`, not the `115797518.01000001` of `toFixed(8)`.
 */
export function nportCell(value: number | null, digits = 8): string {
  if (value === null || !Number.isFinite(value)) return '';
  const fixed = value.toFixed(digits);
  // the shortest text of the rounded number; toFixed only where that text would be an exponent (very small or large numbers)
  const shortest = String(Number(fixed));
  if (!/e/i.test(shortest)) return shortest;
  return fixed.indexOf('.') < 0 ? fixed : fixed.replace(/0+$/, '').replace(/\.$/, '');
}

/** The position's own identifier for a sheet: CUSIP, else ISIN, else the "other" code (a Bloomberg or internal id), else ''. */
export function nportIdentifier(position: NportPosition): string {
  return position.cusip || position.isin || position.other;
}

/**
 * A company name as a lookup key: upper case, punctuation and legal suffixes dropped, `CLASS A` -> `CL A`. Initials are one
 * word whether written with dots, spaces or a slash (`N.V.` = `N V` = `NV`, `C.H. ROBINSON` = `C H ROBINSON`, `A/S` = `A S`,
 * `S.A.B. de C.V.` = `SAB DE CV`), `PUBLIC LIMITED COMPANY` is `plc`, and a leading `US` stays (`U.S. BANCORP` is not
 * `BANCORP, INC.`), so both spellings of one issuer give one key.
 */
export function nportNameKey(value: unknown): string {
  // EDGAR adds a state or qualifier suffix to company titles ("COSTCO WHOLESALE CORP /NEW", "BANK OF AMERICA CORP /DE/",
  // "US BANCORP \DE\", "ACUITY INC. (DE)"): drop a trailing one
  const raw = String(value === null || value === undefined ? '' : value).replace(/(?:\s*(?:[\/\\]\s*[A-Za-z]{2,3}\s*[\/\\]?|\(\s*[A-Za-z]{2,3}\s*\)))+\s*$/, '');
  let text = nportText(raw).toUpperCase().replace(/['’]/g, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').trim();
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, 'CL $1').replace(/\bCL\s+([A-Z])\b/g, 'CL $1');
  // a run of single letters is one word, never the class letter after CL
  const words: string[] = [];
  let joining = false;
  text.split(' ').forEach((word) => {
    const letter = /^[A-Z]$/.test(word);
    if (letter && joining) words[words.length - 1] += word;
    else words.push(word);
    joining = letter && (joining || words[words.length - 2] !== 'CL');
  });
  text = words.join(' ').replace(/\bPUBLIC (?:(?:LIMITED|LTD)(?: (?:COMP[A-Z]*|CO))?|(?:COMPANY|CO) (?:LIMITED|LTD))\b/g, 'PLC').replace(/\b(?:S DE RL )?DE CV\b/g, ' ');
  const share = /\bCL [A-Z]\b/.exec(text);
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|SAB|NV|AG|SE|SPA|AS|ASA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, (word: string, _name: string, at: number) => (word === 'US' && at === 0 ? word : ' ')).replace(/\s+/g, ' ').trim();
  if (share && !/\bCL [A-Z]\b/.test(text)) text = `${text} ${share[0]}`;
  return text;
}

/** SEC company_tickers.json -> name key -> ticker (the first, largest company wins a shared key; the class-less key is added too). */
export function parseSecCompanyNames(payload: unknown): Map<string, string> {
  const names = new Map<string, string>();
  const rows = payload && typeof payload === 'object' ? Object.keys(payload as object).map((key) => (payload as Record<string, unknown>)[key]) : [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] as { ticker?: unknown; title?: unknown } | null;
    if (!row || typeof row !== 'object') continue;
    const ticker = String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
    const key = nportNameKey(row.title);
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker) || !key) continue;
    if (!names.has(key)) names.set(key, ticker);
    const core = key.replace(/ CL [A-Z]$/, '');
    if (core && !names.has(core)) names.set(core, ticker);
  }
  return names;
}

/** SEC company_tickers_mf.json -> fund ticker -> registrant CIK (10 digits), series id, class id. */
export function parseSecFundTickers(payload: unknown): Map<string, NportSeriesRef> {
  const map = new Map<string, NportSeriesRef>();
  const record = (payload && typeof payload === 'object' ? payload : {}) as { fields?: unknown; data?: unknown };
  const fields = Array.isArray(record.fields) ? record.fields.map(String) : [];
  const rows = Array.isArray(record.data) ? record.data : [];
  const at = (row: unknown[], field: string): string => (fields.indexOf(field) < 0 ? '' : String(row[fields.indexOf(field)] === null || row[fields.indexOf(field)] === undefined ? '' : row[fields.indexOf(field)]).trim());
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const ticker = at(row, 'symbol').toUpperCase();
    const cik = at(row, 'cik').replace(/\D/g, '');
    const seriesId = at(row, 'seriesId').toUpperCase();
    if (!ticker || !Number(cik) || !/^S\d{9}$/.test(seriesId) || map.has(ticker)) continue;
    map.set(ticker, { cik: `0000000000${Number(cik)}`.slice(-10), seriesId, classId: at(row, 'classId').toUpperCase() });
  }
  return map;
}

/**
 * Is the row a contingent value right, a right, a warrant or an escrow line filed as equity? A placeholder CUSIP or ISIN
 * (`436CVR021`, `US009CVR0445`, `549ESC028`, `866CNT017`) says so; so does the name or title (`NOVO NORDISK A/S - CVR`,
 * `XYZ INC RIGHTS`, `... WARRANT FEB 2026`, `Luby's Inc Escrow`), except on a CUSIP with the common-stock issue number 10
 * (Schwab titles Enovix common stock 293594107 "Enovix Corp Warrants"). `CVR` as the first word is a company (CVR Energy).
 */
function nportIsRight(position: NportPosition): boolean {
  if (/^[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.cusip) || /^US[0-9A-Z]{3}(?:CVR|ESC|CNT)/.test(position.isin)) return true;
  if (/^[0-9A-Z]{6}10[0-9]$/.test(position.cusip)) return false;
  return [position.name, position.title].some((text) => /\S\s*\bCVRS?\b|\bCONTINGENT\b|\bRIGHTS?\b|\bRTS\b|\bWARRANTS?\b|\bWTS\b|\bESCROW\b/i.test(text));
}

/**
 * Renamed issuers (open-items etfs Q33): N-PORT filers keep an issuer's old name for months while SEC's company_tickers.json
 * titles only the new one, so the name match misses (JPMorgan JEPI's Exxon). Old name key (`nportNameKey`) -> [ticker, CUSIP
 * issuer number (the first six characters)]. Used only when the SEC table has no such key, the row's CUSIP (or U.S. ISIN) has
 * that issuer number and the SEC table still lists the ticker. Each entry was confirmed on 2026-10-26: an EC row without a
 * ticker in the N-PORT-P filings of large U.S. equity funds (VTI, SCHB, ITOT, JEPI, IWB, VB, SCHA, FNDX, FNDA, ...) whose name
 * is a former EDGAR name of the CIK that has the ticker today (data.sec.gov submissions `formerNames`, the date the old name
 * ended), the ticker the CIK's only common stock in the Nasdaq Trader directories. Add an entry only with the same evidence.
 * A function, not a const: blocks sit at the end of update-data.ts, below the top-level run, so only declarations are hoisted.
 */
export function nportRenamedIssuers(): Array<[string, string, string]> {
  return [
    ['AADI BIOSCIENCE', 'WHWK', '00032Q'], // CIK 1422142 Whitehawk Therapeutics, Inc., former EDGAR name until 2025-03-18
    ['ABACUS LIFE', 'ABX', '00258Y'], // CIK 1814287 Abacus Global Management, Inc., former EDGAR name until 2025-02-04
    ['ACUITY BRANDS', 'AYI', '00508Y'], // CIK 1144215 ACUITY INC. (DE), former EDGAR name until 2025-04-17
    ['AEROVATE THERAPEUTICS', 'JBIO', '008064'], // CIK 1798749 Jade Biosciences, Inc., former EDGAR name until 2025-04-30
    ['AILERON THERAPEUTICS', 'RNTX', '00887A'], // CIK 1420565 Rein Therapeutics, Inc., former EDGAR name until 2024-12-09
    ['ALLOVIR', 'KLRS', '482929'], // CIK 1754068 Kalaris Therapeutics, Inc., former EDGAR name until 2025-03-12
    ['AMC NETWORKS', 'AMCX', '00164V'], // CIK 1514991 AMC Global Media Inc., former EDGAR name until 2026-04-03
    ['AMMO', 'POWW', '00175J'], // CIK 1015383 Outdoor Holding Co, former EDGAR name until 2025-04-24
    ['ARDENT HEALTH PARTNERS', 'ARDT', '03980N'], // CIK 1756655 Ardent Health, Inc., former EDGAR name until 2025-05-23
    ['ARENA GROUP HOLDINGS', 'PAAI', '040044'], // CIK 894871 Paradium.AI, Inc., former EDGAR name until 2026-08-13
    ['ATEGRITY SPECIALTY HOLDINGS LLC', 'ASIC', '04681Y'], // CIK 2040491 Ategrity Specialty Insurance Co Holdings, former EDGAR name until 2025-06-11
    ['BAKKT HOLDINGS', 'BKKT', '05759B'], // CIK 1820302 Bakkt, Inc., former EDGAR name until 2026-01-20
    ['BED BATH AND BEYOND', 'NXH', '690370'], // CIK 1130713 NEIGHBORHOOD INTELLIGENCE, INC., former EDGAR name until 2026-08-14
    ['BLACKROCK FUNDING', 'BLK', '09290D'], // CIK 2012383 BlackRock, Inc., former EDGAR name until 2024-10-01
    ['BRIGHTSPHERE INVESTMENT GROUP', 'AAMI', '10948W'], // CIK 1748824 Acadian Asset Management Inc., former EDGAR name until 2024-11-14
    ['CARA THERAPEUTICS', 'TVRD', '140755'], // CIK 1346830 Tvardi Therapeutics, Inc., former EDGAR name until 2025-04-11
    ['CEA INDUSTRIES', 'BNC', '86887P'], // CIK 1482541 BNB Standard Corp, former EDGAR name until 2026-09-21
    ['CHROMADEX', 'NAGE', '171077'], // CIK 1386570 Niagen Bioscience, Inc., former EDGAR name until 2025-03-10
    ['CLEANCORE SOLUTIONS', 'ZONE', '184492'], // CIK 1956741 Zone Frontier Inc., former EDGAR name until 2026-08-20
    ['CORPORATE OFFICE PROPERTIES TRUST', 'CDP', '22002T'], // CIK 860546 COPT DEFENSE PROPERTIES, former EDGAR name until 2023-09-14
    ['CULLINAN ONCOLOGY', 'CGEM', '230031'], // CIK 1789972 Cullinan Therapeutics, Inc., former EDGAR name until 2024-04-02
    ['DIME COMMUNITY BANCSHARES', 'DCOM', '25432X'], // CIK 846617 Dime Commercial Bancshares, Inc. /NY/, former EDGAR name until 2026-05-27
    ['DOMO', 'HUCK', '257554'], // CIK 1505952 Huckleberry.ai, Inc., former EDGAR name until 2026-09-03
    ['EASTSIDE DISTILLING', 'BLNE', '277802'], // CIK 1534708 Beeline Holdings, Inc., former EDGAR name until 2025-03-11
    ['EQUITY RESIDENTIAL', 'VMRK', '29476L'], // CIK 906107 VIVMARK RESIDENTIAL, former EDGAR name until 2026-08-12
    ['EXP WORLD HOLDINGS', 'AGNT', '30212W'], // CIK 1495932 AGNT, Inc., former EDGAR name until 2026-06-01
    ['EXXON MOBIL', 'XOM', '30231G'], // holding company reorganization: XOM is CIK 2115436 ExxonMobil Holdings Corp since 2026, the old Exxon Mobil Corp is CIK 34088
    ['EYEPOINT PHARMACEUTICALS', 'EYPT', '30233G'], // CIK 1314102 EyePoint, Inc., former EDGAR name until 2025-12-08
    ['EZFILL HOLDINGS', 'NXXT', '652941'], // CIK 1817004 NEXTNRG, INC., former EDGAR name until 2025-02-14
    ['FORTUNE BRANDS HOME AND SECURITY', 'FBIN', '34964C'], // CIK 1519751 Fortune Brands Innovations, Inc., former EDGAR name until 2022-12-14
    ['FRANKLIN RESOURCES', 'BEN', '354613'], // CIK 38777 FRANKLIN TEMPLETON INC, former EDGAR name until 2026-08-14
    ['FREYR BATTERY', 'TE', '35834F'], // CIK 1992243 T1 Energy Inc., former EDGAR name until 2025-02-14
    ['GALLAGHER ARTHUR J AND', 'AJG', '363576'], // CIK 354190 Arthur J. Gallagher & Co., former EDGAR name until 2019-08-14
    ['GRAINGER WW', 'GWW', '384802'], // CIK 277135 W.W. GRAINGER, INC., former EDGAR name until 2019-10-15
    ['GRAY TELEVISION', 'GTN', '389375'], // CIK 43196 GRAY MEDIA, INC, former EDGAR name until 2025-02-24
    ['GREAT AJAX', 'RPT', '38983D'], // CIK 1614806 Rithm Property Trust Inc., former EDGAR name until 2024-11-13
    ['GREENIDGE GENERATION HOLDINGS', 'VIP', '39531G'], // CIK 1844971 Vulcan Infrastructure & Power Inc., former EDGAR name until 2026-07-09
    ['HANNON ARMSTRONG SUSTAINABLE INFRASTRUCTURE CAPITAL', 'HASI', '41068X'], // CIK 1561894 HA Sustainable Infrastructure Capital, Inc., former EDGAR name until 2024-07-02
    ['HARTFORD FINANCIAL SERVICES GROUP', 'HIG', '416515'], // CIK 874766 HARTFORD INSURANCE GROUP, INC., former EDGAR name until 2025-01-30
    ['HELIX ENERGY SOLUTIONS GROUP', 'HOS', '42330P'], // CIK 866829 HORNBECK OFFSHORE SERVICES, INC., former EDGAR name until 2026-08-31
    ['HYSTER YALE MATERIALS HANDLING', 'HY', '449172'], // CIK 1173514 HYSTER-YALE, INC., former EDGAR name until 2024-05-30
    ['IAC', 'PPLI', '44891N'], // CIK 1800227 People Inc, former EDGAR name until 2026-06-02
    ['IDENTIV', 'INVE', '45170X'], // CIK 1036044 INVE Technologies, Inc., former EDGAR name until 2026-08-25
    ['IRHYTHM TECHNOLOGIES', 'IRTC', '450056'], // CIK 1388658 iRhythm Holdings, Inc., former EDGAR name until 2026-01-12
    ['ISSUER DIRECT', 'ACCS', '46520M'], // CIK 843006 ACCESS Newswire Inc., former EDGAR name until 2025-01-16
    ['JANOVER', 'DFDV', '47100L'], // CIK 1805526 DeFi Development Corp., former EDGAR name until 2025-04-15
    ['JOHN BEAN TECHNOLOGIES', 'JBTM', '477839'], // CIK 1433660 JBT MAREL Corp, former EDGAR name until 2024-12-20
    ['LENDINGCLUB', 'HAPN', '52603A'], // CIK 1409970 Happen, Inc., former EDGAR name until 2026-06-18
    ['LIXTE BIOTECHNOLOGY HOLDINGS', 'NMAD', '539319'], // CIK 1335105 NOMAD POWER SOLUTIONS, INC., former EDGAR name until 2026-07-02
    ['MKS INSTRUMENTS', 'MKSI', '55306N'], // CIK 1049502 MKS INC, former EDGAR name until 2025-05-15
    ['MONTANA TECHNOLOGIES', 'AIRJ', '612160'], // CIK 1855474 AirJoule Technologies Corp., former EDGAR name until 2024-10-21
    ['MULTIPLAN', 'CTEV', '62548M'], // CIK 1793229 Claritev Corp, former EDGAR name until 2025-02-07
    ['NEWPARK RESOURCES', 'NPKI', '651718'], // CIK 71829 NPK International Inc., former EDGAR name until 2024-12-03
    ['ONCOLOGY INSTITUTE', 'STLN', '68236X'], // CIK 1799191 Starling Oncology, Inc., former EDGAR name until 2026-08-03
    ['OREILLY AUTOMOTIVE', 'ORLY', '67103H'], // CIK 898173 O REILLY AUTOMOTIVE INC, former EDGAR name until 1998-04-10
    ['ORION OFFICE REIT', 'ONL', '68629Y'], // CIK 1873923 Orion Properties Inc., former EDGAR name until 2025-03-07
    ['PALTALK', 'IPM', '69764K'], // CIK 1355839 INTELLIGENT PROTECTION MANAGEMENT CORP., former EDGAR name until 2025-01-02
    ['PARAMOUNT SKYDANCE', 'SKYD', '69932A'], // CIK 2041610 Skydance Corp, former EDGAR name until 2026-10-06
    ['PIEDMONT OFFICE REALTY TRUST', 'PDM', '720190'], // CIK 1042776 Piedmont Realty Trust, Inc., former EDGAR name until 2025-06-02
    ['PIERIS PHARMACEUTICALS', 'PVLA', '697947'], // CIK 1583648 PALVELLA THERAPEUTICS, INC., former EDGAR name until 2024-12-12
    ['PLUS THERAPEUTICS', 'CNSY', '72941H'], // CIK 1095981 CERENOME, INC., former EDGAR name until 2026-07-01
    ['RUMBLE', 'RUM', '78137L'], // CIK 1830081 RUM Group Inc., former EDGAR name until 2026-06-17
    ['SCHWEITZER MAUDUIT INTERNATIONAL', 'MATV', '808541'], // CIK 1000623 Mativ Holdings, Inc., former EDGAR name until 2022-07-01
    ['SEQLL', 'CIRC', '048592'], // CIK 1605888 CIRCLE8 GROUP INC, former EDGAR name until 2024-06-06
    ['SHOE CARNIVAL', 'SHOE', '824889'], // CIK 895447 SHOE STATION GROUP INC, former EDGAR name until 2026-06-11
    ['TANGER FACTORY OUTLET CENTERS', 'SKT', '875465'], // CIK 899715 TANGER INC., former EDGAR name until 2023-11-15
    ['TECNOGLASS', 'TGLS', '87877F'], // CIK 1534675 Tecnoglass Holdings Inc., former EDGAR name until 2026-07-07
    ['TEMPUR SEALY INTERNATIONAL', 'SGI', '88023U'], // CIK 1206264 SOMNIGROUP INTERNATIONAL INC., former EDGAR name until 2025-02-14
    ['TEVOGEN BIO HOLDINGS', 'TVGN', '88165K'], // CIK 1860871 Tevogen Inc., former EDGAR name until 2026-07-30
    ['TORO COMBINECO', 'TTGT', '87874R'], // CIK 2018064 TechTarget, Inc., former EDGAR name until 2024-11-20
    ['VIAD', 'PRSU', '92552R'], // CIK 884219 Pursuit Attractions & Hospitality, Inc., former EDGAR name until 2024-12-31
    ['WELLGISTICS HEALTH', 'MEDS', '949503'], // CIK 2030763 DataMeds AI, Inc., former EDGAR name until 2026-07-21
    ['ZOOM VIDEO COMMUNICATIONS', 'ZM', '98980L'], // CIK 1585521 Zoom Communications, Inc., former EDGAR name until 2024-11-12
    ['ZYMEWORKS DELAWARE', 'ZYME', '98985Y'], // CIK 1937653 Zymeworks Inc., former EDGAR name until 2022-10-13
  ];
}

/** Nasdaq Trader symbol directories: Nasdaq listings, and NYSE, NYSE American, NYSE Arca, Cboe and IEX listings. */
export function nportUsListingsUrls(): string[] {
  return ['https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt', 'https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt'];
}

/**
 * The Nasdaq Trader symbol directories (the texts of `nportUsListingsUrls()`, in any order) as U.S.-listed symbol -> security
 * name; test issues and ETFs left out, CQS class dots as SEC dashes (`BRK.B` -> `BRK-B`). An issuer listed under several
 * symbols (Liberty Global LBTYA, LBTYB, LBTYK) also gets the entry `\u0000<name key>` -> its symbols, which `nportUsListed` reads
 * to require the share class. null unless every text is a whole directory (a header with Security Name and the File Creation
 * Time footer), so a failed or cut download changes nothing.
 */
export function parseUsListings(texts: ReadonlyArray<string>): Map<string, string> | null {
  const listings = new Map<string, string>();
  if (!texts.length) return null;
  for (let t = 0; t < texts.length; t++) {
    const lines = String(texts[t] === null || texts[t] === undefined ? '' : texts[t]).split(/\r?\n/).filter((line) => line.trim());
    const header = (lines[0] || '').split('|').map((cell) => cell.trim().toUpperCase());
    const nameAt = header.indexOf('SECURITY NAME'), testAt = header.indexOf('TEST ISSUE'), etfAt = header.indexOf('ETF');
    if (nameAt < 0 || !/^FILE CREATION TIME/i.test(lines[lines.length - 1] || '')) return null;
    for (let i = 1; i < lines.length - 1; i++) {
      const cells = lines[i].split('|');
      const symbol = String(cells[0] || '').trim().toUpperCase().replace(/[./ ]/g, '-');
      if (!symbol || String(cells[testAt] || '').trim() === 'Y' || String(cells[etfAt] || '').trim() === 'Y' || listings.has(symbol)) continue;
      listings.set(symbol, String(cells[nameAt] || '').trim());
    }
  }
  const issuers = new Map<string, string[]>();
  listings.forEach((name, symbol) => {
    const key = nportNameKey(nportIssuerName(name));
    if (key) issuers.set(key, (issuers.get(key) || []).concat(symbol));
  });
  issuers.forEach((symbols, key) => { if (symbols.length > 1) listings.set(`\u0000${key}`, symbols.join(' ')); });
  return listings;
}

/** The share class a name or title states (`Class C`, `CL C`, `Series A`, `LIBERTY GLOBAL-C`), '' for none. */
function nportShareClass(...texts: unknown[]): string {
  for (let i = 0; i < texts.length; i++) {
    const text = String(texts[i] === null || texts[i] === undefined ? '' : texts[i]);
    const match = /\b(?:CLASS|CL|SERIES|SER)\.?\s+([A-Z])\b/i.exec(text) || /[A-Z]-\s?([A-Z])(?:\s|$)/i.exec(text);
    if (match) return match[1].toUpperCase();
  }
  return '';
}

/** Both symbol directories through the brand's `getText`, null when one fails (`parseUsListings`); load once per run. */
export async function readUsListings(getText: (url: string, label: string) => Promise<string>): Promise<Map<string, string> | null> {
  try {
    return parseUsListings(await Promise.all(nportUsListingsUrls().map((url) => getText(url, `Nasdaq Trader ${url.replace(/^.*\//, '')}`))));
  } catch {
    return null;
  }
}

/** A security or sheet name without its share description: `Accenture plc Class A Ordinary Shares (Ireland)` -> `Accenture plc`. */
function nportIssuerName(value: unknown): string {
  return String(value === null || value === undefined ? '' : value).split(' - ')[0]
    .replace(/\s+(?:\(|(?:CLASS|SERIES)\s+[A-Z]\b|COMMON\b|ORDINARY\b|SUBORDINATE\b|SUB\.?\s+VOT|(?:LIMITED|RESTRICTED)\s+VOTING\b|VOTING\b|SHARES?\b|STOCK\b|AMERICAN\s+DEPOSITARY\b|TRADING\s+UNDER\b)[\s\S]*$/i, '');
}

/**
 * Is `ticker` the company's own U.S. listing? The Nasdaq Trader directories (`parseUsListings`) list it under the same company
 * (same name key, or one key the start of the other: `BUNGE GLOBAL` and the directory's `BUNGE`, a name cut short after two words
 * or more: `CHECK POINT SOFTWARE TECH`), and not as depositary or New York registry shares, which are another security than
 * the foreign line (Shell's SHEL ADR, ASML's New York shares). When the issuer has several listed classes, the name or ]2;]1;
 * must state the listed class (Liberty Latin America Class C is LILAK, not LILA). False without listings. Callers check that
 * the line trades in U.S. dollars: a Toronto or London line of the same company in its own currency never gets the U.S. ticker.
 */
export function nportUsListed(listings: Map<string, string> | null, ticker: string, name: unknown, title: unknown = ''): boolean {
  if (!listings) return false;
  const listed = listings.get(String(ticker).trim().toUpperCase().replace(/[./ ]/g, '-'));
  if (listed === undefined || /\bDEPOSITARY\b|\bADSS?\b|\bADRS?\b|\bREGISTRY\b/i.test(listed)) return false;
  const a = nportNameKey(nportIssuerName(listed)), b = nportNameKey(nportIssuerName(name));
  if (!a || !b) return false;
  const short = a.length < b.length ? a : b, long = a.length < b.length ? b : a;
  if (a !== b && !(short.length >= 4 && long.indexOf(`${short} `) === 0) && !(short.split(' ').length >= 2 && long.indexOf(short) === 0)) return false;
  const listedClass = nportShareClass(listed);
  return !listedClass || !listings.has(`\u0000${a}`) || nportShareClass(name, title) === listedClass;
}

/**
 * Exchange tickers for the positions, in their order ('' for none). A ticker is given only to a common-stock row (assetCat
 * EC; a preferred EP, a CVR, right, warrant or escrow line gets none, a name match would give it the issuer's common ticker):
 * - U.S. ISIN or none, traded in USD (or with no currency): the filer's own `<ticker value>`, else the SEC issuer-name table
 *   (`names`) when the row has a CUSIP or a U.S. ISIN, else a renamed issuer (`nportRenamedIssuers`)
 * - foreign ISIN (Linde IE, NXP NL, IMAX CA): only traded in USD and only when the symbol directories (`listings`,
 *   `parseUsListings`) confirm the filer's or the name-matched ticker for the same company (`nportUsListed`); a local line in
 *   another currency, and every foreign row without listings, gets none
 * A ticker that lands on two different securities (Alphabet A and C, an ordinary share and its ADR) is dropped from the
 * name-matched rows; when the filer itself gave it to two securities it is dropped from all of them. Bonds, cash, funds and
 * derivatives stay identifier-keyed.
 */
export function nportTickers(positions: ReadonlyArray<NportPosition>, names: Map<string, string> | null = null, listings: Map<string, string> | null = null): string[] {
  const fromFiler: boolean[] = [];
  const secTickers = new Set<string>();
  if (names) names.forEach((ticker) => secTickers.add(ticker));
  const renames = nportRenamedIssuers();
  const renamed = (position: NportPosition, key: string): string => {
    const issuer = (position.cusip || (/^US[0-9A-Z]{10}$/.test(position.isin) ? position.isin.slice(2, 11) : '')).slice(0, 6);
    const hit = renames.filter((entry) => entry[0] === key && entry[2] === issuer && secTickers.has(entry[1]))[0];
    return hit ? hit[1] : '';
  };
  const tickers = positions.map((position, index) => {
    fromFiler[index] = false;
    const equity = position.assetCat === 'EC' && !position.derivative && !nportIsRight(position);
    const foreign = Boolean(position.isin) && position.isin.slice(0, 2) !== 'US';
    const usd = foreign ? position.currency === 'USD' && Boolean(listings) : !position.currency || position.currency === 'USD';
    if (!equity || !usd) return '';
    const filer = /^[A-Z][A-Z0-9.-]{0,9}$/.test(position.ticker) ? position.ticker : '';
    const key = nportNameKey(position.name);
    const named = names && (/^[0-9A-Z]{9}$/.test(position.cusip) || /^[A-Z]{2}[0-9A-Z]{10}$/.test(position.isin)) ? names.get(key) || names.get(key.replace(/ CL [A-Z]$/, '')) || '' : '';
    if (!foreign) {
      fromFiler[index] = Boolean(filer);
      return filer || named || (names ? renamed(position, key) : '');
    }
    if (filer && nportUsListed(listings, filer, position.name, position.title)) {
      fromFiler[index] = true;
      return filer;
    }
    return named && nportUsListed(listings, named, position.name, position.title) ? named : '';
  });
  const securities = new Map<string, { keys: string[]; filer: string[] }>();
  tickers.forEach((ticker, index) => {
    if (!ticker) return;
    const position = positions[index];
    const key = position.cusip || position.isin || position.other || nportNameKey(position.name);
    const seen = securities.get(ticker) || { keys: [], filer: [] };
    if (seen.keys.indexOf(key) < 0) seen.keys.push(key);
    if (fromFiler[index] && seen.filer.indexOf(key) < 0) seen.filer.push(key);
    securities.set(ticker, seen);
  });
  return tickers.map((ticker, index) => {
    const seen = ticker ? securities.get(ticker) : undefined;
    if (!seen || seen.keys.length < 2) return ticker;
    return seen.filer.length === 1 && fromFiler[index] ? ticker : '';
  });
}

/** The browse-edgar Atom feed of one series' NPORT-P filings. */
export function nportSeriesFeedUrl(seriesId: string, count = 10): string {
  return `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(String(seriesId).toUpperCase())}&type=NPORT-P&dateb=&owner=include&count=${count}&output=atom`;
}

/** The registrant's submissions JSON (report periods of its recent filings). */
export function nportSubmissionsUrl(cik: string): string {
  return `https://data.sec.gov/submissions/CIK${`0000000000${Number(String(cik).replace(/\D/g, '')) || 0}`.slice(-10)}.json`;
}

/** primary_doc.xml of a filing in the registrant's own folder. Throws without a registrant CIK: the accession prefix is the filer agent. */
export function nportDocumentUrl(registrantCik: string, accession: string): string {
  const cik = Number(String(registrantCik).replace(/\D/g, ''));
  if (!cik) throw new Error(`N-PORT ${accession}: no registrant CIK (the accession prefix is the filer agent, never used as the folder)`);
  return `https://www.sec.gov/Archives/edgar/data/${cik}/${String(accession).replace(/-/g, '')}/primary_doc.xml`;
}

/** NPORT-P entries of a browse-edgar Atom feed (amendments and other forms skipped), with the registrant CIK of the filing link. */
export function parseNportFeed(atom: string): NportCandidate[] {
  const out: NportCandidate[] = [];
  const entries = /<entry>([\s\S]*?)<\/entry>/gi;
  let entry: RegExpExecArray | null;
  while ((entry = entries.exec(String(atom === null || atom === undefined ? '' : atom))) !== null) {
    const body = entry[1];
    const form = (nportTag(body, 'filing-type') || nportAttr(body, 'category', 'term')).toUpperCase();
    const accession = nportTag(body, 'accession-number');
    if (form !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    const folder = /\/Archives\/edgar\/data\/(\d+)\//i.exec(nportTag(body, 'filing-href'));
    out.push({ accession, filed: nportIso(nportTag(body, 'filing-date')), period: nportIso(nportTag(body, 'period')), cik: folder ? folder[1] : '' });
  }
  return out;
}

/** NPORT-P filings of a registrant's submissions JSON (`filings.recent`), with report periods; the registrant is the JSON's own CIK. */
export function parseNportSubmissions(payload: unknown): NportCandidate[] {
  const record = (payload && typeof payload === 'object' ? payload : {}) as { cik?: unknown; filings?: { recent?: Record<string, unknown> } };
  const recent = record.filings && record.filings.recent ? record.filings.recent : {};
  const column = (name: string): unknown[] => (Array.isArray(recent[name]) ? (recent[name] as unknown[]) : []);
  const forms = column('form'), accessions = column('accessionNumber'), filed = column('filingDate'), periods = column('reportDate');
  const cik = String(record.cik === null || record.cik === undefined ? '' : record.cik).replace(/\D/g, '');
  const out: NportCandidate[] = [];
  for (let i = 0; i < forms.length; i++) {
    const accession = String(accessions[i] === null || accessions[i] === undefined ? '' : accessions[i]);
    if (String(forms[i]).toUpperCase() !== 'NPORT-P' || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    out.push({ accession, filed: nportIso(filed[i]), period: nportIso(periods[i]), cik });
  }
  return out;
}

/**
 * Candidates newest report period first, then newest filing: a late filing for an older period never wins. A missing
 * period is taken from `known` (the registrant's submissions) by accession; candidates still without one go last.
 */
export function nportNewestFirst(candidates: ReadonlyArray<NportCandidate>, known: ReadonlyArray<NportCandidate> = []): NportCandidate[] {
  const periods = new Map<string, string>();
  for (let i = 0; i < known.length; i++) if (known[i].period) periods.set(known[i].accession, known[i].period);
  return candidates
    .map((candidate) => (candidate.period ? candidate : { ...candidate, period: periods.get(candidate.accession) || '' }))
    .sort((a, b) => (a.period && b.period ? b.period.localeCompare(a.period) : a.period ? -1 : b.period ? 1 : 0) || b.filed.localeCompare(a.filed));
}

/**
 * Does the filing belong to the fund? With a series id: only the same series id. Without one: the normalized series name
 * equals the fund name, or (`loose`, reported to the caller) one contains the other. Returns the problem, or null.
 */
export function nportIdentity(filing: Pick<NportFiling, 'seriesId' | 'seriesName'>, fund: { seriesId?: string | null; name?: string | null }): { problem: string | null; loose: boolean } {
  const wantedSeries = String(fund.seriesId || '').trim().toUpperCase();
  if (wantedSeries) return { problem: filing.seriesId === wantedSeries ? null : `names series ${filing.seriesId || 'none'}, not ${wantedSeries}`, loose: false };
  const filed = nportNameKey(filing.seriesName), wanted = nportNameKey(fund.name);
  if (!filed || !wanted) return { problem: 'no series id and no fund name to match', loose: false };
  if (filed === wanted) return { problem: null, loose: false };
  if (filed.indexOf(wanted) >= 0 || wanted.indexOf(filed) >= 0) return { problem: null, loose: true };
  return { problem: `names series "${filing.seriesName}", not "${String(fund.name)}"`, loose: false };
}

/**
 * May a filing replace the published holdings? Nothing published (no rows): any dated or undated report. Otherwise only a
 * report period strictly newer than the published holdings date; both must be ISO dates (convert the brand's display
 * date first), an unknown date on either side keeps the published sheet.
 */
export function nportIsFresh(repPdDate: unknown, publishedAsOf: unknown, publishedRows: unknown): boolean {
  if (!(Number(publishedRows) > 0)) return true;
  const report = nportIso(repPdDate), published = nportIso(publishedAsOf);
  return Boolean(report && published && String(publishedAsOf).trim().length === 10 && report > published);
}

export type NportRead = { filing: NportFiling; candidate: NportCandidate; url: string; loose: boolean } | { problem: string };

/**
 * The newest N-PORT-P filing of one fund, or why there is none. Candidates: the series' Atom feed (when a series id is known;
 * an empty feed means no filing yet) with periods from the registrant's submissions, else (no series id, or the feed failed)
 * the registrant's NPORT-P filings themselves; newest period first.
 * Documents are read until one passes the identity check (at most `maxDocuments`); that newest own filing is returned only
 * when it is fresh against the published holdings (`published.asOf` ISO, `published.rows`). Errors of the optional
 * submissions request are tolerated; others come back as `problem`. `cache` (one Map per run) keeps the submissions and
 * the parsed documents, so funds of one registrant share requests.
 */
export async function readNportHoldings(
  fund: { ticker: string; cik: string; seriesId?: string | null; name?: string | null },
  published: { asOf?: unknown; rows?: unknown },
  getText: (url: string, label: string) => Promise<string>,
  options: { maxDocuments?: number; cache?: Map<string, unknown> } = {},
): Promise<NportRead> {
  const cache = options.cache || new Map<string, unknown>();
  const once = async <T>(key: string, load: () => Promise<T>): Promise<T> => {
    if (!cache.has(key)) cache.set(key, load().catch((error: unknown) => { cache.delete(key); throw error; }));
    return (await cache.get(key)) as T;
  };
  const cik = String(fund.cik || '').replace(/\D/g, '');
  if (!Number(cik)) return { problem: `${fund.ticker}: no registrant CIK` };
  let known: NportCandidate[] = [];
  try {
    known = await once(`submissions:${Number(cik)}`, async () => parseNportSubmissions(JSON.parse(await getText(nportSubmissionsUrl(cik), `${fund.ticker} N-PORT periods`))));
  } catch {
    known = [];
  }
  // null: no series feed (no series id, or the feed failed), so the registrant's own NPORT-P filings are scanned instead
  let candidates: NportCandidate[] | null = null;
  try {
    if (fund.seriesId) candidates = parseNportFeed(await getText(nportSeriesFeedUrl(fund.seriesId), `${fund.ticker} N-PORT filings`));
  } catch (error) {
    if (!known.length) return { problem: `${fund.ticker}: N-PORT filings unavailable (${error instanceof Error ? error.message : String(error)})` };
  }
  const sorted = nportNewestFirst(candidates || known, known);
  if (!sorted.length) return { problem: `${fund.ticker}: no NPORT-P filing yet` };
  const limit = Math.max(1, options.maxDocuments || (candidates ? 3 : 12));
  const misses: string[] = [];
  for (let i = 0; i < sorted.length && i < limit; i++) {
    const candidate = sorted[i];
    const url = nportDocumentUrl(Number(candidate.cik) ? candidate.cik : cik, candidate.accession);
    let filing: NportFiling;
    try {
      filing = await once(`document:${url}`, async () => parseNportFiling(await getText(url, `${fund.ticker} N-PORT ${candidate.accession}`)));
    } catch (error) {
      misses.push(`${candidate.accession} unreadable (${error instanceof Error ? error.message : String(error)})`);
      continue;
    }
    const identity = nportIdentity(filing, fund);
    if (identity.problem) {
      misses.push(`${candidate.accession} ${identity.problem}`);
      continue;
    }
    if (!filing.positions.length) return { problem: `${fund.ticker}: ${candidate.accession} has no positions` };
    if (!nportIsFresh(filing.repPdDate, published.asOf, published.rows)) return { problem: `${fund.ticker}: N-PORT ${filing.repPdDate || 'undated'} is not newer than the published holdings (${String(published.asOf || 'undated')})` };
    return { filing, candidate, url, loose: identity.loose };
  }
  return { problem: `${fund.ticker}: no N-PORT-P filing of its own${misses.length ? `: ${misses.join('; ')}` : ''}` };
}
// </nport-reader>

// <calendar-dates> shared block of .claude/tools/etfs/etf-std/calendar-dates.block.ts, applied by apply-block.ts: never edit it in one repo
/**
 * A calendar date as ISO `YYYY-MM-DD`, or null. Pure text work, never `Date.parse` or local getters, so a run in Tokyo
 * publishes the same day as CI (open-items etfs ETF-H4). Accepts ISO (`2026-10-24`, with a time the date part is kept as
 * written), `2026/10/24`, U.S. `10/24/2026` and `10-24-26` (two-digit years up to 69 are 20xx), month names in either order
 * (`Oct 24, 2026`, `October 24 2026`, `Sept. 30, 2026`, `24 Oct 2026`, `24-Oct-26`), an optional weekday or `as of` in front.
 * A day that does not exist (`02/30/2026`) is null.
 */
export function calendarIso(value: unknown): string | null {
  const text = String(value === null || value === undefined ? '' : value).replace(/[\s ]+/g, ' ').trim()
    .replace(/^as of:? /i, '').replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,? /i, '');
  const year = (raw: string): number => (raw.length === 2 ? (Number(raw) <= 69 ? 2000 : 1900) + Number(raw) : Number(raw));
  const month = (raw: string): number => {
    const word = raw.toLowerCase();
    const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    for (let i = 0; i < names.length; i++) if (word.length >= 3 && names[i].indexOf(word) === 0) return i + 1;
    return 0;
  };
  let y = 0, m = 0, d = 0, match: RegExpExecArray | null;
  if ((match = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text)) || (match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(text))) {
    y = Number(match[1]); m = Number(match[2]); d = Number(match[3]);
  } else if ((match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = Number(match[1]); d = Number(match[2]);
  } else if ((match = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/.exec(text))) {
    y = Number(match[3]); m = month(match[1]); d = Number(match[2]);
  } else if ((match = /^(\d{1,2})(?:st|nd|rd|th)?[ -]([A-Za-z]{3,9})\.?,?[ -](\d{4}|\d{2})$/.exec(text))) {
    y = year(match[3]); m = month(match[2]); d = Number(match[1]);
  } else {
    return null;
  }
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1900 || y > 2999 || m < 1 || m > 12 || d < 1 || d > days[m - 1]) return null;
  return `${y}-${m < 10 ? '0' : ''}${m}-${d < 10 ? '0' : ''}${d}`;
}

/**
 * Is the fund at least `years` old on `asOf`? Calendar anniversary, inclusive: a fund started 2025-10-24 is one year old on
 * 2026-10-24 (a 29 February start on 1 March). Unknown or unreadable dates answer true, so a value is never dropped for want
 * of a date. The shared "younger than one year" rule: since-inception returns are annualized only from one year on.
 */
export function fundAgeAtLeast(inception: unknown, asOf: unknown, years: number): boolean {
  const start = calendarIso(inception), end = calendarIso(asOf);
  if (!start || !end) return true;
  return end >= `${Number(start.slice(0, 4)) + years}${start.slice(4)}`;
}

/**
 * The returns with every horizon the fund is too young for set to null: `horizons` maps a key of `returns` to the years it
 * needs (`{ yr1: 1, cagr3y: 3, siAnn: 1 }`). Keys that are absent or already null stay as they are; the object is copied.
 */
export function withoutYoungReturns<T extends object>(returns: T, inception: unknown, asOf: unknown, horizons: Record<string, number>): T {
  const out: Record<string, unknown> = { ...(returns as Record<string, unknown>) };
  const keys = Object.keys(horizons);
  for (let i = 0; i < keys.length; i++) {
    if (out[keys[i]] !== undefined && out[keys[i]] !== null && !fundAgeAtLeast(inception, asOf, horizons[keys[i]])) out[keys[i]] = null;
  }
  return out as T;
}
// </calendar-dates>

// <windowed-chart> shared block of .claude/tools/etfs/etf-std/windowed-chart.block.ts, applied by apply-block.ts: never edit it in one repo
export type WindowedChartDay = { date: string; close: number; adjClose: number; volume: number; adjCloseRaw?: number };
export type WindowedChartDividend = { epoch: number; amount: number };

/**
 * A HISTORY_RANGE window (`period1` N years back) never shrinks the published history, and with it the 3y, 5y, 10y and
 * since-inception returns (open-items etfs Q25; was a byte-identical copy in Fidelity, Invesco and JPMorgan). The published
 * rows older than the first fresh day are put in front of the fresh days; their Adj Close is rescaled by the ratio measured on
 * the overlapping days (Yahoo re-adjusts the whole series after each distribution). Published distributions older than the
 * window are kept as well. Returns the chart unchanged when nothing published is older, and null when the window cannot be
 * joined safely (no overlap, Close changed, inconsistent or implausible ratio): the caller then keeps the fund as published.
 * `published` rows carry `Date` (any calendarIso form), `Close`, `Adj Close`, `Volume`; distribution rows are
 * [date, amount, ...] arrays. The chart's days must be sorted by ISO date.
 */
export function mergeWindowedChart<C extends { days: WindowedChartDay[]; dividends: WindowedChartDividend[] }>(chart: C, published: ReadonlyArray<Record<string, unknown>>, publishedDistributions: ReadonlyArray<unknown> = []): C | null {
  if (!chart.days.length || !published.length) return chart;
  const num = (value: unknown): number | null => {
    const text = String(value === null || value === undefined ? '' : value).replace(/[\s,$]/g, '');
    return text && Number.isFinite(Number(text)) ? Number(text) : null;
  };
  const firstFresh = chart.days[0].date;
  const rows: Array<{ date: string; close: number; adjClose: number; volume: number }> = [];
  for (let i = 0; i < published.length; i++) {
    const date = calendarIso(published[i].Date), close = num(published[i].Close), adjClose = num(published[i]['Adj Close']);
    if (date && close !== null && adjClose !== null && adjClose > 0) rows.push({ date, close, adjClose, volume: num(published[i].Volume) || 0 });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const older = rows.filter((row) => row.date < firstFresh);
  if (!older.length) return chart;
  const byDate = new Map<string, { close: number; adjClose: number }>();
  for (let i = 0; i < rows.length; i++) byDate.set(rows[i].date, rows[i]);
  const adjRatios: number[] = [];
  const closeRatios: number[] = [];
  for (let i = 0; i < chart.days.length; i++) {
    const day = chart.days[i];
    const prior = byDate.get(day.date);
    if (!prior) continue;
    adjRatios.push((day.adjCloseRaw === undefined ? day.adjClose : day.adjCloseRaw) / prior.adjClose);
    if (prior.close > 0) closeRatios.push(day.close / prior.close);
  }
  if (!adjRatios.length) return null;
  const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length;
  if (closeRatios.length && Math.abs(mean(closeRatios) - 1) > 1e-3) return null;
  if (Math.max.apply(null, adjRatios) / Math.min.apply(null, adjRatios) - 1 > 5e-3) return null;
  const measured = mean(adjRatios);
  if (measured < 0.5 || measured > 1.001) return null;
  const factor = Math.abs(measured - 1) < 1e-4 ? 1 : measured;
  const days: WindowedChartDay[] = older.map((row) => {
    const raw = row.adjClose * factor;
    return { date: row.date, close: row.close, adjClose: factor === 1 ? row.adjClose : Math.round(raw * 100) / 100, volume: row.volume, adjCloseRaw: raw };
  });
  const firstFreshEpoch = Date.UTC(Number(firstFresh.slice(0, 4)), Number(firstFresh.slice(5, 7)) - 1, Number(firstFresh.slice(8, 10))) / 1000;
  const kept: WindowedChartDividend[] = [];
  for (let i = 0; i < publishedDistributions.length; i++) {
    const cells = publishedDistributions[i];
    const date = Array.isArray(cells) ? calendarIso(cells[0]) : null;
    const amount = Array.isArray(cells) ? num(cells[1]) : null;
    if (!date || amount === null || amount <= 0) continue;
    const epoch = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))) / 1000;
    if (epoch < firstFreshEpoch) kept.push({ epoch, amount });
  }
  kept.sort((a, b) => a.epoch - b.epoch);
  return { ...chart, days: days.concat(chart.days), dividends: kept.concat(chart.dividends.filter((dividend) => dividend.epoch >= firstFreshEpoch)) };
}
// </windowed-chart>

// <fund-selection> shared block of .claude/tools/etfs/etf-std/fund-selection.block.ts, applied by apply-block.ts: never edit it in one repo
/** An index row as far as these helpers read it: the ticker and whether it has published data (`dataFile`, null for a catalog-only row). */
export type FundSelectionRow = { ticker?: unknown; dataFile?: unknown };

function fundSelectionTicker(row: FundSelectionRow): string {
  return String(row.ticker === null || row.ticker === undefined ? '' : row.ticker).trim().toUpperCase();
}

/**
 * The tickers a TICKERS entry may name: the live catalog plus every fund with published data (closed funds included). When
 * the live catalog could not be read (`live` null) every previous index row counts, since nothing tells a real catalog-only
 * row from a stale one. A catalog-only row from an earlier mistyped TICKERS run is therefore not "known" (open-items etfs Q27).
 */
export function knownTickers(live: ReadonlyArray<string> | null, previous: ReadonlyArray<FundSelectionRow>): string[] {
  const out: string[] = [];
  const add = (ticker: string): void => { if (ticker && out.indexOf(ticker) < 0) out.push(ticker); };
  if (live) for (let i = 0; i < live.length; i++) add(String(live[i]).trim().toUpperCase());
  for (let i = 0; i < previous.length; i++) if (!live || previous[i].dataFile) add(fundSelectionTicker(previous[i]));
  return out;
}

/** Throws before any fund request when TICKERS names a fund outside `known` (see knownTickers): a clear error, nothing fetched or written. */
export function assertKnownTickers(selected: ReadonlyArray<string> | null, known: ReadonlyArray<string>, where: string): void {
  const unknown = (selected || []).map((ticker) => String(ticker).trim().toUpperCase()).filter((ticker) => ticker && known.indexOf(ticker) < 0);
  if (unknown.length) throw new Error(`TICKERS: ${unknown.join(', ')} not in ${where}; nothing was fetched or written`);
}

/**
 * The index rows without stale catalog-only rows: a row with no published data whose ticker the live catalog no longer lists
 * (an earlier mistyped TICKERS entry, a fund withdrawn before launch). Rows with data always stay; nothing is dropped when the
 * live catalog could not be read (`live` null).
 */
export function withoutStalePlaceholders<T extends FundSelectionRow>(rows: ReadonlyArray<T>, live: ReadonlyArray<string> | null): T[] {
  if (!live) return rows.slice();
  const listed = live.map((ticker) => String(ticker).trim().toUpperCase());
  return rows.filter((row) => Boolean(row.dataFile) || listed.indexOf(fundSelectionTicker(row)) >= 0);
}

/**
 * New funds of a run (open-items etfs Q28): `published` - first published in this run (the previous index had no row for it,
 * or only a catalog-only one), so a fund whose first read failed is announced when it finally succeeds; `pending` - new in the
 * catalog this run but not published yet. Nothing is reported on a first run (empty previous index).
 */
export function newFundsReport(previous: ReadonlyArray<FundSelectionRow>, next: ReadonlyArray<FundSelectionRow>): { published: string[]; pending: string[] } {
  const report = { published: [] as string[], pending: [] as string[] };
  if (!previous.length) return report;
  const before = new Map<string, boolean>();
  for (let i = 0; i < previous.length; i++) before.set(fundSelectionTicker(previous[i]), Boolean(previous[i].dataFile));
  for (let i = 0; i < next.length; i++) {
    const ticker = fundSelectionTicker(next[i]);
    if (!ticker || before.get(ticker)) continue;
    if (next[i].dataFile) report.published.push(ticker);
    else if (!before.has(ticker)) report.pending.push(ticker);
  }
  report.published.sort();
  report.pending.sort();
  return report;
}

/** The log and step-summary lines of a newFundsReport: `NEW FUNDS: A, B` and `NEW FUNDS (not published yet): C`; none when empty. */
export function newFundsLines(report: { published: ReadonlyArray<string>; pending: ReadonlyArray<string> }): string[] {
  const lines: string[] = [];
  if (report.published.length) lines.push(`NEW FUNDS: ${report.published.join(', ')}`);
  if (report.pending.length) lines.push(`NEW FUNDS (not published yet): ${report.pending.join(', ')}`);
  return lines;
}
// </fund-selection>
