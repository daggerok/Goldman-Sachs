# Goldman Sachs

One of the app's features lets you select Goldman Sachs ETFs in the Watchlist and aggregate their holdings to see how often each ticker appears across the selected funds. Repeated holdings make overlapping exposure visible: the more selected funds include a ticker, the greater its potential influence on the portfolio; gains in that holding may help, while declines may hurt, and actual impact also depends on each fund's position size.  Another feature makes it faster and easier to find funds with stronger growth over different periods, higher dividend yields or distributions, greater Total Return (price performance plus dividends), and other key performance metrics. A single-file client-side tool that reads the generated `./api/goldmansachs` static feed (Goldman Sachs Asset Management fund finder, per-fund detail pages, Yahoo Finance daily history, SEC EDGAR N-PORT-P as full-holdings fallback) into a searchable ETF/asset-class catalog with per-fund tabs, watchlist aggregation, ticker copy and CSV/TXT export - the same look, feel, columns and business logic as the sibling applications.

## Using Bun

```bash
bunx degit daggerok/Goldman-Sachs#main ./12345 && cd $_
bunx serve . -p 1234
open http://0:1234
```

The published application is available at <https://daggerok.github.io/Goldman-Sachs/>.

## Updating the static Goldman Sachs data

```bash
bun scripts/update-data.ts
```

Every supported control has a default in `scripts/update-data.config.json`, so a plain run and the scheduled workflow use exactly the same settings. Run `bun scripts/update-data.ts --help` to print every control with its default and examples

Precedence, lowest to highest: file defaults < `advanced` JSON < nonblank workflow inputs < protected Actions variable/environment. The **Update Goldman Sachs ETF data** workflow runs weekly (Sunday 00:00 UTC) and on manual dispatch. It exposes 24 controls as individual inputs plus an `advanced` JSON object that can set any other control (for example `{"SEC_UA": "...", "VERBOSE": true}`); the CLI and the workflow resolve controls through the same exported `resolveControls`. The workflow only writes `api/goldmansachs`

### Data sources

