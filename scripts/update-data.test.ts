// Bun's test runner provides these globals at runtime.
// @ts-ignore the repository intentionally keeps runtime dependencies at zero.
import { describe, expect, test } from 'bun:test';
import {
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
  stripProxyPreamble,
  toIsoDate,
  toTextLines,
} from './update-data';
import { GOLDMAN_SACHS_FUNDS } from './goldmansachs-funds';
import {
  DISTRIBUTION_SNAPSHOTS,
  FINDER_SNAPSHOTS,
  FUND_PAGE_SNAPSHOTS,
  TOP_HOLDINGS_SNAPSHOTS,
} from './goldmansachs-verified';

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

  test('parseGsDistributions and parseGsTopHoldings handle absent sections', () => {
    expect(parseGsDistributions(toTextLines('## Performance\n\nNo distributions'))).toEqual([]);
    expect(parseGsTopHoldings(toTextLines('## Performance\n\nNo allocations'))).toBeNull();
  });

  test('mergeOfficialReturns prefers official values but keeps the derived QTD', () => {
    const derived = { asOfDate: '2026-09-18', mo1: 1, qtd: 2, ytd: 3, yr1: 4, cagr3y: 5, cagr5y: 6, cagr10y: 7, siAnn: 8 };
    const merged = mergeOfficialReturns(derived, { asOfDate: '2026-08-31', mo1: 0.31, mo3: 0.89, ytd: 2.3, yr1: 3.7, cagr3y: 4.52, cagr5y: null, cagr10y: null, siAnn: 2.31 });
    expect(merged).toEqual({ asOfDate: '2026-08-31', mo1: 0.31, qtd: 2, ytd: 2.3, yr1: 3.7, cagr3y: 4.52, cagr5y: 6, cagr10y: 7, siAnn: 2.31 });
    expect(mergeOfficialReturns(derived, null)).toBe(derived);
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
    expect(frequencyCodeLabel('—')).toBe('00 - —');
    expect(frequencyCodeLabel('')).toBe('00 - —');
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
