// Bun's test runner provides these globals at runtime.
// @ts-ignore the repository intentionally keeps runtime dependencies at zero.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTROL_NAMES,
  DERIVED_RETURNS_BASIS,
  NO_DATA_BASIS,
  OFFICIAL_RETURNS_BASIS,
  annualizedToTotal,
  aumToUsd,
  checkNportFiling,
  cleanHoldingTicker,
  deriveMetrics,
  fetchText,
  firstDate,
  firstNumber,
  frequencyCodeLabel,
  indexRowFromMeta,
  inferDistributionFrequency,
  installSystemCa,
  isCertError,
  isinFromCusip,
  main,
  mergeOfficialReturns,
  mergePublishedRows,
  monthDateToIso,
  normalizeHoldingName,
  nportUrlFor,
  numberOrNull,
  paceRequests,
  parseAumRange,
  parseCatalogText,
  parseChart,
  parseCsv,
  parseEdgarAtomFilings,
  parseFundTickerMap,
  parseHistoryRange,
  parseNport,
  parseOfficialReturns,
  parseProductPage,
  parseRange,
  parseRanges,
  paymentsPerYearForFrequency,
  performanceAsOf,
  placeholderRow,
  postFetchFilterReasons,
  priceReturns,
  readConfig,
  recordIssuerDirectResult,
  resetIssuerDirectState,
  resetPacing,
  resolveControls,
  rotateAfterCursor,
  runOnLane,
  runtimeControls,
  seedCatalogFunds,
  selectDistributionFrequency,
  setApiRootForTests,
  setFetchTuningForTests,
  toIsoDate,
  toTextLines,
  withMetricsContract,
  yieldBasisFromKind,
  yieldBasisFromYields,
  yahooChartQuery,
} from './update-data';
import { GOLDMAN_SACHS_FUNDS } from './update-data';

// ---------------------------------------------------------------------------
// Fixtures: verbatim shapes observed on am.gs.com (2026-09-21)
// ---------------------------------------------------------------------------

const FUND_FINDER_MARKDOWN = [
  'Title: Fund Finder - Goldman Sachs Asset Management',
  '',
  'URL Source: https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100',
  '',
  'Markdown Content:',
  '# Fund Finder',
  '',
  '48 Funds (48 Share Classes)',
  '',
  '## [Goldman Sachs Access Treasury 0-1 Year ETF](https://am.gs.com/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf)',
  '',
  'GBIL',
  '',
  'FIXED INCOME',
  '',
  'FUND OVERVIEW',
  '',
  '|  | Symbol | NAVas of Sep 17, 2026 | Average Annual Returnsas of Aug 31, 2026 | Distribution Frequency | Documents |',
  '| 1Yr | 3Yr | 5Yr | 10Yr | Inception |',
  '| [381430529](https://am.gs.com/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf) | GBIL | 99.98 USD | 3.7% | 4.52% | 3.5% | - | 2.31%<br>Sep 6, 2016 | Monthly | article |',
  '',
  '## [Goldman Sachs ActiveBeta U.S. Large Cap Equity ETF](https://am.gs.com/en-us/individual/funds/detail/PV102394/381430503/goldman-sachs-active-beta-u-s-large-cap-equity-etf)',
  '',
  'GSLC',
  '',
  'EQUITY',
  '',
  'FUND OVERVIEW',
  '',
  '|  | Symbol | NAVas of Sep 17, 2026 | Average Annual Returnsas of Aug 31, 2026 | Distribution Frequency | Documents |',
  '| 1Yr | 3Yr | 5Yr | 10Yr | Inception |',
  '| [381430503](https://am.gs.com/en-us/individual/funds/detail/PV102394/381430503/goldman-sachs-active-beta-u-s-large-cap-equity-etf) | GSLC | 145.45 USD | 16.62% | 19.58% | 11.38% | 14.48% | 14.03%<br>Sep 17, 2015 | Quarterly | article |',
  '',
  '## [Goldman Sachs Data Enhanced Emerging Markets Equity ETF](https://am.gs.com/en-us/individual/funds/detail/PV110439/38149W390/goldman-sachs-data-enhanced-emerging-markets-equity-etf)',
  '',
  'GEMQ',
  '',
  'EQUITY',
  '',
  'FUND OVERVIEW',
  '',
  '|  | Symbol | NAVas of Sep 17, 2026 | Average Annual Returnsas of -- | Distribution Frequency | Documents |',
  '| 1Yr | 3Yr | 5Yr | 10Yr | Inception |',
  '| [38149W390](https://am.gs.com/en-us/individual/funds/detail/PV110439/38149W390/goldman-sachs-data-enhanced-emerging-markets-equity-etf) | GEMQ | 23.94 USD | - | - | - | - | -<br>Sep 9, 2026 | Annually | article |',
].join('\n');

const FUND_FINDER_HTML = `<!DOCTYPE html><html><head><title>Fund Finder - Goldman Sachs Asset Management</title>
<script>window.app = {"a":1};</script><style>.x{color:red}</style></head>
<body><div>48 Funds (48 Share Classes)</div>
<div class="fund-card"><h2><a href="/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf">Goldman Sachs Access Treasury 0-1 Year ETF</a></h2>
<div>GBIL</div><div>FIXED INCOME</div><div>FUND OVERVIEW</div>
<table><tr><th></th><th>Symbol</th><th>NAV as of Sep 17, 2026</th><th>Average Annual Returns as of Aug 31, 2026</th><th>Distribution Frequency</th><th>Documents</th></tr>
<tr><th>1Yr</th><th>3Yr</th><th>5Yr</th><th>10Yr</th><th>Inception</th></tr>
<tr><td><a href="/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf">381430529</a></td><td>GBIL</td><td>99.98 USD</td><td>3.7%</td><td>4.52%</td><td>3.5%</td><td>-</td><td>2.31%<br>Sep 6, 2016</td><td>Monthly</td><td>article</td></tr>
</table></div>
<div class="fund-card"><h2><a href="/en-us/individual/funds/detail/PV103623/38150K103/goldman-sachs-physical-gold-etf">Goldman Sachs Physical Gold ETF</a></h2>
<div>AAAU</div><div>COMMODITIES</div><div>FUND OVERVIEW</div>
<table><tr><th></th><th>Symbol</th><th>NAV as of Sep 17, 2026</th><th>Average Annual Returns as of Aug 31, 2026</th><th>Distribution Frequency</th><th>Documents</th></tr>
<tr><th>1Yr</th><th>3Yr</th><th>5Yr</th><th>10Yr</th><th>Inception</th></tr>
<tr><td><a href="/en-us/individual/funds/detail/PV103623/38150K103/goldman-sachs-physical-gold-etf">38150K103</a></td><td>AAAU</td><td>43.05 USD</td><td>32.81%</td><td>32.65%</td><td>20.02%</td><td>-</td><td>17.36%<br>Jul 26, 2018</td><td>None</td><td>article</td></tr>
</table></div></body></html>`;

const FUND_PAGE_MARKDOWN = [
  'Title: Goldman Sachs Access Treasury 0-1 Year ETF | GBIL | Class Common Shares',
  '',
  'URL Source: https://am.gs.com/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf',
  '',
  'Markdown Content:',
  '# Goldman Sachs Access Treasury 0-1 Year ETF',
  '',
  'FIXED INCOME',
  '',
  '#### Share Class',
  '',
  'Common Shares',
  '',
  '#### Symbol',
  '',
  'GBIL',
  '',
  '#### CUSIP',
  '',
  '381430529',
  '',
  '## Fund Data',
  '',
  '### Quick Stats',
  '',
  'Net Asset Valuesas of Sep 17, 2026',
  '',
  '99.98USD',
  '',
  '0.01 (0.01%)',
  '',
  'Total Fund Assets (Daily)as of Sep 17, 2026',
  '',
  '7,877.70MMUSD',
  '',
  'Total Fund Assets (Monthly)as of Aug 31, 2026',
  '',
  '7,639.03MMUSD',
  '',
  'Number of Holdings',
  '',
  '40',
  '',
  '### Key Facts',
  '',
  'Asset Class',
  '',
  'Fixed Income',
  '',
  'Fund Inception Date',
  '',
  'Sep 6, 2016',
  '',
  'Benchmark / Comparative Index',
  '',
  'FTSE US Treasury 0-1 Year Composite Select Index (Total Return, Unhedged, USD)',
  '',
  'Exchange',
  '',
  'NYSE Arca',
  '',
  'Nav Ticker',
  '',
  'GBIL.NV',
  '',
  'Intraday Nav Ticker',
  '',
  'GBILIV',
  '',
  '### Fees & Expenses',
  '',
  'Net Expense Ratio',
  '',
  '0.12%',
  '',
  'Gross Expense Ratio',
  '',
  '0.14%',
  '',
  '## Performance',
  '',
  'Market Priceas of Sep 17, 2026',
  '',
  '99.99USD',
  '',
  'Market Price 52 - week Range ($)as of Sep 17, 2026',
  '',
  '100.26-99.85USD',
  '',
  'Premium Discountas of Sep 17, 2026',
  '',
  '0.01%',
  '',
  'Bid/Ask',
  '',
  '99.99USD',
  '',
  '30-Day Median Bid/Ask Spreadas of Sep 17, 2026',
  '',
  '0.01%',
  '',
  '- [**Cumulative Returns (%)** as of Aug 31, 2026](https://am.gs.com/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf#)',
  '- [**Annualized Returns (%)** as of Aug 31, 2026](https://am.gs.com/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf#)',
  '',
  '| label | Since Inception | 1Mth | 3Mth | 6Mth | YTD |',
  '| --- | --: | --: | --: | --: | --: |',
  '| NAV | 25.65 | 0.31 | 0.89 | 1.74 | 2.30 |',
  '| Market Price Returns | 25.64 | 0.29 | 0.89 | 1.74 | 2.28 |',
  '| FTSE US Treasury 0-1 Year Composite Select Index (Total Return, Unhedged, USD) | 27.02 | 0.31 | 0.92 | 1.81 | 2.39 |',
  '',
  '| label | 1Yr | 3Yr | 5Yr | 10Yr |',
  '| --- | --: | --: | --: | --: |',
  '| NAV | 3.70 | 4.52 | 3.50 | N/A |',
  '| Market Price Returns | 3.69 | 4.50 | 3.50 | N/A |',
  '',
  '- [**Average Annualized Returns (%)** as of Aug 31, 2026](https://am.gs.com/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf#)',
  '- [**Quarterly Annualized Returns (%)** as of Jun 30, 2026](https://am.gs.com/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf#)',
  '- [**Calendar Year Returns** as of Aug 31, 2026](https://am.gs.com/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf#)',
  '',
  '| label | Since Inception | 1Yr | 5Yr |',
  '| --- | --: | --: | --: |',
  '| NAV | 2.31 | 3.70 | 3.50 |',
  '| Market Price | 2.31 | 3.69 | 3.50 |',
  '',
  '| label | Since Inception | 1Yr | 5Yr |',
  '| --- | --: | --: | --: |',
  '| NAV | 2.29 | 3.81 | 3.37 |',
  '| Market Price | 2.29 | 3.82 | 3.36 |',
  '',
  '|  | 2017 | 2018 | 2019 |',
  '| NAV | 0.71 | 1.77 | 2.32 |',
  '',
  '| Number of days at Premium | 14 |',
  '| Number of days at NAV | 32 |',
  '| Number of days at Discount | 16 |',
  '',
  '12 Month Trailing Distribution Rateas of Aug 31, 2026',
  '',
  '3.67',
  '',
  'Standardized 30-Day Subsidized Yieldsas of Aug 31, 2026',
  '',
  '3.69',
  '',
  'Standardized 30-Day Unsubsidized Yieldsas of Aug 31, 2026',
  '',
  '3.67',
  '',
  '| Ex-Date | Record Date | Pay Date | $ Amount | Distributions | Short Term Cap Gains | Long Term Cap Gains |',
  '| 09/01/2026 | 09/01/2026 | 09/08/2026 | 0.3047 | 0.3047 | -- | -- |',
  '| 08/03/2026 | 08/03/2026 | 08/07/2026 | 0.3053 | 0.3053 | -- | -- |',
  '| 12/31/2025 | 12/31/2025 | 01/07/2026 | -- | -- | -- | -- |',
  '| 12/31/2025 | 12/31/2025 | 01/07/2026 | 0.3382 | 0.3382 | -- | -- |',
  '| 12/31/2025 | 12/31/2025 | 01/07/2026 | 0.3382 | 0.3382 | -- | -- |',
  '',
  '## Allocations',
  '',
  'All Holdingsas of Sep 17, 2026',
  '',
  'download',
  '',
  '- [**Top 10 Holdings** as of Sep 17, 2026](https://am.gs.com/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf#)',
  '',
  '53.52% of Total Portfolio',
  '',
  '| US GOVT T-BILL 08 OCT 2026 | 7.2% |',
  '',
  '| US GOVT T-BILL 27 NOV 2026 | 7.15% |',
  '',
  '| Others | 46.48% |',
].join('\n');

