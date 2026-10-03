// Bun's test runner provides these globals at runtime.
// @ts-ignore the repository intentionally keeps runtime dependencies at zero.
import { afterEach, describe, expect, test } from 'bun:test';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CONTROL_NAMES,
  NO_DATA_BASIS,
  SOFT_DEADLINE_MS,
  checkNportFiling,
  fetchText,
  main,
  paceRequests,
  parseHistoryRange,
  placeholderRow,
  postFetchFilterReasons,
  recordIssuerDirectResult,
  resetIssuerDirectState,
  resetPacing,
  rotateAfterCursor,
  runOnLane,
  setApiRootForTests,
  setFetchTuningForTests,
  withMetricsContract,
  yahooChartQuery,
  DERIVED_RETURNS_BASIS,
  OFFICIAL_RETURNS_BASIS,
  deriveMetrics,
  performanceAsOf,
  indexRowFromMeta,
  installSystemCa,
  mergePublishedRows,
  isCertError,
  readConfig,
  resolveControls,
  runtimeControls,
  annualizedToTotal,
  aumToUsd,
  cleanHoldingTicker,
  firstDate,
  firstNumber,
  frequencyCodeLabel,
  htmlToText,
  inferDistributionFrequency,
  isinFromCusip,
  lookupLabel,
  mergeOfficialReturns,
  monthDateToIso,
  normalizeHoldingName,
  normalizeMarkdownLinks,
  nportUrlFor,
  numberOrNull,
  parseAumRange,
  parseCatalogText,
  parseChart,
  parseCsv,
  parseEdgarAtomFilings,
  parseFundName,
  parseFundTickerMap,
  parseGsDistributions,
  parseGsTopHoldings,
  parseNport,
  parseOfficialReturns,
  parseProductPage,
  parseRange,
  paymentsPerYearForFrequency,
  priceReturns,
  proxyUrl,
  seedCatalogFunds,
  selectDistributionFrequency,
  stripProxyPreamble,
  toIsoDate,
  toTextLines,
  parseRanges,
} from './update-data';
import { GOLDMAN_SACHS_FUNDS } from '../data/goldmansachs-funds';
import {
  DISTRIBUTION_SNAPSHOTS,
  FINDER_SNAPSHOTS,
  FUND_PAGE_SNAPSHOTS,
  TOP_HOLDINGS_SNAPSHOTS,
} from '../data/goldmansachs-verified';

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

// ---------------------------------------------------------------------------

describe('range parsers', () => {
  test('parseRange keeps inclusive numeric bounds', () => {
    expect(parseRange('', 'X')).toBeUndefined();
    expect(parseRange(':', 'X')).toBeUndefined();
    expect(parseRange('0.1%:0.5%', 'X')).toEqual({ min: 0.1, max: 0.5 });
    expect(parseRange('2:', 'X')).toEqual({ min: 2, max: undefined });
    expect(() => parseRange('5:1', 'X')).toThrow(/must not exceed/);
    expect(() => parseRange('5', 'X')).toThrow(/colon is required/);
  });

  test('parseAumRange supports dollar suffixes and sibling presets', () => {
    expect(parseAumRange('10M:2B')).toEqual({ min: 10_000_000, max: 2_000_000_000 });
    expect(parseAumRange('large')).toEqual({ min: 10_000_000_000, max: undefined });
    expect(parseAumRange('micro')).toEqual({ min: 10_000_000, max: 300_000_000 });
    expect(() => parseAumRange('42')).toThrow(/colon is required/);
  });
});

describe('scalar helpers', () => {
  test('numberOrNull handles signs, placeholders, currency and parentheses', () => {
    expect(numberOrNull('+0.25')).toBe(0.25);
    expect(numberOrNull('-0.01%')).toBe(-0.01);
    expect(numberOrNull('$15,193,857,213.48')).toBe(15_193_857_213.48);
    expect(numberOrNull('(1.5)')).toBe(-1.5);
    expect(numberOrNull('--')).toBeNull();
    expect(numberOrNull('N/A')).toBeNull();
    expect(numberOrNull('—')).toBeNull();
    expect(numberOrNull('')).toBeNull();
  });

  test('toIsoDate accepts ISO, US, two-digit-year US and month-name dates', () => {
    expect(toIsoDate('2026-09-17')).toBe('2026-09-17');
    expect(toIsoDate('08/05/2010')).toBe('2010-08-05');
    expect(toIsoDate('10/10/19')).toBe('2019-10-10');
    expect(toIsoDate('Sep 17, 2015')).toBe('2015-09-17');
    expect(toIsoDate('')).toBe('');
  });

  test('monthDateToIso reads the month-name dates Goldman Sachs prints', () => {
    expect(monthDateToIso('Sep 17, 2026')).toBe('2026-09-17');
    expect(monthDateToIso('August 31, 2026')).toBe('2026-08-31');
    expect(monthDateToIso('Net Asset Valuesas of Sep 17, 2026')).toBe('2026-09-17');
    expect(monthDateToIso('2.31%<br>Sep 6, 2016')).toBe('2016-09-06');
    expect(monthDateToIso('--')).toBe('');
    expect(monthDateToIso('no date here')).toBe('');
  });

  test('aumToUsd scales the MMUSD totals to dollars', () => {
    expect(aumToUsd('15,098.52MMUSD')).toBe(15_098_520_000);
    expect(aumToUsd('7,639.03MMUSD')).toBe(7_639_030_000);
    expect(aumToUsd('123.45')).toBe(123.45);
    expect(aumToUsd('--')).toBeNull();
  });

  test('firstNumber / firstDate pull the value out of free text', () => {
    expect(firstNumber('3.25% As of 09/17/2026')).toBe(3.25);
    expect(firstNumber('09/18/2026 | $23.88')).toBe(23.88);
    expect(firstNumber('145.45USD')).toBe(145.45);
    expect(firstNumber('--')).toBeNull();
    expect(firstDate('Ex-Date 09/01/2026')).toBe('2026-09-01');
    expect(firstDate('no date here')).toBeNull();
  });

  test('isinFromCusip derives the ISIN with the Luhn check digit', () => {
    expect(isinFromCusip('381430503')).toBe('US3814305039'); // GSLC
    expect(isinFromCusip('381430529')).toBe('US3814305294'); // GBIL
    expect(isinFromCusip('bad')).toBe('');
  });

  test('annualizedToTotal compounds the CAGR', () => {
    expect(annualizedToTotal(10, 3)).toBe(33.1);
    expect(annualizedToTotal(null, 3)).toBeNull();
  });

  test('proxyUrl prefixes the rendering proxy', () => {
    expect(proxyUrl('https://am.gs.com/en-us/individual/funds')).toBe('https://r.jina.ai/https://am.gs.com/en-us/individual/funds');
  });
});

describe('text normalization', () => {
  test('stripProxyPreamble removes the r.jina.ai header', () => {
    expect(stripProxyPreamble('Title: x\n\nURL Source: y\n\nMarkdown Content:\nbody')).toBe('body');
    expect(stripProxyPreamble('plain')).toBe('plain');
  });

  test('htmlToText renders tables as pipe rows and anchors as markdown links', () => {
    const text = htmlToText('<table><tr><th>CUSIP</th><td>381430503</td></tr></table><p><a href="/en-us/individual/funds">Fund Finder</a></p>');
    expect(text).toContain('| CUSIP | 381430503 |');
    expect(text).toContain('[Fund Finder](https://am.gs.com/en-us/individual/funds)');
    expect(htmlToText('plain, no tags')).toBe('plain, no tags');
  });

  test('lookupLabel reads glued as-of labels, currency values and text values', () => {
    const lines = toTextLines(['Net Asset Valuesas of Sep 17, 2026', '145.45USD', 'Exchange', 'NYSE Arca', 'Total Fund Assets (Daily)as of Sep 17, 2026', '15,098.52MMUSD'].join('\n'));
    expect(lookupLabel(lines, 'Net Asset Value')?.value).toBe('145.45USD');
    expect(lookupLabel(lines, 'Net Asset Value')?.labelText).toContain('Sep 17, 2026');
    expect(lookupLabel(lines, 'Total Fund Assets (Daily)')?.value).toBe('15,098.52MMUSD');
    expect(lookupLabel(lines, 'Exchange', { text: true })?.value).toBe('NYSE Arca');
    expect(lookupLabel(lines, 'Exchange')?.value).toBe('');
    expect(lookupLabel(lines, 'Missing Label')).toBeNull();
  });
});