| Block | Source |
| --- | --- |
| Catalog (all US Goldman Sachs ETFs) | `https://am.gs.com/en-us/individual/funds?locale=en-us&audience=individual&sf=funds&filters=funds%7CETF&limit=100` (Goldman Sachs fund finder page) |
| Facts, returns, distributions, top 10 per fund | `https://am.gs.com/en-us/individual/funds/detail/{PV}/{CUSIP}/{slug}` -> fund detail pages (e.g. [GSLC](https://am.gs.com/en-us/individual/funds/detail/PV102394/381430503/goldman-sachs-active-beta-u-s-large-cap-equity-etf)) |
| Daily history, distributions | Yahoo Finance public chart API (`/v8/finance/chart/{TICKER}?range=max&interval=1d&events=div`) |
| Fallback | SEC EDGAR N-PORT-P for full holdings (the detail pages only print the top 10) |

### Metrics and caveats

Each fund carries a derived `metrics` object that powers the catalog columns shared with the sibling sites:

- `ytd` / `tr1y` - official YTD and 1-year returns -> *YTD Return*, *TR 1Y*
- `cagr3y` / `cagr5y` / `cagr10y` - published annualized 3Y/5Y/10Y figures -> *CAGR 3Y/5Y/10Y*
- `tr3y` / `tr5y` / `tr10y` - cumulative 3Y/5Y/10Y figures `(1 + CAGR)^n - 1` -> *TR 3Y/5Y/10Y*
- `siAnn` - since-inception annualized -> *SI Ann.*
- `dividendYield` - 12-month trailing yield or indicated yield (latest distribution x frequency / price)
- `secYield` - 30-day SEC yield when published; `-` otherwise

Caveats:

- Returns are the official figures printed on the fund pages; daily history is Yahoo Finance adjusted market-price closes, not official NAV
- Cumulative 3Y/5Y/10Y returns are derived from the published annualized figures, not published values
- Unavailable values stay unavailable and are never filled with `0`
- `AUM`, `TER`, `DIVIDEND_YIELD` and `SEC_YIELD` filters drop funds without a value; `PERFORMANCE_*` and `TOTAL_RETURN_*` filters only drop funds that have a value outside the range
- All supplied filters use AND logic, `TICKERS` included; funds not selected for a successful update keep their prior published metadata and data files
- Holdings come from SEC EDGAR N-PORT-P because the fund pages only print the top 10; the fund-page top 10 is kept as summary data only
- Distributions come from the fund page table, with Yahoo dividend events as the fallback
- `OFFLINE_SEED` builds the feed from the committed seed and verified snapshot in `data/` without network access, so it is not a live refresh

### Update controls

Defaults below are the values in `scripts/update-data.config.json`. Environment variables of the same name override them, and an explicitly set empty variable clears the control

| Control | Default | Meaning |
| --- | --: | --- |
| `MAX_FETCHES` | `0` | Batch size: with a positive value the updater continues after the committed cursor in `api/goldmansachs/update-state.json`; `0` is a full pass over every fund |
| `REQUEST_SLEEP` | `2` | Minimum delay in seconds between outgoing request starts, including retries (rendering-proxy requests are paced at 3.2s or slower) |
| `CONCURRENCY` | `2` | Number of parallel fund update workers; request starts are still globally spaced by `REQUEST_SLEEP` |
| `AUM` | `:` | Net Assets range; each bound may be a USD amount or `K`/`M`/`B`/`T`, or one of the presets `nano`, `micro`, `small`, `mid`, `large` |
| `TER` | `:` | Expense ratio range in % (strict `min:max`) |
| `DIVIDEND_YIELD` | `:` | Dividend-yield percentage range |
| `SEC_YIELD` | `:` | Published 30-day SEC yield percentage range |
| `TICKERS` | empty (all) | Space-, comma- or semicolon-separated ticker allowlist, e.g. `GSLC GBIL AAAU GPIX GPIQ` |
| `HOLDINGS_PAGE_SIZE` | `250` | Rows in each generated current-holdings JSON page |
| `HISTORY_PAGE_SIZE` | `1000` | Rows in each generated daily-history JSON page |
| `HISTORY_RANGE` | `max` | Yahoo Finance chart range for history rows (`max`, `10y`, `5y`, ...) |
| `STORE_RAW_DOWNLOADS` | `false` | Store the official fund finder and fund pages under `api/goldmansachs/raw` |
| `MAX_RETRIES` | `2` | Retries after the initial request (integer >= 1); only network errors and HTTP 408/425/429/5xx are retried with exponential backoff |
| `SEC_UA` | `daggerok ETF feed daggerok@gmail.com` | SEC User-Agent; SEC policy requires automated tools to declare a contact. The workflow takes it from the protected `SEC_UA` Actions variable when that is set |
| `EDGAR_FALLBACK` | `true` | Use SEC EDGAR Form N-PORT-P for full holdings; `false` disables it |
| `SKIP_YAHOO` | `false` | Keep previous history and distributions, skip Yahoo Finance |
| `SKIP_GOLDMANSACHS` | `false` | Skip the Goldman Sachs fund finder and detail pages (SEC EDGAR + Yahoo Finance only) |
| `OFFLINE_SEED` | `false` | Build the feed from the committed seed and verified snapshot in `data/` only, with no network access |
| `VERBOSE` | `false` | Print per-fund retry and fallback notices |
| `USE_SYSTEM_CA` | `auto` | TLS trust store: `auto` restarts the updater once with Bun's `--use-system-ca` when a request fails with an untrusted-certificate error; `true` always uses the system CA store; `false` never restarts. Not an individual workflow input: use `advanced`, the config file or the CLI environment. |
| `PERFORMANCE_YTD` / `_1Y` / `_3Y` / `_5Y` / `_10Y` | `:` | Annualized return range `min:max` per tenor (official NAV return where published) |
| `TOTAL_RETURN_YTD` / `_1Y` / `_3Y` / `_5Y` / `_10Y` | `:` | Cumulative return range `min:max` per tenor |

Workflow inputs mirror the lowercase control names, except `STORE_RAW_DOWNLOADS`, `SEC_UA`, `EDGAR_FALLBACK`, `OFFLINE_SEED`, `VERBOSE` and `USE_SYSTEM_CA`, which are reachable through `advanced`

### Examples

```bash
MAX_FETCHES=10 bun scripts/update-data.ts
TICKERS="GSLC GBIL AAAU GPIX GPIQ" bun scripts/update-data.ts
AUM="1B:" TER=":0.5" bun scripts/update-data.ts
PERFORMANCE_1Y="15:" bun scripts/update-data.ts
```

## TypeScript and verification

The browser app is intentionally build-free: `index.html` carries the markup, styles and bootstrap, and `app.tsx` is TypeScript compiled in the browser with Babel standalone - no build step, no bundler, no `tsconfig.json` needed. Bun runs TypeScript out of the box.

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
| Amplify | Amplify ETFs (Firestore data feed) | [Amplify](https://github.com/daggerok/Amplify) |
| ARK Invest | ark-funds.com fund pages + overview/NAV-history/performance JSON + official daily holdings CSV + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance distributions/history fallback | [ARK](https://github.com/daggerok/ARK) |
| Capital Group | Official Capital Group fund data + SEC N-PORT holdings fallback + Yahoo history fallback | [Capital-Group](https://github.com/daggerok/Capital-Group) |
| Fidelity | SEC EDGAR N-PORT-P + Yahoo Finance | [Fidelity](https://github.com/daggerok/Fidelity) |
| First Trust | ftportfolios.com official ETF list + fund summary, holdings, distribution and price-history export pages + SEC EDGAR N-PORT-P holdings fallback + Yahoo Finance history fallback | [First-Trust](https://github.com/daggerok/First-Trust) |
| Franklin Templeton | franklintempleton.com ETF listings + product pages + SEC EDGAR N-PORT-P | [Franklin](https://github.com/daggerok/Franklin) |
| Global X | globalxetfs.com Next.js catalog and fund pages + dated full-holdings CSV | [Global-X](https://github.com/daggerok/Global-X) |
| Goldman Sachs | am.gs.com fund finder + detail pages + SEC EDGAR N-PORT-P | [Goldman-Sachs](https://github.com/daggerok/Goldman-Sachs) |
| Invesco | invesco.com CSV downloads + Yahoo Finance | [Invesco](https://github.com/daggerok/Invesco) |
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
