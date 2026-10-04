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
  };
  const range = (v: any): string => v?.source ?? `${Number.isFinite(v?.min) ? v.min : ''}:${Number.isFinite(v?.max) ? v.max : ''}`;
  for (const [key, value] of Object.entries(config)) {
    const name = aliases[key] ?? key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
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
function outputPrintConfig(brand: string, config: Record<string, any>): void {
  const entries: [string, string][] = [...outputConfigEntries(config), ['VERBOSE', String(outputVerbose())]];
  console.log(`[ config   ] ${brand} updater:\n${entries.map(([key, value]) => `              ${key}=${/TOKEN|PASSWORD|SECRET|COOKIE|SEC_UA/i.test(key) ? '<redacted>' : outputClean(value)}`).join('\n')}`);
}
function outputHasOutputFilters(config: Record<string, any>): boolean {
  return outputConfigEntries(config).some(([name, value]) =>
    /^(TICKERS|CATEGORY|AUM|TER|DIVIDEND_YIELD|SEC_YIELD|PERFORMANCE_|TOTAL_RETURN_)/.test(name) &&
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
function outputMoney(value: any): string {
  const raw = outputScalar(value);
  if (raw === null || raw === undefined || raw === '—' || raw === '--') return 'null';
  const text = String(raw).replace(/[$,\s]/g, '');
  const match = text.match(/^([+-]?[\d.]+)([KMBT])?$/i);
  if (!match) return outputClean(raw);
  const number = Number(match[1]) * ({ K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[match[2]?.toUpperCase() as 'K' | 'M' | 'B' | 'T'] ?? 1);
  if (!Number.isFinite(number)) return 'null';
  for (const [unit, scale] of [['T', 1e12], ['B', 1e9], ['M', 1e6], ['K', 1e3]] as const) {
    if (Math.abs(number) >= scale) return `$${(number / scale).toFixed(1)}${unit}`;
  }
  return `$${number.toFixed(2)}`;
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
    field('div', outputScalar(data.trailingYield ?? data.yields?.effectiveYield ?? data.yields?.dividendYield ?? data.dividendYield ?? metrics.dividendYield)),
    field('sec', outputScalar(data.secYield ?? data.yields?.secYield ?? metrics.secYield)),
    field('wp', data.workplaceRaw),
  ].filter(part => part !== '').join(' ');
  return `[ ${String(index).padStart(width)}/${String(total).padEnd(width)}  ] ${outputClean(ticker).padEnd(5)} ${status.padEnd(9)}${detail ? ` ${detail}` : ''}${reason ? ` reason=${outputClean(reason)}` : ''}`;
}
function outputCreateReporter(root: URL | string, total: number) {
  let completed = 0;
  return {
    before: (ticker: string) => outputInspectFund(root, ticker),
    async result(ticker: string, before: { digest: string }, status?: string, reason?: unknown, extra: any = {}) {
      const after = await outputInspectFund(root, ticker);
      console.log(outputFundLine(++completed, total, ticker, status ?? (before.digest === after.digest ? 'unchanged' : 'updated'), { ...after.meta, ...extra }, reason));
    },
  };
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
//   holdings      SEC EDGAR Form N-PORT-P for the exact series (the issuer
//                 publishes only the top-10 holdings on the fund page; the
//                 "All Holdings download" is a JavaScript export with no stable
//                 public file URL, so there is no issuer CSV to fetch; the
//                 previous run is the last resort)
//   distributions the Distributions table on the official fund page (Yahoo
//                 dividend events as the fallback)
//   history       Yahoo Finance's public chart endpoint (daily close, adjusted
//                 close, volume, dividends, splits)
//
// Issuer requests are made directly with a browser-like User-Agent first; when
// the issuer answers a non-browser client with an error or a bot-wall page,
// the same public URL is read through the read-only r.jina.ai rendering proxy
// (identical to daggerok/Schwab). No user data or credentials are sent to
// the proxy. SEC and Yahoo requests stay direct.
//
// `OFFLINE_SEED=1` replays the checked-in snapshot in
// the verified snapshot in this file without any network request, but only for
// funds that have no published data yet: it never overwrites a published
// funds/<TICKER>/meta.json and never shrinks index.json.
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
 * detail pages on every run — see the verified snapshot in this file for the
 * read-only offline replay snapshot.
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

// ---------------------------------------------------------------------------
// Verified snapshot (inlined from the former the verified snapshot in this file)
// ---------------------------------------------------------------------------

/**
 * Live Goldman Sachs responses captured during the S0 reconnaissance on 2026-09-21.
 *
 * Why this file exists: the sandbox the feed was first built in has no direct
 * network egress, so the updater could not be run against am.gs.com from
 * there. These are the real, verbatim values the official pages print for a
 * bounded set of funds, kept as a replayable snapshot so
 * `OFFLINE_SEED=1 bun ./scripts/update-data.ts` can produce a working feed
 * offline and so the parsers have real input to be tested against. A run with
 * network access (`OFFLINE_SEED=0`) overwrites every field here from the live
 * endpoints and keeps this file only as the fallback, exactly like the
 * catalog fallback in the sibling updaters.
 *
 * Everything here was read from:
 *   https://am.gs.com/en-us/individual/funds?...filters=funds%7CETF  (finder cards)
 *   https://am.gs.com/en-us/individual/funds/detail/PV<id>/<CUSIP>/<slug>  (fund pages)
 *
 * Nothing in this file is estimated, interpolated or copied from another
 * provider. Cells Goldman Sachs printed as "-" or "N/A" are stored as null.
 */

export const SNAPSHOT_READ_AT = '2026-09-21T00:00:00.000Z';

/** Finder card row, exactly as the server-rendered finder prints it. */
export type FinderSnapshot = {
  /** NAV column value ('41.04 USD'). */
  nav: number | null;
  navAsOf: string | null;
  /** Average-annual-returns column values (percent units, null when '-'). */
  yr1: number | null;
  yr3: number | null;
  yr5: number | null;
  yr10: number | null;
  sinceInception: number | null;
  returnsAsOf: string | null;
  /** Distribution Frequency column ('Monthly' | 'Quarterly' | 'Annually' | 'None'). */
  frequency: string;
};

/**
 * All 48 finder cards, in finder order (alphabetical by fund name).
 * NAV as of Sep 17, 2026; returns as of Aug 31, 2026 ('--' for funds too young
 * to have annualized returns: GEMQ, GIEQ, GTPE).
 */
export const FINDER_SNAPSHOTS: Record<string, FinderSnapshot> = {
  GEMD: { nav: 41.04, navAsOf: 'Sep 17, 2026', yr1: 6.11, yr3: 8.03, yr5: null, yr10: null, sinceInception: 2.02, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GHYB: { nav: 44.12, navAsOf: 'Sep 17, 2026', yr1: 4.59, yr3: 8.27, yr5: 3.88, yr10: null, sinceInception: 4.56, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GTIP: { nav: 47.06, navAsOf: 'Sep 17, 2026', yr1: 0.97, yr3: 3.9, yr5: 0.3, yr10: null, sinceInception: 3.01, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GIGB: { nav: 44.5, navAsOf: 'Sep 17, 2026', yr1: 1.92, yr3: 4.86, yr5: -0.22, yr10: null, sinceInception: 2.32, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GBIL: { nav: 99.98, navAsOf: 'Sep 17, 2026', yr1: 3.7, yr3: 4.52, yr5: 3.5, yr10: null, sinceInception: 2.31, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GCOR: { nav: 40.01, navAsOf: 'Sep 17, 2026', yr1: 1.8, yr3: 3.85, yr5: -0.63, yr10: null, sinceInception: -0.61, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GPRF: { nav: 48.98, navAsOf: 'Sep 17, 2026', yr1: 2.66, yr3: null, yr5: null, yr10: null, sinceInception: 4.82, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GEM: { nav: 50.62, navAsOf: 'Sep 17, 2026', yr1: 37.09, yr3: 22.57, yr5: 8.27, yr10: 8.79, sinceInception: 9.24, returnsAsOf: 'Aug 31, 2026', frequency: 'Annually' },
  GSEU: { nav: 48.96, navAsOf: 'Sep 17, 2026', yr1: 20.1, yr3: 17.74, yr5: 8.84, yr10: 9.88, sinceInception: 10.02, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GSIE: { nav: 47.21, navAsOf: 'Sep 17, 2026', yr1: 21, yr3: 18.65, yr5: 9.19, yr10: 9.74, sinceInception: 9.06, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GSJY: { nav: 55.61, navAsOf: 'Sep 17, 2026', yr1: 26.7, yr3: 19.44, yr5: 9.89, yr10: 9.5, sinceInception: 9.75, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GSLC: { nav: 145.45, navAsOf: 'Sep 17, 2026', yr1: 16.62, yr3: 19.58, yr5: 11.38, yr10: 14.48, sinceInception: 14.03, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GSSC: { nav: 87.87, navAsOf: 'Sep 17, 2026', yr1: 22.17, yr3: 16.55, yr5: 8.07, yr10: null, sinceInception: 10.44, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GSWO: { nav: 65.1, navAsOf: 'Sep 17, 2026', yr1: 18.23, yr3: 18.73, yr5: null, yr10: null, sinceInception: 13.44, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GBND: { nav: 49.06, navAsOf: 'Sep 17, 2026', yr1: 1.94, yr3: null, yr5: null, yr10: null, sinceInception: 2.95, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GCPB: { nav: 49.42, navAsOf: 'Sep 17, 2026', yr1: 2.32, yr3: 4.92, yr5: -0.22, yr10: 1.81, sinceInception: 3.47, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GIGL: { nav: 49.04, navAsOf: 'Sep 17, 2026', yr1: 2.11, yr3: null, yr5: null, yr10: null, sinceInception: 3.18, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GEMQ: { nav: 23.94, navAsOf: 'Sep 17, 2026', yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null, returnsAsOf: null, frequency: 'Annually' },
  GIEQ: { nav: 42.17, navAsOf: 'Sep 17, 2026', yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null, returnsAsOf: null, frequency: 'Annually' },
  GCAL: { nav: 49.38, navAsOf: 'Sep 17, 2026', yr1: 4.63, yr3: null, yr5: null, yr10: null, sinceInception: 3.45, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GMNY: { nav: 48.5, navAsOf: 'Sep 17, 2026', yr1: 4.55, yr3: null, yr5: null, yr10: null, sinceInception: 2.67, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GUSE: { nav: 45.5, navAsOf: 'Sep 17, 2026', yr1: 19.29, yr3: 19.12, yr5: 12.2, yr10: 15.53, sinceInception: 12.67, returnsAsOf: 'Aug 31, 2026', frequency: 'Annually' },
  GSEW: { nav: 94.89, navAsOf: 'Sep 17, 2026', yr1: 17.16, yr3: 17.44, yr5: 8.51, yr10: null, sinceInception: 12, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GDOC: { nav: 37.24, navAsOf: 'Sep 17, 2026', yr1: 15.26, yr3: 5.12, yr5: null, yr10: null, sinceInception: -1.08, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GTEK: { nav: 55.85, navAsOf: 'Sep 17, 2026', yr1: 54.83, yr3: 31.55, yr5: null, yr10: null, sinceInception: 7.34, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GSGO: { nav: 44.42, navAsOf: 'Sep 17, 2026', yr1: 16.57, yr3: 22.26, yr5: 10.89, yr10: 17.27, sinceInception: 8.75, returnsAsOf: 'Aug 31, 2026', frequency: 'Annually' },
  GVIP: { nav: 168.8, navAsOf: 'Sep 17, 2026', yr1: 19.25, yr3: 24.82, yr5: 10.87, yr10: null, sinceInception: 16.29, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GINC: { nav: 49.39, navAsOf: 'Sep 17, 2026', yr1: 2.87, yr3: 7.21, yr5: 2.9, yr10: null, sinceInception: 3.95, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GIND: { nav: 24.37, navAsOf: 'Sep 17, 2026', yr1: -1.25, yr3: null, yr5: null, yr10: null, sinceInception: 1.13, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GINN: { nav: 81.53, navAsOf: 'Sep 17, 2026', yr1: 18.61, yr3: 19.99, yr5: 6.42, yr10: null, sinceInception: 9.9, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  JUST: { nav: 109.15, navAsOf: 'Sep 17, 2026', yr1: 21.59, yr3: 21.1, yr5: 12.31, yr10: null, sinceInception: 14.67, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GSEE: { nav: 68.13, navAsOf: 'Sep 17, 2026', yr1: 36.67, yr3: 21.9, yr5: 8.05, yr10: null, sinceInception: 12.8, returnsAsOf: 'Aug 31, 2026', frequency: 'Annually' },
  GSID: { nav: 76.74, navAsOf: 'Sep 17, 2026', yr1: 21.8, yr3: 18.3, yr5: 9.26, yr10: null, sinceInception: 14.05, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GGUS: { nav: 66.62, navAsOf: 'Sep 17, 2026', yr1: 11.19, yr3: null, yr5: null, yr10: null, sinceInception: 20.9, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GVUS: { nav: 65.14, navAsOf: 'Sep 17, 2026', yr1: 29.53, yr3: null, yr5: null, yr10: null, sinceInception: 22.1, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GXUS: { nav: 63.53, navAsOf: 'Sep 17, 2026', yr1: 26.67, yr3: 19.77, yr5: null, yr10: null, sinceInception: 18.77, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GSUS: { nav: 105.5, navAsOf: 'Sep 17, 2026', yr1: 20.09, yr3: 21.25, yr5: 12.38, yr10: null, sinceInception: 18.57, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GUSA: { nav: 65.91, navAsOf: 'Sep 17, 2026', yr1: 19.82, yr3: 20.72, yr5: null, yr10: null, sinceInception: 13.99, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GTPE: { nav: 60.18, navAsOf: 'Sep 17, 2026', yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null, returnsAsOf: null, frequency: 'Annually' },
  GMUB: { nav: 49.71, navAsOf: 'Sep 17, 2026', yr1: 4.59, yr3: null, yr5: null, yr10: null, sinceInception: 3.76, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GPIQ: { nav: 56.57, navAsOf: 'Sep 17, 2026', yr1: 24.93, yr3: null, yr5: null, yr10: null, sinceInception: 24.84, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  AAAU: { nav: 43.05, navAsOf: 'Sep 17, 2026', yr1: 32.81, yr3: 32.65, yr5: 20.02, yr10: null, sinceInception: 17.36, returnsAsOf: 'Aug 31, 2026', frequency: 'None' },
  GPIX: { nav: 55.61, navAsOf: 'Sep 17, 2026', yr1: 19.78, yr3: null, yr5: null, yr10: null, sinceInception: 21.94, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GSC: { nav: 62.37, navAsOf: 'Sep 17, 2026', yr1: 21.25, yr3: null, yr5: null, yr10: null, sinceInception: 19.16, returnsAsOf: 'Aug 31, 2026', frequency: 'Quarterly' },
  GTOP: { nav: 49.62, navAsOf: 'Sep 17, 2026', yr1: 30.5, yr3: 28.42, yr5: 12.86, yr10: 20.42, sinceInception: 10.74, returnsAsOf: 'Aug 31, 2026', frequency: 'Annually' },
  GSST: { nav: 50.42, navAsOf: 'Sep 17, 2026', yr1: 4.16, yr3: 5.37, yr5: 3.93, yr10: null, sinceInception: 3.28, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GUMI: { nav: 50.23, navAsOf: 'Sep 17, 2026', yr1: 2.75, yr3: null, yr5: null, yr10: null, sinceInception: 3.18, returnsAsOf: 'Aug 31, 2026', frequency: 'Monthly' },
  GVLE: { nav: 47.94, navAsOf: 'Sep 17, 2026', yr1: 20.79, yr3: 17.22, yr5: 11.37, yr10: 12.13, sinceInception: 10.93, returnsAsOf: 'Aug 31, 2026', frequency: 'Annually' },
};

/** Returns row of a performance table (percent units, null when 'N/A'/'-'). */
export type ReturnsRowSnapshot = {
  sinceInception?: number | null;
  mo1?: number | null;
  mo3?: number | null;
  mo6?: number | null;
  ytd?: number | null;
  yr1?: number | null;
  yr3?: number | null;
  yr5?: number | null;
  yr10?: number | null;
};

/** Fund-page header/quick-stats/key-facts/pricing/yields blocks. */
export type FundPageSnapshot = {
  /** Canonical fund page URL (seed fundPage). */
  fundPage: string;
  nav: number | null;
  navChange: number | null;
  navChangePct: number | null;
  navAsOf: string | null;
  /** Total Fund Assets (Daily) in USD millions. */
  aumDailyMm: number | null;
  aumDailyAsOf: string | null;
  /** Total Fund Assets (Monthly) in USD millions. */
  aumMonthlyMm: number | null;
  aumMonthlyAsOf: string | null;
  /** 'Number of Holdings' (null when the page prints no such line, e.g. AAAU). */
  holdingsCount: number | null;
  /** LBMA Gold Price line (AAAU only). */
  lbmaGoldPrice: number | null;
  assetClass: string | null;
  inceptionDate: string | null;
  benchmark: string | null;
  exchange: string | null;
  navTicker: string | null;
  iopvTicker: string | null;
  etfType: string | null;
  distributor: string | null;
  peRatio: number | null;
  pbRatio: number | null;
  /** Weighted Average Market Cap in USD billions. */
  wtdAvgMktCapBn: number | null;
  netExpenseRatio: number | null;
  grossExpenseRatio: number | null;
  marketPrice: number | null;
  marketPrice52wkRange: string | null;
  premiumDiscount: number | null;
  bidAsk: number | null;
  bidAskSpread30d: number | null;
  pricingAsOf: string | null;
  /** Cumulative + Annualized tables (month-end). */
  monthEndAsOf: string | null;
  monthEndNav: ReturnsRowSnapshot;
  monthEndMarketPrice: ReturnsRowSnapshot;
  /** Quarterly Annualized table (quarter-end). */
  quarterEndAsOf: string | null;
  quarterEndNav: ReturnsRowSnapshot;
  quarterEndMarketPrice: ReturnsRowSnapshot;
  /** Q2 2026 premium/discount day counts (null when the tab is absent). */
  premiumDays: number | null;
  atNavDays: number | null;
  discountDays: number | null;
  distRate12M: number | null;
  secYieldSubsidized: number | null;
  secYieldUnsubsidized: number | null;
  yieldsAsOf: string | null;
};

export const FUND_PAGE_SNAPSHOTS: Record<string, FundPageSnapshot> = {
  GSLC: {
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102394/381430503/goldman-sachs-active-beta-u-s-large-cap-equity-etf',
    nav: 145.45,
    navChange: 1.61,
    navChangePct: 1.12,
    navAsOf: 'Sep 17, 2026',
    aumDailyMm: 15098.52,
    aumDailyAsOf: 'Sep 17, 2026',
    aumMonthlyMm: 15182.53,
    aumMonthlyAsOf: 'Aug 31, 2026',
    holdingsCount: 427,
    lbmaGoldPrice: null,
    assetClass: 'Equity',
    inceptionDate: 'Sep 17, 2015',
    benchmark: 'Goldman Sachs ActiveBeta U.S. Large Cap Equity Index',
    exchange: 'NYSE Arca',
    navTicker: 'GSLC.NV',
    iopvTicker: 'GSLCIV',
    etfType: 'Passive',
    distributor: 'ALPS Distributors, Inc.',
    peRatio: 23.12,
    pbRatio: 5.15,
    wtdAvgMktCapBn: 1526.44,
    netExpenseRatio: 0.09,
    grossExpenseRatio: 0.09,
    marketPrice: 145.41,
    marketPrice52wkRange: '148.94-121.12',
    premiumDiscount: -0.03,
    bidAsk: 145.46,
    bidAskSpread30d: 0.01,
    pricingAsOf: 'Sep 17, 2026',
    monthEndAsOf: 'Aug 31, 2026',
    monthEndNav: { sinceInception: 321.75, mo1: 2.47, mo3: 2.14, mo6: 11.13, ytd: 11.11, yr1: 16.62, yr3: 19.58, yr5: 11.38, yr10: 14.48 },
    monthEndMarketPrice: { sinceInception: 321.96, mo1: 2.48, mo3: 2.2, mo6: 11.22, ytd: 11.13, yr1: 16.61, yr3: 19.59, yr5: 11.4, yr10: 14.49 },
    quarterEndAsOf: 'Jun 30, 2026',
    quarterEndNav: { yr1: 18.03, yr5: 11.95, yr10: 14.5 },
    quarterEndMarketPrice: { yr1: 18.09, yr5: 11.95, yr10: 14.5 },
    premiumDays: 28,
    atNavDays: 4,
    discountDays: 30,
    distRate12M: 0.92,
    secYieldSubsidized: 0.97,
    secYieldUnsubsidized: 0.97,
    yieldsAsOf: 'Aug 31, 2026',
  },
  GBIL: {
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf',
    nav: 99.98,
    navChange: 0.01,
    navChangePct: 0.01,
    navAsOf: 'Sep 17, 2026',
    aumDailyMm: 7877.7,
    aumDailyAsOf: 'Sep 17, 2026',
    aumMonthlyMm: 7639.03,
    aumMonthlyAsOf: 'Aug 31, 2026',
    holdingsCount: 40,
    lbmaGoldPrice: null,
    assetClass: 'Fixed Income',
    inceptionDate: 'Sep 6, 2016',
    benchmark: 'FTSE US Treasury 0-1 Year Composite Select Index (Total Return, Unhedged, USD)',
    exchange: 'NYSE Arca',
    navTicker: 'GBIL.NV',
    iopvTicker: 'GBILIV',
    etfType: 'Passive',
    distributor: 'ALPS Distributors, Inc.',
    peRatio: null,
    pbRatio: null,
    wtdAvgMktCapBn: null,
    netExpenseRatio: 0.12,
    grossExpenseRatio: 0.14,
    marketPrice: 99.99,
    marketPrice52wkRange: '100.26-99.85',
    premiumDiscount: 0.01,
    bidAsk: 99.99,
    bidAskSpread30d: 0.01,
    pricingAsOf: 'Sep 17, 2026',
    monthEndAsOf: 'Aug 31, 2026',
    monthEndNav: { sinceInception: 25.65, mo1: 0.31, mo3: 0.89, mo6: 1.74, ytd: 2.3, yr1: 3.7, yr3: 4.52, yr5: 3.5, yr10: null },
    monthEndMarketPrice: { sinceInception: 25.64, mo1: 0.29, mo3: 0.89, mo6: 1.74, ytd: 2.28, yr1: 3.69, yr3: 4.5, yr5: 3.5, yr10: null },
    quarterEndAsOf: 'Jun 30, 2026',
    quarterEndNav: { sinceInception: 2.29, yr1: 3.81, yr5: 3.37 },
    quarterEndMarketPrice: { sinceInception: 2.29, yr1: 3.82, yr5: 3.36 },
    premiumDays: 14,
    atNavDays: 32,
    discountDays: 16,
    distRate12M: 3.67,
    secYieldSubsidized: 3.69,
    secYieldUnsubsidized: 3.67,
    yieldsAsOf: 'Aug 31, 2026',
  },
  AAAU: {
    fundPage:
      'https://am.gs.com/en-us/individual/funds/detail/PV103623/38150K103/goldman-sachs-physical-gold-etf',
    nav: 43.05,
    navChange: 0.39,
    navChangePct: 0.91,
    navAsOf: 'Sep 17, 2026',
    aumDailyMm: 2807.57,
    aumDailyAsOf: 'Sep 17, 2026',
    aumMonthlyMm: 2874.48,
    aumMonthlyAsOf: 'Aug 31, 2026',
    holdingsCount: null,
    lbmaGoldPrice: 4328.2,
    assetClass: 'Commodities',
    inceptionDate: 'Jul 26, 2018',
    benchmark: 'London Gold Fixed Price (Price Return, USD, Unhedged)',
    exchange: 'Cboe BZX',
    navTicker: 'AAAU.NV',
    iopvTicker: 'AAAUIV',
    etfType: 'Passive',
    distributor: 'ALPS Distributors, Inc.',
    peRatio: null,
    pbRatio: null,
    wtdAvgMktCapBn: null,
    netExpenseRatio: 0.18,
    grossExpenseRatio: 0.18,
    marketPrice: 42.82,
    marketPrice52wkRange: '54.71-35.81',
    premiumDiscount: -0.53,
    bidAsk: 42.83,
    bidAskSpread30d: 0.02,
    pricingAsOf: 'Sep 17, 2026',
    monthEndAsOf: 'Aug 31, 2026',
    monthEndNav: { sinceInception: 266.13, mo1: 13.27, mo3: 0.31, mo6: -12.71, ytd: 5.79, yr1: 32.81, yr3: 32.65, yr5: 20.02, yr10: null },
    monthEndMarketPrice: { sinceInception: 257.26, mo1: 9.89, mo3: -2.08, mo6: -15.49, ytd: 3.13, yr1: 28.68, yr3: 31.63, yr5: 19.42, yr10: null },
    quarterEndAsOf: 'Jun 30, 2026',
    quarterEndNav: { sinceInception: 15.93, yr1: 22.27, yr5: 17.74 },
    quarterEndMarketPrice: { sinceInception: 15.88, yr1: 21.08, yr5: 17.58 },
    premiumDays: null,
    atNavDays: null,
    discountDays: null,
    distRate12M: null,
    secYieldSubsidized: null,
    secYieldUnsubsidized: null,
    yieldsAsOf: null,
  },
};

/** Top-10 holdings table row (weight in percent units). */
export type TopHoldingSnapshot = { name: string; weight: number };

export type TopHoldingsSnapshot = {
  asOf: string;
  /** '35.85% of Total Portfolio' headline. */
  top10Pct: number;
  rows: TopHoldingSnapshot[];
};

export const TOP_HOLDINGS_SNAPSHOTS: Record<string, TopHoldingsSnapshot> = {
  GSLC: {
    asOf: 'Sep 17, 2026',
    top10Pct: 35.85,
    rows: [
      { name: 'NVIDIA Corp', weight: 8.01 },
      { name: 'Apple Inc', weight: 7.45 },
      { name: 'Microsoft Corp', weight: 5.25 },
      { name: 'Amazon.com Inc', weight: 3.42 },
      { name: 'Alphabet Inc', weight: 2.95 },
      { name: 'Meta Platforms Inc', weight: 2.23 },
      { name: 'Broadcom Inc', weight: 2.19 },
      { name: 'Alphabet Inc', weight: 1.84 },
      { name: 'Micron Technology Inc', weight: 1.27 },
      { name: 'JPMorgan Chase & Co', weight: 1.24 },
    ],
  },
  GBIL: {
    asOf: 'Sep 17, 2026',
    top10Pct: 53.52,
    rows: [
      { name: 'US GOVT T-BILL 08 OCT 2026', weight: 7.2 },
      { name: 'US GOVT T-BILL 27 NOV 2026', weight: 7.15 },
      { name: 'US GOVT T-BILL 22 OCT 2026', weight: 6.8 },
      { name: 'US GOVT T-BILL 29 OCT 2026', weight: 6.56 },
      { name: 'US GOVT T-BILL 27 OCT 2026', weight: 6.52 },
      { name: 'US GOVT T-BILL 25 FEB 2027', weight: 4.18 },
      { name: 'US GOVT 3.875% 31 JUL 2027', weight: 3.93 },
      { name: 'US GOVT T-BILL 24 NOV 2026', weight: 3.84 },
      { name: 'US GOVT 3.875% 31 MAR 2027', weight: 3.68 },
      { name: 'US GOVT 3.75% 30 APR 2027', weight: 3.66 },
    ],
  },
};

/** Distributions table row, exactly as the fund page prints it. */
export type DistributionSnapshot = {
  exDate: string;
  recordDate: string;
  payDate: string;
  amount: number | null;
};

export const DISTRIBUTION_SNAPSHOTS: Record<string, DistributionSnapshot[]> = {
  // Page order is newest-first; the page renders one all-'--' row
  // (12/31/2025) and one duplicated row (12/23/2025) — both cleaned here.
  GSLC: [
    { exDate: '06/24/2026', recordDate: '06/24/2026', payDate: '06/30/2026', amount: 0.3447 },
    { exDate: '03/25/2026', recordDate: '03/25/2026', payDate: '03/31/2026', amount: 0.3409 },
    { exDate: '12/23/2025', recordDate: '12/23/2025', payDate: '12/30/2025', amount: 0.3381 },
    { exDate: '09/24/2025', recordDate: '09/24/2025', payDate: '09/30/2025', amount: 0.3183 },
    { exDate: '06/24/2025', recordDate: '06/24/2025', payDate: '06/30/2025', amount: 0.331 },
    { exDate: '03/25/2025', recordDate: '03/25/2025', payDate: '03/31/2025', amount: 0.3359 },
    { exDate: '12/23/2024', recordDate: '12/23/2024', payDate: '12/30/2024', amount: 0.3629 },
    { exDate: '09/24/2024', recordDate: '09/24/2024', payDate: '09/30/2024', amount: 0.297 },
  ],
  // The page renders the 12/31/2025 row twice — deduplicated here.
  GBIL: [
    { exDate: '09/01/2026', recordDate: '09/01/2026', payDate: '09/08/2026', amount: 0.3047 },
    { exDate: '08/03/2026', recordDate: '08/03/2026', payDate: '08/07/2026', amount: 0.3053 },
    { exDate: '07/01/2026', recordDate: '07/01/2026', payDate: '07/08/2026', amount: 0.3109 },
    { exDate: '06/01/2026', recordDate: '06/01/2026', payDate: '06/05/2026', amount: 0.2777 },
    { exDate: '05/01/2026', recordDate: '05/01/2026', payDate: '05/07/2026', amount: 0.2935 },
    { exDate: '04/01/2026', recordDate: '04/01/2026', payDate: '04/08/2026', amount: 0.3022 },
    { exDate: '03/02/2026', recordDate: '03/02/2026', payDate: '03/06/2026', amount: 0.2747 },
    { exDate: '02/02/2026', recordDate: '02/02/2026', payDate: '02/06/2026', amount: 0.2731 },
    { exDate: '12/31/2025', recordDate: '12/31/2025', payDate: '01/07/2026', amount: 0.3382 },
  ],
};


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
const PROXY_PREFIX = 'https://r.jina.ai/';
const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';
const SEC_SITE = 'https://www.sec.gov';
const SEC_BROWSE_URL = `${SEC_SITE}/cgi-bin/browse-edgar`;
const SEC_ARCHIVES = `${SEC_SITE}/Archives/edgar/data`;
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

export type ParsedNport = {
  regName: string;
  regCik: string;
  seriesName: string;
  seriesId: string;
  repPdDate: string;
  holdings: JsonRecord[];
  totalValue: number;
  netAssets: number | null;
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
  officialReturns: OfficialReturns;
  /** Which sections of the page are present at all (a heading or labelled value), whether or not their values parsed. */
  sections: PageSections;
  /** True only when the pricing table AND the performance (returns) tables are present: such a page has loaded fully. */
  loadedFully: boolean;
};

export type PageSections = { pricing: boolean; yields: boolean; returns: boolean; distributions: boolean; topHoldings: boolean };
const NO_SECTIONS: PageSections = { pricing: false, yields: false, returns: false, distributions: false, topHoldings: false };

export type Distribution = { epoch: number; amount: number };

type SecSeriesRef = { cik: string; seriesId: string; classId: string };
type NportAccession = { accession: string; filed: string; reportDate: string; url: string };

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
  offlineSeed: boolean;
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
let fundTickerMap: Map<string, SecSeriesRef> | null = null;
let fundTickerMapPromise: Promise<Map<string, SecSeriesRef>> | null = null;
let companyTickerMap: Map<string, string> | null = null;
let companyTickerMapPromise: Promise<Map<string, string>> | null = null;

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
  const named = monthDateToIso(raw);
  if (named) return named;
  // Parsed as UTC so a run east of UTC prints the same calendar day as one in UTC.
  const parsed = Date.parse(/(?:Z|UTC|GMT|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw} UTC`);
  return Number.isNaN(parsed) ? raw : new Date(parsed).toISOString().slice(0, 10);
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
    offlineSeed: parseBoolean(env.OFFLINE_SEED),
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

export function parseCatalogText(text: string): CatalogFund[] {
  const source = htmlToText(stripProxyPreamble(normalizeMarkdownLinks(text)));
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

/** Universe seed rows as catalog entries (finder backfill + offline runs). */
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

export async function fetchText(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}): Promise<string> {
  let lastError: unknown = new Error('no request attempted');
  const proxy = isProxyUrl(url);
  // The proxy is rate limited: at most one retry there, whatever MAX_RETRIES says.
  const retries = proxy ? Math.min(config.maxRetries, 1) : config.maxRetries;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await paceRequests(proxy);
      // The signal covers connecting, the headers AND reading the body (both reads below are inside the attempt).
      const response = await fetch(url, { headers: { 'User-Agent': secUserAgent, Accept: '*/*', ...headers }, redirect: 'follow', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
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

async function fetchIssuerText(url: string, label: string, config: UpdaterConfig, validate: (text: string) => boolean, accept = 'text/html,application/xhtml+xml,text/csv,text/plain;q=0.9,*/*;q=0.8', options: { cache?: boolean } = {}): Promise<{ text: string; via: 'direct' | 'proxy' }> {
  let lastError: unknown = new Error('direct request skipped (issuer CDN denies this network)');
  if (!issuerDirectDisabled) {
    try {
      const text = await fetchText(url, label, { ...config, maxRetries: 0 }, { 'User-Agent': BROWSER_UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' });
      if (validate(text)) {
        recordIssuerDirectResult(false);
        return { text, via: 'direct' };
      }
      lastError = new Error(`direct response did not contain the expected content (${text.length} chars: ${responseSnippet(text)})`);
    } catch (error) {
      lastError = error;
      if (/\b403\b/.test(error instanceof Error ? error.message : String(error))) {
        const wasDisabled = issuerDirectDisabled;
        if (recordIssuerDirectResult(true) && !wasDisabled) console.warn('[issuer  ] direct requests are denied from this network; using the read-only rendering proxy for the rest of the run');
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

export function parseProductPage(text: string, ticker: string, now: Date = new Date()): ProductPageSummary {
  const source = htmlToText(stripProxyPreamble(text));
  const lines = toTextLines(source);
  const upper = ticker.toUpperCase();
  const empty: ProductPageSummary = {
    name: null, cusip: '', exchange: '', assetClass: '', benchmark: '', inception: null,
    nav: null, navChange: null, navChangePct: null, navAsOfDate: null,
    aumDaily: null, aumDailyAsOfDate: null, aumMonthly: null, aumMonthlyAsOfDate: null,
    totalHoldings: null, lbmaGoldPrice: null, lbmaGoldPriceAsOfDate: null,
    netExpenseRatio: null, grossExpenseRatio: null,
    marketPrice: null, marketPrice52wkRange: '', premiumDiscount: null, pricingAsOfDate: null,
    bidAsk: null, bidAskSpread30d: null,
    premiumDays: null, atNavDays: null, discountDays: null,
    distRate12M: null, secYieldSubsidized: null, secYieldUnsubsidized: null, yieldsAsOfDate: null,
    navTicker: '', iopvTicker: '', distributions: [], topHoldings: null,
    officialReturns: { monthEnd: { nav: null, marketPrice: null }, quarterEnd: { nav: null, marketPrice: null } },
    sections: { ...NO_SECTIONS }, loadedFully: false,
  };
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
// SEC EDGAR Form N-PORT-P (same resolver as daggerok/Schwab)
// ---------------------------------------------------------------------------

function secHeaders(): Record<string, string> {
  return { 'User-Agent': secUserAgent, Accept: 'application/json, application/xml, text/xml, text/plain' };
}

export function parseFundTickerMap(payload: JsonRecord): Map<string, SecSeriesRef> {
  const result = new Map<string, SecSeriesRef>();
  const fields = Array.isArray(payload?.fields) ? payload.fields.map(String) : [];
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const at = (field: string) => String(row[fields.indexOf(field)] ?? '');
    const ticker = sanitizeTicker(at('symbol'));
    const cik = at('cik').replace(/\D/g, '');
    const seriesId = at('seriesId').toUpperCase();
    const classId = at('classId').toUpperCase();
    if (ticker && cik && seriesId && !result.has(ticker)) result.set(ticker, { cik: cik.padStart(10, '0'), seriesId, classId });
  }
  return result;
}

function unescapeXml(value: string): string {
  return value.replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'");
}

function tagValue(xml: string, tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`<(?:(?:[A-Za-z0-9_.-]+):)?${escaped}\\b[^>]*>([\\s\\S]*?)<\\/(?:(?:[A-Za-z0-9_.-]+):)?${escaped}>`, 'i').exec(xml);
  return match ? cleanText(unescapeXml(match[1].replace(/<[^>]+>/g, ' '))) : '';
}

function tagAttribute(xml: string, tag: string, attribute: string): string {
  const match = new RegExp(`<(?:(?:[A-Za-z0-9_.-]+):)?${tag}\\b[^>]*\\b${attribute}="([^"]*)"`, 'i').exec(xml);
  return match ? cleanText(unescapeXml(match[1])) : '';
}

export function nportUrlFor(cik: string, accession: string): string {
  const digits = String(cik).replace(/\D/g, '').replace(/^0+/, '') || '0';
  const acc = String(accession).replace(/-/g, '');
  // The raw submission text is the stable machine-readable public document for
  // NPORT-P filings; primary_doc.xml is often only the EDGAR submission header
  // or an XSL-rendered HTML view.
  return `${SEC_ARCHIVES}/${digits}/${acc}/${accession}.txt`;
}

export function parseEdgarAtomFilings(xml: string): NportAccession[] {
  const result: NportAccession[] = [];
  for (const match of String(xml ?? '').matchAll(/<entry>([\s\S]*?)<\/entry>/gi)) {
    const body = match[1];
    const type = (tagValue(body, 'filing-type') || '').toUpperCase();
    if (type && type !== 'NPORT-P') continue;
    if (/<amend>/i.test(body)) continue;
    const accession = tagValue(body, 'accession-number');
    if (!accession) continue;
    const href = /<filing-href>([\s\S]*?)<\/filing-href>/i.exec(body)?.[1] || '';
    const cik = /\/data\/(\d+)\//i.exec(unescapeXml(href))?.[1] || '';
    result.push({ accession, filed: tagValue(body, 'filing-date'), reportDate: tagValue(body, 'period'), url: nportUrlFor(cik, accession) });
  }
  return result;
}

export function parseNport(xml: string): ParsedNport {
  const text = String(xml ?? '');
  const genInfo = /<genInfo\b[^>]*>([\s\S]*?)<\/genInfo>/i.exec(text)?.[1] || text.slice(0, 5000);
  const fundInfo = /<fundInfo\b[^>]*>([\s\S]*?)<\/fundInfo>/i.exec(text)?.[1] || '';
  const holdings: JsonRecord[] = [];
  let totalValue = 0;
  for (const match of text.matchAll(/<invstOrSec\b[^>]*>([\s\S]*?)<\/invstOrSec>/gi)) {
    const body = match[1];
    const name = tagValue(body, 'name') || tagValue(body, 'title') || '-';
    const cusip = tagValue(body, 'cusip');
    const identifier = cusip && !/^n\/?a$/i.test(cusip) ? cusip : tagAttribute(body, 'isin', 'value') || tagAttribute(body, 'other', 'value') || '-';
    const value = numberOrNull(tagValue(body, 'valUSD'));
    const weight = numberOrNull(tagValue(body, 'pctVal'));
    if (value !== null) totalValue += value;
    const debt = /<debtSec\b[^>]*>([\s\S]*?)<\/debtSec>/i.exec(body)?.[1] || '';
    holdings.push({
      Name: name,
      Ticker: '-',
      Identifier: identifier,
      Weight: weight === null ? '0' : String(weight),
      'Market Value': value === null ? '0' : String(value),
      'Shares Held': tagValue(body, 'balance') || '-',
      'Asset Category': tagValue(body, 'assetCat') || '-',
      ...(debt ? { Coupon: tagValue(debt, 'annualizedRt') || '-', Maturity: tagValue(debt, 'maturityDt') || '-' } : {}),
    });
  }
  return {
    regName: tagValue(genInfo, 'regName'),
    regCik: tagValue(genInfo, 'regCik'),
    seriesName: tagValue(genInfo, 'seriesName'),
    seriesId: tagValue(genInfo, 'seriesId'),
    repPdDate: toIsoDate(tagValue(genInfo, 'repPdDate')),
    holdings,
    totalValue: round(totalValue, 2),
    netAssets: numberOrNull(tagValue(fundInfo, 'netAssets')),
  };
}

export function normalizeHoldingName(value: unknown): string {
  let text = cleanText(value).toUpperCase().replace(/[’']/g, '').replace(/&/g, ' AND ').replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
  text = text.replace(/\bCLASS\s+([A-Z])\b/g, 'CL $1').replace(/\bCL\.?\s*([A-Z])\b/g, 'CL $1');
  const keepClass = text.match(/\bCL\s+[A-Z]\b/gi)?.[0] || '';
  text = text.replace(/\b(THE|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LTD|LIMITED|PLC|SA|NV|AG|SE|SPA|ORDINARY|COMMON|STOCK|SHS|SHARES|ADR|DEPOSITARY|RECEIPT|USD|US|REG|REGISTERED)\b/g, ' ');
  text = text.replace(/\s+/g, ' ').trim();
  if (keepClass && !/\bCL\s+[A-Z]\b/.test(text)) text = `${text} ${keepClass}`.trim();
  return text;
}

export function normalizeHoldingNameCore(value: unknown): string {
  return normalizeHoldingName(value).replace(/\s+CL\s+[A-Z]\b/g, '').trim();
}

export function cleanHoldingTicker(value: unknown): string {
  const raw = cleanText(value).toUpperCase();
  if (!raw || ['-', '--', 'N/A', 'NA', 'NONE', 'NULL', 'SEE FILE'].includes(raw)) return '';
  return raw.replace(/\s+/g, '');
}

function parseCompanyTickerMap(payload: JsonRecord): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of Object.values(payload || {})) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as JsonRecord;
    const ticker = cleanHoldingTicker(row.ticker);
    const title = cleanText(row.title);
    if (!ticker || !title) continue;
    for (const key of [normalizeHoldingName(title), normalizeHoldingNameCore(title)]) if (key && !map.has(key)) map.set(key, ticker);
  }
  return map;
}

async function loadFundTickerTable(config: UpdaterConfig): Promise<Map<string, SecSeriesRef>> {
  if (fundTickerMap) return fundTickerMap;
  if (fundTickerMapPromise) return fundTickerMapPromise;
  fundTickerMapPromise = (async () => {
    const payload = await fetchJson(SEC_FUND_TICKERS_URL, '[edgar   ] fund ticker table', config, secHeaders());
    fundTickerMap = parseFundTickerMap(payload);
    outputNote(`[ ${'edgar'.padEnd(9)}] SEC fund ticker table: ${fundTickerMap.size} share classes`);
    return fundTickerMap;
  })();
  try {
    return await fundTickerMapPromise;
  } finally {
    fundTickerMapPromise = null;
  }
}

async function loadCompanyTickerTable(config: UpdaterConfig): Promise<Map<string, string>> {
  if (companyTickerMap) return companyTickerMap;
  if (companyTickerMapPromise) return companyTickerMapPromise;
  companyTickerMapPromise = (async () => {
    const payload = await fetchJson(SEC_COMPANY_TICKERS_URL, '[edgar   ] company ticker table', config, secHeaders());
    companyTickerMap = parseCompanyTickerMap(payload);
    outputNote(`[ ${'edgar'.padEnd(9)}] SEC company ticker table: ${companyTickerMap.size} issuer names`);
    return companyTickerMap;
  })();
  try {
    return await companyTickerMapPromise;
  } finally {
    companyTickerMapPromise = null;
  }
}

function fillNportTickers(rows: JsonRecord[], names: Map<string, string>): JsonRecord[] {
  return rows.map((row) => {
    if (cleanHoldingTicker(row.Ticker)) return row;
    if ('Maturity' in row && row.Maturity !== '-') return row; // bonds stay identifier-keyed
    const ticker = names.get(normalizeHoldingName(row.Name)) || names.get(normalizeHoldingNameCore(row.Name)) || '';
    return ticker ? { ...row, Ticker: ticker } : row;
  });
}

/**
 * N-PORT series refs for tickers the SEC fund-ticker map does not (yet) list,
 * e.g. recently listed or converted share classes. Look the Series ID up on
 * the trust's filing list (CIK 0001479026, type NPORT-P): open the fund's most
 * recent filing and copy its Series ID; remove the entry once the map catches
 * up. https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001479026&type=NPORT-P
 */
const SEC_SERIES_OVERRIDES: Record<string, SecSeriesRef> = {
};

async function resolveNportFiling(fund: CatalogFund, config: UpdaterConfig): Promise<{ ref: SecSeriesRef; accession: NportAccession } | null> {
  const table = await loadFundTickerTable(config);
  const ref = table.get(fund.ticker) || SEC_SERIES_OVERRIDES[fund.ticker] || null;
  if (!ref) return null;
  const params = new URLSearchParams({ action: 'getcompany', CIK: ref.seriesId, type: 'NPORT-P', owner: 'include', count: '10', output: 'atom' });
  const atom = await fetchText(`${SEC_BROWSE_URL}?${params.toString()}`, `[edgar   ] ${fund.ticker} filings`, config, secHeaders());
  const [accession] = parseEdgarAtomFilings(atom);
  return accession ? { ref, accession } : null;
}

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

function historyRows(days: ChartDay[]): JsonRecord[] {
  // Yahoo recomputes the split/dividend-adjusted close on every request; storing
  // the raw float lets the last digit or two jitter between otherwise identical
  // requests, making every history row (and the fund) look "updated" on every
  // single run. Rounding to 2 decimals is well past any meaningful price
  // precision and absorbs that jitter.
  return days.map((day) => ({ Date: formatDate(day.date), Close: String(day.close), 'Adj Close': String(round(day.adjClose, 2)), Volume: String(day.volume) }));
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
const PROVIDER_LABEL = 'Goldman Sachs Asset Management fund finder + official fund page + fund-page Distributions table + SEC EDGAR Form N-PORT-P holdings + Yahoo Finance public chart API';

/**
 * May this N-PORT filing replace the published holdings? Identity: the filing must name the fund's series.
 * Freshness: its report date must not be older than the published holdings' date (a published top-10
 * snapshot from OFFLINE_SEED does not count as newer than a real filing).
 */
export function checkNportFiling(filingSeriesId: unknown, expectedSeriesId: string, filingReportDate: unknown, publishedAsOf: unknown, publishedSource: unknown): { ok: boolean; reason?: string } {
  const series = String(filingSeriesId ?? '').toUpperCase();
  if (!series) return { ok: false, reason: 'filing names no series; cannot verify it is this fund, ignoring it' };
  if (series !== expectedSeriesId.toUpperCase()) return { ok: false, reason: `filing series ${series} is not ${expectedSeriesId}; ignoring it` };
  const published = /offline seed/i.test(String(publishedSource ?? '')) ? '' : toIsoDate(publishedAsOf ?? '');
  const filing = toIsoDate(filingReportDate ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(published) && /^\d{4}-\d{2}-\d{2}$/.test(filing) && filing < published) return { ok: false, reason: `filing ${filing} is older than the published holdings ${published}; keeping the published holdings` };
  return { ok: true };
}

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
  if (!config.skipGoldmanSachs) {
    if (!fund.fundPage) throw new Error('no official fund page URL; kept the published data');
    if (fund.source === 'previous index') {
      // Rebuilt from the published row: nothing of it may stand in for a value the fresh page leaves out.
      Object.assign(fund, { ter: null, grossTer: null, nav: null, close: null, premiumDiscount: null, netAssets: null, dividendYield: null, secYield: null, asOfDate: null, returnsAsOf: null, returns: { ...EMPTY_RETURNS } });
    }
    try {
      const page = await fetchIssuerText(fund.fundPage, `[product ] ${fund.ticker}`, config, (text) => /Net Asset Value|Total Fund Assets|Fund Inception Date/i.test(text), undefined, { cache: false });
      productVia = page.via;
      summary = parseProductPage(page.text, fund.ticker);
      if (config.storeRawDownloads) {
        const raw = new URL('raw/', API_ROOT);
        await mkdir(raw, { recursive: true });
        await writeFile(new URL(`${fund.ticker}-fund-page.${page.via === 'proxy' ? 'md' : 'html'}`, raw), page.text, 'utf8');
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

  // 2. Holdings: N-PORT-P -> previous run --------------------------------------
  // The issuer publishes only the top-10 holdings on the fund page; the 'All
  // Holdings download' is a JavaScript export with no stable public file URL,
  // so the public SEC filing is the primary full-holdings source.
  let holdingsRows: JsonRecord[] = [];
  let holdingsHeaders: string[] = HOLDINGS_HEADERS;
  let holdingsAsOf: string | null = null;
  let holdingsSource = 'not available from a public SEC filing (the issuer publishes only top-10 holdings)';
  let holdingsDownload: string | null = null;
  let marketValueBasis: string | null = null;
  let nport: ParsedNport | null = null;
  if (!holdingsRows.length && config.edgarFallback) {
    try {
      const filing = await resolveNportFiling(fund, config);
      if (filing) {
        const parsed = parseNport(await fetchText(filing.accession.url, `[nport   ] ${fund.ticker}`, config, secHeaders()));
        // The series must be named in the filing and be this fund's series (identity), and the report
        // must not be older than the holdings already published (freshness): an older filing never
        // replaces newer data. A published top-10 snapshot from OFFLINE_SEED does not count as newer.
        const verdict = checkNportFiling(parsed.seriesId, filing.ref.seriesId, parsed.repPdDate, previousMeta?.holdings?.asOfDate, previousMeta?.holdings?.source);
        if (!verdict.ok) outputNote(`[ ${'nport'.padEnd(9)}] ${fund.ticker}: ${verdict.reason}`);
        if (verdict.ok && parsed.holdings.length) {
          const names = await loadCompanyTickerTable(config);
          holdingsRows = fillNportTickers(parsed.holdings, names);
          holdingsHeaders = holdingsRows.some((row) => 'Coupon' in row || 'Maturity' in row) ? BOND_HOLDINGS_HEADERS : HOLDINGS_HEADERS;
          holdingsAsOf = parsed.repPdDate || null;
          nport = parsed;
          holdingsDownload = filing.accession.url;
          holdingsSource = `SEC EDGAR Form N-PORT-P (accession ${filing.accession.accession}, report period ${parsed.repPdDate || 'n/a'})`;
          marketValueBasis = 'SEC Form N-PORT-P reported value (valUSD)';
        }
      }
    } catch (error) {
      outputNote(`[ ${'nport'.padEnd(9)}] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
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
      chart = parseChart(payload);
      days = chart.days;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Yahoo answers HTTP 404 / "no result" for a symbol it has no chart for: that is an honest empty
      // history (the published rows stay), not a failed source. Everything else fails the whole fund.
      if (!/\b404\b|no result/i.test(message)) throw new Error(`Yahoo chart unavailable (${message}); kept the published data`);
      outputNote(`[ ${'chart'.padEnd(9)}] ${fund.ticker}: ${message}`);
    }
  }
  if (!days.length) {
    const previousRows = await readPreviousSheet(fund.ticker, 'history');
    days = previousRows.map((row) => ({ date: toIsoDate(row.Date), close: numberOrNull(row.Close) || 0, adjClose: numberOrNull(row['Adj Close']) || numberOrNull(row.Close) || 0, volume: numberOrNull(row.Volume) || 0 })).filter((row) => row.date && row.close > 0);
    if (previousRows.length) historySource = previousMeta?.history?.source || 'previous run';
  }
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
  const effective = mergeOfficialReturns(derived, officialMonthly);
  const marketPrice = summary?.marketPrice ?? chart?.regularMarketPrice ?? (days.length ? days[days.length - 1].close : carry ? numberOrNull(previous.closePriceValue) : null);
  const nav = fund.nav ?? (carry ? numberOrNull(previous.navValue) : null);
  const metrics = deriveMetrics(effective, fund, dividends, { paymentsPerYear }, nav ?? marketPrice, Boolean(officialMonthly));
  const skipReasons = postFetchFilterReasons(fund, metrics, config);
  if (skipReasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: skipReasons };
  }

  // 6. Write sheets, meta.json and the index row --------------------------------
  const history = historyRows(days);
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
      productPageRendering: productVia ? (productVia === 'proxy' ? 'read-only rendering proxy (r.jina.ai) of the official fund page' : 'official fund page (direct)') : 'not fetched in this run',
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

// ---------------------------------------------------------------------------
// Offline seed replay (no network; identical feed shape)
// ---------------------------------------------------------------------------

const OFFLINE_BASIS = 'offline seed snapshot (official fund finder + transcribed fund pages, 2026-09-21); refreshed from live sources in CI';

function snapshotReturnRow(values: { sinceInception?: number | null; mo1?: number | null; mo3?: number | null; ytd?: number | null; yr1?: number | null; yr3?: number | null; yr5?: number | null; yr10?: number | null }, asOfDate: string): OfficialReturnRow {
  return { asOfDate, mo1: values.mo1 ?? null, mo3: values.mo3 ?? null, ytd: values.ytd ?? null, yr1: values.yr1 ?? null, cagr3y: values.yr3 ?? null, cagr5y: values.yr5 ?? null, cagr10y: values.yr10 ?? null, siAnn: values.sinceInception ?? null };
}

async function buildOfflineSeedFeed(config: UpdaterConfig): Promise<void> {
  console.log(`[ ${'seed'.padEnd(9)}] OFFLINE_SEED=1: replaying the verified snapshot in this file (no network requests) for funds without published data`);
  // Published data is never overwritten: a fund that already has funds/<T>/meta.json keeps its live files
  // and index row, and the index keeps every known fund (TICKERS and filters only choose which new funds are seeded).
  const known = await readKnownFunds();
  const universe = seedCatalogFunds();
  for (const fund of universe) {
    const snap = FINDER_SNAPSHOTS[fund.ticker];
    if (snap) {
      if (snap.nav !== null) fund.nav = snap.nav;
      if (snap.navAsOf) fund.asOfDate = monthDateToIso(snap.navAsOf);
      if (snap.frequency) fund.frequency = snap.frequency;
      if (snap.returnsAsOf) fund.returnsAsOf = monthDateToIso(snap.returnsAsOf);
      fund.returns = { ytd: null, yr1: snap.yr1, yr3: snap.yr3, yr5: snap.yr5, yr10: snap.yr10, sinceInception: snap.sinceInception };
    }
    if (fund.cusip) fund.isin = isinFromCusip(fund.cusip);
  }
  universe.sort((a, b) => a.ticker.localeCompare(b.ticker));
  const funds: JsonRecord[] = [];
  const selectedCount = universe.filter(fund => !catalogFilterReasons(fund, config).length).length;
  outputPrintFilter(selectedCount, universe.length);
  const output = outputCreateReporter(API_ROOT, selectedCount);
  for (const fund of universe) {
    if (catalogFilterReasons(fund, config).length) continue;
    const before = await output.before(fund.ticker);
    const fundDir = new URL(`funds/${fund.ticker}/`, API_ROOT);
    if (await readPreviousMeta(fund.ticker)) {
      await output.result(fund.ticker, before, 'skipped', 'published data kept (OFFLINE_SEED only fills funds without data)');
      continue;
    }
    const rich = FUND_PAGE_SNAPSHOTS[fund.ticker];
    const ter = rich?.netExpenseRatio ?? null;
    const grossTer = rich?.grossExpenseRatio ?? null;
    const nav = rich?.nav ?? fund.nav;
    const netAssets = rich?.aumDailyMm != null ? rich.aumDailyMm * 1e6 : null;
    const marketPrice = rich?.marketPrice ?? null;
    const premiumDiscount = rich?.premiumDiscount ?? null;
    const secYield = rich?.secYieldSubsidized ?? null;
    const dividendYield = rich?.distRate12M ?? null;
    const dividends: Distribution[] = (DISTRIBUTION_SNAPSHOTS[fund.ticker] || [])
      .map((row) => ({ epoch: isoToEpoch(toIsoDate(row.exDate)) ?? 0, amount: row.amount ?? 0 }))
      .filter((item) => item.epoch > 0 && item.amount > 0)
      .sort((a, b) => a.epoch - b.epoch);
    const latest = dividends[dividends.length - 1] || null;
    const inferred = inferDistributionFrequency(dividends);
    const distributionFrequency = selectDistributionFrequency(fund.frequency, inferred.frequency, dividends.length, undefined);
    const paymentsPerYear = paymentsPerYearForFrequency(distributionFrequency) ?? inferred.paymentsPerYear;
    const text = (value: number | null) => (value === null ? '—' : `${value.toFixed(2)}%`);
    const monthEndNav = rich?.monthEndNav || {};
    const monthEndMp = rich?.monthEndMarketPrice || {};
    const quarterEndNav = rich?.quarterEndNav || {};
    const quarterEndMp = rich?.quarterEndMarketPrice || {};
    const monthEndAsOf = rich?.monthEndAsOf ? monthDateToIso(rich.monthEndAsOf) : fund.returnsAsOf;
    const quarterEndAsOf = rich?.quarterEndAsOf ? monthDateToIso(rich.quarterEndAsOf) : null;
    const monthEnd = {
      asOfDate: monthEndAsOf ? formatDate(monthEndAsOf) : '—',
      mo1: monthEndNav.mo1 ?? null, mo1Text: text(monthEndNav.mo1 ?? null),
      mo3: monthEndNav.mo3 ?? null, mo3Text: text(monthEndNav.mo3 ?? null),
      qtd: null, qtdText: '—',
      ytd: monthEndNav.ytd ?? null, ytdText: text(monthEndNav.ytd ?? null),
      yr1: fund.returns.yr1, yr1Text: text(fund.returns.yr1),
      yr3: fund.returns.yr3, yr3Text: text(fund.returns.yr3),
      yr5: fund.returns.yr5, yr5Text: text(fund.returns.yr5),
      yr10: fund.returns.yr10, yr10Text: text(fund.returns.yr10),
      sinceInception: fund.returns.sinceInception, sinceInceptionText: text(fund.returns.sinceInception),
    };
    const quarterEnd = {
      asOfDate: quarterEndAsOf ? formatDate(quarterEndAsOf) : '—',
      ytd: null,
      yr1: quarterEndNav.yr1 ?? null,
      yr3: quarterEndNav.yr3 ?? null,
      yr5: quarterEndNav.yr5 ?? null,
      yr10: quarterEndNav.yr10 ?? null,
      sinceInception: quarterEndNav.sinceInception ?? null,
    };
    const returns: JsonRecord = { derivedFrom: OFFLINE_BASIS, monthEnd, quarterEnd };
    const metrics: JsonRecord = {
      ytd: monthEnd.ytd,
      tr1y: fund.returns.yr1,
      tr3y: annualizedToTotal(fund.returns.yr3, 3),
      tr5y: annualizedToTotal(fund.returns.yr5, 5),
      tr10y: annualizedToTotal(fund.returns.yr10, 10),
      cagr3y: fund.returns.yr3,
      cagr5y: fund.returns.yr5,
      cagr10y: fund.returns.yr10,
      siAnn: fund.returns.sinceInception,
      dividendYield,
      dividendYieldText: dividendYield === null ? '—' : `${dividendYield.toFixed(2)}%`,
      dividendYieldBasis: dividendYield === null ? null : 'official-trailing-12m',
      secYield,
      secYieldText: secYield === null ? '—' : `${secYield.toFixed(2)}%`,
      returnsBasis: OFFLINE_BASIS,
      performanceAsOf: performanceAsOf(monthEndAsOf),
    };
    const top = TOP_HOLDINGS_SNAPSHOTS[fund.ticker];
    const holdingsRows: JsonRecord[] = (top?.rows || []).map((row) => ({
      Name: row.name,
      Ticker: '-',
      Identifier: '-',
      Weight: row.weight === null ? '0' : String(row.weight),
      'Market Value': row.weight !== null && netAssets !== null ? String(round(row.weight / 100 * netAssets, 2)) : '-',
      'Shares Held': '-',
      'Asset Category': rich?.assetClass || fund.category,
    }));
    const holdingsAsOf = top?.asOf ? monthDateToIso(top.asOf) : null;
    const holdingsSource = top
      ? 'offline seed snapshot: official top-10 holdings transcribed from the fund page (full sheet refreshes from SEC EDGAR Form N-PORT-P in CI)'
      : 'offline seed snapshot carries no holdings for this fund (SEC EDGAR Form N-PORT-P refresh in CI)';
    const holdingManifest = await writePages(fundDir, fund.ticker, 'holdings', HOLDINGS_HEADERS, holdingsRows, config.holdingsPageSize, holdingsAsOf, holdingsSource);
    if (top) holdingManifest.marketValueBasis = 'derived: published top-10 weight x Total Fund Assets (Daily)';
    if (rich?.holdingsCount !== null && rich?.holdingsCount !== undefined) holdingManifest.publishedTotalHoldings = rich.holdingsCount;
    const historySource = 'offline seed snapshot carries no price history (Yahoo Finance refresh in CI)';
    const historyManifest = await writePages(fundDir, fund.ticker, 'history', historyHeaders(), [], config.historyPageSize, null, historySource);
    const distributionsSource = dividends.length
      ? 'offline seed snapshot: official fund-page Distributions table (2026-09-21)'
      : distributionFrequency === 'None'
        ? 'the issuer reports no distributions for this fund (Distribution Frequency: None)'
        : 'offline seed snapshot carries no distribution history for this fund';
    const asOfLabel = rich?.navAsOf ? formatDate(monthDateToIso(rich.navAsOf)) : fund.asOfDate ? formatDate(fund.asOfDate) : '—';
    const meta: JsonRecord = {
      ticker: fund.ticker,
      name: fund.name,
      category: fund.category,
      categoryPath: fund.categoryPath || fund.category,
      source: {
        fundPage: fund.fundPage,
        officialProductPage: fund.fundPage,
        productPageRendering: rich ? 'offline seed snapshot of the official fund page (2026-09-21)' : 'offline seed snapshot: fund finder card only (detail refresh in CI)',
        productPageAsOf: rich?.navAsOf ? formatDate(monthDateToIso(rich.navAsOf)) : null,
        holdingsDownload: null,
        distributionsDownload: null,
        navHistoryDownload: null,
        pricesDownload: null,
        yahooChart: `${YAHOO_CHART_URL}/${encodeURIComponent(fund.ticker)}`,
        holdingsSource,
        historySource,
        distributionsSource,
        provider: PROVIDER_LABEL,
      },
      identifiers: { cusip: fund.cusip || null, isin: fund.isin || null, isinBasis: fund.isin ? 'derived from the published CUSIP (US prefix + check digit)' : null, indexTicker: rich?.benchmark || null, exchange: rich?.exchange || null, morningstarCategory: null, navTicker: rich?.navTicker || null, iopvTicker: rich?.iopvTicker || null },
      expenseRatio: { display: ter === null ? '—' : `${ter}%`, value: ter, gross: grossTer, kind: 'Net Expense Ratio published on the official fund page' },
      nav: { display: nav === null ? '—' : `$${nav.toFixed(2)}`, value: nav, asOfDate: asOfLabel },
      marketPrice: { display: marketPrice === null ? '—' : `$${marketPrice.toFixed(2)}`, value: marketPrice, asOfDate: asOfLabel, source: rich ? 'official fund page Pricing Table' : 'offline seed snapshot carries no market price for this fund' },
      premiumDiscount: { display: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`, value: premiumDiscount, asOfDate: asOfLabel, source: rich ? 'official fund page Pricing Table' : 'offline seed snapshot carries no premium/discount for this fund' },
      aum: { display: formatAumDisplay(netAssets), value: netAssets, asOfDate: rich?.aumDailyAsOf ? formatDate(monthDateToIso(rich.aumDailyAsOf)) : '—', source: rich ? 'official fund page Total Fund Assets (Daily)' : 'offline seed snapshot carries no AUM for this fund' },
      fundFacts: { sharesOutstanding: null, portfolioTurnover: null, publishedTotalHoldings: rich?.holdingsCount ?? null, bidAskMidpoint: rich?.bidAsk ?? null, lbmaGoldPrice: rich?.lbmaGoldPrice ?? null, lbmaGoldPriceAsOf: rich?.lbmaGoldPrice ? formatDate(monthDateToIso('Sep 16, 2026')) : null, premiumDays: rich?.premiumDays ?? null, atNavDays: rich?.atNavDays ?? null, discountDays: rich?.discountDays ?? null },
      yields: {
        dividendYield,
        dividendYieldText: metrics.dividendYieldText,
        dividendYieldBasis: metrics.dividendYieldBasis,
        dividendYieldKind: rich?.distRate12M != null ? `12 Month Trailing Distribution Rate published on the official fund page${rich.yieldsAsOf ? ` as of ${formatDate(monthDateToIso(rich.yieldsAsOf))}` : ''}` : 'offline seed snapshot carries no distribution rate for this fund',
        distributionRate: rich?.distRate12M ?? null,
        secYield,
        secYieldText: metrics.secYieldText,
        secYieldKind: rich?.secYieldSubsidized != null ? `Standardized 30-Day Subsidized Yield published on the official fund page${rich.yieldsAsOf ? ` as of ${formatDate(monthDateToIso(rich.yieldsAsOf))}` : ''}` : 'offline seed snapshot carries no SEC yield for this fund',
      },
      returns,
      officialMarketPriceReturns: rich ? { monthEnd: returnRowJson(snapshotReturnRow(monthEndMp, monthEndAsOf || '')), quarterEnd: returnRowJson(snapshotReturnRow(quarterEndMp, quarterEndAsOf || '')) } : null,
      distributions: { frequency: distributionFrequency, frequencyCode: frequencyCodeLabel(distributionFrequency), paymentsPerYear, source: distributionsSource, headers: ['Ex-Date', 'Amount'], rows: distributionRows(dividends) },
      topHoldings: top ? { asOfDate: holdingsAsOf ? formatDate(holdingsAsOf) : '—', asOf: holdingsAsOf ? formatDate(holdingsAsOf) : '—', top10Pct: top.top10Pct, rows: top.rows } : null,
      holdings: holdingManifest,
      history: historyManifest,
    };
    await writeIfChanged(new URL('meta.json', fundDir), meta);
    await output.result(fund.ticker, before);
    funds.push({
      ticker: fund.ticker,
      name: fund.name,
      category: fund.category,
      fundPage: fund.fundPage,
      dataFile: `./funds/${fund.ticker}/meta.json`,
      cusip: fund.cusip || null,
      isin: fund.isin || null,
      ter: ter === null ? '—' : `${ter}%`,
      terValue: ter,
      nav: nav === null ? '—' : `$${nav.toFixed(2)}`,
      navValue: nav,
      aum: formatAumDisplay(netAssets),
      aumValue: netAssets,
      asOfDate: asOfLabel,
      inceptionDate: fund.inception ? formatDate(fund.inception) : '—',
      exchange: rich?.exchange || '',
      closePrice: marketPrice === null ? '—' : `$${marketPrice.toFixed(2)}`,
      closePriceValue: marketPrice,
      premiumDiscount: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`,
      premiumDiscountValue: premiumDiscount,
      frequencyCode: frequencyCodeLabel(distributionFrequency),
      distributions: { frequency: distributionFrequency, exDate: latest ? formatUsDate(latest.epoch) : '—', dividend: latest ? String(round(latest.amount, 6)) : '—' },
      returns,
      metrics,
      holdings: holdingsRows.length,
      history: 0,
    });
  }
  const merged = new Map(known);
  for (const row of funds) merged.set(String(row.ticker), row);
  for (const fund of universe) if (!merged.has(fund.ticker)) merged.set(fund.ticker, placeholderRow(fund));
  funds.length = 0;
  for (const row of [...merged.values()].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)))) funds.push(await finalizeRow(row));
  const counts = { funds: funds.length, holdings: funds.reduce((sum, row) => sum + (numberOrNull(row.holdings) || 0), 0), history: funds.reduce((sum, row) => sum + (numberOrNull(row.history) || 0), 0) };
  await writeIfChanged(INDEX_FILE, {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    source: {
      provider: 'Goldman Sachs Asset Management, U.S.-listed ETFs',
      market: 'us',
      site: GS_SITE,
      catalog: GS_CATALOG_URL,
      catalogFallback: proxyUrl(GS_CATALOG_URL),
      holdings: 'offline seed snapshot: official top-10 holdings (SEC EDGAR Form N-PORT-P refresh in CI)',
      distributions: 'offline seed snapshot: official fund-page Distributions table (full refresh in CI)',
      history: 'offline seed snapshot carries no price history (Yahoo Finance refresh in CI)',
    },
    counts,
    funds,
  });
  console.log(`[ ${'done'.padEnd(9)}] offline seed feed: ${counts.funds} funds / ${counts.holdings} holdings rows`);
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
  holdings      SEC EDGAR Form N-PORT-P for the exact series (the issuer
                publishes only top-10 holdings; no issuer CSV exists)
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
  EDGAR_FALLBACK=true
  SKIP_GOLDMANSACHS=off use the previously published catalog/fund-page data
  SKIP_YAHOO=off      keep previously published history when possible
  OFFLINE_SEED=off    replay the verified snapshot in this file (no network) for funds WITHOUT published data only

Examples:
  TICKERS="GSLC GBIL AAAU" ./scripts/update-data.ts
  AUM="large:" TER=":0.10" ./scripts/update-data.ts
  PERFORMANCE_3Y="10:" TOTAL_RETURN_1Y="15:" ./scripts/update-data.ts
  OFFLINE_SEED=1 ./scripts/update-data.ts
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
  outputPrintConfig('Goldman-Sachs', config);

  if (config.offlineSeed) {
    await buildOfflineSeedFeed(config);
    return;
  }

  const previous = await readKnownFunds();
  const catalog = new Map<string, CatalogFund>();
  let catalogSource = 'previous api/goldmansachs/index.json';
  if (!config.skipGoldmanSachs) {
    try {
      const fetched = await fetchIssuerText(GS_CATALOG_URL, '[catalog ] fund finder', config, (text) => /\/funds\/detail\/PV\d+\//i.test(text) && /Average Annual Returns|Distribution Frequency/i.test(text), undefined, { cache: false });
      const parsed = parseCatalogText(fetched.text);
      for (const fund of parsed) catalog.set(fund.ticker, fund);
      catalogSource = fetched.via === 'proxy' ? 'Goldman Sachs Asset Management fund finder via read-only rendering proxy' : 'Goldman Sachs Asset Management fund finder';
      if (config.storeRawDownloads) {
        const raw = new URL('raw/', API_ROOT);
        await mkdir(raw, { recursive: true });
        await writeFile(new URL(`fund-finder-${new Date().toISOString().slice(0, 10)}.${fetched.via === 'proxy' ? 'md' : 'html'}`, raw), fetched.text, 'utf8');
      }
    } catch (error) {
      console.warn(`[ ${'catalog'.padEnd(9)}] ${error instanceof Error ? error.message : String(error)} - keeping the published feed`);
    }
  }
  // The checked-in universe seed pins the catalog: seed funds the live finder
  // did not return (card layout drift, pagination) still refresh by URL, and
  // live-only tickers are kept so new listings are never dropped silently.
  for (const seed of seedCatalogFunds()) if (!catalog.has(seed.ticker)) catalog.set(seed.ticker, seed);
  // Funds already published (index rows and funds/*/meta.json) always stay known, even when the live finder or the seed misses them.
  for (const [ticker, row] of previous) if (!catalog.has(ticker)) catalog.set(ticker, parsePreviousFund(ticker, row));

  const universe = [...catalog.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  if (!universe.length) throw new Error('No catalog rows available. Run this where am.gs.com is reachable or seed api/goldmansachs/index.json first.');
  console.log(`[ ${'catalog'.padEnd(9)}] ${universe.length} Goldman Sachs ETFs (${catalogSource})`);

  // Strict: a requested ticker the catalog does not list is an error, never a silently empty run.
  if (config.tickers) {
    const unknown = [...config.tickers].filter((ticker) => !catalog.has(ticker));
    if (unknown.length) throw new Error(`TICKERS: not in the Goldman Sachs ETF catalog: ${unknown.join(', ')}`);
  }

  // New listings: catalog tickers the published feed does not know yet.
  const newFunds = previous.size ? universe.filter((fund) => !previous.has(fund.ticker)).map((fund) => fund.ticker) : [];
  if (newFunds.length) {
    console.log(`NEW FUNDS: ${newFunds.join(', ')}`);
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `### Goldman Sachs data update\n\nNEW FUNDS: ${newFunds.join(', ')}\n`, 'utf8');
  }

  // MAX_FETCHES batches walk the filtered set (TICKERS and catalog-level filters) in ticker order from the
  // saved cursor and wrap around. A TICKERS run is an explicit selection: it never reads, moves or deletes the cursor.
  const filtered = universe.filter((fund) => !catalogFilterReasons(fund, config).length);
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
  const output = outputCreateReporter(API_ROOT, candidates.length);
  const worker = async (): Promise<void> => {
    for (;;) {
      if (Date.now() > deadlineAt) { deadlineHit = true; return; }
      const fund = queue.shift();
      if (!fund) return;
      const before = await output.before(fund.ticker);
      try {
        const row = await processFund(fund, config, previous.get(fund.ticker) || {});
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
  const merged = new Map(previous);
  for (const fund of universe) if (!merged.has(fund.ticker)) merged.set(fund.ticker, placeholderRow(fund));
  for (const row of results) merged.set(String(row.ticker), row);
  const funds: JsonRecord[] = [];
  for (const row of [...merged.values()].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)))) funds.push(await finalizeRow(row));
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
      holdings: 'SEC EDGAR Form N-PORT-P per fund (the issuer publishes only top-10 holdings)',
      distributions: 'official fund-page Distributions table per fund (Yahoo dividend events fallback)',
      history: 'Yahoo Finance public chart API (adjusted close)',
    },
    counts,
    funds,
  });
  if (useCursor) {
    // The cursor is the last fund of the contiguous prefix of this batch that finished (completion order does not
    // matter). A full pass that finished clears it; a bounded or interrupted batch resumes after it.
    let prefix = 0;
    while (prefix < candidates.length && finished.has(candidates[prefix].ticker)) prefix += 1;
    const next = prefix === 0 ? (cursor || null) : config.maxFetches === 0 && prefix >= ordered.length ? null : candidates[prefix - 1].ticker;
    await writeIfChanged(STATE_FILE, { cursor: next, savedAt: isoNow() });
  }
  console.log(`[ ${'done'.padEnd(9)}] ${results.length} funds updated, ${failures} failures`);
  console.log(`[ ${'done'.padEnd(9)}] counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows`);
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
  'EDGAR_FALLBACK', 'SKIP_YAHOO', 'SKIP_GOLDMANSACHS', 'OFFLINE_SEED', 'VERBOSE', 'USE_SYSTEM_CA',
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
  for (const key of ['STORE_RAW_DOWNLOADS', 'EDGAR_FALLBACK', 'SKIP_YAHOO', 'SKIP_GOLDMANSACHS', 'OFFLINE_SEED', 'VERBOSE']) {
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