describe('Goldman Sachs fund finder parser', () => {
  test('reads the proxied markdown rendering (NAV, returns, frequency, inception)', () => {
    const funds = parseCatalogText(FUND_FINDER_MARKDOWN);
    expect(funds.map((fund) => fund.ticker)).toEqual(['GBIL', 'GEMQ', 'GSLC']);
    const gbil = funds.find((fund) => fund.ticker === 'GBIL')!;
    expect(gbil.name).toBe('Goldman Sachs Access Treasury 0-1 Year ETF');
    expect(gbil.category).toBe('Fixed Income');
    expect(gbil.cusip).toBe('381430529');
    expect(gbil.fundPage).toBe('https://am.gs.com/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf');
    expect(gbil.inception).toBe('2016-09-06');
    expect(gbil.nav).toBe(99.98);
    expect(gbil.asOfDate).toBe('2026-09-17');
    expect(gbil.frequency).toBe('Monthly');
    expect(gbil.returnsAsOf).toBe('2026-08-31');
    expect(gbil.returns).toEqual({ ytd: null, yr1: 3.7, yr3: 4.52, yr5: 3.5, yr10: null, sinceInception: 2.31 });
    expect(gbil.source).toBe('goldman');
    const gslc = funds.find((fund) => fund.ticker === 'GSLC')!;
    expect(gslc.category).toBe('Equity');
    expect(gslc.frequency).toBe('Quarterly');
    expect(gslc.returns.yr10).toBe(14.48);
    expect(gslc.returns.sinceInception).toBe(14.03);
    const gemq = funds.find((fund) => fund.ticker === 'GEMQ')!;
    expect(gemq.nav).toBe(23.94);
    expect(gemq.returns).toEqual({ ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null });
    expect(gemq.returnsAsOf).toBeNull();
    expect(gemq.inception).toBe('2026-09-09');
    expect(gemq.frequency).toBe('Annually');
  });

  test('reads the direct HTML rendering', () => {
    const funds = parseCatalogText(FUND_FINDER_HTML);
    expect(funds.map((fund) => fund.ticker)).toEqual(['AAAU', 'GBIL']);
    const aaau = funds.find((fund) => fund.ticker === 'AAAU')!;
    expect(aaau.name).toBe('Goldman Sachs Physical Gold ETF');
    expect(aaau.category).toBe('Commodities');
    expect(aaau.cusip).toBe('38150K103');
    expect(aaau.nav).toBe(43.05);
    expect(aaau.frequency).toBe('None');
    expect(aaau.returns.yr1).toBe(32.81);
    expect(aaau.returns.sinceInception).toBe(17.36);
    expect(aaau.inception).toBe('2018-07-26');
    expect(aaau.fundPage).toBe('https://am.gs.com/en-us/individual/funds/detail/PV103623/38150K103/goldman-sachs-physical-gold-etf');
  });

  test('normalizeMarkdownLinks absolutizes relative links and inlines reference links', () => {
    expect(normalizeMarkdownLinks('[a](/en-us/x)')).toBe('[a](https://am.gs.com/en-us/x)');
    expect(normalizeMarkdownLinks('[a](https://am.gs.com/en-us/x)')).toBe('[a](https://am.gs.com/en-us/x)');
    expect(normalizeMarkdownLinks('[a](//cdn/x)')).toBe('[a](//cdn/x)');
    expect(normalizeMarkdownLinks('[a][1]\n\n[1]: https://am.gs.com/en-us/x')).toBe('[a](https://am.gs.com/en-us/x)\n\n[1]: https://am.gs.com/en-us/x');
    expect(normalizeMarkdownLinks('[a][9]')).toBe('[a][9]');
  });

  test('resolves relative finder links before parsing cards', () => {
    const relative = FUND_FINDER_MARKDOWN.replaceAll('](https://am.gs.com/', '](/');
    const funds = parseCatalogText(relative);
    expect(funds.map((fund) => fund.ticker)).toEqual(['GBIL', 'GEMQ', 'GSLC']);
    const gbil = funds.find((fund) => fund.ticker === 'GBIL')!;
    expect(gbil.fundPage).toBe('https://am.gs.com/en-us/individual/funds/detail/PV102645/381430529/goldman-sachs-access-treasury-0-1-year-etf');
    expect(gbil.frequency).toBe('Monthly');
    expect(gbil.inception).toBe('2016-09-06');
  });

const FUND_FINDER_LIVE = [
  'Title: Fund Finder',
  '',
  'URL Source: https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds|ETF&limit=100',
  '',
  'Markdown Content:',
  'United States (en)keyboard_arrow_down',
  '',
  '[](https://am.gs.com/)',
  '',
  '*   [Funds](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds|ETF&limit=100#)',
  '*   [Creating Impact](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds|ETF&limit=100#)',
  '*   [About Us](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds|ETF&limit=100#)',
  '',
  '*   search',
  '*   Login',
  '',
  '* * *',
  '',
  '# Fund Finder',
  '',
  '48 Funds (48 Share Classes)',
  '',
  '[Reset Filters restart_alt](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds|ETF&limit=100#)',
  '',
  '- [x] Show all fund details',
  '',
  'Fund Name metric_arrow_drop_up Asset Class metric_arrow_drop_up',
  '',
  '* * *',
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
  '',
  '## [Goldman Sachs Access High Yield Corporate Bond ETF](https://am.gs.com/en-us/individual/funds/detail/PV102746/381430453/goldman-sachs-access-high-yield-corporate-bond-etf)',
  '',
  'GHYB',
  '',
  'FIXED INCOME',
  '',
  'FUND OVERVIEW',
  '',
  '|  | Symbol | NAV as of Sep 17, 2026 | Average Annual Returns as of Aug 31, 2026 | Distribution Frequency | Documents |',
  '| --- | --- | --- | --- | --- |',
  '| 1Yr | 3Yr | 5Yr | 10Yr | Inception |',
  '| [381430453](https://am.gs.com/en-us/individual/funds/detail/PV102746/381430453/goldman-sachs-access-high-yield-corporate-bond-etf) | GHYB | 44.12 USD | 4.59% | 8.27% | 3.88% | - | 4.56% Sep 5, 2017 | Monthly | article |',
  '',
  '* * *',
].join('\n');

  test('reads the live render shape (separator row, spaced labels, no <br>)', () => {
    const funds = parseCatalogText(FUND_FINDER_LIVE);
    expect(funds.map((fund) => fund.ticker)).toEqual(['GEMD', 'GHYB']);
    const gemd = funds.find((fund) => fund.ticker === 'GEMD')!;
    expect(gemd.name).toBe('Goldman Sachs Access Emerging Markets USD Bond ETF');
    expect(gemd.category).toBe('Fixed Income');
    expect(gemd.cusip).toBe('381430388');
    expect(gemd.nav).toBe(41.04);
    expect(gemd.asOfDate).toBe('2026-09-17');
    expect(gemd.frequency).toBe('Monthly');
    expect(gemd.inception).toBe('2022-02-15');
    expect(gemd.returnsAsOf).toBe('2026-08-31');
    expect(gemd.returns).toEqual({ ytd: null, yr1: 6.11, yr3: 8.03, yr5: null, yr10: null, sinceInception: 2.02 });
    const ghyb = funds.find((fund) => fund.ticker === 'GHYB')!;
    expect(ghyb.nav).toBe(44.12);
    expect(ghyb.returns.yr5).toBe(3.88);
    expect(ghyb.returns.sinceInception).toBe(4.56);
    expect(ghyb.inception).toBe('2017-09-05');
  });

  test('throws when no fund rows are present', () => {
    expect(() => parseCatalogText('<html><body>Access denied</body></html>')).toThrow(/no ETF rows/);
  });

  test('seedCatalogFunds pins the 48-ETF universe', () => {
    const seeds = seedCatalogFunds();
    expect(seeds.length).toBe(48);
    expect(seeds.every((fund) => fund.source === 'seed')).toBe(true);
    const gslc = seeds.find((fund) => fund.ticker === 'GSLC')!;
    expect(gslc.inception).toBe('2015-09-17');
    expect(gslc.fundPage).toContain('/PV102394/381430503/');
  });
});

describe('Goldman Sachs fund page parser', () => {
  test('reads the proxied markdown rendering', () => {
    const summary = parseProductPage(FUND_PAGE_MARKDOWN, 'GBIL');
    expect(summary.name).toBe('Goldman Sachs Access Treasury 0-1 Year ETF');
    expect(summary.cusip).toBe('381430529');
    expect(summary.exchange).toBe('NYSE Arca');
    expect(summary.assetClass).toBe('Fixed Income');
    expect(summary.benchmark).toBe('FTSE US Treasury 0-1 Year Composite Select Index (Total Return, Unhedged, USD)');
    expect(summary.inception).toBe('2016-09-06');
    expect(summary.nav).toBe(99.98);
    expect(summary.navChange).toBe(0.01);
    expect(summary.navChangePct).toBe(0.01);
    expect(summary.navAsOfDate).toBe('2026-09-17');
    expect(summary.aumDaily).toBe(7_877_700_000);
    expect(summary.aumDailyAsOfDate).toBe('2026-09-17');
    expect(summary.aumMonthly).toBe(7_639_030_000);
    expect(summary.aumMonthlyAsOfDate).toBe('2026-08-31');
    expect(summary.totalHoldings).toBe(40);
    expect(summary.netExpenseRatio).toBe(0.12);
    expect(summary.grossExpenseRatio).toBe(0.14);
    expect(summary.marketPrice).toBe(99.99);
    expect(summary.marketPrice52wkRange).toBe('100.26-99.85');
    expect(summary.premiumDiscount).toBe(0.01);
    expect(summary.pricingAsOfDate).toBe('2026-09-17');
    expect(summary.bidAsk).toBe(99.99);
    expect(summary.bidAskSpread30d).toBe(0.01);
    expect(summary.premiumDays).toBe(14);
    expect(summary.atNavDays).toBe(32);
    expect(summary.discountDays).toBe(16);
    expect(summary.distRate12M).toBe(3.67);
    expect(summary.secYieldSubsidized).toBe(3.69);
    expect(summary.secYieldUnsubsidized).toBe(3.67);
    expect(summary.yieldsAsOfDate).toBe('2026-08-31');
    expect(summary.navTicker).toBe('GBIL.NV');
    expect(summary.iopvTicker).toBe('GBILIV');
    expect(summary.distributions).toEqual([
      { epoch: Date.UTC(2025, 11, 31) / 1000, amount: 0.3382 },
      { epoch: Date.UTC(2026, 7, 3) / 1000, amount: 0.3053 },
      { epoch: Date.UTC(2026, 8, 1) / 1000, amount: 0.3047 },
    ]);
    expect(summary.topHoldings?.asOfDate).toBe('2026-09-17');
    expect(summary.topHoldings?.top10Pct).toBe(53.52);
    expect(summary.topHoldings?.rows).toEqual([
      { name: 'US GOVT T-BILL 08 OCT 2026', weight: 7.2 },
      { name: 'US GOVT T-BILL 27 NOV 2026', weight: 7.15 },
    ]);
    expect(summary.officialReturns.monthEnd.nav).toEqual({ asOfDate: '2026-08-31', mo1: 0.31, mo3: 0.89, ytd: 2.3, yr1: 3.7, cagr3y: 4.52, cagr5y: 3.5, cagr10y: null, siAnn: 2.31 });
    expect(summary.officialReturns.monthEnd.marketPrice?.mo1).toBe(0.29);
    expect(summary.officialReturns.monthEnd.marketPrice?.siAnn).toBe(2.31);
    expect(summary.officialReturns.quarterEnd.nav).toEqual({ asOfDate: '2026-06-30', mo1: null, mo3: null, ytd: null, yr1: 3.81, cagr3y: null, cagr5y: 3.37, cagr10y: null, siAnn: 2.29 });
    expect(summary.officialReturns.quarterEnd.marketPrice?.yr1).toBe(3.82);
  });

  test('reads the direct HTML rendering', () => {
    const summary = parseProductPage(FUND_PAGE_HTML, 'GSLC');
    expect(summary.name).toBe('Goldman Sachs ActiveBeta U.S. Large Cap Equity ETF');
    expect(summary.cusip).toBe('381430503');
    expect(summary.exchange).toBe('NYSE Arca');
    expect(summary.assetClass).toBe('Equity');
    expect(summary.benchmark).toBe('Goldman Sachs ActiveBeta U.S. Large Cap Equity Index');
    expect(summary.inception).toBe('2015-09-17');
    expect(summary.nav).toBe(145.45);
    expect(summary.navChange).toBe(1.61);
    expect(summary.navChangePct).toBe(1.12);
    expect(summary.aumDaily).toBe(15_098_520_000);
    expect(summary.totalHoldings).toBe(427);
    expect(summary.netExpenseRatio).toBe(0.09);
    expect(summary.marketPrice).toBe(145.41);
    expect(summary.premiumDiscount).toBe(-0.03);
    expect(summary.bidAsk).toBe(145.46);
    expect(summary.distRate12M).toBe(0.92);
    expect(summary.secYieldSubsidized).toBe(0.97);
    expect(summary.secYieldUnsubsidized).toBe(0.97);
    expect(summary.navTicker).toBe('GSLC.NV');
    expect(summary.iopvTicker).toBe('GSLCIV');
    expect(summary.distributions).toEqual([
      { epoch: Date.UTC(2026, 2, 25) / 1000, amount: 0.3409 },
      { epoch: Date.UTC(2026, 5, 24) / 1000, amount: 0.3447 },
    ]);
    expect(summary.topHoldings?.top10Pct).toBe(35.85);
    expect(summary.topHoldings?.rows[0]).toEqual({ name: 'NVIDIA Corp', weight: 8.01 });
    expect(summary.officialReturns.monthEnd.nav).toEqual({ asOfDate: '2026-08-31', mo1: 2.47, mo3: 2.14, ytd: 11.11, yr1: 16.62, cagr3y: 19.58, cagr5y: 11.38, cagr10y: 14.48, siAnn: null });
    expect(summary.officialReturns.quarterEnd.nav).toEqual({ asOfDate: '2026-06-30', mo1: null, mo3: null, ytd: null, yr1: 18.03, cagr3y: null, cagr5y: 11.95, cagr10y: 14.5, siAnn: null });
  });

  test('parseFundName prefers the heading and tolerates the title suffix', () => {
    expect(parseFundName('# Goldman Sachs Access Treasury 0-1 Year ETF\n\nFIXED INCOME', 'GBIL')).toBe('Goldman Sachs Access Treasury 0-1 Year ETF');
    expect(parseFundName('Title: Goldman Sachs Access Treasury 0-1 Year ETF | GBIL | Class Common Shares', 'GBIL')).toBe('Goldman Sachs Access Treasury 0-1 Year ETF');
    expect(parseFundName('## Performance\n\nReasons to consider investing', 'GBIL')).toBeNull();
  });

  test('young funds keep -- and N/A cells as null and missing sections as null', () => {
    const lines = toTextLines(['- [**Annualized Returns (%)** as of Aug 31, 2026](https://am.gs.com/x#)', '| label | 1Yr | 3Yr | 5Yr | 10Yr |', '| NAV | 4.30 | -- | N/A | - |'].join('\n'));
    const returns = parseOfficialReturns(lines, 'GEMQ');
    expect(returns.monthEnd.nav).toEqual({ asOfDate: '2026-08-31', mo1: null, mo3: null, ytd: null, yr1: 4.3, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null });
    expect(returns.monthEnd.marketPrice).toBeNull();
    expect(returns.quarterEnd.nav).toBeNull();
    const empty = parseProductPage('<html><body>Access denied</body></html>', 'GBIL');
    expect(empty.nav).toBeNull();
    expect(empty.cusip).toBe('');
    expect(empty.distributions).toEqual([]);
    expect(empty.topHoldings).toBeNull();
    expect(empty.officialReturns.monthEnd.nav).toBeNull();
  });

  test('drops a yields block dated after today instead of publishing a fabricated yield', () => {
    const page = [
      '# Goldman Sachs Core Bond ETF',
      '',
      '12 Month Trailing Distribution Rateas of Dec 29, 2026',
      '',
      '4.17',
      '',
      'Standardized 30-Day Subsidized Yieldsas of Dec 29, 2026',
      '',
      '100.00',
      '',
      'Standardized 30-Day Unsubsidized Yieldsas of Dec 29, 2026',
      '',
      '99.00',
    ].join('\n');
    const dropped = parseProductPage(page, 'GCOR', new Date('2026-09-20T00:00:00Z'));
    expect(dropped.distRate12M).toBeNull();
    expect(dropped.secYieldSubsidized).toBeNull();
    expect(dropped.secYieldUnsubsidized).toBeNull();
    expect(dropped.yieldsAsOfDate).toBeNull();
    const control = parseProductPage(page, 'GCOR', new Date('2027-01-15T00:00:00Z'));
    expect(control.distRate12M).toBe(4.17);
    expect(control.secYieldSubsidized).toBe(100);
    expect(control.secYieldUnsubsidized).toBe(99);
    expect(control.yieldsAsOfDate).toBe('2026-12-29');
  });

  test('parseGsDistributions and parseGsTopHoldings handle absent sections', () => {
    expect(parseGsDistributions(toTextLines('## Performance\n\nNo distributions'))).toEqual([]);
    expect(parseGsTopHoldings(toTextLines('## Performance\n\nNo allocations'))).toBeNull();
  });

  test('mergeOfficialReturns never fills a period the page omits from market prices (one basis per row), but keeps the derived QTD', () => {
    const derived = { asOfDate: '2026-09-18', mo1: 1, qtd: 2, ytd: 3, yr1: 4, cagr3y: 5, cagr5y: 6, cagr10y: 7, siAnn: 8 };
    const merged = mergeOfficialReturns(derived, { asOfDate: '2026-08-31', mo1: 0.31, mo3: 0.89, ytd: 2.3, yr1: 3.7, cagr3y: 4.52, cagr5y: null, cagr10y: null, siAnn: 2.31 });
    expect(merged).toEqual({ asOfDate: '2026-08-31', mo1: 0.31, qtd: 2, ytd: 2.3, yr1: 3.7, cagr3y: 4.52, cagr5y: null, cagr10y: null, siAnn: 2.31 });
    expect(mergeOfficialReturns(derived, null)).toBe(derived);
  });

  test('metrics carry a non-empty returnsBasis and performanceAsOf as the last two keys', () => {
    const fund = { dividendYield: 3.67, secYield: null } as Parameters<typeof deriveMetrics>[1];
    const days = [
      { date: '2025-09-10', close: 100, adjClose: 100, volume: 0 },
      { date: '2026-09-17', close: 121, adjClose: 121, volume: 0 },
    ];
    const derived = priceReturns(days);
    const yahoo = deriveMetrics(derived, fund, [], { paymentsPerYear: null }, 100, false);
    expect(yahoo.returnsBasis).toBe(DERIVED_RETURNS_BASIS);
    expect(yahoo.performanceAsOf).toBe('2026-09-17');
    const official = deriveMetrics(mergeOfficialReturns(derived, { asOfDate: '2026-08-31', mo1: null, mo3: null, ytd: 2.3, yr1: 3.7, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null }), fund, [], { paymentsPerYear: null }, 100, true);
    expect(official.returnsBasis).toBe(OFFICIAL_RETURNS_BASIS);
    expect(official.performanceAsOf).toBe('2026-08-31');
    expect(Object.keys(official).slice(-2)).toEqual(['returnsBasis', 'performanceAsOf']);
    const unknown = deriveMetrics(priceReturns([]), fund, [], { paymentsPerYear: null }, null, false);
    expect(unknown.performanceAsOf).toBeNull();
    expect(unknown.returnsBasis).toBeTruthy();
    expect(unknown.returnsBasis).not.toBe('-');
    expect(performanceAsOf('')).toBeNull();
    expect(performanceAsOf('—')).toBeNull();
    expect(performanceAsOf('Aug 31 2026')).toBe('2026-08-31');
    expect(performanceAsOf('2026-8-5')).toBe('2026-08-05');
  });
});