const FUND_PAGE_HTML = `<html><head><title>Goldman Sachs ActiveBeta U.S. Large Cap Equity ETF | GSLC | Class Common Shares</title></head><body>
<h1>Goldman Sachs ActiveBeta U.S. Large Cap Equity ETF</h1>
<div>EQUITY</div>
<h4>Share Class</h4><div>Common Shares</div>
<h4>Symbol</h4><div>GSLC</div>
<h4>CUSIP</h4><div>381430503</div>
<h2>Fund Data</h2><h3>Quick Stats</h3>
<div>Net Asset Value as of Sep 17, 2026</div><div>145.45USD</div><div>1.61 (1.12%)</div>
<div>Total Fund Assets (Daily) as of Sep 17, 2026</div><div>15,098.52MMUSD</div>
<div>Total Fund Assets (Monthly) as of Aug 31, 2026</div><div>15,182.53MMUSD</div>
<div>Number of Holdings</div><div>427.0</div>
<h3>Key Facts</h3>
<table><tr><th>Asset Class</th><td>Equity</td></tr>
<tr><th>Fund Inception Date</th><td>Sep 17, 2015</td></tr>
<tr><th>Benchmark / Comparative Index</th><td>Goldman Sachs ActiveBeta U.S. Large Cap Equity Index</td></tr>
<tr><th>Exchange</th><td>NYSE Arca</td></tr>
<tr><th>Nav Ticker</th><td>GSLC.NV</td></tr>
<tr><th>Intraday Nav Ticker</th><td>GSLCIV</td></tr></table>
<h3>Fees &amp; Expenses</h3>
<div>Net Expense Ratio</div><div>0.09%</div>
<div>Gross Expense Ratio</div><div>0.09%</div>
<h2>Performance</h2>
<div>Market Price as of Sep 17, 2026</div><div>145.41USD</div>
<div>Premium Discount as of Sep 17, 2026</div><div>-0.03%</div>
<div>Bid/Ask</div><div>145.46USD</div>
<div><a href="#">Cumulative Returns (%)</a> as of Aug 31, 2026</div>
<div><a href="#">Annualized Returns (%)</a> as of Aug 31, 2026</div>
<table><tr><th>label</th><th>Since Inception</th><th>1Mth</th><th>3Mth</th><th>6Mth</th><th>YTD</th></tr>
<tr><td>NAV</td><td>321.75</td><td>2.47</td><td>2.14</td><td>11.13</td><td>11.11</td></tr>
<tr><td>Market Price Returns</td><td>321.96</td><td>2.48</td><td>2.20</td><td>11.22</td><td>11.13</td></tr></table>
<table><tr><th>label</th><th>1Yr</th><th>3Yr</th><th>5Yr</th><th>10Yr</th></tr>
<tr><td>NAV</td><td>16.62</td><td>19.58</td><td>11.38</td><td>14.48</td></tr>
<tr><td>Market Price Returns</td><td>16.61</td><td>19.59</td><td>11.40</td><td>14.49</td></tr></table>
<div><a href="#">Quarterly Annualized Returns (%)</a> as of Jun 30, 2026</div>
<table><tr><th>label</th><th>1Yr</th><th>5Yr</th><th>10Yr</th></tr>
<tr><td>NAV</td><td>18.03</td><td>11.95</td><td>14.50</td></tr>
<tr><td>Market Price</td><td>18.09</td><td>11.95</td><td>14.50</td></tr></table>
<div>12 Month Trailing Distribution Rate as of Aug 31, 2026</div><div>0.92</div>
<div>Standardized 30-Day Subsidized Yields as of Aug 31, 2026</div><div>0.97</div>
<div>Standardized 30-Day Unsubsidized Yields as of Aug 31, 2026</div><div>0.97</div>
<table><tr><th>Ex-Date</th><th>Record Date</th><th>Pay Date</th><th>$ Amount</th><th>Distributions</th><th>Short Term Cap Gains</th><th>Long Term Cap Gains</th></tr>
<tr><td>06/24/2026</td><td>06/24/2026</td><td>06/30/2026</td><td>0.3447</td><td>0.3447</td><td>--</td><td>--</td></tr>
<tr><td>03/25/2026</td><td>03/25/2026</td><td>03/31/2026</td><td>0.3409</td><td>0.3409</td><td>--</td><td>--</td></tr></table>
<div>Top 10 Holdings as of Sep 17, 2026</div><div>35.85% of Total Portfolio</div>
<table><tr><td>NVIDIA Corp</td><td>8.01%</td></tr>
<tr><td>Apple Inc</td><td>7.45%</td></tr>
<tr><td>Others</td><td>64.15%</td></tr></table>
</body></html>`;

// The live render keeps a separator row, spaced labels and no <br> between return and date.
const FUND_FINDER_LIVE = [
  'Markdown Content:',
  '# Fund Finder',
  '',
  '## [Goldman Sachs Access Emerging Markets USD Bond ETF](https://am.gs.com/en-us/individual/funds/detail/PV102979/381430388/goldman-sachs-access-emerging-markets-usd-bond-etf)',
  '',
  'GEMD',
  '',
  'FIXED INCOME',
  '',
  'FUND OVERVIEW',
  '',
  '|  | Symbol | NAV as of Sep 17, 2026 | Average Annual Returns as of Aug 31, 2026 | Distribution Frequency | Documents |',
  '| --- | --- | --- | --- | --- |',
  '| 1Yr | 3Yr | 5Yr | 10Yr | Inception |',
  '| [381430388](https://am.gs.com/en-us/individual/funds/detail/PV102979/381430388/goldman-sachs-access-emerging-markets-usd-bond-etf) | GEMD | 41.04 USD | 6.11% | 8.03% | - | - | 2.02% Feb 15, 2022 | Monthly | article |',
  '',
  '* * *',
].join('\n');

// ---------------------------------------------------------------------------
// Shared harness: clean env, pinned TZ, restored globals, mocked network
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
const realLog = console.log;
const initialExitCode = process.exitCode;
const initialTz = process.env.TZ;

const readRepo = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const configFile = () => JSON.parse(readRepo('scripts/update-data.config.json')) as Record<string, string>;
const rowFor = (index: { funds: Array<{ ticker: string }> }, ticker: string) => index.funds.find((row) => row.ticker === ticker) as any;

type Hit = { url: string };
type Mock = { hits: Hit[]; peak: number; restore: () => void; dir: string; api: string };
const mocks: Mock[] = [];

beforeEach(() => {
  process.env.TZ = 'UTC';
});

afterEach(() => {
  while (mocks.length) mocks.pop()!.restore();
  globalThis.fetch = realFetch;
  console.log = realLog;
  // main() sets process.exitCode = 1 when every fund failed: never let it leak into the runner's exit status
  process.exitCode = initialExitCode ?? 0;
  setFetchTuningForTests(45_000, 800);
  resetIssuerDirectState();
  if (initialTz === undefined) delete process.env.TZ;
  else process.env.TZ = initialTz;
});

function chartJson(days = 400): string {
  const end = Date.UTC(2026, 8, 17) / 1000;
  const timestamp: number[] = [];
  const close: number[] = [];
  for (let i = 0; i < days; i += 1) { timestamp.push(end - (days - 1 - i) * 86_400); close.push(100 + i * 0.05); }
  return JSON.stringify({ chart: { result: [{ meta: { exchangeName: 'PCX', regularMarketPrice: 120, regularMarketTime: end, firstTradeDate: timestamp[0] }, timestamp, indicators: { quote: [{ close, volume: close.map(() => 1000) }], adjclose: [{ adjclose: close }] }, events: { dividends: {} } }] } });
}

/** Mocks catalog, fund pages and Yahoo in a temp output dir; `handler` may override any URL (undefined falls through). */
function mockWorld(opts: { latency?: number; handler?: (url: string) => Response | Promise<Response> | undefined } = {}): Mock {
  const dir = mkdtempSync(join(tmpdir(), 'gs-mock-'));
  const api = join(dir, 'api') + '/';
  mkdirSync(api, { recursive: true });
  setApiRootForTests(pathToFileURL(api));
  const mock: Mock = { hits: [], peak: 0, restore: () => undefined, dir, api };
  let inFlight = 0;
  globalThis.fetch = (async (input: unknown) => {
    const url = String(input);
    mock.hits.push({ url });
    inFlight += 1;
    mock.peak = Math.max(mock.peak, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, opts.latency ?? 5));
      const custom = opts.handler?.(url);
      if (custom) return await custom;
      if (url.includes('am.gs.com/en-us/individual/funds?')) return new Response(FUND_FINDER_HTML);
      if (url.includes('am.gs.com')) return new Response(FUND_PAGE_HTML);
      if (url.includes('query1.finance.yahoo.com')) return new Response(chartJson());
      return new Response('unavailable', { status: 503 });
    } finally {
      inFlight -= 1;
    }
  }) as typeof fetch;
  mock.restore = () => { globalThis.fetch = realFetch; rmSync(dir, { recursive: true, force: true }); };
  mocks.push(mock);
  return mock;
}

