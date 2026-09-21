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
 * detail pages on every run — see `scripts/goldmansachs-verified.ts` for the
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