describe('CSV helper', () => {
  test('parseCsv honours quotes, CRLF and drops blank lines', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n\r\n1,2')).toEqual([['a', 'b'], ['x, y', 'he said "hi"'], ['1', '2']]);
  });
});

describe('distribution frequency', () => {
  const day = 86_400;
  const at = (iso: string) => ({ epoch: Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10))) / 1000, amount: 0.1 });

  test('monthly payers with a December special stay Monthly (median gap)', () => {
    const dividends = ['2025-08-01', '2025-09-02', '2025-10-01', '2025-11-03', '2025-12-01', '2025-12-19', '2026-02-02', '2026-03-02', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-03', '2026-09-01'].map(at);
    expect(inferDistributionFrequency(dividends)).toEqual({ frequency: 'Monthly', paymentsPerYear: 12 });
  });

  test('quarterly, semi-annual, annual, irregular, unknown and none', () => {
    expect(inferDistributionFrequency(['2025-03-26', '2025-06-25', '2025-09-24', '2025-12-10', '2026-03-25', '2026-06-24'].map(at))).toEqual({ frequency: 'Quarterly', paymentsPerYear: 4 });
    expect(inferDistributionFrequency(['2024-06-20', '2024-12-18', '2025-06-24', '2025-12-17', '2026-06-23'].map(at))).toEqual({ frequency: 'Semi-Annual', paymentsPerYear: 2 });
    expect(inferDistributionFrequency(['2023-12-20', '2024-12-18', '2025-12-17'].map(at))).toEqual({ frequency: 'Annual', paymentsPerYear: 1 });
    expect(inferDistributionFrequency([{ epoch: 0, amount: 1 }, { epoch: 900 * day, amount: 1 }])).toEqual({ frequency: 'Irregular', paymentsPerYear: null });
    expect(inferDistributionFrequency([{ epoch: 0, amount: 1 }])).toEqual({ frequency: 'Unknown', paymentsPerYear: null });
    expect(inferDistributionFrequency([])).toEqual({ frequency: 'None', paymentsPerYear: null });
  });

  test('frequencyCodeLabel mirrors the client formatter', () => {
    expect(frequencyCodeLabel('Monthly')).toBe('01 - Monthly');
    expect(frequencyCodeLabel('Quarterly')).toBe('04 - Quarterly');
    expect(frequencyCodeLabel('Semi-Annual')).toBe('06 - Semi-annually');
    expect(frequencyCodeLabel('Annual')).toBe('12 - Annually');
    expect(frequencyCodeLabel('Annually')).toBe('12 - Annually');
    expect(frequencyCodeLabel('Irregular')).toBe('99 - Irregular');
    expect(frequencyCodeLabel('None')).toBe('00 - None');
    expect(frequencyCodeLabel('Unknown')).toBe('00 - Unknown');
    expect(frequencyCodeLabel('—')).toBe('00 - None');
    expect(frequencyCodeLabel('')).toBe('00 - None');
  });

  test('selectDistributionFrequency prefers the finder, then inference, then the previous run', () => {
    expect(selectDistributionFrequency('Monthly', 'Quarterly', 12, 'Quarterly')).toBe('Monthly');
    expect(selectDistributionFrequency('', 'Monthly', 12, 'Quarterly')).toBe('Monthly');
    expect(selectDistributionFrequency('', 'Unknown', 1, 'Monthly')).toBe('Monthly');
    expect(selectDistributionFrequency('', 'Unknown', 1, '')).toBe('—');
    expect(selectDistributionFrequency('', 'None', 0, 'Annually')).toBe('Annually');
    expect(selectDistributionFrequency('—', 'Unknown', 1, null)).toBe('—');
    expect(selectDistributionFrequency(null, 'Unknown', 0, undefined)).toBe('—');
  });

  test('paymentsPerYearForFrequency maps the official finder frequencies', () => {
    expect(paymentsPerYearForFrequency('Monthly')).toBe(12);
    expect(paymentsPerYearForFrequency('Quarterly')).toBe(4);
    expect(paymentsPerYearForFrequency('Annually')).toBe(1);
    expect(paymentsPerYearForFrequency('Annual')).toBe(1);
    expect(paymentsPerYearForFrequency('None')).toBeNull();
    expect(paymentsPerYearForFrequency('—')).toBeNull();
  });
});

describe('Yahoo chart', () => {
  const payload = {
    chart: {
      result: [{
        meta: { exchangeName: 'PCX', regularMarketPrice: 145.5, regularMarketTime: 1_789_000_000, firstTradeDate: 1_442_000_000 },
        timestamp: [1_600_000_000, 1_600_086_400, 1_600_172_800],
        indicators: { quote: [{ close: [10, null, 12], volume: [100, 200, 300] }], adjclose: [{ adjclose: [9, null, 11.5] }] },
        events: { dividends: { '1600086400': { amount: 0.25, date: 1_600_086_400 } } },
      }],
    },
  };

  test('parseChart drops null closes and sorts dividends', () => {
    const chart = parseChart(payload);
    expect(chart.days.length).toBe(2);
    expect(chart.days[0]).toEqual({ date: '2020-09-13', close: 10, adjClose: 9, volume: 100 });
    expect(chart.dividends).toEqual([{ epoch: 1_600_086_400, amount: 0.25 }]);
    expect(chart.exchangeName).toBe('PCX');
    expect(() => parseChart({})).toThrow(/no result/);
  });

  test('priceReturns computes YTD and 1Y from adjusted closes', () => {
    const days = [
      { date: '2025-09-10', close: 100, adjClose: 100, volume: 0 },
      { date: '2025-12-31', close: 110, adjClose: 110, volume: 0 },
      { date: '2026-06-30', close: 115, adjClose: 115, volume: 0 },
      { date: '2026-09-17', close: 121, adjClose: 121, volume: 0 },
    ];
    const returns = priceReturns(days);
    expect(returns.asOfDate).toBe('2026-09-17');
    expect(returns.ytd).toBe(10);
    expect(returns.qtd).toBe(5.22);
    expect(returns.yr1).toBe(21);
    expect(returns.cagr3y).toBeNull();
  });

  test('priceReturns leaves SI ANN blank until a full year of history exists', () => {
    const young = [
      { date: '2026-05-19', close: 40, adjClose: 40, volume: 0 },
      { date: '2026-09-18', close: 44, adjClose: 44, volume: 0 },
    ];
    expect(priceReturns(young).siAnn).toBeNull();
    const mature = [
      { date: '2025-09-17', close: 40, adjClose: 40, volume: 0 },
      { date: '2026-09-18', close: 44, adjClose: 44, volume: 0 },
    ];
    expect(priceReturns(mature).siAnn).not.toBeNull();
  });
});

