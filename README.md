# Goldman Sachs

One of the app's features lets you select Goldman Sachs ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size.  Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A client-side tool that reads the generated `./api/goldmansachs` static feed (Goldman Sachs Asset Management fund finder and per-fund data from the am.gs.com fund data API, including the daily full holdings list, Yahoo Finance daily history, SEC EDGAR N-PORT-P as full-holdings fallback) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export - the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/Goldman-Sachs#main ./12345 && cd $_
bun install
bun run serve
open http://localhost:1234
```

The published application is available at <https://daggerok.github.io/Goldman-Sachs/>.

### Column types and filters

Every column of the ETF catalog and of the Watchlist, Holdings, History and Distributions tabs has a type: text (`ABC`), number (`123`), percentage (`%`), money (`$`), date (`D`), date and time (`DT`) or time of day (`T`). The type is detected from the texts the column shows (80% of the filled cells must agree, otherwise text) and is written in the badge next to the column title: click it to cycle the type, Shift+click to return to auto-detection. Dates are read as `2024-06-15`, `6/15/2024`, `15.06.2024`, `Jun 15, 2024` or `15-Jun-2024`, date and time as `2024-06-15T09:30:00Z` or `2024-06-15 09:30`, time as `09:30`, `16:00:00` or `9:30 PM`

A row of filter inputs sits under the column headers (the `Filters` button hides it, `Clear filters` empties it). Filters of different columns are combined with AND, the search box applies on top, and Copy Tickers and the exports use the filtered rows. Filters and type overrides are remembered in the browser. `Sticky #` (next to `Filters`, off by default, remembered in the browser) numbers the rows by their rank in the table sorted by the current column before the column filters, so a filtered fund keeps its rank and the numbers keep gaps; the sort, the search and the category and blacklist choices rank again. The catalog starts sorted by Net Assets, largest first, unavailable values sort last in both directions, and every export starts with the `#` column. The red `Clear` button opens a dialog that lists what can be reset (the selection, searches, sort order, open tab, shown columns, column filters, remembered table views and the blacklist), all ticked the first time and afterwards as they were left at the last OK; `Enter` confirms, `Esc` or a click outside cancels, the theme is always kept, so the page looks like a first visit (also after a reload)

Inside one filter: a space means AND, a comma means OR, a leading `!` means NOT, `?` matches an empty or unavailable value and `!?` a value that is there; a value that is unavailable matches only `?` and negated conditions. An unquoted space ends the value, so quote values that contain one (`>="2024-06-15 09:30"`)

| Type | Examples |
| --- | --- |
| Text | `bank` contains, `"two words"`, `!bank`, `=exact`, `^starts`, `ends$`, `/regex/`, `tech, health` |
| Number, percentage, money | `>10`, `>=10 <50`, `=22` (matches what rounds to 22), `!=22`, `10..50`, `..50`, `10..`, `>1B` and `K` `M` `B` `T` suffixes, an optional `$` or `%` |
| Date, date and time | `>2024-06-01`, `2024` (the whole year), `2024-06` (the whole month), `2024-01..2024-06`, `today`, `yesterday`, `-7d..` (the last 7 days), `+2w`, `-3m`, `-1y` |
| Time | `>09:30`, `09:30..16:00`, `=12:00` (the whole minute) |

The `Columns` menu next to `Filters` lists every column of the ETF table from the first to the last, all of them shown by default, with a search box and the `All`, `Clear`, `Toggle` and `Reset` buttons. `Use` and `Ticker` are listed but locked. Hiding a column only removes it from the table: the filters, the sorting, the exports and Copy Tickers still use it. The choice is remembered in the browser (localStorage, never the data) and the menu is shown on the ETF catalog only

The asset classes are one `Asset classes` multi-select next to the `All ETFs` pill instead of one tab per class: every class is selected by default (= all ETFs), `Only` or unchecking narrows the table, and the `All ETFs` pill is lit only while nothing narrows it (all or none of the classes checked); clicking the pill clears the selection. The choice is remembered in the browser (localStorage, never the data)

## Updating the static Goldman Sachs data

```bash
bun scripts/update-data.ts
```