/** Runs main() in-process with a clean explicit env (never process.env) and silenced output. */
async function run(env: Record<string, string>, options: { deadlineMs?: number; log?: string[] } = {}): Promise<void> {
  console.log = (...args: unknown[]) => { options.log?.push(args.join(' ')); };
  try {
    await main({ REQUEST_SLEEP: '0', MAX_RETRIES: '1', USE_SYSTEM_CA: 'false', EDGAR_FALLBACK: 'false', ...env }, options);
  } finally {
    console.log = realLog;
  }
}

const readJson = (mock: Mock, path: string) => JSON.parse(readFileSync(join(mock.api, path), 'utf8'));
const snapshot = (root: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path); else out[path.slice(root.length)] = readFileSync(path, 'utf8');
    }
  };
  walk(root);
  return out;
};
const THREE = 'GBIL,AAAU,GSLC';
const NULL_RETURNS = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };

// ---------------------------------------------------------------------------
// controls: resolver, config file, workflow and docs parity (no network)
// ---------------------------------------------------------------------------

describe('controls', () => {
  test('precedence: file < advanced < nonblank input < env, an explicit empty env wins', () => {
    const cases: Array<[unknown[], string, string]> = [
      [[{ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }, { CONCURRENCY: '5' }], 'CONCURRENCY', '5'],
      [[{ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }], 'CONCURRENCY', '4'],
      [[{ CONCURRENCY: 2 }, { CONCURRENCY: 3 }], 'CONCURRENCY', '3'],
      [[{ TICKERS: 'GSLC' }, { TICKERS: 'GBIL' }, { TICKERS: '' }], 'TICKERS', 'GBIL'],
      [[{ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }], 'CONCURRENCY', '2'],
      [[{ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }], 'SKIP_YAHOO', 'false'],
      [[{ SEC_UA: 'a' }, {}, {}, { SEC_UA: '' }], 'SEC_UA', ''],
      [[{ MAX_FETCHES: 7 }, {}, {}, { UNRELATED: 'x' }], 'MAX_FETCHES', '7'],
    ];
    for (const [args, key, expected] of cases) {
      expect((resolveControls as (...a: unknown[]) => Record<string, string>)(...args)[key]).toBe(expected);
    }
  });

  test('brand env aliases (GOLDMANSACHS_<NAME>, HISTORICAL_PAGE_SIZE) work and keep their precedence', () => {
    const resolve = (file: Record<string, unknown>, env: Record<string, string>) => resolveControls(file, {}, {}, env);
    expect(resolve({}, { GOLDMANSACHS_CONCURRENCY: '7' }).CONCURRENCY).toBe('7');
    expect(resolve({}, { HISTORICAL_PAGE_SIZE: '123' }).HISTORY_PAGE_SIZE).toBe('123');
    expect(resolve({ CONCURRENCY: 2 }, { GOLDMANSACHS_CONCURRENCY: '7', CONCURRENCY: '5' }).CONCURRENCY).toBe('7');
    expect(resolve({}, { HISTORY_PAGE_SIZE: '5', HISTORICAL_PAGE_SIZE: '9' }).HISTORY_PAGE_SIZE).toBe('5');
    expect(resolve({ TICKERS: 'GSLC' }, { GOLDMANSACHS_TICKERS: '' }).TICKERS).toBe('');
    expect(readConfig(resolve({}, { GOLDMANSACHS_SKIP_YAHOO: 'true', HISTORICAL_PAGE_SIZE: '50' })).historyPageSize).toBe(50);
    expect(() => resolve({}, { GOLDMANSACHS_CONCURRENCY: '0' })).toThrow('CONCURRENCY');
  });

  test('validation is strict: bad values are errors, never silent fallbacks', () => {
    const resolverRejects: unknown[][] = [
      [{ UNKNOWN: 1 }], [{ SEC_UA: 'x\nEVIL=yes' }], [{ CONCURRENCY: 0 }], [{ MAX_RETRIES: 0 }], [{ MAX_RETRIES: -1 }],
      [{ SEC_YIELD: '3:1' }], [{ HISTORY_RANGE: 'forever' }], [{ MAX_FETCHES: 1.5 }], [{ REQUEST_SLEEP: '-1' }],
      [{ VERBOSE: 'maybe' }], [{ USE_SYSTEM_CA: 'maybe' }], [{ EDGAR_FALLBACK: 'sometimes' }], [{ AUM: '1:2:3' }],
      [{ TER: '5:1' }], [{ PERFORMANCE_1Y: 'a:b' }], [{ TICKERS: ['GSLC'] }], [{ TICKERS: null }], [{ OUTPUT_DIR: '/tmp' }],
      [null], [[]],
      [{}, { SEC_UA: 'x\rfoo' }], [{}, []], [{}, {}, { TICKERS: 'A\nB' }], [{}, {}, {}, { SEC_UA: 'x\0bad' }],
      [{}, {}, {}, { HISTORY_RANGE: 'ytd' }], [{}, {}, {}, { USE_SYSTEM_CA: 'maybe' }],
    ];
    for (const args of resolverRejects) expect(() => (resolveControls as (...a: unknown[]) => unknown)(...args)).toThrow();
    const configRejects: Array<[Record<string, string>, string]> = [
      [{ CONCURRENCY: 'abc' }, 'CONCURRENCY'], [{ MAX_RETRIES: '0' }, 'MAX_RETRIES'], [{ REQUEST_SLEEP: '-2' }, 'REQUEST_SLEEP'],
      [{ TICKERS: 'GSLC, not a ticker!' }, 'TICKERS'], [{ AUM: 'huge:' }, 'AUM'], [{ TER: 'x:1' }, 'TER'],
    ];
    for (const [env, name] of configRejects) expect(() => readConfig(env)).toThrow(name);
    for (const value of ['auto', 'TRUE', 'False']) expect(resolveControls({}, {}, {}, { USE_SYSTEM_CA: value }).USE_SYSTEM_CA).toBe(value);
  });

  test('range filters: min:max bounds, presets, colon-only is inactive, a missing figure fails a bounded range', () => {
    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange(':', 'X')).toBeUndefined();
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
    expect(() => parseRange('5', 'X')).toThrow(/colon is required/);
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('large')).toEqual({ min: 10_000_000_000, max: undefined });
    expect(parseAumRange('micro')).toEqual({ min: 10_000_000, max: 300_000_000 });
    expect(() => parseAumRange('42')).toThrow(/colon is required/);
    expect(parseRanges({ PERFORMANCE_YTD: ':', PERFORMANCE_1Y: ':', TOTAL_RETURN_1Y: ':' }, 'PERFORMANCE')).toEqual({});
    expect(readConfig(resolveControls({ SEC_YIELD: '4:' })).secYield).toEqual({ min: 4, max: undefined });
    expect(readConfig(resolveControls({ SEC_YIELD: ':2.5' })).secYield).toEqual({ min: undefined, max: 2.5 });

    const config = readConfig({ TOTAL_RETURN_10Y: '1:', PERFORMANCE_5Y: ':50' });
    const fund = { ter: 0.1, netAssets: 1e9 } as Parameters<typeof postFetchFilterReasons>[0];
    expect(postFetchFilterReasons(fund, { tr10y: null, cagr5y: null }, config)).toEqual(['PERFORMANCE_5Y', 'TOTAL_RETURN_10Y']);
    expect(postFetchFilterReasons(fund, { tr10y: 20, cagr5y: 10 }, config)).toEqual([]);
    expect(postFetchFilterReasons(fund, { tr10y: null, cagr5y: null }, readConfig({}))).toEqual([]);
    expect(postFetchFilterReasons({ ...fund, ter: null } as typeof fund, {}, readConfig({ TER: ':0.5' }))).toEqual(['TER']);
  });

  test('the scheduled path equals the config defaults and the environment overrides the file', async () => {
    const defaults = configFile();
    expect(resolveControls(defaults, {}, {}, {})).toEqual(defaults);
    expect(await runtimeControls({})).toEqual(defaults);
    const config = readConfig(defaults);
    expect(config).toMatchObject({
      maxFetches: 0, requestSleep: 2, concurrency: 2, holdingsPageSize: 250, historyPageSize: 1000, historyRange: 'max', maxRetries: 2,
      tickers: null, performance: {}, totalReturn: {}, edgarFallback: true, skipYahoo: false, skipGoldmanSachs: false,
      storeRawDownloads: false, secUa: 'daggerok ETF feed daggerok@gmail.com',
    });
    for (const key of ['aum', 'ter', 'dividendYield', 'secYield'] as const) expect(config[key]).toBeUndefined();
    const controls = await runtimeControls({ TICKERS: 'GSLC GBIL', SKIP_YAHOO: 'true', PERFORMANCE_1Y: '15:' });
    const overridden = readConfig(controls);
    expect([...(overridden.tickers ?? [])]).toEqual(['GSLC', 'GBIL']);
    expect(overridden.skipYahoo).toBe(true);
    expect(overridden.performance['1Y']).toEqual({ min: 15, max: undefined });
  });

  test('USE_SYSTEM_CA: only untrusted-certificate errors restart the script, once, in auto mode', async () => {
    expect(configFile().USE_SYSTEM_CA).toBe('auto');
    expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
    expect(isCertError(new Error('fetch failed', { cause: new Error('self-signed certificate in certificate chain') }))).toBe(true);
    expect(isCertError({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(false);
    expect(isCertError(null)).toBe(false);

    let calls = 0;
    const reexec = (() => { calls += 1; throw new Error('reexec'); }) as () => never;
    installSystemCa('false', reexec, false);
    installSystemCa('auto', reexec, true);
    expect(globalThis.fetch).toBe(realFetch);
    expect(() => installSystemCa('true', reexec, false)).toThrow('reexec');
    expect(calls).toBe(1);

    calls = 0;
    let next: () => Promise<Response> = async () => { throw Object.assign(new Error('fetch failed'), { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }); };
    globalThis.fetch = (async () => next()) as unknown as typeof fetch;
    installSystemCa('auto', reexec, false);
    await expect(fetch('https://example.invalid/')).rejects.toThrow('reexec');
    expect(calls).toBe(1);
    next = async () => { throw new Error('ECONNRESET'); };
    await expect(fetch('https://example.invalid/')).rejects.toThrow('ECONNRESET');
    next = async () => new Response('ok');
    expect(await (await fetch('https://example.invalid/')).text()).toBe('ok');
    expect(calls).toBe(1);
  });

  test('config keys, CONTROL_NAMES, README and --help are in sync, and scripts/ holds only the standard files', () => {
    expect(Object.keys(configFile()).sort()).toEqual([...CONTROL_NAMES].sort());
    for (const value of Object.values(configFile())) expect(typeof value).toBe('string');
    const doc = readRepo('README.md');
    const usage = readRepo('scripts/update-data.ts');
    for (const name of CONTROL_NAMES) {
      const tenor = name.match(/^(PERFORMANCE|TOTAL_RETURN)_(1Y|3Y|5Y|10Y)$/);
      expect(doc).toContain(tenor ? '`_' + tenor[2] + '`' : '`' + name + '`');
      expect(usage).toContain(tenor ? `${tenor[1]}_YTD|1Y|3Y|5Y|10Y` : name);
    }
    expect(doc).not.toContain('example.com');
    expect(usage).not.toContain('example.com');
    expect(readdirSync(new URL('./', import.meta.url)).sort()).toEqual(['update-data.config.json', 'update-data.test.ts', 'update-data.ts']);
  });

  test('the workflow resolves the same controls and only writes under api/goldmansachs', () => {
    const yml = readRepo('.github/workflows/update-data.yml');
    const block = yml.slice(yml.indexOf('    inputs:'), yml.indexOf('\npermissions:'));
    const names = [...block.matchAll(/^      (\w+):$/gm)].map((m) => m[1]);
    expect(names.length).toBeLessThanOrEqual(25);
    expect(names).toContain('advanced');
    for (const name of names.filter((n) => n !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase() as never);
    for (const text of ['import { resolveControls } from "./scripts/update-data.ts"', 'toJSON(inputs)', 'PROTECTED_SEC_UA: ${{ vars.SEC_UA }}', 'git add api/goldmansachs\n', 'timeout-minutes: 30', 'persist-credentials: false']) {
      expect(yml).toContain(text);
    }
    expect(yml.match(/git add /g)?.length).toBe(1);
    expect(yml).not.toMatch(/\$\{\{\s*(inputs|github\.event\.inputs)\./);
    expect(yml).not.toMatch(/^  push:/m);
    expect(yml).not.toContain('OUTPUT_DIR');
    for (const dir of yml.match(/api\/[\w-]+/g) ?? []) expect(dir).toBe('api/goldmansachs');
  });
});

// ---------------------------------------------------------------------------
// parsing: provider payloads, missing values become null
// ---------------------------------------------------------------------------

describe('parsing', () => {
  test('scalar helpers: signs, placeholders become null, dates, units', () => {
    const cases: Array<[unknown, unknown]> = [
      [numberOrNull('+0.25'), 0.25], [numberOrNull('-0.01%'), -0.01], [numberOrNull('$15,193,857,213.48'), 15_193_857_213.48],
      [numberOrNull('(1.5)'), -1.5], [numberOrNull('--'), null], [numberOrNull('N/A'), null], [numberOrNull('—'), null], [numberOrNull(''), null],
      [toIsoDate('2026-09-17'), '2026-09-17'], [toIsoDate('08/05/2010'), '2010-08-05'], [toIsoDate('10/10/19'), '2019-10-10'],
      [toIsoDate('Sep 17, 2015'), '2015-09-17'], [toIsoDate(''), ''],
      [monthDateToIso('August 31, 2026'), '2026-08-31'], [monthDateToIso('Net Asset Valuesas of Sep 17, 2026'), '2026-09-17'],
      [monthDateToIso('2.31%<br>Sep 6, 2016'), '2016-09-06'], [monthDateToIso('--'), ''],
      [aumToUsd('15,098.52MMUSD'), 15_098_520_000], [aumToUsd('123.45'), 123.45], [aumToUsd('--'), null],
      [firstNumber('3.25% As of 09/17/2026'), 3.25], [firstNumber('145.45USD'), 145.45], [firstNumber('--'), null],
      [firstDate('Ex-Date 09/01/2026'), '2026-09-01'], [firstDate('no date here'), null],
      [isinFromCusip('381430503'), 'US3814305039'], [isinFromCusip('bad'), ''],
      [annualizedToTotal(10, 3), 33.1], [annualizedToTotal(null, 3), null],
      [parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n\r\n1,2'), [['a', 'b'], ['x, y', 'he said "hi"'], ['1', '2']]],
    ];
    for (const [actual, expected] of cases) expect(actual).toEqual(expected);
  });

  test('dates parse the same in every time zone, east and west of UTC', () => {
    const script = `import { toIsoDate } from ${JSON.stringify(new URL('./update-data.ts', import.meta.url).pathname)}; console.log(toIsoDate('Sep 17 2026'), toIsoDate('September 5 2026'));`;
    for (const tz of ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']) {
      const child = Bun.spawnSync([process.execPath, '-e', script], { env: { PATH: process.env.PATH ?? '', TZ: tz } });
      expect(new TextDecoder().decode(child.stdout).trim()).toBe('2026-09-17 2026-09-05');
    }
  });

  test('fund finder: proxied markdown, relative links, live render and direct HTML', () => {
    const gbil = {
      name: 'Goldman Sachs Access Treasury 0-1 Year ETF', category: 'Fixed Income', cusip: '381430529',
      fundPage: 'https://am.gs.com/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf',
      inception: '2016-09-06', nav: 99.98, asOfDate: '2026-09-17', frequency: 'Monthly', returnsAsOf: '2026-08-31', source: 'goldman',
      returns: { ytd: null, yr1: 3.7, yr3: 4.52, yr5: 3.5, yr10: null, sinceInception: 2.31 },
    };
    const relative = FUND_FINDER_MARKDOWN.replaceAll('](https://am.gs.com/', '](/');
    for (const text of [FUND_FINDER_MARKDOWN, relative]) {
      const funds = parseCatalogText(text);
      expect(funds.map((fund) => fund.ticker)).toEqual(['GBIL', 'GEMQ', 'GSLC']);
      expect(funds.find((fund) => fund.ticker === 'GBIL')).toMatchObject(gbil);
      expect(funds.find((fund) => fund.ticker === 'GSLC')).toMatchObject({ category: 'Equity', frequency: 'Quarterly', returns: { yr10: 14.48, sinceInception: 14.03 } });
      expect(funds.find((fund) => fund.ticker === 'GEMQ')).toMatchObject({ nav: 23.94, returns: NULL_RETURNS, returnsAsOf: null, inception: '2026-09-09', frequency: 'Annually' });
    }
    const live = parseCatalogText(FUND_FINDER_LIVE);
    expect(live.map((fund) => fund.ticker)).toEqual(['GEMD']);
    expect(live[0]).toMatchObject({ cusip: '381430388', nav: 41.04, frequency: 'Monthly', inception: '2022-02-15', returnsAsOf: '2026-08-31', returns: { yr1: 6.11, yr3: 8.03, yr5: null, yr10: null, sinceInception: 2.02 } });
    const html = parseCatalogText(FUND_FINDER_HTML);
    expect(html.map((fund) => fund.ticker)).toEqual(['AAAU', 'GBIL']);
    expect(html[0]).toMatchObject({ name: 'Goldman Sachs Physical Gold ETF', category: 'Commodities', cusip: '38150K103', nav: 43.05, frequency: 'None', inception: '2018-07-26', returns: { yr1: 32.81, sinceInception: 17.36 } });
    expect(() => parseCatalogText('<html><body>Access denied</body></html>')).toThrow(/no ETF rows/);
  });

  test('fund page: proxied markdown and direct HTML renderings', () => {
    const md = parseProductPage(FUND_PAGE_MARKDOWN, 'GBIL');
    expect(md).toMatchObject({
      name: 'Goldman Sachs Access Treasury 0-1 Year ETF', cusip: '381430529', exchange: 'NYSE Arca', assetClass: 'Fixed Income', inception: '2016-09-06',
      nav: 99.98, navChange: 0.01, navChangePct: 0.01, navAsOfDate: '2026-09-17', aumDaily: 7_877_700_000, aumMonthly: 7_639_030_000,
      aumMonthlyAsOfDate: '2026-08-31', totalHoldings: 40, netExpenseRatio: 0.12, grossExpenseRatio: 0.14, marketPrice: 99.99,
      premiumDiscount: 0.01, premiumDays: 14, atNavDays: 32, discountDays: 16, distRate12M: 3.67, secYieldSubsidized: 3.69,
      secYieldUnsubsidized: 3.67, yieldsAsOfDate: '2026-08-31', navTicker: 'GBIL.NV', iopvTicker: 'GBILIV',
    });
    expect(md.distributions).toEqual([
      { epoch: Date.UTC(2025, 11, 31) / 1000, amount: 0.3382 },
      { epoch: Date.UTC(2026, 7, 3) / 1000, amount: 0.3053 },
      { epoch: Date.UTC(2026, 8, 1) / 1000, amount: 0.3047 },
    ]);
    expect(md.topHoldings).toMatchObject({ asOfDate: '2026-09-17', top10Pct: 53.52, rows: [{ name: 'US GOVT T-BILL 08 OCT 2026', weight: 7.2 }, { name: 'US GOVT T-BILL 27 NOV 2026', weight: 7.15 }] });
    expect(md.officialReturns.monthEnd.nav).toEqual({ asOfDate: '2026-08-31', mo1: 0.31, mo3: 0.89, ytd: 2.3, yr1: 3.7, cagr3y: 4.52, cagr5y: 3.5, cagr10y: null, siAnn: 2.31 });
    expect(md.officialReturns.monthEnd.marketPrice).toMatchObject({ mo1: 0.29, siAnn: 2.31 });
    expect(md.officialReturns.quarterEnd.nav).toEqual({ asOfDate: '2026-06-30', mo1: null, mo3: null, ytd: null, yr1: 3.81, cagr3y: null, cagr5y: 3.37, cagr10y: null, siAnn: 2.29 });

    const html = parseProductPage(FUND_PAGE_HTML, 'GSLC');
    expect(html).toMatchObject({
      name: 'Goldman Sachs ActiveBeta U.S. Large Cap Equity ETF', cusip: '381430503', assetClass: 'Equity', inception: '2015-09-17', nav: 145.45,
      aumDaily: 15_098_520_000, totalHoldings: 427, netExpenseRatio: 0.09, marketPrice: 145.41, premiumDiscount: -0.03, distRate12M: 0.92,
      secYieldSubsidized: 0.97, navTicker: 'GSLC.NV',
    });
    expect(html.distributions.map((d) => d.amount)).toEqual([0.3409, 0.3447]);
    expect(html.topHoldings).toMatchObject({ top10Pct: 35.85, rows: [{ name: 'NVIDIA Corp', weight: 8.01 }, { name: 'Apple Inc', weight: 7.45 }] });
    expect(html.officialReturns.monthEnd.nav).toEqual({ asOfDate: '2026-08-31', mo1: 2.47, mo3: 2.14, ytd: 11.11, yr1: 16.62, cagr3y: 19.58, cagr5y: 11.38, cagr10y: 14.48, siAnn: null });
  });

  test('page-loaded check: the pricing table and the performance tables must both be present', () => {
    const cut = (html: string, from: string, to: string) => html.slice(0, html.indexOf(from)) + html.slice(html.indexOf(to));
    const partial = cut(FUND_PAGE_HTML, '<h2>Performance</h2>', '<div>Top 10 Holdings');
    expect(parseProductPage(FUND_PAGE_HTML, 'GSLC')).toMatchObject({ loadedFully: true, sections: { pricing: true, yields: true, returns: true, distributions: true, topHoldings: true } });
    expect(parseProductPage(FUND_PAGE_MARKDOWN, 'GBIL')).toMatchObject({ loadedFully: true });
    expect(parseProductPage(partial, 'GSLC')).toMatchObject({ nav: 145.45, loadedFully: false, sections: { pricing: false, yields: false, returns: false, distributions: false, topHoldings: true } });
    // pricing without the performance tables (and the reverse) is still partial; a missing yields block alone is not
    expect(parseProductPage(cut(FUND_PAGE_HTML, '<div><a href="#">Cumulative', '<div>Top 10 Holdings'), 'GSLC').loadedFully).toBe(false);
    expect(parseProductPage(cut(FUND_PAGE_HTML, '<div>Market Price as of', '<div><a href="#">Cumulative'), 'GSLC').loadedFully).toBe(false);
    expect(parseProductPage(cut(FUND_PAGE_HTML, '<div>12 Month Trailing', '<table><tr><th>Ex-Date'), 'GSLC')).toMatchObject({ loadedFully: true, sections: { yields: false } });
  });

  test('missing values become null, never 0: young funds, absent sections, future-dated yields', () => {
    const lines = toTextLines(['- [**Annualized Returns (%)** as of Aug 31, 2026](https://am.gs.com/x#)', '| label | 1Yr | 3Yr | 5Yr | 10Yr |', '| NAV | 4.30 | -- | N/A | - |'].join('\n'));
    const returns = parseOfficialReturns(lines, 'GEMQ');
    expect(returns.monthEnd.nav).toEqual({ asOfDate: '2026-08-31', mo1: null, mo3: null, ytd: null, yr1: 4.3, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null });
    expect(returns.monthEnd.marketPrice).toBeNull();
    expect(returns.quarterEnd.nav).toBeNull();

    // real zeros and negatives survive, reordered headers map by label
    const zero = parseOfficialReturns(toTextLines(['- [**Annualized Returns (%)** as of Aug 31, 2026](https://am.gs.com/x#)', '| label | 10Yr | 3Yr | 1Yr |', '| NAV | 6.00 | -1.50 | 0.00 |'].join('\n')), 'X');
    expect(zero.monthEnd.nav).toEqual({ asOfDate: '2026-08-31', mo1: null, mo3: null, ytd: null, yr1: 0, cagr3y: -1.5, cagr5y: null, cagr10y: 6, siAnn: null });

    const empty = parseProductPage('<html><body>Access denied</body></html>', 'GBIL');
    expect(empty).toMatchObject({ nav: null, cusip: '', distributions: [], topHoldings: null });
    expect(empty.officialReturns.monthEnd.nav).toBeNull();

    const page = ['# Goldman Sachs Core Bond ETF', '', '12 Month Trailing Distribution Rateas of Dec 29, 2026', '', '4.17', '', 'Standardized 30-Day Subsidized Yieldsas of Dec 29, 2026', '', '100.00', '', 'Standardized 30-Day Unsubsidized Yieldsas of Dec 29, 2026', '', '99.00'].join('\n');
    expect(parseProductPage(page, 'GCOR', new Date('2026-09-20T00:00:00Z'))).toMatchObject({ distRate12M: null, secYieldSubsidized: null, secYieldUnsubsidized: null, yieldsAsOfDate: null });
    expect(parseProductPage(page, 'GCOR', new Date('2027-01-15T00:00:00Z'))).toMatchObject({ distRate12M: 4.17, secYieldSubsidized: 100, secYieldUnsubsidized: 99, yieldsAsOfDate: '2026-12-29' });
  });

  test('distribution frequency: inferred from payments, official labels, selection order', () => {
    const at = (iso: string) => ({ epoch: Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 1000, amount: 0.1 });
    const day = 86_400;
    const monthly = ['2025-08-01', '2025-09-02', '2025-10-01', '2025-11-03', '2025-12-01', '2025-12-19', '2026-02-02', '2026-03-02', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-03', '2026-09-01'];
    const inferred: Array<[Array<{ epoch: number; amount: number }>, string, number | null]> = [
      [monthly.map(at), 'Monthly', 12],
      [['2025-03-26', '2025-06-25', '2025-09-24', '2025-12-10', '2026-03-25', '2026-06-24'].map(at), 'Quarterly', 4],
      [['2024-06-20', '2024-12-18', '2025-06-24', '2025-12-17', '2026-06-23'].map(at), 'Semi-Annual', 2],
      [['2023-12-20', '2024-12-18', '2025-12-17'].map(at), 'Annual', 1],
      [[{ epoch: 0, amount: 1 }, { epoch: 900 * day, amount: 1 }], 'Irregular', null],
      [[{ epoch: 0, amount: 1 }], 'Unknown', null],
      [[], 'None', null],
    ];
    for (const [dividends, frequency, paymentsPerYear] of inferred) expect(inferDistributionFrequency(dividends)).toEqual({ frequency, paymentsPerYear });

    const labels: Array<[string, string]> = [['Monthly', '01 - Monthly'], ['Quarterly', '04 - Quarterly'], ['Semi-Annual', '06 - Semi-annually'], ['Annual', '12 - Annually'], ['Annually', '12 - Annually'], ['Irregular', '99 - Irregular'], ['None', '00 - None'], ['Unknown', '00 - Unknown'], ['—', '00 - None'], ['', '00 - None']];
    for (const [input, label] of labels) expect(frequencyCodeLabel(input)).toBe(label);
    const perYear: Array<[string, number | null]> = [['Monthly', 12], ['Quarterly', 4], ['Annually', 1], ['Annual', 1], ['None', null], ['—', null]];
    for (const [input, payments] of perYear) expect(paymentsPerYearForFrequency(input)).toBe(payments);
    expect(selectDistributionFrequency('Monthly', 'Quarterly', 12, 'Quarterly')).toBe('Monthly');
    expect(selectDistributionFrequency('', 'Monthly', 12, 'Quarterly')).toBe('Monthly');
    expect(selectDistributionFrequency('', 'Unknown', 1, 'Monthly')).toBe('Monthly');
    expect(selectDistributionFrequency('', 'None', 0, 'Annually')).toBe('Annually');
    expect(selectDistributionFrequency('—', 'Unknown', 1, null)).toBe('—');
  });

  test('Yahoo chart: null closes are dropped, dividends sorted, no result throws', () => {
    const chart = parseChart({
      chart: { result: [{
        meta: { exchangeName: 'PCX', regularMarketPrice: 145.5, regularMarketTime: 1_789_000_000, firstTradeDate: 1_442_000_000 },
        timestamp: [1_600_000_000, 1_600_086_400, 1_600_172_800],
        indicators: { quote: [{ close: [10, null, 12], volume: [100, 200, 300] }], adjclose: [{ adjclose: [9, null, 11.5] }] },
        events: { dividends: { '1600086400': { amount: 0.25, date: 1_600_086_400 } } },
      }] },
    });
    expect(chart.days.length).toBe(2);
    expect(chart.days[0]).toEqual({ date: '2020-09-13', close: 10, adjClose: 9, volume: 100 });
    expect(chart.dividends).toEqual([{ epoch: 1_600_086_400, amount: 0.25 }]);
    expect(chart.exchangeName).toBe('PCX');
    expect(() => parseChart({})).toThrow(/no result/);
  });

  test('SEC EDGAR N-PORT: ticker map, original filings only, holdings, series and freshness checks', () => {
    const map = parseFundTickerMap({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1479026, 'S000045678', 'C000123456', 'GSLC'], [1479026, 'S000045679', 'C000123457', 'GBIL']] });
    expect(map.get('GSLC')).toEqual({ cik: '0001479026', seriesId: 'S000045678', classId: 'C000123456' });
    const atom = `<feed><entry><content><accession-number>0001752724-26-000001</accession-number><filing-date>2026-08-27</filing-date><filing-type>NPORT-P</filing-type><filing-href>https://www.sec.gov/Archives/edgar/data/1479026/000175272426000001/0001752724-26-000001-index.htm</filing-href><period>2026-06-30</period></content></entry><entry><content><accession-number>0001752724-26-000002</accession-number><filing-type>NPORT-P/A</filing-type></content></entry></feed>`;
    const filings = parseEdgarAtomFilings(atom);
    expect(filings.length).toBe(1);
    expect(filings[0].url).toBe(nportUrlFor('0001479026', '0001752724-26-000001'));

    const xml = `<edgarSubmission><genInfo><seriesName>Goldman Sachs ActiveBeta U.S. Large Cap Equity ETF</seriesName><seriesId>S000045678</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>15182530000.00</netAssets></fundInfo>
<invstOrSecs><invstOrSec><name>NVIDIA CORP</name><cusip>67066G104</cusip><balance>9500000</balance><valUSD>1214772000.00</valUSD><pctVal>8.01</pctVal><assetCat>EC</assetCat></invstOrSec>
<invstOrSec><name>UNITED STATES TREASURY NOTE</name><cusip>91282CJL6</cusip><balance>1000000</balance><valUSD>990000</valUSD><pctVal>0.5</pctVal><assetCat>DBT</assetCat><debtSec><maturityDt>2028-01-31</maturityDt><annualizedRt>3.5</annualizedRt></debtSec></invstOrSec></invstOrSecs></edgarSubmission>`;
    const parsed = parseNport(xml);
    expect(parsed).toMatchObject({ seriesId: 'S000045678', repPdDate: '2026-06-30', netAssets: 15_182_530_000 });
    expect(parsed.holdings[0]).toEqual({ Name: 'NVIDIA CORP', Ticker: '-', Identifier: '67066G104', Weight: '8.01', 'Market Value': '1214772000', 'Shares Held': '9500000', 'Asset Category': 'EC' });
    expect(parsed.holdings[1]).toMatchObject({ Coupon: '3.5', Maturity: '2028-01-31' });
    expect(normalizeHoldingName('Merck & Co., Inc.')).toBe('MERCK AND');
    expect(cleanHoldingTicker(' n/a ')).toBe('');

    expect(checkNportFiling('S000001', 'S000001', '2026-06-30', '2026-03-31', 'SEC EDGAR Form N-PORT-P').ok).toBe(true);
    expect(checkNportFiling('s000001', 'S000001', '2026-06-30', undefined, undefined).ok).toBe(true);
    expect(checkNportFiling('S000002', 'S000001', '2026-06-30', '', '').ok).toBe(false);
    expect(checkNportFiling('', 'S000001', '2026-06-30', '', '').ok).toBe(false);
    expect(checkNportFiling('S000001', 'S000001', '2026-03-31', '2026-06-30', 'SEC EDGAR Form N-PORT-P').reason).toContain('older than the published holdings');
    // a legacy published top-10 snapshot is not "fresher" than a real filing
    expect(checkNportFiling('S000001', 'S000001', '2026-06-30', '2026-09-17', 'offline seed snapshot: official top-10 holdings').ok).toBe(true);
  });

  test('the 48-ETF universe seed is complete and consistent', () => {
    const tickers = GOLDMAN_SACHS_FUNDS.map((fund) => fund.ticker);
    expect(tickers.length).toBe(48);
    expect(new Set(tickers).size).toBe(48);
    const count = (category: string) => GOLDMAN_SACHS_FUNDS.filter((fund) => fund.category === category).length;
    expect([count('EQUITY'), count('FIXED INCOME'), count('COMMODITIES')]).toEqual([31, 16, 1]);
    for (const fund of GOLDMAN_SACHS_FUNDS) {
      expect(/\/funds\/detail\/(PV\d+)\/([A-Za-z0-9]{9})\//.exec(fund.fundPage)?.[2]).toBe(fund.cusip);
      expect(monthDateToIso(fund.inceptionDate)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    const seeds = seedCatalogFunds();
    expect(seeds.length).toBe(48);
    expect(seeds.every((fund) => fund.source === 'seed')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// metrics: null for unknown horizons, one key set, one basis
// ---------------------------------------------------------------------------

describe('metrics', () => {
  const day = (date: string, close: number) => ({ date, close, adjClose: close, volume: 0 });

  test('horizons the fund is too young for are null, never 0', () => {
    const returns = priceReturns([day('2025-09-10', 100), day('2025-12-31', 110), day('2026-06-30', 115), day('2026-09-17', 121)]);
    expect(returns).toMatchObject({ asOfDate: '2026-09-17', ytd: 10, qtd: 5.22, yr1: 21, cagr3y: null, cagr5y: null, cagr10y: null });
    expect(priceReturns([day('2026-05-19', 40), day('2026-09-18', 44)]).siAnn).toBeNull();
    expect(priceReturns([day('2025-09-17', 40), day('2026-09-18', 44)]).siAnn).not.toBeNull();
    expect(priceReturns([]).yr1).toBeNull();
  });

  test('official figures never mix with market-price estimates (one basis per row)', () => {
    const derived = { asOfDate: '2026-09-18', mo1: 1, qtd: 2, ytd: 3, yr1: 4, cagr3y: 5, cagr5y: 6, cagr10y: 7, siAnn: 8 };
    const merged = mergeOfficialReturns(derived, { asOfDate: '2026-08-31', mo1: 0.31, mo3: 0.89, ytd: 2.3, yr1: 3.7, cagr3y: 4.52, cagr5y: null, cagr10y: null, siAnn: 2.31 });
    expect(merged).toEqual({ asOfDate: '2026-08-31', mo1: 0.31, qtd: 2, ytd: 2.3, yr1: 3.7, cagr3y: 4.52, cagr5y: null, cagr10y: null, siAnn: 2.31 });
    expect(mergeOfficialReturns(derived, null)).toBe(derived);
  });

  test('returnsBasis and performanceAsOf travel together as the last two keys', () => {
    const fund = { dividendYield: 3.67, secYield: null } as Parameters<typeof deriveMetrics>[1];
    const derived = priceReturns([day('2025-09-10', 100), day('2026-09-17', 121)]);
    const yahoo = deriveMetrics(derived, fund, [], { paymentsPerYear: null }, 100, false);
    expect(yahoo).toMatchObject({ returnsBasis: DERIVED_RETURNS_BASIS, performanceAsOf: '2026-09-17' });
    const official = deriveMetrics(mergeOfficialReturns(derived, { asOfDate: '2026-08-31', mo1: null, mo3: null, ytd: 2.3, yr1: 3.7, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null }), fund, [], { paymentsPerYear: null }, 100, true);
    expect(official).toMatchObject({ returnsBasis: OFFICIAL_RETURNS_BASIS, performanceAsOf: '2026-08-31' });
    expect(Object.keys(official).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
    const unknown = deriveMetrics(priceReturns([]), fund, [], { paymentsPerYear: null }, null, false);
    expect(unknown.performanceAsOf).toBeNull();
    expect(unknown.returnsBasis).toBeTruthy();
    for (const [input, expected] of [['', null], ['—', null], ['Aug 31 2026', '2026-08-31'], ['2026-8-5', '2026-08-05']] as const) expect(performanceAsOf(input)).toBe(expected);
  });

  test('every index row has the same metrics key set; official returns and TER net/gross are mapped', async () => {
    const world = mockWorld();
    await run({ TICKERS: 'GSLC' });
    const index = readJson(world, 'index.json');
    expect(index.funds.length).toBeGreaterThan(40);
    const keys = ['ytd', 'tr1y', 'tr3y', 'tr5y', 'tr10y', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn', 'dividendYield', 'dividendYieldText', 'dividendYieldBasis', 'secYield', 'secYieldText', 'returnsBasis', 'performanceAsOf'];
    for (const row of index.funds) {
      expect(Object.keys(row.metrics).slice(0, keys.length)).toEqual(keys);
      expect(row.metrics.returnsBasis.length).toBeGreaterThan(5);
    }
    const gslc = rowFor(index, 'GSLC');
    expect(gslc.metrics).toMatchObject({ ytd: 11.11, tr1y: 16.62, cagr3y: 19.58, cagr5y: 11.38, cagr10y: 14.48, returnsBasis: OFFICIAL_RETURNS_BASIS, performanceAsOf: '2026-08-31' });
    expect(gslc).toMatchObject({ terValue: 0.09, terGrossValue: 0.09 });
    expect(rowFor(index, 'AAAU').metrics).toMatchObject({ ytd: null, tr10y: null, dividendYield: null, secYield: null, returnsBasis: NO_DATA_BASIS, performanceAsOf: null });
    expect(withMetricsContract({ metrics: { 'null': null, ytd: 0 } }).metrics).not.toHaveProperty('null');
  });

  test('dividendYieldBasis names the source of each yield and is null exactly when the yield is null', async () => {
    const effective = priceReturns([day('2025-09-10', 100), day('2026-09-17', 121)]);
    const monthly = [{ epoch: Date.UTC(2026, 7, 1) / 1000, amount: 0.3 }];
    const derive = (dividendYield: number | null, dividends = monthly) => deriveMetrics(effective, { dividendYield, secYield: null } as Parameters<typeof deriveMetrics>[1], dividends, { paymentsPerYear: 12 }, 100, true);
    // fund-page 12 Month Trailing Distribution Rate (fresh, retained or carried)
    expect(derive(0.92)).toMatchObject({ dividendYield: 0.92, dividendYieldBasis: 'official-trailing-12m' });
    expect(derive(0)).toMatchObject({ dividendYield: 0, dividendYieldBasis: 'official-trailing-12m' });
    // updater estimate: latest distribution x payments per year / price
    expect(derive(null)).toMatchObject({ dividendYield: 3.6, dividendYieldBasis: 'indicated' });
    expect(derive(null, [])).toMatchObject({ dividendYield: null, dividendYieldBasis: null });
    // published meta.json texts map exhaustively; an unknown text is never claimed as official
    expect(yieldBasisFromKind('12 Month Trailing Distribution Rate published on the official fund page as of Aug 31 2026', 1)).toBe('official-trailing-12m');
    expect(yieldBasisFromKind('carried from the previous run (official fund page)', 1)).toBe('official-trailing-12m');
    expect(yieldBasisFromKind('indicated (latest distribution x inferred payments per year / NAV)', 1)).toBe('indicated');
    expect(yieldBasisFromKind('something new', 1)).toBe('indicated');
    expect(yieldBasisFromKind('12 Month Trailing Distribution Rate', null)).toBeNull();
    expect(yieldBasisFromYields({ dividendYield: 2, dividendYieldBasis: 'official-other', dividendYieldKind: 'x' })).toBe('official-other');
    expect(yieldBasisFromYields({ dividendYield: null, dividendYieldBasis: 'indicated' })).toBeNull();
    // the contract never lets a code outlive its yield or a yield go without one
    expect(withMetricsContract({ metrics: { dividendYield: null, dividendYieldBasis: 'indicated' } }).metrics.dividendYieldBasis).toBeNull();
    expect(withMetricsContract({ metrics: { dividendYield: 1, dividendYieldBasis: 'bogus' } }).metrics.dividendYieldBasis).toBe('indicated');
  });

  test('fresh, rebuilt and placeholder rows carry the same metrics keys, and the code follows the yield', async () => {
    const world = mockWorld();
    await run({ TICKERS: 'GSLC' });
    const index = readJson(world, 'index.json');
    const fresh = rowFor(index, 'GSLC').metrics;
    expect(fresh).toMatchObject({ dividendYield: 0.92, dividendYieldBasis: 'official-trailing-12m' });
    expect(readJson(world, 'funds/GSLC/meta.json').yields).toMatchObject({ dividendYield: 0.92, dividendYieldBasis: 'official-trailing-12m' });
    const meta = readJson(world, 'funds/GSLC/meta.json');
    const rebuilt = indexRowFromMeta(meta)!.metrics;
    const placeholder = placeholderRow({ ticker: 'X', name: 'X', category: 'ETF', fundPage: '', cusip: '', isin: '' }).metrics;
    expect(Object.keys(rebuilt).sort()).toEqual(Object.keys(fresh).sort());
    expect(Object.keys(placeholder).sort()).toEqual(Object.keys(fresh).sort());
    expect(rebuilt.dividendYieldBasis).toBe('official-trailing-12m');
    expect(placeholder).toMatchObject({ dividendYield: null, dividendYieldBasis: null });
    // a row published before the key existed: the code is taken from its meta.json
    delete meta.yields.dividendYieldBasis;
    expect(indexRowFromMeta(meta)!.metrics.dividendYieldBasis).toBe('official-trailing-12m');
    for (const row of index.funds) expect(row.metrics.dividendYieldBasis === null).toBe(row.metrics.dividendYield === null);
  });
});

// ---------------------------------------------------------------------------
// pipeline: whole runs against a mocked network in a throwaway output dir
// ---------------------------------------------------------------------------

describe('pipeline', () => {
  const metaFor = (ticker: string) => ({
    ticker, name: `${ticker} ETF`, category: 'Fixed Income', source: { fundPage: `https://am.gs.com/${ticker}` },
    identifiers: { cusip: '123456789', isin: 'US1234567890', exchange: 'NYSE Arca' },
    expenseRatio: { display: '0.12%', value: 0.12 }, nav: { display: '$100.00', value: 100, asOfDate: 'Sep 30 2026' },
    marketPrice: { display: '$100.01', value: 100.01 }, premiumDiscount: { display: '0.01%', value: 0.01 }, aum: { display: '$1.00 B', value: 1e9 },
    yields: { dividendYield: 3.5, dividendYieldText: '3.50%', secYield: null, secYieldText: '—' },
    returns: { derivedFrom: 'official test basis', monthEnd: { asOfDate: 'Aug 31 2026', ytd: 2.3, yr3: 4.5, yr5: null, yr10: null, sinceInception: 2.1 } },
    distributions: { frequency: 'Monthly', frequencyCode: '01 - Monthly' }, holdings: { totalRows: 10 }, history: { totalRows: 20 },
  });

  test('index rows rebuild from meta.json with the metrics contract, merging only adds or refreshes', () => {
    const row = indexRowFromMeta(metaFor('GBIL'))!;
    expect(row).toMatchObject({ ticker: 'GBIL', dataFile: './funds/GBIL/meta.json', metrics: { ytd: 2.3, cagr3y: 4.5, cagr5y: null, tr1y: null, returnsBasis: 'official test basis', performanceAsOf: '2026-08-31' } });
    expect(indexRowFromMeta({ name: 'no ticker' })).toBeNull();
    const known = new Map<string, Record<string, any>>([['AAAU', { ticker: 'AAAU', nav: 'old' }], ['GBIL', { ticker: 'GBIL', nav: 'old' }]]);
    const merged = mergePublishedRows(known, [{ ticker: 'GBIL', nav: 'new' }, { ticker: 'GBND', nav: 'new' }]);
    expect(merged.map((r) => `${r.ticker}:${r.nav}`)).toEqual(['AAAU:old', 'GBIL:new', 'GBND:new']);
    expect(mergePublishedRows(known, []).length).toBe(2);
  });

  // Runs the real updater in a child process against a throwaway copy of the repo (its API_ROOT is relative to the script),
  // with fetch preloaded to a dead network and sleeps shortened, so no real data is touched and no request leaves the machine.
  async function runUpdater(env: Record<string, string>): Promise<{ before: string[]; after: string[] }> {
    const root = mkdtempSync(join(tmpdir(), 'gs-no-shrink-'));
    try {
      mkdirSync(join(root, 'scripts'), { recursive: true });
      for (const file of ['update-data.ts', 'update-data.config.json']) cpSync(new URL(file, import.meta.url), join(root, 'scripts', file));
      const api = join(root, 'api', 'goldmansachs');
      const indexed = ['AAAU', 'GBIL', 'GSLC', 'ZZIDX'];
      for (const ticker of [...indexed, 'ZZMETA']) {
        mkdirSync(join(api, 'funds', ticker), { recursive: true });
        writeFileSync(join(api, 'funds', ticker, 'meta.json'), JSON.stringify(metaFor(ticker)));
      }
      const rows = indexed.map((ticker) => indexRowFromMeta(metaFor(ticker)));
      writeFileSync(join(api, 'index.json'), JSON.stringify({ generatedAt: '2026-01-01T00:00:00Z', counts: { funds: rows.length }, funds: rows }));
      writeFileSync(join(root, 'dead-fetch.ts'), [
        "globalThis.fetch = (async () => { throw new TypeError('network down'); }) as typeof fetch;",
        'const realSetTimeout = globalThis.setTimeout; // proxy pacing and backoff sleeps only delay the offline run',
        'globalThis.setTimeout = ((fn: () => void, _ms?: number, ...args: unknown[]) => realSetTimeout(fn, 0, ...args)) as unknown as typeof setTimeout;',
        '',
      ].join('\n'));
      const read = () => JSON.parse(readFileSync(join(api, 'index.json'), 'utf8')).funds.map((row: { ticker: string }) => row.ticker) as string[];
      const before = read();
      const child = Bun.spawn([process.execPath, '--preload', join(root, 'dead-fetch.ts'), join(root, 'scripts', 'update-data.ts')], {
        cwd: root, stdout: 'ignore', stderr: 'ignore',
        env: { PATH: process.env.PATH ?? '', REQUEST_SLEEP: '0', MAX_RETRIES: '1', USE_SYSTEM_CA: 'false', ...env },
      });
      await child.exited;
      return { before, after: read() };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test('filtered, bounded and dead-network runs never shrink the feed (rows known only from meta.json stay)', async () => {
    const all = ['AAAU', 'GBIL', 'GSLC', 'ZZIDX', 'ZZMETA'];
    for (const env of <Record<string, string>[]>[{ TICKERS: 'GBIL' }, { MAX_FETCHES: '1' }, { SKIP_YAHOO: 'true', EDGAR_FALLBACK: 'false' }]) {
      const { before, after } = await runUpdater(env);
      expect(before).toEqual(['AAAU', 'GBIL', 'GSLC', 'ZZIDX']);
      expect(after).toEqual(expect.arrayContaining(all));
    }
    // an unknown ticker is an error before anything is written
    expect((await runUpdater({ TICKERS: 'NOSUCH' })).after).toEqual(['AAAU', 'GBIL', 'GSLC', 'ZZIDX']);
  }, 120_000);

  test('a one-ticker run keeps every row and file of the other funds', async () => {
    const world = mockWorld();
    await run({ TICKERS: THREE });
    const rows = readJson(world, 'index.json').funds.length;
    const others = snapshot(join(world.api, 'funds', 'AAAU'));
    await run({ TICKERS: 'GBIL', HISTORY_PAGE_SIZE: '500' });
    expect(readJson(world, 'index.json').funds.length).toBe(rows);
    expect(snapshot(join(world.api, 'funds', 'AAAU'))).toEqual(others);
    expect(readdirSync(join(world.api, 'funds')).sort()).toEqual(['AAAU', 'GBIL', 'GSLC']);
  });

  test('a second identical run writes nothing, not even generatedAt', async () => {
    const world = mockWorld();
    await run({ TICKERS: THREE });
    const first = snapshot(world.api);
    expect(Object.keys(first).length).toBeGreaterThanOrEqual(7); // index + meta and history page for each of the three funds
    expect(readJson(world, 'funds/GBIL/history/001.json').rows[0].Date).toMatch(/^[A-Z][a-z]{2} \d{2} \d{4}$/);
    await new Promise((resolve) => setTimeout(resolve, 1100)); // a stamp that moved would differ
    await run({ TICKERS: THREE });
    expect(snapshot(world.api)).toEqual(first);
  }, 30_000);

  test('a failed source keeps the fund exactly as published; other funds still update; all failed -> exit 1', async () => {
    let outage = false;
    const world = mockWorld({
      handler: (url) => {
        if (!outage) return undefined;
        if (url.includes('yahoo') && url.includes('GSLC')) return new Response('down', { status: 503 });
        if (url.includes('/detail/')) return new Response(FUND_PAGE_HTML.replace('145.45USD', '150.00USD'));
        return undefined;
      },
    });
    await run({ TICKERS: THREE });
    const gslc = snapshot(join(world.api, 'funds', 'GSLC'));
    const gbil = snapshot(join(world.api, 'funds', 'GBIL'));
    outage = true;
    await run({ TICKERS: 'GSLC,GBIL' });
    expect(snapshot(join(world.api, 'funds', 'GSLC'))).toEqual(gslc);
    expect(snapshot(join(world.api, 'funds', 'GBIL'))).not.toEqual(gbil); // GBIL still updated
    expect(process.exitCode ?? 0).toBe(0);
    await run({ TICKERS: 'GSLC' });
    expect(snapshot(join(world.api, 'funds', 'GSLC'))).toEqual(gslc);
    expect(process.exitCode).toBe(1);
  }, 30_000);

  test('a partial fund page keeps the published official sections byte for byte; a full page lacking a field is an honest null', async () => {
    const cut = (html: string, from: string, to: string) => html.slice(0, html.indexOf(from)) + html.slice(html.indexOf(to));
    let page = FUND_PAGE_HTML;
    const world = mockWorld({ handler: (url) => (url.includes('/detail/') ? new Response(page) : undefined) });
    await run({ TICKERS: THREE });
    const published = snapshot(world.api);
    const meta = readJson(world, 'funds/GSLC/meta.json');
    expect(meta).toMatchObject({ marketPrice: { value: 145.41, source: 'official fund page Pricing Table' }, yields: { distributionRate: 0.92, secYield: 0.97 }, returns: { derivedFrom: OFFICIAL_RETURNS_BASIS } });

    // run 2: the pricing, yields, returns and distributions sections are missing (proxy rendering came back partial)
    page = cut(FUND_PAGE_HTML, '<h2>Performance</h2>', '<div>Top 10 Holdings');
    const log: string[] = [];
    await run({ TICKERS: THREE }, { log });
    expect(snapshot(world.api)).toEqual(published); // meta.json, history, index.json: zero diff
    expect(log.filter((line) => line.startsWith('[ kept'))).toHaveLength(3); // one notice per fund
    expect(log.find((line) => line.includes('GSLC') && line.startsWith('[ kept'))).toContain('pricing table, yields, month-end returns, distributions');
    expect(rowFor(readJson(world, 'index.json'), 'GSLC').metrics).toMatchObject({ dividendYield: 0.92, dividendYieldBasis: 'official-trailing-12m', secYield: 0.97, returnsBasis: OFFICIAL_RETURNS_BASIS, performanceAsOf: '2026-08-31' });

    // run 3: a page that loaded fully but really has no SEC yield and no bid/ask: honest nulls, everything else fresh
    log.length = 0;
    page = cut(cut(FUND_PAGE_HTML.replace('145.41USD', '146.00USD'), '<div>Standardized 30-Day Subsidized', '<table><tr><th>Ex-Date'), '<div>Bid/Ask', '<div><a href="#">Cumulative');
    await run({ TICKERS: THREE }, { log });
    const fresh = readJson(world, 'funds/GSLC/meta.json');
    expect(fresh.marketPrice.value).toBe(146);
    expect(fresh.fundFacts.bidAskMidpoint).toBeNull();
    expect(fresh.yields).toMatchObject({ distributionRate: 0.92, secYield: null, secYieldText: '—' });
    expect(fresh.yields.secYieldKind).toContain('not published');
    expect(log.filter((line) => line.startsWith('[ kept'))).toHaveLength(0);
  }, 30_000);

  test('a Yahoo 404 is an honest empty history, not a failed fund', async () => {
    const world = mockWorld({ handler: (url) => (url.includes('yahoo') ? new Response('{"chart":{"result":null}}', { status: 404 }) : undefined) });
    await run({ TICKERS: 'GBIL' });
    expect(readJson(world, 'funds/GBIL/meta.json').history.totalRows).toBe(0);
    expect(process.exitCode ?? 0).toBe(0);
  });

  test('rows without published data are placeholders: dataFile null', async () => {
    const world = mockWorld();
    await run({ TICKERS: 'GBIL' });
    for (const row of readJson(world, 'index.json').funds) expect(row.dataFile).toBe(row.ticker === 'GBIL' ? './funds/GBIL/meta.json' : null);
    expect(placeholderRow({ ticker: 'X', name: 'X', category: 'ETF', fundPage: '', cusip: '', isin: '' }).dataFile).toBeNull();
  });

  test('an unknown ticker is an error and a filtered-out fund leaves no files', async () => {
    const world = mockWorld();
    await expect(run({ TICKERS: 'GSLC,NOSUCH' })).rejects.toThrow('NOSUCH');
    expect(existsSync(join(world.api, 'index.json'))).toBe(false);
    await run({ TICKERS: 'GBIL,GSLC', AUM: '1T:' });
    expect(existsSync(join(world.api, 'funds'))).toBe(false);
  });

  test('MAX_FETCHES walks the filtered set with a cursor and wraps; a TICKERS run never touches it', async () => {
    const world = mockWorld();
    const state = () => readJson(world, 'update-state.json').cursor;
    await run({ SKIP_YAHOO: 'true', MAX_FETCHES: '2' });
    expect(readdirSync(join(world.api, 'funds')).sort()).toEqual(['AAAU', 'GBIL']);
    expect(state()).toBe('GBIL');
    await run({ SKIP_YAHOO: 'true', MAX_FETCHES: '2' });
    expect(readdirSync(join(world.api, 'funds')).sort()).toEqual(['AAAU', 'GBIL', 'GBND', 'GCAL']);
    expect(state()).toBe('GCAL');
    const bytes = readFileSync(join(world.api, 'update-state.json'), 'utf8');
    await run({ SKIP_YAHOO: 'true', TICKERS: 'GSLC' });
    expect(readFileSync(join(world.api, 'update-state.json'), 'utf8')).toBe(bytes);
    writeFileSync(join(world.api, 'update-state.json'), JSON.stringify({ cursor: 'JUST' }));
    await run({ SKIP_YAHOO: 'true', MAX_FETCHES: '1' });
    expect(state()).toBe('AAAU');
    const tickers = (funds: Array<{ ticker: string }>) => funds.map((fund) => fund.ticker);
    expect(tickers(rotateAfterCursor([{ ticker: 'A' }, { ticker: 'C' }, { ticker: 'E' }], 'B'))).toEqual(['C', 'E', 'A']);
    expect(tickers(rotateAfterCursor([{ ticker: 'A' }, { ticker: 'C' }], 'C'))).toEqual(['A', 'C']);
  }, 60_000);

  test('the soft deadline takes no new fund but still writes the index', async () => {
    const world = mockWorld();
    await run({ SKIP_YAHOO: 'true' }, { deadlineMs: -1 });
    expect(readJson(world, 'index.json').funds.length).toBeGreaterThan(40);
    expect(existsSync(join(world.api, 'funds'))).toBe(false);
    expect(process.exitCode ?? 0).toBe(0);
  });

  test('new catalog funds are announced in the step summary', async () => {
    const world = mockWorld();
    await run({ TICKERS: 'GBIL' });
    const index = readJson(world, 'index.json');
    index.funds = index.funds.filter((row: { ticker: string }) => !['AAAU', 'JUST'].includes(row.ticker));
    writeFileSync(join(world.api, 'index.json'), JSON.stringify(index));
    rmSync(join(world.api, 'funds', 'AAAU'), { recursive: true, force: true });
    const summary = join(world.dir, 'summary.md');
    await run({ TICKERS: 'GBIL', GITHUB_STEP_SUMMARY: summary });
    expect(readFileSync(summary, 'utf8')).toContain('NEW FUNDS: AAAU, JUST');
  });

  test('stale history pages are removed after the new meta.json is written, no temp files are left', async () => {
    const world = mockWorld();
    await run({ TICKERS: 'GBIL', HISTORY_PAGE_SIZE: '100' });
    expect(readdirSync(join(world.api, 'funds', 'GBIL', 'history')).length).toBe(4);
    await run({ TICKERS: 'GBIL', HISTORY_PAGE_SIZE: '1000' });
    expect(readdirSync(join(world.api, 'funds', 'GBIL', 'history'))).toEqual(['001.json']);
    expect(readJson(world, 'funds/GBIL/meta.json').history.pages).toEqual(['history/001.json']);
    for (const name of Object.keys(snapshot(world.api))) expect(name).not.toContain('.tmp-');
  });
});

// ---------------------------------------------------------------------------
// network: concurrency, pacing, timeouts, retries, request URLs
// ---------------------------------------------------------------------------

describe('network', () => {
  test('in-flight requests peak at 1 with CONCURRENCY=1 and at N with CONCURRENCY=N', async () => {
    const wide = mockWorld({ latency: 60 });
    await run({ TICKERS: THREE, CONCURRENCY: '3', SKIP_YAHOO: 'true' });
    expect(wide.peak).toBe(3);
    const narrow = mockWorld({ latency: 20 });
    await run({ TICKERS: THREE, CONCURRENCY: '1', SKIP_YAHOO: 'true' });
    expect(narrow.peak).toBe(1);
  }, 30_000);

  test('pacing: lanes are independent, one lane spaces its own requests, the proxy keeps one global gate', async () => {
    resetPacing(0.25);
    const started = Date.now();
    const lane0 = runOnLane(0, async () => { await paceRequests(); await paceRequests(); return Date.now() - started; });
    const lane1 = runOnLane(1, async () => { await paceRequests(); return Date.now() - started; });
    const [second, otherFirst] = await Promise.all([lane0, lane1]);
    expect(second).toBeGreaterThanOrEqual(230); // the lane's second request waits out REQUEST_SLEEP
    expect(otherFirst).toBeLessThan(second); // another lane's first request does not queue behind it

    // two requests made in the same tick on one lane claim two different slots
    resetPacing(0.2);
    const t = Date.now();
    const times = await runOnLane(2, () => Promise.all([paceRequests().then(() => Date.now() - t), paceRequests().then(() => Date.now() - t)]));
    expect(Math.abs(times[1] - times[0])).toBeGreaterThanOrEqual(180);

    // r.jina.ai traffic is spaced >= 3.2 s apart across all lanes
    resetPacing(0);
    const t2 = Date.now();
    const proxied = await Promise.all([runOnLane(0, () => paceRequests(true).then(() => Date.now() - t2)), runOnLane(1, () => paceRequests(true).then(() => Date.now() - t2))]);
    expect(Math.abs(proxied[1] - proxied[0])).toBeGreaterThanOrEqual(3150);
  }, 20_000);

  test('a page the issuer denies directly costs at most one proxy request plus one retry, and the denial latch holds', async () => {
    setFetchTuningForTests(45_000, 5);
    const world = mockWorld({
      handler: (url) => {
        if (url.startsWith('https://r.jina.ai/')) return new Response('down', { status: 503 });
        if (url.includes('/detail/')) return new Response('Access Denied', { status: 403 });
        return undefined;
      },
    });
    await run({ TICKERS: 'GBIL', MAX_RETRIES: '5', SKIP_YAHOO: 'true' });
    expect(world.hits.filter((hit) => hit.url.startsWith('https://r.jina.ai/') && hit.url.includes('/detail/')).length).toBeLessThanOrEqual(2);
    expect(process.exitCode).toBe(1); // the only selected fund failed

    resetIssuerDirectState();
    expect(recordIssuerDirectResult(true)).toBe(false);
    expect(recordIssuerDirectResult(true)).toBe(true);
    expect(recordIssuerDirectResult(false)).toBe(true); // a late success cannot re-enable direct requests
    resetIssuerDirectState();
    recordIssuerDirectResult(true);
    expect(recordIssuerDirectResult(false)).toBe(false); // a success before the limit resets the count
    expect(recordIssuerDirectResult(true)).toBe(false);
  }, 20_000);

  test('every request has a timeout that also covers the body, and retries are bounded by MAX_RETRIES', async () => {
    setFetchTuningForTests(60, 1);
    let calls = 0;
    const config = readConfig({ MAX_RETRIES: '2', REQUEST_SLEEP: '0' });
    resetPacing(0);
    const never = (signal: AbortSignal) => new Promise<never>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
    // headers never arrive
    globalThis.fetch = ((_url: unknown, init: { signal: AbortSignal }) => { calls += 1; return never(init.signal); }) as unknown as typeof fetch;
    await expect(fetchText('https://example.test/a', 'hang', config)).rejects.toThrow(/no complete response within/);
    expect(calls).toBe(3);
    // headers arrive, the body stalls
    calls = 0;
    globalThis.fetch = ((_url: unknown, init: { signal: AbortSignal }) => { calls += 1; return Promise.resolve({ ok: true, status: 200, text: () => never(init.signal) }); }) as unknown as typeof fetch;
    await expect(fetchText('https://example.test/b', 'stall', config)).rejects.toThrow(/no complete response within/);
    expect(calls).toBe(3);
    // 404 is final, 403 is retried (the issuer CDN answers it while throttling)
    calls = 0;
    globalThis.fetch = (async () => { calls += 1; return new Response('x', { status: 404 }); }) as unknown as typeof fetch;
    await expect(fetchText('https://example.test/c', 'gone', config)).rejects.toThrow(/404/);
    expect(calls).toBe(1);
    calls = 0;
    globalThis.fetch = (async () => { calls += 1; return calls < 3 ? new Response('x', { status: 403 }) : new Response('ok'); }) as unknown as typeof fetch;
    expect(await fetchText('https://example.test/d', 'flaky', config)).toBe('ok');
    expect(calls).toBe(3);
  });

  test('HISTORY_RANGE is max or Ny and the Yahoo request carries an explicit period1/period2 (no range)', async () => {
    for (const bad of ['1mo', 'ytd', '5d', '0y', 'forever', '5Y5', '-1y']) expect(() => parseHistoryRange(bad)).toThrow('HISTORY_RANGE');
    expect(parseHistoryRange('5Y')).toBe('5y');
    expect(parseHistoryRange('')).toBe('max');
    const now = Date.UTC(2026, 8, 17, 12);
    const five = yahooChartQuery('5y', now);
    expect(five.get('period1')).toBe(String(Date.UTC(2021, 8, 17) / 1000));
    expect(five.get('period2')).toBe(String(now / 1000 + 86_400));
    expect(five.has('range')).toBe(false);
    expect(yahooChartQuery('max', now).get('period1')).toBe('0');

    const world = mockWorld();
    await run({ TICKERS: 'GSLC', HISTORY_RANGE: '5y' });
    const url = new URL(world.hits.find((hit) => hit.url.includes('yahoo'))!.url);
    expect(url.searchParams.has('range')).toBe(false);
    expect(url.searchParams.has('period2')).toBe(true);
    const fiveYearsAgo = Date.now() / 1000 - 5 * 365.25 * 86_400;
    expect(Math.abs(Number(url.searchParams.get('period1')) - fiveYearsAgo)).toBeLessThan(3 * 86_400);
  });
});