describe('SEC EDGAR fallback', () => {
  test('parseFundTickerMap maps tickers to series refs', () => {
    const map = parseFundTickerMap({ fields: ['cik', 'seriesId', 'classId', 'symbol'], data: [[1479026, 'S000045678', 'C000123456', 'GSLC'], [1479026, 'S000045679', 'C000123457', 'GBIL']] });
    expect(map.get('GSLC')).toEqual({ cik: '0001479026', seriesId: 'S000045678', classId: 'C000123456' });
    expect(map.size).toBe(2);
  });

  test('parseEdgarAtomFilings keeps only original NPORT-P filings', () => {
    const atom = `<feed><entry><content><accession-number>0001752724-26-000001</accession-number><filing-date>2026-08-27</filing-date><filing-type>NPORT-P</filing-type><filing-href>https://www.sec.gov/Archives/edgar/data/1479026/000175272426000001/0001752724-26-000001-index.htm</filing-href><period>2026-06-30</period></content></entry><entry><content><accession-number>0001752724-26-000002</accession-number><filing-type>NPORT-P/A</filing-type></content></entry></feed>`;
    const filings = parseEdgarAtomFilings(atom);
    expect(filings.length).toBe(1);
    expect(filings[0].url).toBe('https://www.sec.gov/Archives/edgar/data/1479026/000175272426000001/0001752724-26-000001.txt');
    expect(nportUrlFor('0001479026', '0001752724-26-000001')).toBe(filings[0].url);
  });

  test('parseNport reads holdings, debt attributes and net assets', () => {
    const xml = `<edgarSubmission><genInfo><regName>Goldman Sachs ETF Trust</regName><regCik>0001479026</regCik><seriesName>Goldman Sachs ActiveBeta U.S. Large Cap Equity ETF</seriesName><seriesId>S000045678</seriesId><repPdDate>2026-06-30</repPdDate></genInfo><fundInfo><netAssets>15182530000.00</netAssets></fundInfo>
<invstOrSecs><invstOrSec><name>NVIDIA CORP</name><cusip>67066G104</cusip><balance>9500000</balance><valUSD>1214772000.00</valUSD><pctVal>8.01</pctVal><assetCat>EC</assetCat></invstOrSec>
<invstOrSec><name>UNITED STATES TREASURY NOTE</name><cusip>91282CJL6</cusip><balance>1000000</balance><valUSD>990000</valUSD><pctVal>0.5</pctVal><assetCat>DBT</assetCat><debtSec><maturityDt>2028-01-31</maturityDt><annualizedRt>3.5</annualizedRt></debtSec></invstOrSec></invstOrSecs></edgarSubmission>`;
    const parsed = parseNport(xml);
    expect(parsed.seriesId).toBe('S000045678');
    expect(parsed.repPdDate).toBe('2026-06-30');
    expect(parsed.netAssets).toBe(15_182_530_000);
    expect(parsed.holdings.length).toBe(2);
    expect(parsed.holdings[0]).toEqual({ Name: 'NVIDIA CORP', Ticker: '-', Identifier: '67066G104', Weight: '8.01', 'Market Value': '1214772000', 'Shares Held': '9500000', 'Asset Category': 'EC' });
    expect(parsed.holdings[1].Coupon).toBe('3.5');
    expect(parsed.holdings[1].Maturity).toBe('2028-01-31');
  });

  test('name normalization helpers', () => {
    expect(normalizeHoldingName('Merck & Co., Inc.')).toBe('MERCK AND');
    expect(normalizeHoldingName('Alphabet Inc. Class A')).toBe('ALPHABET CL A');
    expect(cleanHoldingTicker(' n/a ')).toBe('');
    expect(cleanHoldingTicker('brk.b')).toBe('BRK.B');
  });
});