Every supported control has a default in `scripts/update-data.config.json`, so a plain run and the scheduled workflow use exactly the same settings. Run `bun scripts/update-data.ts --help` to print every control with its default and examples

Precedence, lowest to highest: file defaults < `advanced` JSON < nonblank workflow inputs < protected Actions variable/environment. The **Update Goldman Sachs ETF data** workflow runs weekly (Sunday 00:00 UTC) and on manual dispatch. It exposes 24 controls as individual inputs plus an `advanced` JSON object that can set any other control (for example `{"SEC_UA": "...", "VERBOSE": true}`); the CLI and the workflow resolve controls through the same exported `resolveControls`. The workflow only writes `api/goldmansachs`

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all US Goldman Sachs ETFs) | `https://am.gs.com/services/funds` (public GraphQL fund data API, POST), the same `fundShareClasses` query with the ETF filter that the client-rendered fund finder `https://am.gs.com/en-us/individual/funds?...&filters=funds%7CETF` sends; the rendered finder through the read-only r.jina.ai proxy as the fallback |
| Facts, returns, distributions, top 10 per fund | the same API, `fundsDetail` by PV id and CUSIP of the fund page `https://am.gs.com/en-us/individual/funds/detail/{PV}/{CUSIP}/{slug}` (e.g. [GSLC](https://am.gs.com/en-us/individual/funds/detail/PV102394/381430503/goldman-sachs-active-beta-u-s-large-cap-equity-etf)); the answer must name the requested ticker. The rendered page through the proxy as the fallback |
| Full holdings per fund | the same `fundsDetail` answer: `allHoldings`, the fund page's daily All Holdings table (every position with its weight, market value, shares or par, CUSIP, ISIN, SEDOL, coupon and maturity) |
| Daily history, distributions | Yahoo Finance public chart API (`/v8/finance/chart/{TICKER}?period1=...&period2=...&interval=1d&events=div`; `period1=0` for `max`, an explicit start for `HISTORY_RANGE=Ny`) |
| Holdings fallback | SEC EDGAR N-PORT-P for full holdings, only when the API list is missing (`EDGAR_FALLBACK`) and strictly newer than the published holdings |

### Metrics and caveats

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` - official YTD and 1-year returns -> *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` - published annualized 3Y/5Y/10Y figures -> *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` - cumulative 3Y/5Y/10Y figures `(1 + CAGR)^n - 1` -> *TR 3Y/5Y/10Y*
- `siAnn` - since-inception annualized -> *SI Ann.*
- `dividendYield` - 12-month trailing yield or indicated yield (latest distribution x frequency / price)
- `dividendYieldBasis` - short code for the definition behind `dividendYield`, `null` exactly when `dividendYield` is `null`; it is kept together with the yield it describes (also when a partial page keeps the published yields):

  | Code | Meaning for Goldman Sachs |
  | --- | --- |
  | `official-trailing-12m` | the fund page's 12 Month Trailing Distribution Rate (fresh, kept after a partial page, or carried with `SKIP_GOLDMANSACHS`) |
  | `indicated` | the updater's estimate: latest distribution x inferred payments per year / NAV or price (used only when the page publishes no rate) |
  | `official-distribution-rate`, `official-other`, `computed-trailing-12m` | part of the shared vocabulary, not produced for this brand |

- `secYield` - 30-day SEC yield when published; `-` otherwise
- `returnsBasis` - always a non-empty label of how the returns were computed: official Goldman Sachs fund-page NAV returns (one basis per row: a period the page does not publish stays `null` and is never estimated from market prices), or an estimate derived entirely from Yahoo Finance adjusted market-price closes (only when the page publishes no return table)
- `terValue` / `terGrossValue` (index row) - NET expense ratio (after waivers) and GROSS expense ratio from the fund page; `null` when the page does not publish it
- `performanceAsOf` - ISO `YYYY-MM-DD` date the returns are as of: the date of the fund-page performance table, or the last Yahoo close date when derived; not the NAV date, `null` only when truly unknown

Caveats:

- Returns are the official NAV figures printed on the fund pages; daily history is Yahoo Finance adjusted market-price closes, not official NAV. `returns.monthEnd.qtd` is always estimated from Yahoo market prices (the page publishes 3-month, not quarter-to-date) and is not part of `metrics`
- Cumulative 3Y/5Y/10Y returns are derived from the published annualized figures, not published values
- Unavailable values stay unavailable and are never filled with `0`. A `dividendYield` of `0` (AAAU, a gold trust that pays nothing, and GIND, GSGO, GTEK, GTOP) is the 12 Month Trailing Distribution Rate the issuer itself prints. A negative `secYield` (GTIP -2.33, confirmed against the live fund page; also GIND, GTEK, GTOP, GVIP) is the Standardized 30-Day Subsidized Yield parsed from the fund page
- `AUM`, `TER`, `DIVIDEND_YIELD`, `SEC_YIELD`, `PERFORMANCE_*` and `TOTAL_RETURN_*` filters drop funds without a value for a bounded range (data-dependent filters are judged after the fund page was read, so such a fund still counts toward `MAX_FETCHES`)
- All supplied filters use AND logic, `TICKERS` included; funds not selected for a successful update keep their prior published metadata and data files. A fund excluded by a data-dependent filter writes nothing and creates no directory
- Filtered or bounded runs (`TICKERS`, `MAX_FETCHES`, filters, `SKIP_GOLDMANSACHS`) and runs where the live catalog cannot be read never shrink the feed: `index.json` always lists every known fund (the published index plus every `funds/*/meta.json`), and only the selected funds are refreshed
- Every fund is published whole or kept whole: it is computed in memory and written once (pages, then `meta.json`, then stale pages are removed, then the index row at the end of the run; every file is written through a temp file and renamed). When a required source fails (the fund page, or Yahoo with anything other than HTTP 404 / no chart) the fund keeps every previously published file and is reported as `failed`; the run exits non-zero only when every selected fund failed. Holdings are the exception by design: they carry their own `asOfDate`, so a missing holdings list, an older API list or an older N-PORT filing keeps the published holdings
- A fund page counts as fully loaded only when it has both the pricing table (Market Price / Premium Discount / Bid/Ask labels) and the performance tables (a Cumulative or Annualized Returns heading or table). The rendering proxy sometimes returns a partial page: every section that was published as official before (pricing table, yields, month-end returns with their dates, basis and `performanceAsOf`, distributions, top 10) and is missing from such a page counts as a failed read of that section. The previous official block is kept as one unit per section, never replaced by Yahoo-derived values or `null`, and one `[ kept ]` line per fund names the sections kept. A fully loaded page that lacks a field is an honest absence and publishes `null`
- A rerun with identical upstream data changes nothing (`generatedAt` and the cursor stamp move only when content moved), so the workflow commits nothing
- A catalog fund without published data gets an index row with `dataFile: null` and a full all-`null` `metrics` object (`returnsBasis` says no data was published yet). `NEW FUNDS: A, B` (run output and `$GITHUB_STEP_SUMMARY`) names a fund when it is published for the first time, also when its first read failed and a later run succeeds; `NEW FUNDS (not published yet): ...` names new catalog funds that have no data yet. A catalog-only row that neither the live finder nor the seed lists any more (for example an old mistyped `TICKERS` entry) is dropped
- The run stops taking new funds after 25 minutes and still writes the index (the workflow limit is 30 minutes); the next run resumes after the cursor
- Holdings are the fund page's daily All Holdings list from the fund data API, as of its own date (`holdings.asOfDate`). `Weight` is the issuer's portfolio percentage (two decimals, so small positions show `0`), `Market Value` is in USD and `Shares Held` is shares or par. A bond's API ticker is its issuer's equity ticker, so positions with a coupon or a maturity get `-` and are keyed by their CUSIP; the API ticker of a foreign line is its local code (MRK is Merck KGaA on Xetra next to Merck & Co.), so a ticker is published only for a U.S. listing - a U.S. or Puerto Rico ISIN (ADRs included), a U.S. CUSIP, or a foreign ISIN whose company SEC lists under that same ticker (Accenture, Linde, Eaton) - and other lines, futures, contra lines and currency cash get `-` and are keyed by their ISIN or code (when SEC's company table cannot be read, the published holdings are kept); the API publishes no asset category, so that column stays empty. Rows keep the issuer's order, including a repeated futures line the issuer itself lists
- `publishedTotalHoldings` is the page's Quick Stats Number of Holdings. It is not the row count of the list (on 2026-10-15: GSLC 427 vs 429 rows, GBIL 42 vs 43, GBND 716 vs 735), so funds whose page prints no count (several bond funds, e.g. GCOR) publish `null`
- SEC EDGAR N-PORT-P is a fallback only: a filing is used when the API answer has no holdings list, it names the fund's own series and its report period is strictly newer than the published holdings (the newest report period first, read as primary_doc.xml from the trust's own EDGAR folder; with daily holdings published, a months-old filing never replaces them). N-PORT identifiers are the position's own (a derivative never takes its reference security's CUSIP or ticker), a ticker is set only for a U.S. equity traded in USD and never on two different securities, and a missing weight or value stays empty. The fund-page top 10 is kept as summary data
- Dates are zero padded (`Jun 04 2026`); month-name and U.S. dates are read as plain calendar text, never through the local time zone, so local runs match CI
- A fund younger than one year (calendar anniversary of its inception, inclusive) publishes no 1-year or since-inception return, and no 3, 5 or 10-year one before those anniversaries, official or derived
- Distributions come from the fund page table, with Yahoo dividend events as the fallback

### Update controls

Defaults below are the values in `scripts/update-data.config.json`. Environment variables of the same name override them, and an explicitly set empty variable clears the control

| Control | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` | Batch size: with a positive value the updater continues after the committed cursor in `api/goldmansachs/update-state.json` (funds that pass `TICKERS` and the catalog-level filters, in ticker order, wrapping around); `0` is a full pass. A `TICKERS` run never reads or changes the cursor; an interrupted full pass resumes after its cursor |
| `REQUEST_SLEEP` | `2` | Minimum delay in seconds between request starts of one worker, retries included (each of the `CONCURRENCY` workers has its own lane). Only the rate-limited r.jina.ai rendering proxy keeps one global gate of 3.2s or slower and at most one retry |
| `CONCURRENCY` | `2` | Number of parallel fund update workers; each worker spaces its own requests by `REQUEST_SLEEP`, so throughput scales with the worker count |
| `AUM` | `:` | Net Assets range; each bound may be a USD amount or `K`/`M`/`B`/`T`, or one of the presets `nano`, `micro`, `small`, `mid`, `large` |
| `TER` | `:` | Expense ratio range in % (strict `min:max`) |
| `DIVIDEND_YIELD` | `:` | Dividend-yield percentage range |
| `SEC_YIELD` | `:` | Published 30-day SEC yield percentage range |
| `TICKERS` | empty (all) | Space-, comma- or semicolon-separated ticker allowlist, e.g. `GSLC GBIL AAAU GPIX GPIQ`; a token that is not a ticker, or a ticker that is neither in the live catalog (finder plus seed) nor a published fund, is an error before any fund request (nothing is written) |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated daily-history JSON page |
| `HISTORY_RANGE` | `max` | History window: `max` or `Ny` (the last N years, for example `5y`). It becomes an explicit Yahoo `period1`/`period2`, so the request and the stored history really shrink (`1mo`, `ytd` and other Yahoo ranges are rejected); a window keeps the older published history (rescaled by the overlapping days), and a window that does not join it keeps the fund as published |
| `STORE_RAW_DOWNLOADS` | `false` | Store the official fund finder and fund pages under `api/goldmansachs/raw` |
| `MAX_RETRIES` | `2` | Retries after the initial request (integer >= 1); network errors, timeouts and HTTP 403/408/425/429/5xx are retried with exponential backoff. Every attempt has a 45 s timeout that also covers reading the body |
| `SEC_UA` | `daggerok ETF feed daggerok@gmail.com` | SEC User-Agent; SEC policy requires automated tools to declare a contact. The workflow takes it from the protected `SEC_UA` Actions variable when that is set |
| `EDGAR_FALLBACK` | `true` | Use SEC EDGAR Form N-PORT-P for full holdings when the fund data API list is missing (only when strictly newer than the published holdings); `false` disables it |
| `SKIP_YAHOO` | `false` | Keep previous history and distributions, skip Yahoo Finance |
| `SKIP_GOLDMANSACHS` | `false` | Skip the Goldman Sachs fund finder and detail pages (SEC EDGAR + Yahoo Finance only) |
| `VERBOSE` | `false` | Print per-fund retry and fallback notices |
| `USE_SYSTEM_CA` | `auto` | TLS trust store: `auto` restarts the updater once with Bun's `--use-system-ca` when a request fails with an untrusted-certificate error; `true` always uses the system CA store; `false` never restarts. Not an individual workflow input: use `advanced`, the config file or the CLI environment. |
| `PERFORMANCE_YTD` / `_1Y` / `_3Y` / `_5Y` / `_10Y` | `:` | Annualized return range `min:max` per tenor (official NAV return where published) |
| `TOTAL_RETURN_YTD` / `_1Y` / `_3Y` / `_5Y` / `_10Y` | `:` | Cumulative return range `min:max` per tenor |

Environment aliases keep working through the same resolver: `GOLDMANSACHS_<CONTROL>` (for example `GOLDMANSACHS_CONCURRENCY`) beats `<CONTROL>`, and `HISTORICAL_PAGE_SIZE` is the legacy name of `HISTORY_PAGE_SIZE`. Invalid values (non-integer counts, bad ranges, unknown tickers, `HISTORY_RANGE` other than `max` or `Ny`) are errors, never silent fallbacks

Workflow inputs mirror the lowercase control names, except `STORE_RAW_DOWNLOADS`, `SEC_UA`, `EDGAR_FALLBACK`, `VERBOSE` and `USE_SYSTEM_CA`, which are reachable through `advanced`

### Examples

```bash
MAX_FETCHES=10 bun scripts/update-data.ts
TICKERS="GSLC GBIL AAAU GPIX GPIQ" bun scripts/update-data.ts
AUM="1B:" TER=":0.5" bun scripts/update-data.ts
PERFORMANCE_1Y="15:" bun scripts/update-data.ts
```

## TypeScript and verification

The browser app is built with Parcel and Tailwind CSS v4: `src/index.html` carries the markup, `src/index.css` the styles and `src/main.tsx` is the TypeScript source, so no `tsconfig.json` is needed. `bun run serve` starts the Parcel dev server (it copies `api/` to `dist/api`), `bun run build` writes the site to `dist/`, and `bun run build-github-pages` does the same with the `/Goldman-Sachs/` public URL used by `.github/workflows/github-pages.yml`. Bun runs the updater TypeScript out of the box.

Verification before every publish:

```bash
bun install --frozen-lockfile
bun test
bun build --target=bun scripts/update-data.ts --outfile=/dev/null
git diff --check
```

`bun test` also checks that the config file, `CONTROL_NAMES`, `--help`, this controls table and the workflow inputs stay in sync

## Brands table

| Brand | Where to get the data |
| --- | --- |
| **AAM** | [aamlive.com](https://www.aamlive.com/ETF) \| [AAM](https://daggerok.github.io/AAM/) |
| **abrdn (Aberdeen)** | [aberdeeninvestments.com](https://www.aberdeeninvestments.com/en-us/investor/funds/etfs) \| [aberdeen](https://daggerok.github.io/aberdeen/) |
| **Amplify** | [amplifyetfs.com](https://amplifyetfs.com/) \| [Amplify](https://daggerok.github.io/Amplify/) |
| **ARK Invest** | [ark-funds.com](https://www.ark-funds.com/our-etfs/) \| [ARK](https://daggerok.github.io/ARK/) |
| **Capital Group** | [capitalgroup.com](https://www.capitalgroup.com/advisor/investments/exchange-traded-funds.html) \| [Capital-Group](https://daggerok.github.io/Capital-Group/) |
| **Fidelity** | [fidelity.com](https://www.fidelity.com/etfs) \| [Fidelity](https://daggerok.github.io/Fidelity/) |
| **First Trust** | [ftportfolios.com](https://www.ftportfolios.com/Retail/etf/etflist.aspx) \| [First-Trust](https://daggerok.github.io/First-Trust/) |
| **Franklin Templeton** | [franklintempleton.com](https://www.franklintempleton.com/investments/options/exchange-traded-funds) \| [Franklin](https://daggerok.github.io/Franklin/) |
| **Global X** | [globalxetfs.com/explore](https://www.globalxetfs.com/explore) \| [Global-X](https://daggerok.github.io/Global-X/) |
| **Goldman Sachs** | [am.gs.com](https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100) \| [Goldman-Sachs](https://daggerok.github.io/Goldman-Sachs/) |
| **Invesco** | [invesco.com](https://www.invesco.com/us/en/financial-products/etfs.html) \| [Invesco](https://daggerok.github.io/Invesco/) |
| **iShares** | [ishares.com](https://www.ishares.com/) \| [iShares](https://daggerok.github.io/iShares/) |
| **JPMorgan** | [am.jpmorgan.com](https://am.jpmorgan.com/us/en/asset-management/adv/products/fund-explorer/etf) \| [JPMorgan](https://daggerok.github.io/JPMorgan/) |
| **NEOS** | [neosfunds.com](https://neosfunds.com/#explore-etfs) \| [Neos](https://daggerok.github.io/Neos/) |
| **Northern Trust** | [etfs.ntam.northerntrust.com](https://etfs.ntam.northerntrust.com/us/en/individual/funds) \| [Northern-Trust](https://daggerok.github.io/Northern-Trust/) |
| **Pacer ETFs** | [paceretfs.com](https://www.paceretfs.com/products/) \| [Pacer](https://daggerok.github.io/Pacer/) |
| **Parametric** | [eatonvance.com](https://www.eatonvance.com/products/etfs.html) \| [Parametric](https://daggerok.github.io/Parametric/) |
| **ProShares** | [proshares.com](https://www.proshares.com/our-etfs/find-proshares-etfs) \| [ProShares](https://daggerok.github.io/ProShares/) |
| **Schwab** | [schwabassetmanagement.com](https://www.schwabassetmanagement.com/products) \| [Schwab](https://daggerok.github.io/Schwab/) |
| **SP Funds** | [sp-funds.com](https://www.sp-funds.com/) \| [SP-Funds](https://daggerok.github.io/SP-Funds/) |
| **SPDR** | [ssga.com](https://www.ssga.com/us/en/intermediary/etfs/fund-finder) \| [SPDR](https://daggerok.github.io/SPDR/) |
| **Sprott ETFs** | [sprottetfs.com](https://sprottetfs.com/) \| [Sprott](https://daggerok.github.io/Sprott/) |
| **Tema ETFs** | [temaetfs.com](https://temaetfs.com/funds) \| [Tema](https://daggerok.github.io/Tema/) |
| **Themes ETFs** | [themesetfs.com/etfs](https://themesetfs.com/etfs) \| [Themes](https://daggerok.github.io/Themes/) |
| **VanEck** | [vaneck.com](https://www.vaneck.com/us/en/etf-mutual-fund-finder/) \| [VanEck](https://daggerok.github.io/VanEck/) |
| **Vanguard** | [investor.vanguard.com](https://investor.vanguard.com/etf/list) \| [Vanguard](https://daggerok.github.io/Vanguard/) |
| **VictoryShares** | [vcm.com VictoryShares ETFs](https://www.vcm.com/products/victoryshares-etfs/victoryshares-etfs-list) \| [VictoryShares](https://daggerok.github.io/VictoryShares/) |
| **WisdomTree** | [wisdomtree.com](https://www.wisdomtree.com/investments) \| [WisdomTree](https://daggerok.github.io/WisdomTree/) |
| **Xtrackers** | [etf.dws.com](https://etf.dws.com/en-us/etf-products/) \| [Xtrackers](https://daggerok.github.io/Xtrackers/) |

## Sibling applications

| Application | Data provider | Repository |
| --- | --- | --- |
| AAM | Official AAM catalog/detail HTML + full holdings XLS + SEC N-PORT holdings fallback + Yahoo market history/dividends | [AAM](https://github.com/daggerok/AAM) |
| abrdn (Aberdeen) | Official Aberdeen gateway + SEC N-PORT holdings fallback + Yahoo history/dividends | [aberdeen](https://github.com/daggerok/aberdeen) |
| Amplify | Amplify ETFs Firestore data feed + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Amplify](https://github.com/daggerok/Amplify) |
| ARK Invest | ark-funds.com fund pages + overview/NAV-history/performance JSON + official daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance distributions/history fallback | [ARK](https://github.com/daggerok/ARK) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global-X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund data API (catalog, fund details, daily full holdings) + SEC EDGAR N-PORT-P holdings fallback | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com fund pages and sitemap + official Invesco fund API (monthly returns, NAV, AUM, yields, daily holdings, expense ratio) + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [Invesco](https://github.com/daggerok/Invesco) |
| iShares | iShares (BlackRock) product workbooks | [iShares](https://github.com/daggerok/iShares) |
| JPMorgan | am.jpmorgan.com fund explorer + product-data JSON | [JPMorgan](https://github.com/daggerok/JPMorgan) |
| NEOS | neosfunds.com lineup table + official fund pages + daily holdings CSV | [Neos](https://github.com/daggerok/Neos) |
| Northern Trust | etfs.ntam.northerntrust.com funds list + per-fund CSV/JSON downloads | [Northern-Trust](https://github.com/daggerok/Northern-Trust) |
| Pacer ETFs | paceretfs.com product catalog and fund pages (Cloudflare WAF; r.jina.ai proxy fallback) + SEC EDGAR N-PORT-P (Pacer Funds Trust) + Yahoo Finance history/dividends | [Pacer](https://github.com/daggerok/Pacer) |
| Parametric | eatonvance.com ETF catalog and Parametric product pages + SEC EDGAR N-PORT-P holdings + Yahoo Finance history/dividends | [Parametric](https://github.com/daggerok/Parametric) |
| ProShares | proshares.com ETF finder + fund pages + official data host | [ProShares](https://github.com/daggerok/ProShares) |
| Schwab | schwabassetmanagement.com product pages + CSV exports | [Schwab](https://github.com/daggerok/Schwab) |
| SP Funds | sp-funds.com homepage catalog, fund pages and daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history/dividends | [SP-Funds](https://github.com/daggerok/SP-Funds) |
| SPDR | SSGA / State Street public feeds | [SPDR](https://github.com/daggerok/SPDR) |
| Sprott ETFs | sprottetfs.com fund pages + SEC EDGAR N-PORT-P (Sprott Funds Trust) + Yahoo Finance history/dividends | [Sprott](https://github.com/daggerok/Sprott) |
| Tema ETFs | Tema official fund pages + dated daily holdings CSV; SEC EDGAR N-PORT-P holdings fallback only + Yahoo Finance price/history/dividend fallback | [Tema](https://github.com/daggerok/Tema) |
| Themes ETFs | themesetfs.com catalog + daily holdings CSV + Yahoo Finance history/dividends + SEC N-PORT-P holdings fallback | [Themes](https://github.com/daggerok/Themes) |
| VanEck | vaneck.com ETF finder + product pages | [VanEck](https://github.com/daggerok/VanEck) |
| Vanguard | Vanguard product pages + SEC EDGAR N-PORT-P | [Vanguard](https://github.com/daggerok/Vanguard) |
| VictoryShares | VCM VictoryShares catalog and product JSON + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance adjusted-market-price history | [VictoryShares](https://github.com/daggerok/VictoryShares) |
| WisdomTree | WisdomTree product table + SEC EDGAR N-PORT-P + Yahoo Finance | [WisdomTree](https://github.com/daggerok/WisdomTree) |
| Xtrackers | Official DWS catalog/US sitemap + PDP/XLSX + SEC N-PORT-P holdings fallback + Yahoo Finance daily prices/history/dividends | [Xtrackers](https://github.com/daggerok/Xtrackers) |

## License

[MIT - same as all sibling ETF repositories.](./LICENSE)

Goldman Sachs® and the fund names/tickers referenced here are trademarks of Goldman Sachs & Co. LLC. This is an independent, unofficial tool; it is not affiliated with, endorsed by, or sponsored by Goldman Sachs or Goldman Sachs Asset Management. All data is reproduced from Goldman Sachs Asset Management's own public fund pages, public SEC EDGAR filings and Yahoo Finance for research purposes. All other trademarks, including index names, are the property of their respective owners.
