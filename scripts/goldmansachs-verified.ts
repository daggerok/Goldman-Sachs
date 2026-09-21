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