describe('universe seed and verified snapshot', () => {
  test('the seed pins 48 unique ETF tickers with finder-verbatim categories', () => {
    expect(GOLDMAN_SACHS_FUNDS.length).toBe(48);
    const tickers = GOLDMAN_SACHS_FUNDS.map((fund) => fund.ticker);
    expect(new Set(tickers).size).toBe(48);
    expect(tickers.every((ticker) => /^[A-Z]{3,4}$/.test(ticker))).toBe(true);
    const categories = GOLDMAN_SACHS_FUNDS.map((fund) => fund.category);
    expect(categories.every((category) => ['EQUITY', 'FIXED INCOME', 'COMMODITIES'].includes(category))).toBe(true);
    expect(categories.filter((category) => category === 'EQUITY').length).toBe(31);
    expect(categories.filter((category) => category === 'FIXED INCOME').length).toBe(16);
    expect(categories.filter((category) => category === 'COMMODITIES').length).toBe(1);
    for (const fund of GOLDMAN_SACHS_FUNDS) {
      const match = /\/funds\/detail\/(PV\d+)\/([A-Za-z0-9]{9})\//.exec(fund.fundPage);
      expect(match?.[2]).toBe(fund.cusip);
      expect(monthDateToIso(fund.inceptionDate)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  test('finder snapshots cover the whole seed universe', () => {
    expect(Object.keys(FINDER_SNAPSHOTS).sort()).toEqual(GOLDMAN_SACHS_FUNDS.map((fund) => fund.ticker).sort());
    expect(FINDER_SNAPSHOTS.GSLC.nav).toBe(145.45);
    expect(FINDER_SNAPSHOTS.AAAU.frequency).toBe('None');
    expect(FINDER_SNAPSHOTS.GEMQ.yr1).toBeNull();
    expect(FINDER_SNAPSHOTS.GEMQ.returnsAsOf).toBeNull();
  });

  test('fund-page snapshots carry the S0-verified detail metrics', () => {
    expect(FUND_PAGE_SNAPSHOTS.GSLC.netExpenseRatio).toBe(0.09);
    expect(FUND_PAGE_SNAPSHOTS.GSLC.aumDailyMm).toBe(15098.52);
    expect(FUND_PAGE_SNAPSHOTS.GSLC.holdingsCount).toBe(427);
    expect(FUND_PAGE_SNAPSHOTS.GBIL.grossExpenseRatio).toBe(0.14);
    expect(FUND_PAGE_SNAPSHOTS.AAAU.holdingsCount).toBeNull();
    expect(FUND_PAGE_SNAPSHOTS.AAAU.lbmaGoldPrice).toBe(4328.2);
    expect(TOP_HOLDINGS_SNAPSHOTS.GSLC.rows.length).toBe(10);
    expect(TOP_HOLDINGS_SNAPSHOTS.GSLC.rows[0]).toEqual({ name: 'NVIDIA Corp', weight: 8.01 });
    expect(DISTRIBUTION_SNAPSHOTS.GSLC.length).toBe(8);
    expect(DISTRIBUTION_SNAPSHOTS.GSLC[0].exDate).toBe('06/24/2026');
    expect(DISTRIBUTION_SNAPSHOTS.GBIL.length).toBe(9);
  });
});


import { test as frequencyLabelTest, expect as frequencyLabelExpect } from 'bun:test';
frequencyLabelTest('Frequency placeholders display None and existing cadence labels stay unchanged', async () => {
  const text = await Bun.file(new URL('../app.tsx', import.meta.url)).text();
  const start = /^([ \t]*)function (formatDividendFrequency|formatDistributionFrequency)\(/m.exec(text);
  frequencyLabelExpect(start).not.toBeNull();
  const tail = text.slice(start!.index);
  const end = new RegExp('^' + start![1] + '\u007d', 'm').exec(tail);
  frequencyLabelExpect(end).not.toBeNull();
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(tail.slice(0, end!.index + end![0].length));
  const format = new Function(js + '; return ' + start![2] + ';')();
  for (const value of [null, undefined, '', '  ', '-', '‐', '‑', '‒', '–', '—', ' — ']) {
    frequencyLabelExpect(format(value)).toBe('00 - None');
  }
  for (const [input, expected] of [
    ['None', '00 - None'], ['Unknown', '00 - Unknown'], ['Monthly', '01 - Monthly'],
    ['Quarterly', '04 - Quarterly'], ['Semi-annually', '06 - Semi-annually'],
    ['Annually', '12 - Annually'], ['Irregular', '99 - Irregular'],
  ]) frequencyLabelExpect(format(input)).toBe(expected);
});


import { test as queueTest, describe as queueDescribe, expect as queueExpect } from 'bun:test';

async function tickerChainHarness() {
 const app=await Bun.file(new URL('../app.tsx',import.meta.url)).text();
 const source=app.match(/^function withTickerChain<T>\([\s\S]*?^\}/m)?.[0];
 queueExpect(source).toBeDefined();
 const javascript=new Bun.Transpiler({loader:'ts'}).transformSync(source!);
 const chains=new Map<string,Promise<void>>();
 const enqueue=new Function('holdingsChains',`${javascript}; return withTickerChain;`)(chains) as
  <T>(ticker:string,fn:()=>Promise<T>)=>Promise<T>;
 return {chains,enqueue};
}

queueDescribe('per-ticker queue preserves caller results and stores completion-only promises',()=>{
 queueTest('successful generic result reaches caller, not the internal queue',async()=>{
  const {chains,enqueue}=await tickerChainHarness();
  const value={rows:[['AGEM']]};
  queueExpect(await enqueue('AGEM',async()=>value)).toBe(value);
  queueExpect(await chains.get('AGEM')).toBeUndefined();
 });
 queueTest('rejection reaches caller without poisoning the next queued task',async()=>{
  const {chains,enqueue}=await tickerChainHarness();
  const error=new Error('page failed');
  const work=enqueue('AGEM',async()=>{throw error;});
  const observed=work.catch(reason=>reason);
  const settled=chains.get('AGEM');
  const next=enqueue('AGEM',async()=>42);
  queueExpect(await observed).toBe(error);
  queueExpect(await settled).toBeUndefined();
  queueExpect(await next).toBe(42);
  queueExpect(await chains.get('AGEM')).toBeUndefined();
 });
 queueTest('synchronous callback throws also leave the queue usable',async()=>{
  const {chains,enqueue}=await tickerChainHarness();
  const error=new Error('synchronous failure');
  queueExpect(await enqueue('AGEM',()=>{throw error;}).catch(reason=>reason)).toBe(error);
  queueExpect(await chains.get('AGEM')).toBeUndefined();
  queueExpect(await enqueue('AGEM',async()=>'recovered')).toBe('recovered');
 });
 queueTest('same-ticker work stays serial while other tickers run independently',async()=>{
  const {chains,enqueue}=await tickerChainHarness();
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  const events:string[]=[];
  const first=enqueue('AGEM',async()=>{events.push('first');await gate;events.push('done');return 1;});
  const second=enqueue('AGEM',async()=>{events.push('second');return 2;});
  try {
   queueExpect(await enqueue('SGOL',async()=>3)).toBe(3);
   queueExpect(events).toEqual(['first']);
  } finally { release(); }
  queueExpect(await Promise.all([first,second])).toEqual([1,2]);
  queueExpect(events).toEqual(['first','done','second']);
  queueExpect(await chains.get('AGEM')).toBeUndefined();
  queueExpect(await chains.get('SGOL')).toBeUndefined();
 });
});


async function officialReturnRowHarness() {
  const source = await Bun.file(new URL('./update-data.ts', import.meta.url)).text();
  const start = source.indexOf('function emptyReturnRow(');
  const end = source.indexOf('\n/**', start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end));
  const makeRow = new Function(js + '; return returnRowFromLabeledCells;')() as
    (headers: string[], values: Array<number | null>, date: string) => import('./update-data').OfficialReturnRow;
  return { source, makeRow };
}

describe('numeric official return-row keys', () => {
  test('the slot annotation excludes the string date field without a cast', async () => {
    const { source } = await officialReturnRowHarness();
    expect(source).toContain("const slot = (header: string): Exclude<keyof OfficialReturnRow, 'asOfDate'> | null => {");
    expect(source).toContain('if (field) row[field] = values[index] ?? null;');
  });
  test('all numeric tenors retain their values, including zero and negatives', async () => {
    const { makeRow } = await officialReturnRowHarness();
    expect(makeRow(['Since Inception', '1Mth', '3Month', 'YTD', '1Yr', '3Year', '5Yr', '10Year'],
      [-1.5, 0, 0.25, 2, 3, 4, 5, 6], '2026-08-31')).toEqual({
      asOfDate: '2026-08-31', siAnn: -1.5, mo1: 0, mo3: 0.25, ytd: 2,
      yr1: 3, cagr3y: 4, cagr5y: 5, cagr10y: 6,
    });
  });
  test('date/unknown headers cannot overwrite metadata or create fields', async () => {
    const { makeRow } = await officialReturnRowHarness();
    expect(makeRow(['asOfDate', 'Unknown', '1Year'], [999, 123, 0], '2026-06-30')).toEqual({
      asOfDate: '2026-06-30', mo1: null, mo3: null, ytd: null, yr1: 0,
      cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null,
    });
  });
  test('missing/null cells stay null; reordered headers map by label', async () => {
    const { makeRow } = await officialReturnRowHarness();
    expect(makeRow(['10Yr', 'YTD', '1Month', '3Yr'], [6, null], '2026-08-31')).toEqual({
      asOfDate: '2026-08-31', mo1: null, mo3: null, ytd: null, yr1: null,
      cagr3y: null, cagr5y: null, cagr10y: 6, siAnn: null,
    });
  });
});


import { test as headerTest, expect as headerExpect } from 'bun:test';
async function headerSummaryHarness() {
  const source = await Bun.file(new URL('../app.tsx', import.meta.url)).text();
  const match = /^([ \t]*)function renderHeaderSummary\(/m.exec(source);
  headerExpect(match).not.toBeNull();
  const tail = source.slice(match!.index);
  const end = new RegExp('^' + match![1] + '}', 'm').exec(tail)!;
  const js = new Bun.Transpiler({ loader: 'ts' }).transformSync(tail.slice(0, end.index + end[0].length));
  const makeNode = (text = ''): any => {
    const node: any = { textContent: text, childNodes: [], dataset: {}, listeners: {} };
    node.replaceChildren = (...children: any[]) => { node.childNodes = children; };
    node.append = (...children: any[]) => { node.childNodes.push(...children); };
    node.addEventListener = (name: string, listener: any) => { node.listeners[name] = listener; };
    return node;
  };
  const panel = makeNode(), subtitle = makeNode(), details = makeNode('Data: source link and updated timestamp');
  subtitle.append(details);
  const document = { getElementById: () => panel, createTextNode: makeNode, createElement: () => makeNode() };
  const render = new Function('document', js + '; return renderHeaderSummary;')(document);
  const text = () => subtitle.childNodes.map((n: any) => n.textContent).join('');
  return { render, panel, subtitle, details, makeNode, text };
}
headerTest('header has no visible subtitle without selection; original details nodes are retained', async () => {
  const h = await headerSummaryHarness();
  h.render(h.subtitle, new Set(), null, () => {});
  headerExpect(h.text()).toBe('');
  headerExpect(h.panel.childNodes).toEqual([h.details]);
  headerExpect(h.panel.childNodes[0]).toBe(h.details);
});
headerTest('header shows sorted selected tickers only, preserving click activation and highlight', async () => {
  const h = await headerSummaryHarness(); const activated: string[] = [];
  h.render(h.subtitle, new Set(['ZZZ', 'AAA']), 'AAA', (ticker: string) => activated.push(ticker));
  headerExpect(h.text()).toBe('2 selected: AAA, ZZZ');
  const links = h.subtitle.childNodes.filter((n: any) => n.dataset.headerFund);
  headerExpect(links[0].className).toContain('underline');
  links[1].listeners.click({ preventDefault() {} });
  headerExpect(activated).toEqual(['ZZZ']);
  headerExpect(h.panel.childNodes[0]).toBe(h.details);
});
headerTest('all selected still lists tickers; clear replaces both summary and selection', async () => {
  const h = await headerSummaryHarness();
  h.render(h.subtitle, new Set(['CCC','AAA','BBB']), 'BBB', () => {});
  headerExpect(h.text()).toBe('3 selected: AAA, BBB, CCC');
  const next = h.makeNode('Fresh detail context'); h.subtitle.replaceChildren(next);
  h.render(h.subtitle, new Set(), null, () => {});
  headerExpect(h.text()).toBe(''); headerExpect(h.panel.childNodes).toEqual([next]);
});
headerTest('header markup supplies a focusable counter and hidden rich panel with dismissal', async () => {
  const html = await Bun.file(new URL('../index.html', import.meta.url)).text();
  headerExpect(html).toMatch(/<button[^>]*aria-controls="app-summary"[^>]*id="ticker-count"/);
  headerExpect(html).toContain('id="app-summary" role="region" aria-label="ETF catalog information" hidden');
  headerExpect(html).toContain("event.key !== 'Escape'");
  headerExpect(html).toContain("trigger.addEventListener('focus', show)");
  headerExpect(html).toContain("trigger.addEventListener('pointerenter'");
});


describe('return range defaults', () => {
  test('colon-only values do not create active return filters', () => {
    expect(parseRanges({ PERFORMANCE_YTD: ':', PERFORMANCE_1Y: ':', TOTAL_RETURN_1Y: ':' }, 'PERFORMANCE')).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// Controls: resolver, config file, README, --help and workflow parity
// ---------------------------------------------------------------------------


const readRepo = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const configFile = () => JSON.parse(readRepo('scripts/update-data.config.json'));

test('configuration precedence: file < advanced < nonblank input < environment', () => {
  const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'GSLC' }, { CONCURRENCY: 3, TICKERS: 'GBIL' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '5' });
  expect(c.CONCURRENCY).toBe('5');
  expect(c.TICKERS).toBe('GBIL');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
  expect(resolveControls({ TICKERS: 'GSLC' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
  expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
  expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  expect(readConfig(resolveControls({ MAX_RETRIES: 1 })).maxRetries).toBe(1);
  expect(resolveControls({ SEC_UA: 'a' }, {}, {}, { SEC_UA: '' }).SEC_UA).toBe('');
  expect(resolveControls({ MAX_FETCHES: 7 }, {}, {}, { UNRELATED: 'x' }).MAX_FETCHES).toBe('7');
});

test('scheduled path (empty advanced and inputs) equals the config defaults', () => {
  const defaults = configFile();
  const resolved = resolveControls(defaults, JSON.parse('{}'), {}, {});
  expect(resolved).toEqual(defaults);
  const config = readConfig(resolved);
  expect(config.maxFetches).toBe(0);
  expect(config.requestSleep).toBe(2);
  expect(config.concurrency).toBe(2);
  expect(config.holdingsPageSize).toBe(250);
  expect(config.historyPageSize).toBe(1000);
  expect(config.historyRange).toBe('max');
  expect(config.maxRetries).toBe(2);
  expect(config.tickers).toBeNull();
  expect(config.aum).toBeUndefined();
  expect(config.ter).toBeUndefined();
  expect(config.dividendYield).toBeUndefined();
  expect(config.performance).toEqual({});
  expect(config.totalReturn).toEqual({});
  expect(config.edgarFallback).toBe(true);
  expect(config.skipYahoo).toBe(false);
  expect(config.skipGoldmanSachs).toBe(false);
  expect(config.storeRawDownloads).toBe(false);
  expect(config.offlineSeed).toBe(false);
  expect(config.secYield).toBeUndefined();
  expect(config.secUa).toBe('daggerok ETF feed daggerok@gmail.com');
  expect(defaults.SEC_UA).toBe(config.secUa);
});

test('runtime controls read the checked-in file and let the environment override it', async () => {
  expect(await runtimeControls({})).toEqual(configFile());
  const controls = await runtimeControls({ TICKERS: 'GSLC GBIL', SKIP_YAHOO: 'true', PERFORMANCE_1Y: '15:' });
  expect(controls.TICKERS).toBe('GSLC GBIL');
  const config = readConfig(controls);
  expect([...(config.tickers ?? [])]).toEqual(['GSLC', 'GBIL']);
  expect(config.skipYahoo).toBe(true);
  expect(config.performance['1Y']).toEqual({ min: 15, max: undefined });
});

test('resolver rejects unknown, non-scalar, invalid and multiline values', () => {
  const bad: unknown[] = [{ UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: 0 }, { MAX_RETRIES: -1 }, { SEC_YIELD: '3:1' }, { HISTORY_RANGE: 'forever' }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { USE_SYSTEM_CA: 'maybe' }, { EDGAR_FALLBACK: 'sometimes' }, { AUM: '1:2:3' }, { TER: '5:1' }, { PERFORMANCE_1Y: 'a:b' }, { TICKERS: ['GSLC'] }, { TICKERS: null }, { OUTPUT_DIR: '/tmp' }, null, []];
  for (const value of bad) expect(() => resolveControls(value)).toThrow();
  expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
  expect(() => resolveControls({}, [])).toThrow();
  expect(() => resolveControls({}, {}, { TICKERS: 'A\nB' })).toThrow();
  expect(() => resolveControls({}, {}, {}, { SEC_UA: 'x\0bad' })).toThrow();
  expect(() => JSON.parse('{bad')).toThrow();
});

test('USE_SYSTEM_CA resolves auto/true/false case-insensitively and defaults to auto', () => {
  expect(configFile().USE_SYSTEM_CA).toBe('auto');
  expect(resolveControls(configFile()).USE_SYSTEM_CA).toBe('auto');
  for (const value of ['auto', 'TRUE', 'False']) expect(resolveControls({}, {}, {}, { USE_SYSTEM_CA: value }).USE_SYSTEM_CA).toBe(value);
  expect(() => resolveControls({}, {}, {}, { USE_SYSTEM_CA: 'maybe' })).toThrow('USE_SYSTEM_CA');
});

test('isCertError detects untrusted-certificate failures, also through cause', () => {
  expect(isCertError({ code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })).toBe(true);
  expect(isCertError(new Error('unable to get local issuer certificate'))).toBe(true);
  expect(isCertError(new Error('fetch failed', { cause: new Error('self-signed certificate in certificate chain') }))).toBe(true);
  expect(isCertError({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(false);
  expect(isCertError(new Error('HTTP 403 Forbidden'))).toBe(false);
  expect(isCertError(null)).toBe(false);
});

test('installSystemCa leaves fetch alone for false/active, restarts for true and once on cert errors in auto', async () => {
  const original = globalThis.fetch;
  const reexec = () => { calls++; throw new Error('reexec'); };
  let calls = 0;
  try {
    installSystemCa('false', reexec as () => never, false);
    expect(globalThis.fetch).toBe(original);
    installSystemCa('auto', reexec as () => never, true);
    expect(globalThis.fetch).toBe(original);
    expect(() => installSystemCa('true', reexec as () => never, false)).toThrow('reexec');
    expect(calls).toBe(1);
    expect(globalThis.fetch).toBe(original);

    calls = 0;
    let next: () => Promise<Response> = async () => { throw Object.assign(new Error('fetch failed'), { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }); };
    globalThis.fetch = (async () => next()) as unknown as typeof fetch;
    installSystemCa('auto', reexec as () => never, false);
    expect(globalThis.fetch).not.toBe(original);
    await expect(fetch('https://example.invalid/')).rejects.toThrow('reexec');
    expect(calls).toBe(1);
    next = async () => { throw new Error('ECONNRESET'); };
    await expect(fetch('https://example.invalid/')).rejects.toThrow('ECONNRESET');
    expect(calls).toBe(1);
    next = async () => new Response('ok');
    expect(await (await fetch('https://example.invalid/')).text()).toBe('ok');
    expect(calls).toBe(1);
  } finally {
    globalThis.fetch = original;
  }
});

test('config keys, CONTROL_NAMES, README rows and --help are in sync', () => {
  expect(Object.keys(configFile()).sort()).toEqual([...CONTROL_NAMES].sort());
  for (const value of Object.values(configFile())) expect(typeof value).toBe('string');
  const doc = readRepo('README.md');
  const usage = readRepo('scripts/update-data.ts');
  for (const name of CONTROL_NAMES) {
    const tenor = name.match(/^(PERFORMANCE|TOTAL_RETURN)_(1Y|3Y|5Y|10Y)$/);
    expect(doc).toContain(tenor ? '`_' + tenor[2] + '`' : '`' + name + '`');
    if (tenor) expect(doc).toContain('`' + tenor[1] + '_YTD`');
    expect(usage).toContain(tenor ? `${tenor[1]}_YTD|1Y|3Y|5Y|10Y` : name);
  }
  expect(doc).toContain('scripts/update-data.config.json');
});

test('SEC_YIELD parses min:max like the other yield filter', () => {
  expect(readConfig(resolveControls({ SEC_YIELD: '4:' })).secYield).toEqual({ min: 4, max: undefined });
  expect(readConfig(resolveControls({ SEC_YIELD: ':2.5' })).secYield).toEqual({ min: undefined, max: 2.5 });
});

test('workflow resolves the same controls and only writes under api/goldmansachs', () => {
  const yml = readRepo('.github/workflows/update-data.yml');
  const block = yml.slice(yml.indexOf('    inputs:'), yml.indexOf('\npermissions:'));
  const names = [...block.matchAll(/^      (\w+):$/gm)].map((m) => m[1]);
  expect(names.length).toBeLessThanOrEqual(25);
  expect(names).toContain('advanced');
  expect(block).toMatch(/advanced:[\s\S]*?default: '\{\}'/);
  for (const name of names.filter((n) => n !== 'advanced')) expect(CONTROL_NAMES).toContain(name.toUpperCase() as never);
  expect(yml).toContain("cron: '0 0 * * 0'");
  expect(yml).not.toMatch(/^  push:/m);
  expect(yml).toContain('import { resolveControls } from "./scripts/update-data.ts"');
  expect(yml).toContain('toJSON(inputs)');
  expect(yml).not.toMatch(/\$\{\{\s*inputs\./);
  expect(yml).toContain('PROTECTED_SEC_UA: ${{ vars.SEC_UA }}');
  expect(yml).toContain('git add api/goldmansachs\n');
  expect(yml.match(/git add /g)?.length).toBe(1);
  expect(yml).not.toContain('OUTPUT_DIR');
  expect(yml).not.toContain('bunx tsc');
  expect(yml).toContain('timeout-minutes: 30');
  expect(yml).toContain('persist-credentials: false');
  expect(yml).not.toMatch(/git push origin|x-access-token:\$\{\{/);
  expect(yml).not.toMatch(/\$\{\{\s*(inputs|github\.event\.inputs)\./);
  expect(yml).toContain('cron:');
  for (const dir of yml.match(/api\/[\w-]+/g) ?? []) expect(dir).toBe('api/goldmansachs');
});

test('README documents the controls, keeps the standard sections and avoids stale references', () => {
  const doc = readRepo('README.md');
  const headings = [...doc.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  for (const name of ['Using Bun', 'TypeScript and verification', 'License']) expect(headings).toContain(name);
  expect(doc).toContain('### Update controls');
  expect(doc).toContain('### Data sources');
  expect(doc).toContain('### Metrics and caveats');
  expect(doc).toContain('### Examples');
  expect(doc).not.toMatch(/worklog|\.prompt|evidence\/|fixtures|config-docs\.test/i);
  expect(doc).not.toContain('example.com');
});

test('scripts/ holds only the three standard files and the SEC contact is the owner descriptor', () => {
  expect(readdirSync(new URL('./', import.meta.url)).sort()).toEqual(['update-data.config.json', 'update-data.test.ts', 'update-data.ts']);
  expect(readRepo('scripts/update-data.ts')).not.toContain('example.com');
});

describe('the published feed never shrinks', () => {
  const metaFor = (ticker: string) => ({
    ticker, name: `${ticker} ETF`, category: 'Fixed Income', source: { fundPage: `https://am.gs.com/${ticker}` },
    identifiers: { cusip: '123456789', isin: 'US1234567890', exchange: 'NYSE Arca' },
    expenseRatio: { display: '0.12%', value: 0.12 }, nav: { display: '$100.00', value: 100, asOfDate: 'Sep 30 2026' },
    marketPrice: { display: '$100.01', value: 100.01 }, premiumDiscount: { display: '0.01%', value: 0.01 }, aum: { display: '$1.00 B', value: 1e9 },
    yields: { dividendYield: 3.5, dividendYieldText: '3.50%', secYield: null, secYieldText: '—' },
    returns: { derivedFrom: 'official test basis', monthEnd: { asOfDate: 'Aug 31 2026', ytd: 2.3, yr3: 4.5, yr5: null, yr10: null, sinceInception: 2.1 } },
    distributions: { frequency: 'Monthly', frequencyCode: '01 - Monthly' }, holdings: { totalRows: 10 }, history: { totalRows: 20 },
  });

  test('indexRowFromMeta rebuilds a metrics-contract row and mergePublishedRows only adds or refreshes', () => {
    const row = indexRowFromMeta(metaFor('GBIL'))!;
    expect(row.ticker).toBe('GBIL');
    expect(row.dataFile).toBe('./funds/GBIL/meta.json');
    expect(row.metrics).toMatchObject({ ytd: 2.3, cagr3y: 4.5, cagr5y: null, tr1y: null, returnsBasis: 'official test basis', performanceAsOf: '2026-08-31' });
    expect(indexRowFromMeta({ name: 'no ticker' })).toBeNull();
    const known = new Map<string, Record<string, any>>([['AAAU', { ticker: 'AAAU', nav: 'old' }], ['GBIL', { ticker: 'GBIL', nav: 'old' }]]);
    const merged = mergePublishedRows(known, [{ ticker: 'GBIL', nav: 'new' }, { ticker: 'GBND', nav: 'new' }]);
    expect(merged.map((r) => `${r.ticker}:${r.nav}`)).toEqual(['AAAU:old', 'GBIL:new', 'GBND:new']);
    expect(mergePublishedRows(known, []).length).toBe(2);
  });

  // Runs the real updater against a throwaway copy of the repo (its API_ROOT is relative to the script),
  // with fetch preloaded to a dead network and sleeps shortened, so no real data is touched and no request leaves the machine.
  async function runUpdater(env: Record<string, string>): Promise<{ before: string[]; after: string[]; stdout: string }> {
    const root = mkdtempSync(join(tmpdir(), 'gs-no-shrink-'));
    try {
      mkdirSync(join(root, 'scripts'), { recursive: true });
      for (const file of ['update-data.ts', 'update-data.config.json']) cpSync(new URL(file, import.meta.url), join(root, 'scripts', file));
      cpSync(new URL('../data', import.meta.url), join(root, 'data'), { recursive: true });
      const api = join(root, 'api', 'goldmansachs');
      const indexed = ['AAAU', 'GBIL', 'GSLC', 'ZZIDX'];
      mkdirSync(api, { recursive: true });
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
        cwd: root, stdout: 'pipe', stderr: 'pipe',
        env: { PATH: process.env.PATH ?? '', REQUEST_SLEEP: '0', MAX_RETRIES: '1', USE_SYSTEM_CA: 'false', ...env },
      });
      const stdout = await new Response(child.stdout).text();
      await child.exited;
      return { before, after: read(), stdout };
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test('a one-ticker run keeps every published row, including funds known only from meta.json', async () => {
    const { before, after } = await runUpdater({ TICKERS: 'GBIL' });
    expect(before).toEqual(['AAAU', 'GBIL', 'GSLC', 'ZZIDX']);
    // published rows stay (plus funds known only from meta.json); catalog funds without data get placeholder rows
    expect(after).toEqual(expect.arrayContaining(['AAAU', 'GBIL', 'GSLC', 'ZZIDX', 'ZZMETA']));
  }, 60_000);

  test('a bounded run (MAX_FETCHES) and a ticker outside the universe do not shrink the index either', async () => {
    expect((await runUpdater({ MAX_FETCHES: '1' })).after).toEqual(expect.arrayContaining(['AAAU', 'GBIL', 'GSLC', 'ZZIDX', 'ZZMETA']));
    // an unknown ticker is an error before anything is written
    const unknown = await runUpdater({ TICKERS: 'NOSUCH' });
    expect(unknown.after).toEqual(['AAAU', 'GBIL', 'GSLC', 'ZZIDX']);
  }, 60_000);

  test('an unreadable live catalog (dead network, full run) never drops published funds', async () => {
    const { after, stdout } = await runUpdater({ SKIP_YAHOO: 'true', EDGAR_FALLBACK: 'false' });
    expect(stdout).toContain('catalog');
    expect(after).toEqual(expect.arrayContaining(['AAAU', 'GBIL', 'GSLC', 'ZZIDX', 'ZZMETA']));
    expect(after.length).toBeGreaterThanOrEqual(5);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Whole-run behaviour against a mocked network (main() in-process, throwaway output directory)
// ---------------------------------------------------------------------------

describe('updater run against a mocked network', () => {
  type Hit = { t: number; url: string };
  type Mock = { hits: Hit[]; peak: number; restore: () => void; dir: string; api: string };
  const realFetch = globalThis.fetch;
  const realLog = console.log;
  const mocks: Mock[] = [];

  function chartJson(days = 400): string {
    const end = Date.UTC(2026, 8, 17) / 1000;
    const timestamp: number[] = [];
    const close: number[] = [];
    for (let i = 0; i < days; i += 1) { timestamp.push(end - (days - 1 - i) * 86_400); close.push(100 + i * 0.05); }
    return JSON.stringify({ chart: { result: [{ meta: { exchangeName: 'PCX', regularMarketPrice: 120, regularMarketTime: end, firstTradeDate: timestamp[0] }, timestamp, indicators: { quote: [{ close, volume: close.map(() => 1000) }], adjclose: [{ adjclose: close }] }, events: { dividends: {} } }] } });
  }

  /** Mocks catalog, fund pages and Yahoo; `handler` may override any URL (return undefined to fall through). */
  function mockWorld(opts: { latency?: number; handler?: (url: string) => Response | Promise<Response> | undefined } = {}): Mock {
    const dir = mkdtempSync(join(tmpdir(), 'gs-mock-'));
    const api = join(dir, 'api') + '/';
    mkdirSync(api, { recursive: true });
    setApiRootForTests(pathToFileURL(api));
    const t0 = Date.now();
    const mock: Mock = { hits: [], peak: 0, restore: () => undefined, dir, api };
    let inFlight = 0;
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      mock.hits.push({ t: Date.now() - t0, url });
      inFlight += 1;
      mock.peak = Math.max(mock.peak, inFlight);
      try {
        await new Promise((resolve) => setTimeout(resolve, opts.latency ?? 20));
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

  afterEach(() => {
    while (mocks.length) mocks.pop()!.restore();
    console.log = realLog;
    // main() sets process.exitCode = 1 when every fund failed: never let it leak into the test runner's exit status
    process.exitCode = 0;
    setFetchTuningForTests(45_000, 800);
    resetIssuerDirectState();
  });

  async function run(env: Record<string, string>, options: { deadlineMs?: number } = {}): Promise<string> {
    const lines: string[] = [];
    console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
    try {
      await main({ REQUEST_SLEEP: '0', MAX_RETRIES: '1', USE_SYSTEM_CA: 'false', EDGAR_FALLBACK: 'false', ...env }, options);
    } finally {
      console.log = realLog;
    }
    return lines.join('\n');
  }

  const readJson = (mock: Mock, path: string) => JSON.parse(readFileSync(join(mock.api, path), 'utf8'));
  const snapshot = (root: string): Record<string, string> => {
    const out: Record<string, string> = {};
    const walk = (dir: string) => { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) walk(path); else out[path.slice(root.length)] = readFileSync(path, 'utf8'); } };
    walk(root);
    return out;
  };
  const THREE = 'GBIL,AAAU,GSLC';
  const detailHits = (mock: Mock) => mock.hits.filter((hit) => hit.url.includes('/detail/'));

  test('pacing: CONCURRENCY=3 starts three workers together (per-worker lanes), CONCURRENCY=1 never overlaps', async () => {
    const wide = mockWorld({ latency: 40 });
    await run({ TICKERS: THREE, CONCURRENCY: '3', REQUEST_SLEEP: '0.6', SKIP_YAHOO: 'true' });
    const starts = detailHits(wide).map((hit) => hit.t);
    expect(starts.length).toBe(3);
    // old global gate: starts 0.6 s apart (spread 1200 ms); lanes: all three within one sleep interval
    expect(Math.max(...starts) - Math.min(...starts)).toBeLessThan(300);
    expect(wide.peak).toBe(3);
    wide.restore(); mocks.pop();

    const narrow = mockWorld({ latency: 40 });
    await run({ TICKERS: THREE, CONCURRENCY: '1', REQUEST_SLEEP: '0', SKIP_YAHOO: 'true' });
    expect(narrow.peak).toBe(1);
  }, 30_000);

  test('pacing: one worker still spaces its own requests by REQUEST_SLEEP, and the slot is reserved synchronously', async () => {
    resetPacing(0.25);
    const first = runOnLane(0, async () => { const t = Date.now(); await paceRequests(); const a = Date.now() - t; await paceRequests(); return [a, Date.now() - t]; });
    const other = runOnLane(1, async () => { const t = Date.now(); await paceRequests(); return Date.now() - t; });
    const [[a, b], c] = await Promise.all([first, other]);
    expect(a).toBeLessThan(100);
    expect(b).toBeGreaterThanOrEqual(230);
    expect(c).toBeLessThan(100);
    // two requests made in the same tick on one lane claim two different slots
    resetPacing(0.2);
    const t = Date.now();
    const times = await runOnLane(2, () => Promise.all([paceRequests().then(() => Date.now() - t), paceRequests().then(() => Date.now() - t)]));
    expect(Math.abs(times[1] - times[0])).toBeGreaterThanOrEqual(180);
  });

  test('pacing: the r.jina.ai proxy keeps one global gate of at least 3.2 s, shared by all lanes', async () => {
    resetPacing(0);
    const t = Date.now();
    const times = await Promise.all([runOnLane(0, () => paceRequests(true).then(() => Date.now() - t)), runOnLane(1, () => paceRequests(true).then(() => Date.now() - t))]);
    expect(Math.abs(times[1] - times[0])).toBeGreaterThanOrEqual(3150);
  }, 10_000);

  test('a fund page the issuer denies directly costs at most one proxy request plus one retry', async () => {
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
  }, 20_000);

  test('direct-denial latch: two denials disable direct requests and a late success from another worker cannot re-enable them', () => {
    resetIssuerDirectState();
    expect(recordIssuerDirectResult(true)).toBe(false);
    expect(recordIssuerDirectResult(true)).toBe(true);
    expect(recordIssuerDirectResult(false)).toBe(true);
    resetIssuerDirectState();
    recordIssuerDirectResult(true);
    expect(recordIssuerDirectResult(false)).toBe(false); // a success before the limit resets the count
    expect(recordIssuerDirectResult(true)).toBe(false);
  });

  test('every request has a timeout that also covers the body, and is retried per MAX_RETRIES', async () => {
    setFetchTuningForTests(60, 1);
    let calls = 0;
    const config = readConfig({ MAX_RETRIES: '2', REQUEST_SLEEP: '0' });
    resetPacing(0);
    // headers never arrive
    globalThis.fetch = ((_url: unknown, init: { signal: AbortSignal }) => { calls += 1; return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))); }) as unknown as typeof fetch;
    await expect(fetchText('https://example.test/a', 'hang', config)).rejects.toThrow(/no complete response within/);
    expect(calls).toBe(3);
    // headers arrive, the body stalls
    calls = 0;
    globalThis.fetch = ((_url: unknown, init: { signal: AbortSignal }) => { calls += 1; return Promise.resolve({ ok: true, status: 200, text: () => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))) }); }) as unknown as typeof fetch;
    await expect(fetchText('https://example.test/b', 'stall', config)).rejects.toThrow(/no complete response within/);
    expect(calls).toBe(3);
    // 404 is final, 403 is retried (the issuer CDN answers it while throttling)
    calls = 0;
    globalThis.fetch = (async () => { calls += 1; return new Response('x', { status: 404 }); }) as typeof fetch;
    await expect(fetchText('https://example.test/c', 'gone', config)).rejects.toThrow(/404/);
    expect(calls).toBe(1);
    calls = 0;
    globalThis.fetch = (async () => { calls += 1; return calls < 3 ? new Response('x', { status: 403 }) : new Response('ok'); }) as typeof fetch;
    expect(await fetchText('https://example.test/d', 'flaky', config)).toBe('ok');
    expect(calls).toBe(3);
  });

  test('HISTORY_RANGE: only max or Ny, and the Yahoo request carries an explicit period1 (no range)', async () => {
    for (const bad of ['1mo', 'ytd', '5d', '0y', 'forever', '5Y5', '-1y']) expect(() => parseHistoryRange(bad)).toThrow('HISTORY_RANGE');
    expect(() => resolveControls({}, {}, {}, { HISTORY_RANGE: 'ytd' })).toThrow('HISTORY_RANGE');
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
    const period1 = Number(url.searchParams.get('period1'));
    const fiveYearsAgo = Date.now() / 1000 - 5 * 365.25 * 86_400;
    expect(Math.abs(period1 - fiveYearsAgo)).toBeLessThan(3 * 86_400);
  });

  test('brand environment aliases keep working through the resolver (GOLDMANSACHS_<NAME>, HISTORICAL_PAGE_SIZE)', () => {
    expect(resolveControls({}, {}, {}, { GOLDMANSACHS_CONCURRENCY: '7' }).CONCURRENCY).toBe('7');
    expect(resolveControls({}, {}, {}, { HISTORICAL_PAGE_SIZE: '123' }).HISTORY_PAGE_SIZE).toBe('123');
    // brand beats plain beats legacy alias; an explicitly empty value still wins over the file
    expect(resolveControls({ CONCURRENCY: 2 }, {}, {}, { GOLDMANSACHS_CONCURRENCY: '7', CONCURRENCY: '5' }).CONCURRENCY).toBe('7');
    expect(resolveControls({}, {}, {}, { HISTORY_PAGE_SIZE: '5', HISTORICAL_PAGE_SIZE: '9' }).HISTORY_PAGE_SIZE).toBe('5');
    expect(resolveControls({ TICKERS: 'GSLC' }, {}, {}, { GOLDMANSACHS_TICKERS: '' }).TICKERS).toBe('');
    expect(() => resolveControls({}, {}, {}, { GOLDMANSACHS_CONCURRENCY: '0' })).toThrow('CONCURRENCY');
    expect(readConfig(resolveControls({}, {}, {}, { GOLDMANSACHS_SKIP_YAHOO: 'true', HISTORICAL_PAGE_SIZE: '50' })).historyPageSize).toBe(50);
  });

  test('controls are strict: bad numbers, tickers and bounds are errors, never silent fallbacks', () => {
    expect(() => readConfig({ CONCURRENCY: 'abc' })).toThrow('CONCURRENCY');
    expect(() => readConfig({ MAX_RETRIES: '0' })).toThrow('MAX_RETRIES');
    expect(() => readConfig({ REQUEST_SLEEP: '-2' })).toThrow('REQUEST_SLEEP');
    expect(() => readConfig({ TICKERS: 'GSLC, not a ticker!' })).toThrow('TICKERS');
    expect(() => readConfig({ AUM: 'huge:' })).toThrow('AUM');
    expect(() => readConfig({ TER: 'x:1' })).toThrow('TER');
  });

  test('a run for an unknown ticker is an error and writes nothing', async () => {
    const world = mockWorld();
    await expect(run({ TICKERS: 'GSLC,NOSUCH' })).rejects.toThrow('NOSUCH');
    expect(existsSync(join(world.api, 'index.json'))).toBe(false);
  });

  test('a fund filtered out after its page was read leaves no files or empty directories', async () => {
    const world = mockWorld();
    const out = await run({ TICKERS: 'GBIL,GSLC', AUM: '1T:' });
    expect(out).toContain('skipped');
    expect(existsSync(join(world.api, 'funds'))).toBe(false);
  });

  test('return filters exclude a fund with no figure for a bounded range', () => {
    const config = readConfig({ TOTAL_RETURN_10Y: '1:', PERFORMANCE_5Y: ':50' });
    const fund = { ter: 0.1, netAssets: 1e9 } as Parameters<typeof postFetchFilterReasons>[0];
    expect(postFetchFilterReasons(fund, { tr10y: null, cagr5y: null }, config)).toEqual(['PERFORMANCE_5Y', 'TOTAL_RETURN_10Y']);
    expect(postFetchFilterReasons(fund, { tr10y: 20, cagr5y: 10 }, config)).toEqual([]);
    expect(postFetchFilterReasons(fund, { tr10y: null, cagr5y: null }, readConfig({}))).toEqual([]);
    expect(postFetchFilterReasons({ ...fund, ter: null } as typeof fund, {}, readConfig({ TER: ':0.5' }))).toEqual(['TER']);
  });

  test('identical upstream data: the second run writes nothing, not even generatedAt', async () => {
    const world = mockWorld();
    await run({ TICKERS: THREE });
    const first = snapshot(world.api);
    expect(Object.keys(first).length).toBeGreaterThanOrEqual(7); // index + meta and history page for each of the three funds
    await new Promise((resolve) => setTimeout(resolve, 1100)); // a stamp that moved would differ
    await run({ TICKERS: THREE });
    expect(snapshot(world.api)).toEqual(first);
    expect(readdirSync(join(world.api, 'funds', 'GSLC')).some((name) => name.includes('.tmp-'))).toBe(false);
  }, 30_000);

  test('whole fund or nothing: when Yahoo fails the fund keeps every published byte; other funds still update; all failed -> exit 1', async () => {
    const good = mockWorld();
    await run({ TICKERS: THREE });
    const before = snapshot(join(good.api, 'funds', 'GSLC'));
    const beforeIndex = readJson(good, 'index.json').funds.find((row: { ticker: string }) => row.ticker === 'GSLC');
    good.restore(); mocks.pop();

    // reuse the same output tree with a Yahoo outage on GSLC only
    const dir = mkdtempSync(join(tmpdir(), 'gs-keep-'));
    mocks.push({ hits: [], peak: 0, restore: () => { globalThis.fetch = realFetch; rmSync(dir, { recursive: true, force: true }); }, dir, api: join(dir, 'api') + '/' });
    mkdirSync(join(dir, 'api', 'funds', 'GSLC'), { recursive: true });
    for (const [path, text] of Object.entries(before)) { mkdirSync(join(dir, 'api', 'funds', 'GSLC', path.split('/').slice(1, -1).join('/')), { recursive: true }); writeFileSync(join(dir, 'api', 'funds', 'GSLC', path.split('/').slice(1).join('/')), text); }
    writeFileSync(join(dir, 'api', 'index.json'), JSON.stringify({ generatedAt: '2026-01-01T00:00:00Z', funds: [beforeIndex] }));
    setApiRootForTests(pathToFileURL(join(dir, 'api') + '/'));
    globalThis.fetch = (async (input: unknown) => {
      const url = String(input);
      if (url.includes('am.gs.com/en-us/individual/funds?')) return new Response(FUND_FINDER_HTML);
      if (url.includes('am.gs.com')) return new Response(FUND_PAGE_HTML.replace('145.45USD', '150.00USD'));
      if (url.includes('yahoo') && url.includes('GSLC')) return new Response('down', { status: 503 });
      if (url.includes('yahoo')) return new Response(chartJson());
      return new Response('unavailable', { status: 503 });
    }) as typeof fetch;
    const out = await run({ TICKERS: 'GSLC,GBIL', MAX_RETRIES: '1' });
    expect(out).toMatch(/GSLC\s+failed/);
    expect(out).toMatch(/GBIL\s+(updated|unchanged)/);
    expect(snapshot(join(dir, 'api', 'funds', 'GSLC'))).toEqual(before);
    expect(process.exitCode ?? 0).toBe(0); // one fund still updated

    const onlyBad = await run({ TICKERS: 'GSLC' });
    expect(onlyBad).toMatch(/GSLC\s+failed/);
    expect(process.exitCode).toBe(1);
    expect(snapshot(join(dir, 'api', 'funds', 'GSLC'))).toEqual(before);
  }, 60_000);

  test('a Yahoo 404 is an honest empty history, not a failed fund', async () => {
    const world = mockWorld({ handler: (url) => (url.includes('yahoo') ? new Response('{"chart":{"result":null}}', { status: 404 }) : undefined) });
    const out = await run({ TICKERS: 'GBIL' });
    expect(out).toMatch(/GBIL\s+updated/);
    expect(readJson(world, 'funds/GBIL/meta.json').history.totalRows).toBe(0);
  });

  test('returns keep one basis: official NAV figures are not mixed with market-price estimates and travel with their date', async () => {
    const world = mockWorld();
    await run({ TICKERS: 'GSLC' });
    const row = readJson(world, 'index.json').funds.find((item: { ticker: string }) => item.ticker === 'GSLC');
    expect(row.metrics).toMatchObject({ ytd: 11.11, tr1y: 16.62, cagr3y: 19.58, cagr5y: 11.38, cagr10y: 14.48, returnsBasis: OFFICIAL_RETURNS_BASIS, performanceAsOf: '2026-08-31' });
    expect(OFFICIAL_RETURNS_BASIS).toContain('never estimated from market prices');
    expect(row.terValue).toBe(0.09);
    expect(row.terGrossValue).toBe(0.09);
    expect(row.dataFile).toBe('./funds/GSLC/meta.json');
  });

  test('dates are zero padded ("Jan 05 2026") and month-name parsing is the same east of UTC', () => {
    const world = mockWorld();
    return run({ TICKERS: 'GBIL' }).then(() => {
      const history = readJson(world, 'funds/GBIL/history/001.json');
      expect(history.rows[0].Date).toMatch(/^[A-Z][a-z]{2} \d{2} \d{4}$/);
      const script = `import { toIsoDate } from ${JSON.stringify(new URL('./update-data.ts', import.meta.url).pathname)}; console.log(toIsoDate('Sep 17 2026'), toIsoDate('September 5 2026'));`;
      for (const tz of ['Pacific/Kiritimati', 'America/Los_Angeles', 'UTC']) {
        const child = Bun.spawnSync([process.execPath, '-e', script], { env: { PATH: process.env.PATH ?? '', TZ: tz } });
        expect(new TextDecoder().decode(child.stdout).trim()).toBe('2026-09-17 2026-09-05');
      }
    });
  });

  test('rows without published data are placeholders: dataFile null, full null metrics and a basis; the metrics contract holds for every row', async () => {
    const world = mockWorld();
    await run({ TICKERS: 'GBIL' });
    const funds = readJson(world, 'index.json').funds;
    expect(funds.length).toBeGreaterThan(40);
    const keys = ['ytd', 'tr1y', 'tr3y', 'tr5y', 'tr10y', 'cagr3y', 'cagr5y', 'cagr10y', 'siAnn', 'dividendYield', 'dividendYieldText', 'secYield', 'secYieldText', 'returnsBasis', 'performanceAsOf'];
    for (const row of funds) {
      expect(Object.keys(row.metrics).slice(0, keys.length)).toEqual(keys);
      expect(row.metrics.returnsBasis.length).toBeGreaterThan(5);
      expect(row.dataFile).toBe(row.ticker === 'GBIL' ? './funds/GBIL/meta.json' : null);
    }
    const aaau = funds.find((row: { ticker: string }) => row.ticker === 'AAAU');
    expect(aaau.metrics).toMatchObject({ ytd: null, tr10y: null, dividendYield: null, secYield: null, returnsBasis: NO_DATA_BASIS, performanceAsOf: null });
    expect(withMetricsContract({ metrics: { 'null': null, ytd: 0 } }).metrics).not.toHaveProperty('null');
    expect(placeholderRow({ ticker: 'X', name: 'X', category: 'ETF', fundPage: '', cusip: '', isin: '' }).dataFile).toBeNull();
  });

  test('NEW FUNDS: catalog tickers missing from the published index are announced on stdout and in the step summary', async () => {
    const world = mockWorld();
    await run({ TICKERS: 'GBIL' });
    const index = readJson(world, 'index.json');
    index.funds = index.funds.filter((row: { ticker: string }) => !['AAAU', 'JUST'].includes(row.ticker));
    writeFileSync(join(world.api, 'index.json'), JSON.stringify(index));
    rmSync(join(world.api, 'funds', 'AAAU'), { recursive: true, force: true });
    const summary = join(world.dir, 'summary.md');
    const out = await run({ TICKERS: 'GBIL', GITHUB_STEP_SUMMARY: summary });
    expect(out).toContain('NEW FUNDS: AAAU, JUST');
    expect(readFileSync(summary, 'utf8')).toContain('NEW FUNDS: AAAU, JUST');
  });

  test('MAX_FETCHES cursor: walks the filtered set, wraps around, and a TICKERS run never touches it', async () => {
    const world = mockWorld();
    const state = () => readJson(world, 'update-state.json').cursor;
    const touched = async (env: Record<string, string>) => (await run({ SKIP_YAHOO: 'true', ...env }), new Set(readdirSync(join(world.api, 'funds'))));
    await touched({ MAX_FETCHES: '2' });
    expect(readdirSync(join(world.api, 'funds')).sort()).toEqual(['AAAU', 'GBIL']);
    expect(state()).toBe('GBIL');
    await run({ SKIP_YAHOO: 'true', MAX_FETCHES: '2' });
    expect(readdirSync(join(world.api, 'funds')).sort()).toEqual(['AAAU', 'GBIL', 'GBND', 'GCAL']);
    expect(state()).toBe('GCAL');
    // a TICKERS run leaves the state file byte for byte alone
    const bytes = readFileSync(join(world.api, 'update-state.json'), 'utf8');
    await run({ SKIP_YAHOO: 'true', TICKERS: 'GSLC' });
    expect(readFileSync(join(world.api, 'update-state.json'), 'utf8')).toBe(bytes);
    // cursor on the last fund wraps to the top
    writeFileSync(join(world.api, 'update-state.json'), JSON.stringify({ cursor: 'JUST' }));
    await run({ SKIP_YAHOO: 'true', MAX_FETCHES: '1' });
    expect(state()).toBe('AAAU');
    // the cursor is scoped to the filter set: a cursor outside it still continues in ticker order
    expect(rotateAfterCursor([{ ticker: 'A' }, { ticker: 'C' }, { ticker: 'E' }], 'B').map((fund) => fund.ticker)).toEqual(['C', 'E', 'A']);
    expect(rotateAfterCursor([{ ticker: 'A' }, { ticker: 'C' }], 'C').map((fund) => fund.ticker)).toEqual(['A', 'C']);
    expect(rotateAfterCursor([{ ticker: 'A' }], '').map((fund) => fund.ticker)).toEqual(['A']);
  }, 60_000);

  test('soft deadline: no new fund is taken, the index is still written, and the next run resumes at the cursor', async () => {
    expect(SOFT_DEADLINE_MS).toBe(25 * 60 * 1000);
    const world = mockWorld();
    const out = await run({ SKIP_YAHOO: 'true' }, { deadlineMs: -1 });
    expect(out).toContain('soft deadline reached');
    expect(readJson(world, 'index.json').funds.length).toBeGreaterThan(40);
    expect(existsSync(join(world.api, 'funds'))).toBe(false);
    expect(process.exitCode ?? 0).toBe(0);
  });

  test('N-PORT fallback: series identity and freshness are verified, an older filing never replaces newer holdings', () => {
    expect(checkNportFiling('S000001', 'S000001', '2026-06-30', '2026-03-31', 'SEC EDGAR Form N-PORT-P').ok).toBe(true);
    expect(checkNportFiling('s000001', 'S000001', '2026-06-30', undefined, undefined).ok).toBe(true);
    expect(checkNportFiling('S000002', 'S000001', '2026-06-30', '', '').ok).toBe(false);
    expect(checkNportFiling('', 'S000001', '2026-06-30', '', '').ok).toBe(false);
    expect(checkNportFiling('S000001', 'S000001', '2026-03-31', '2026-06-30', 'SEC EDGAR Form N-PORT-P').reason).toContain('older than the published holdings');
    // a published top-10 snapshot from OFFLINE_SEED is not "fresher" than a real filing
    expect(checkNportFiling('S000001', 'S000001', '2026-06-30', '2026-09-17', 'offline seed snapshot: official top-10 holdings').ok).toBe(true);
  });

  test('OFFLINE_SEED fills only funds without published data: live meta is never overwritten and the index never shrinks', async () => {
    const world = mockWorld();
    await run({ TICKERS: 'GBIL' });
    const gbil = snapshot(join(world.api, 'funds', 'GBIL'));
    const rows = readJson(world, 'index.json').funds.length;
    const stateBefore = existsSync(join(world.api, 'update-state.json')) ? readFileSync(join(world.api, 'update-state.json'), 'utf8') : null;
    const hitsBefore = world.hits.length;
    const out = await run({ OFFLINE_SEED: 'true', TICKERS: 'GBIL,GSLC' });
    expect(out).toMatch(/GBIL\s+skipped/);
    expect(snapshot(join(world.api, 'funds', 'GBIL'))).toEqual(gbil);
    expect(world.hits.length).toBe(hitsBefore); // no network request
    expect(existsSync(join(world.api, 'funds', 'GSLC', 'meta.json'))).toBe(true); // had no data: seeded
    expect(readJson(world, 'index.json').funds.length).toBeGreaterThanOrEqual(rows);
    const seeded = readJson(world, 'index.json').funds.find((row: { ticker: string }) => row.ticker === 'GSLC');
    expect(seeded.dataFile).toBe('./funds/GSLC/meta.json');
    expect(existsSync(join(world.api, 'update-state.json')) ? readFileSync(join(world.api, 'update-state.json'), 'utf8') : null).toBe(stateBefore);
  });

  test('stale pages are removed only after the new meta.json is written, and no temp files are left', async () => {
    const world = mockWorld();
    await run({ TICKERS: 'GBIL', HISTORY_PAGE_SIZE: '100' });
    const pages = readdirSync(join(world.api, 'funds', 'GBIL', 'history'));
    expect(pages.length).toBe(4);
    await run({ TICKERS: 'GBIL', HISTORY_PAGE_SIZE: '1000' });
    expect(readdirSync(join(world.api, 'funds', 'GBIL', 'history'))).toEqual(['001.json']);
    expect(readJson(world, 'funds/GBIL/meta.json').history.pages).toEqual(['history/001.json']);
    expect(statSync(join(world.api, 'index.json')).size).toBeGreaterThan(0);
  });
});
