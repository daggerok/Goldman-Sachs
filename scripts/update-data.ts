#!/usr/bin/env bun

// Goldman Sachs U.S.-listed ETF static data updater.
//
// The browser application is deliberately static. This script builds the feed
// under api/goldmansachs/** from public issuer/SEC/market-data sources:
//
//   catalog       Goldman Sachs Asset Management fund finder filtered to ETFs
//                 https://am.gs.com/en-us/individual/funds (48 ETFs), pinned
//                 by the checked-in universe seed in goldmansachs-funds.ts
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
// A run with no reachable network (or `OFFLINE_SEED=1`) replays the checked-in
// snapshot in `scripts/goldmansachs-verified.ts` instead of failing, so the
// feed can be built and the UI verified without egress (identical to
// daggerok/VanEck).
//
// Usage: bun ./scripts/update-data.ts [--help]

// Bun provides Node-compatible fs/promises; node types are intentionally not required at runtime.
/// <reference types="bun" />
import { appendFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { GOLDMAN_SACHS_FUNDS } from './goldmansachs-funds';
import {
  DISTRIBUTION_SNAPSHOTS,
  FINDER_SNAPSHOTS,
  FUND_PAGE_SNAPSHOTS,
  TOP_HOLDINGS_SNAPSHOTS,
} from './goldmansachs-verified';

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  exitCode?: number;
};

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
const SEC_UA = 'DaggerOk Goldman Sachs ETF feed admin@daggerok.example.com';
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const PROXY_SLEEP_SECONDS = 3.2; // r.jina.ai anonymous tier is ~20 requests per minute

const API_ROOT = new URL('../api/goldmansachs/', import.meta.url);
const INDEX_FILE = new URL('index.json', API_ROOT);
const STATE_FILE = new URL('update-state.json', API_ROOT);

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
};

export type Distribution = { epoch: number; amount: number };

type SecSeriesRef = { cik: string; seriesId: string; classId: string };
type NportAccession = { accession: string; filed: string; reportDate: string; url: string };

type UpdaterConfig = {
  maxFetches: number;
  requestSleep: number;
  aum?: Range;
  ter?: Range;
  dividendYield?: Range;
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
};

const EMPTY_RETURNS: CatalogReturns = { ytd: null, yr1: null, yr3: null, yr5: null, yr10: null, sinceInception: null };
const EMPTY_PRICE_RETURNS: PriceReturns = { asOfDate: '', mo1: null, qtd: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null };

let requestGateAt = 0;
let proxyGateAt = 0;
let requestSleepSeconds = 1.5;
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
  const parsed = Date.parse(raw);
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
  return `${MONTHS[Number(match[2]) - 1]} ${Number(match[3])} ${match[1]}`;
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

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseDecimal(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
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

function parseRanges(env: Record<string, string | undefined>, prefix: 'PERFORMANCE' | 'TOTAL_RETURN'): RangeMap {
  const result: RangeMap = {};
  for (const period of ['YTD', '1Y', '3Y', '5Y', '10Y'] as ReturnPeriod[]) {
    const value = env[`${prefix}_${period}`];
    if (value !== undefined && value.trim() !== '') result[period] = parseRange(value, `${prefix}_${period}`);
  }
  return result;
}

function readTickerSet(value: string | undefined): Set<string> | null {
  const tickers = String(value ?? '').split(/[\s,;]+/).map(sanitizeTicker).filter(Boolean);
  return tickers.length ? new Set(tickers) : null;
}

function hasConfiguredFilters(config: UpdaterConfig): boolean {
  return Boolean(config.aum || config.ter || config.dividendYield || config.tickers || Object.keys(config.performance).length || Object.keys(config.totalReturn).length);
}

function readConfig(env: Record<string, string | undefined> = process.env): UpdaterConfig {
  return {
    maxFetches: parsePositiveInt(env.MAX_FETCHES, 0),
    requestSleep: parseDecimal(env.REQUEST_SLEEP, 1.5),
    aum: parseAumRange(env.AUM ?? ':'),
    ter: parseRange(env.TER ?? ':', 'TER'),
    dividendYield: parseRange(env.DIVIDEND_YIELD ?? ':', 'DIVIDEND_YIELD'),
    performance: parseRanges(env, 'PERFORMANCE'),
    totalReturn: parseRanges(env, 'TOTAL_RETURN'),
    concurrency: Math.max(1, parsePositiveInt(env.CONCURRENCY, 3)),
    holdingsPageSize: Math.max(1, parsePositiveInt(env.HOLDINGS_PAGE_SIZE, 250)),
    historyPageSize: Math.max(1, parsePositiveInt(env.HISTORY_PAGE_SIZE, 1000)),
    storeRawDownloads: parseBoolean(env.STORE_RAW_DOWNLOADS),
    maxRetries: Math.max(0, parsePositiveInt(env.MAX_RETRIES, 2)),
    tickers: readTickerSet(env.TICKERS),
    historyRange: env.HISTORY_RANGE?.trim() || 'max',
    edgarFallback: !['0', 'false', 'off', 'no'].includes(String(env.EDGAR_FALLBACK ?? '1').toLowerCase()),
    skipGoldmanSachs: parseBoolean(env.SKIP_GOLDMANSACHS),
    skipYahoo: parseBoolean(env.SKIP_YAHOO),
    offlineSeed: parseBoolean(env.OFFLINE_SEED),
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
export function parseCatalogText(text: string): CatalogFund[] {
  const source = htmlToText(stripProxyPreamble(text));
  const lines = source.split('\n');
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
      const window = lines.slice(index, index + 10);
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

async function paceRequests(proxy = false): Promise<void> {
  const now = Date.now();
  if (proxy) {
    const wait = Math.max(0, proxyGateAt - now);
    proxyGateAt = Math.max(now, proxyGateAt) + Math.max(requestSleepSeconds, PROXY_SLEEP_SECONDS) * 1000;
    if (wait) await sleep(wait);
    return;
  }
  const wait = Math.max(0, requestGateAt - now);
  requestGateAt = Math.max(now, requestGateAt) + Math.max(0, requestSleepSeconds * 1000);
  if (wait) await sleep(wait);
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

async function fetchText(url: string, label: string, config: UpdaterConfig, headers: Record<string, string> = {}): Promise<string> {
  let lastError: unknown = new Error('no request attempted');
  const proxy = isProxyUrl(url);
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    try {
      await paceRequests(proxy);
      const response = await fetch(url, { headers: { 'User-Agent': SEC_UA, Accept: '*/*', ...headers }, redirect: 'follow' });
      if (!response.ok) {
        const snippet = cleanText((await response.text().catch(() => '')).replace(/<[^>]+>/g, ' ')).slice(0, 160);
        throw new HttpError(response.status, `${response.status} ${response.statusText}${snippet ? ` — ${snippet}` : ''}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
      if (attempt >= config.maxRetries || !retryable(error)) break;
      const rateLimited = error instanceof HttpError && error.status === 429;
      await sleep(Math.min(60_000, (rateLimited ? 12_000 : 800) * 2 ** attempt));
    }
  }
  throw new Error(`${label}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
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
const ISSUER_DIRECT_DENIAL_LIMIT = 2;

/**
 * Issuer documents: one direct request with a browser-like User-Agent first,
 * then the same public URL through the read-only rendering proxy. The issuer
 * CDN answers datacenter clients with "Access Denied" (HTTP 403); after two
 * such denials in a run the direct attempt is skipped to keep the run short.
 * The proxy itself sits behind Cloudflare and challenges browser User-Agents,
 * so proxy requests declare the plain feed User-Agent. `validate` rejects
 * bot-wall/HTML error pages so that the fallback is taken instead of parsing
 * garbage.
 */
async function fetchIssuerText(url: string, label: string, config: UpdaterConfig, validate: (text: string) => boolean, accept = 'text/html,application/xhtml+xml,text/csv,text/plain;q=0.9,*/*;q=0.8', options: { cache?: boolean } = {}): Promise<{ text: string; via: 'direct' | 'proxy' }> {
  let lastError: unknown = new Error('direct request skipped (issuer CDN denies this network)');
  if (issuerDirectDenials < ISSUER_DIRECT_DENIAL_LIMIT) {
    try {
      const text = await fetchText(url, label, { ...config, maxRetries: 0 }, { 'User-Agent': BROWSER_UA, Accept: accept, 'Accept-Language': 'en-US,en;q=0.9' });
      if (validate(text)) {
        issuerDirectDenials = 0;
        return { text, via: 'direct' };
      }
      lastError = new Error('direct response did not contain the expected content');
    } catch (error) {
      lastError = error;
      if (/\b403\b/.test(error instanceof Error ? error.message : String(error))) {
        issuerDirectDenials += 1;
        if (issuerDirectDenials === ISSUER_DIRECT_DENIAL_LIMIT) console.warn('[issuer  ] direct requests are denied from this network; using the read-only rendering proxy for the rest of the run');
      }
    }
  }
  try {
    const headers: Record<string, string> = { 'User-Agent': SEC_UA, Accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.8' };
    if (options.cache === false) headers['X-No-Cache'] = 'true';
    const text = stripProxyPreamble(await fetchText(proxyUrl(url), `${label} (proxy)`, config, headers));
    if (validate(text)) return { text, via: 'proxy' };
    throw new Error('proxy response did not contain the expected content');
  } catch (error) {
    const first = lastError instanceof Error ? lastError.message : String(lastError);
    const second = error instanceof Error ? error.message : String(error);
    throw new Error(`${label}: ${first}; ${second}`);
  }
}

// ---------------------------------------------------------------------------
// Fund page
// ---------------------------------------------------------------------------

function emptyReturnRow(asOfDate = ''): OfficialReturnRow {
  return { asOfDate, mo1: null, mo3: null, ytd: null, yr1: null, cagr3y: null, cagr5y: null, cagr10y: null, siAnn: null };
}

function returnRowFromLabeledCells(headers: string[], values: Array<number | null>, asOfDate: string): OfficialReturnRow {
  const row = emptyReturnRow(asOfDate);
  const slot = (header: string): keyof OfficialReturnRow | null => {
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
  return {
    ...empty,
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
    marketPrice: labelNumber(marketPrice),
    marketPrice52wkRange: cleanText(labelText(range52).replace(/USD$/i, '')),
    premiumDiscount: labelNumber(premium),
    pricingAsOfDate: labelAsOf(marketPrice) || labelAsOf(premium),
    bidAsk: labelNumber(bidAsk),
    bidAskSpread30d: labelNumber(spread),
    premiumDays: labelNumber(premiumDays),
    atNavDays: labelNumber(atNavDays),
    discountDays: labelNumber(discountDays),
    distRate12M: yieldsValid ? labelNumber(distRate) : null,
    secYieldSubsidized: yieldsValid ? labelNumber(secSub) : null,
    secYieldUnsubsidized: yieldsValid ? labelNumber(secUnsub) : null,
    yieldsAsOfDate: yieldsValid ? yieldsAsOfDate : null,
    navTicker: labelText(navTicker),
    iopvTicker: labelText(iopvTicker),
    distributions: parseGsDistributions(lines),
    topHoldings: parseGsTopHoldings(lines),
    officialReturns: parseOfficialReturns(lines, upper),
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
  return { 'User-Agent': SEC_UA, Accept: 'application/json, application/xml, text/xml, text/plain' };
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
    console.log(`[edgar   ] SEC fund ticker table: ${fundTickerMap.size} share classes`);
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
    console.log(`[edgar   ] SEC company ticker table: ${companyTickerMap.size} issuer names`);
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
  if (!normalized || normalized === '-' || normalized === '—') return '00 - —';
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

const DERIVED_RETURNS_BASIS = 'adjusted market-price closes (Yahoo chart API), not official Goldman Sachs NAV returns';
const OFFICIAL_RETURNS_BASIS = 'official Goldman Sachs fund-page NAV total returns (month-end) where published; Yahoo adjusted market-price closes for missing values';

function deriveMetrics(effective: PriceReturns, fund: CatalogFund, dividends: Distribution[], frequency: { paymentsPerYear: number | null }, price: number | null, official: boolean): JsonRecord {
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
    secYield: fund.secYield,
    secYieldText: fund.secYield === null ? '—' : `${fund.secYield.toFixed(2)}%`,
    returnsBasis: official ? OFFICIAL_RETURNS_BASIS : DERIVED_RETURNS_BASIS,
  };
}

function historyRows(days: ChartDay[]): JsonRecord[] {
  return days.map((day) => ({ Date: formatDate(day.date), Close: String(day.close), 'Adj Close': String(day.adjClose), Volume: String(day.volume) }));
}

function distributionRows(dividends: Distribution[]): string[][] {
  return dividends.map((item) => [formatUsDate(item.epoch), String(round(item.amount, 6))]);
}

export function mergeOfficialReturns(derived: PriceReturns, official: OfficialReturnRow | null): PriceReturns {
  if (!official) return derived;
  return {
    ...derived,
    asOfDate: official.asOfDate || derived.asOfDate,
    mo1: official.mo1 ?? derived.mo1,
    qtd: derived.qtd, // the fund page publishes 3-month, not quarter-to-date
    ytd: official.ytd ?? derived.ytd,
    yr1: official.yr1 ?? derived.yr1,
    cagr3y: official.cagr3y ?? derived.cagr3y,
    cagr5y: official.cagr5y ?? derived.cagr5y,
    cagr10y: official.cagr10y ?? derived.cagr10y,
    siAnn: official.siAnn ?? derived.siAnn,
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
    dividendYield: numberOrNull(metrics.dividendYield),
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
  try {
    const data = JSON.parse(await readFile(INDEX_FILE, 'utf8')) as JsonRecord;
    const map = new Map<string, JsonRecord>();
    for (const row of Array.isArray(data.funds) ? data.funds : []) if (row?.ticker) map.set(String(row.ticker), row);
    return map;
  } catch {
    return new Map();
  }
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

async function writeIfChanged(file: URL, value: unknown): Promise<boolean> {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  try {
    if (await readFile(file, 'utf8') === text) return false;
  } catch {
    // New file.
  }
  await mkdir(new URL('.', file), { recursive: true });
  await writeFile(file, text, 'utf8');
  return true;
}

async function writePages(fundDir: URL, ticker: string, kind: 'holdings' | 'history', headers: string[], rows: JsonRecord[], pageSize: number, asOfDate: string | null, source: string): Promise<JsonRecord> {
  const dir = new URL(`${kind}/`, fundDir);
  await mkdir(dir, { recursive: true });
  const pageCount = rows.length ? Math.ceil(rows.length / pageSize) : 0;
  const kept = new Set<string>();
  for (let page = 0; page < pageCount; page += 1) {
    const name = `${String(page + 1).padStart(3, '0')}.json`;
    kept.add(name);
    await writeIfChanged(new URL(name, dir), { ticker, page: page + 1, pageSize, totalRows: rows.length, headers, rows: rows.slice(page * pageSize, (page + 1) * pageSize) });
  }
  try {
    for (const name of await readdir(dir)) if (name.endsWith('.json') && !kept.has(name)) await rm(new URL(name, dir), { force: true });
  } catch {
    // Directory may not exist on a zero-row first run.
  }
  return { pages: [...kept].sort().map((name) => `${kind}/${name}`), pageSize, totalRows: rows.length, ...(kind === 'holdings' ? { asOfDate, asOf: asOfDate ? formatDate(asOfDate) : '—', source } : { asOf: asOfDate ? formatDate(asOfDate) : '—', source }) };
}

function catalogFilterReasons(fund: CatalogFund, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  if (config.tickers && !config.tickers.has(fund.ticker)) reasons.push('TICKERS');
  if (!rangeMatches(fund.ter, config.ter)) reasons.push('TER');
  return reasons;
}

function postFetchFilterReasons(fund: CatalogFund, metrics: JsonRecord, config: UpdaterConfig): string[] {
  const reasons: string[] = [];
  if (!rangeMatches(fund.netAssets, config.aum)) reasons.push('AUM');
  if (!rangeMatches(numberOrNull(metrics.dividendYield), config.dividendYield)) reasons.push('DIVIDEND_YIELD');
  const annual: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.tr1y, '3Y': metrics.cagr3y, '5Y': metrics.cagr5y, '10Y': metrics.cagr10y };
  const cumulative: Record<ReturnPeriod, number | null> = { YTD: metrics.ytd, '1Y': metrics.tr1y, '3Y': metrics.tr3y, '5Y': metrics.tr5y, '10Y': metrics.tr10y };
  for (const [period, range] of Object.entries(config.performance) as [ReturnPeriod, Range][]) if (annual[period] !== null && !rangeMatches(annual[period], range)) reasons.push(`PERFORMANCE_${period}`);
  for (const [period, range] of Object.entries(config.totalReturn) as [ReturnPeriod, Range][]) if (cumulative[period] !== null && !rangeMatches(cumulative[period], range)) reasons.push(`TOTAL_RETURN_${period}`);
  return reasons;
}

// ---------------------------------------------------------------------------
// Per-fund pipeline
// ---------------------------------------------------------------------------

const PROVIDER_LABEL = 'Goldman Sachs Asset Management fund finder + official fund page + fund-page Distributions table + SEC EDGAR Form N-PORT-P holdings + Yahoo Finance public chart API';

async function processFund(fund: CatalogFund, config: UpdaterConfig, previous: JsonRecord = {}): Promise<JsonRecord> {
  const reasons = catalogFilterReasons(fund, config);
  if (reasons.length) {
    return { __skipped: true, ticker: fund.ticker, __skipReasons: reasons };
  }
  const fundDir = new URL(`funds/${fund.ticker}/`, API_ROOT);
  await mkdir(fundDir, { recursive: true });
  const previousMeta = await readPreviousMeta(fund.ticker);

  // 1. Official fund page ------------------------------------------------------
  let summary: ProductPageSummary | null = null;
  let productVia: 'direct' | 'proxy' | null = null;
  if (!config.skipGoldmanSachs && fund.fundPage) {
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
      console.warn(`[product ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // Slow-moving page facts survive a flaky render: a missed fee or yield must
  // not clobber the previously published value with '—' (the next successful
  // page read refreshes them). Yield carries require a previously official
  // value — indicated yields are recomputed every run instead.
  if (fund.ter === null) fund.ter = numberOrNull(previous.terValue);
  if (fund.grossTer === null) fund.grossTer = numberOrNull((previousMeta?.expenseRatio as JsonRecord | undefined)?.gross);
  const previousMetrics = (previous.metrics as JsonRecord | undefined) || {};
  const previousYields = (previousMeta?.yields as JsonRecord | undefined) || {};
  if (fund.secYield === null && String(previousYields.secYieldKind || '').startsWith('Standardized 30-Day')) fund.secYield = numberOrNull(previousMetrics.secYield);
  if (fund.dividendYield === null && String(previousYields.dividendYieldKind || '').startsWith('12 Month Trailing')) fund.dividendYield = numberOrNull(previousMetrics.dividendYield);
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
        const seriesMatches = !parsed.seriesId || parsed.seriesId.toUpperCase() === filing.ref.seriesId.toUpperCase();
        if (seriesMatches && parsed.holdings.length) {
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
      console.warn(`[nport   ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
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
      const query = new URLSearchParams({ period1: '0', period2: String(Math.floor(Date.now() / 1000) + 86_400), interval: '1d', events: 'div|split', includeAdjustedClose: 'true' });
      if (config.historyRange && config.historyRange !== 'max') query.set('range', config.historyRange);
      const payload = await fetchJson(`${YAHOO_CHART_URL}/${encodeURIComponent(fund.ticker)}?${query.toString()}`, `[chart   ] ${fund.ticker}`, config, { 'User-Agent': 'Mozilla/5.0' });
      chart = parseChart(payload);
      days = chart.days;
    } catch (error) {
      console.warn(`[chart   ] ${fund.ticker}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!days.length) {
    const previousRows = await readPreviousSheet(fund.ticker, 'history');
    days = previousRows.map((row) => ({ date: toIsoDate(row.Date), close: numberOrNull(row.Close) || 0, adjClose: numberOrNull(row['Adj Close']) || numberOrNull(row.Close) || 0, volume: numberOrNull(row.Volume) || 0 })).filter((row) => row.date && row.close > 0);
    if (previousRows.length) historySource = previousMeta?.history?.source || 'previous run';
  }
  if (!dividends.length && chart?.dividends.length) {
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
  if (!officialMonthly && (fund.returns.yr1 !== null || fund.returns.yr3 !== null || fund.returns.yr5 !== null || fund.returns.yr10 !== null || fund.returns.sinceInception !== null)) {
    // The fund page failed in this run but the finder card carries the same
    // month-end series; keep the official values instead of Yahoo's.
    officialMonthly = { asOfDate: fund.returnsAsOf || '', mo1: null, mo3: null, ytd: fund.returns.ytd, yr1: fund.returns.yr1, cagr3y: fund.returns.yr3, cagr5y: fund.returns.yr5, cagr10y: fund.returns.yr10, siAnn: fund.returns.sinceInception };
  }
  const officialQuarterly = summary?.officialReturns.quarterEnd.nav || null;
  const effective = mergeOfficialReturns(derived, officialMonthly);
  const marketPrice = summary?.marketPrice ?? chart?.regularMarketPrice ?? (days.length ? days[days.length - 1].close : numberOrNull(previous.closePriceValue));
  const nav = fund.nav ?? numberOrNull(previous.navValue);
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
  const premiumDiscount = fund.premiumDiscount ?? (nav && marketPrice ? round((marketPrice / nav - 1) * 100, 2) : numberOrNull(previous.premiumDiscountValue));
  const netAssets = fund.netAssets ?? nport?.netAssets ?? numberOrNull(previous.aumValue);
  const asOfDate = fund.asOfDate || toIsoDate(previous.asOfDate) || null;
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
    marketPrice: { display: marketPrice === null ? '—' : `$${marketPrice.toFixed(2)}`, value: marketPrice, asOfDate: marketPriceAsOfLabel, source: summary?.marketPrice !== null && summary?.marketPrice !== undefined ? 'official fund page Pricing Table' : chart ? 'Yahoo Finance last regular-session price' : 'previous run' },
    premiumDiscount: { display: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`, value: premiumDiscount, asOfDate: summary?.pricingAsOfDate ? formatDate(summary.pricingAsOfDate) : asOfLabel, source: fund.premiumDiscount !== null ? 'official fund page Pricing Table' : 'computed from market price / fund-page NAV' },
    aum: { display: formatAumDisplay(netAssets), value: netAssets, asOfDate: summary?.aumDailyAsOfDate ? formatDate(summary.aumDailyAsOfDate) : summary?.aumMonthlyAsOfDate ? formatDate(summary.aumMonthlyAsOfDate) : (nport?.repPdDate ? formatDate(nport.repPdDate) : asOfLabel), source: summary?.aumDaily !== null && summary?.aumDaily !== undefined ? 'official fund page Total Fund Assets (Daily)' : summary?.aumMonthly !== null && summary?.aumMonthly !== undefined ? 'official fund page Total Fund Assets (Monthly)' : nport ? `SEC Form N-PORT-P net assets (${nport.repPdDate || 'n/a'})` : 'previous run' },
    fundFacts: { sharesOutstanding: null, portfolioTurnover: null, publishedTotalHoldings: summary?.totalHoldings ?? null, bidAskMidpoint: summary?.bidAsk ?? null, lbmaGoldPrice: summary?.lbmaGoldPrice ?? null, lbmaGoldPriceAsOf: summary?.lbmaGoldPriceAsOfDate ? formatDate(summary.lbmaGoldPriceAsOfDate) : null, premiumDays: summary?.premiumDays ?? null, atNavDays: summary?.atNavDays ?? null, discountDays: summary?.discountDays ?? null },
    yields: {
      dividendYield: metrics.dividendYield,
      dividendYieldText: metrics.dividendYieldText,
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
  await writeIfChanged(new URL('meta.json', fundDir), meta);

  return {
    ticker: fund.ticker,
    name: fund.name,
    category: fund.category,
    fundPage: fund.fundPage,
    dataFile: `./funds/${fund.ticker}/meta.json`,
    cusip: fund.cusip || null,
    isin: fund.isin || null,
    ter: fund.ter === null ? '—' : `${fund.ter}%`,
    terValue: fund.ter,
    nav: nav === null ? '—' : `$${nav.toFixed(2)}`,
    navValue: nav,
    aum: formatAumDisplay(netAssets),
    aumValue: netAssets,
    asOfDate: asOfLabel,
    inceptionDate: fund.inception ? formatDate(fund.inception) : chart?.firstTradeDate ? formatDate(new Date(chart.firstTradeDate * 1000).toISOString().slice(0, 10)) : (previous.inceptionDate || '—'),
    exchange: fund.exchange || chart?.exchangeName || previous.exchange || '',
    closePrice: marketPrice === null ? '—' : `$${marketPrice.toFixed(2)}`,
    closePriceValue: marketPrice,
    premiumDiscount: premiumDiscount === null ? '—' : `${premiumDiscount.toFixed(2)}%`,
    premiumDiscountValue: premiumDiscount,
    frequencyCode: frequencyCodeLabel(distributionFrequency),
    distributions: { frequency: distributionFrequency, exDate: latest ? formatUsDate(latest.epoch) : (previous.distributions?.exDate || '—'), dividend: latest ? String(round(latest.amount, 6)) : (previous.distributions?.dividend || '—') },
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
  console.log('[seed    ] OFFLINE_SEED=1: replaying scripts/goldmansachs-verified.ts (no network requests)');
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
  for (const fund of universe) {
    if (catalogFilterReasons(fund, config).length) continue;
    const fundDir = new URL(`funds/${fund.ticker}/`, API_ROOT);
    await mkdir(fundDir, { recursive: true });
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
      secYield,
      secYieldText: secYield === null ? '—' : `${secYield.toFixed(2)}%`,
      returnsBasis: OFFLINE_BASIS,
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
  const counts = { funds: funds.length, holdings: funds.reduce((sum, row) => sum + (numberOrNull(row.holdings) || 0), 0), history: 0 };
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
  await writeIfChanged(STATE_FILE, { cursor: null, savedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
  console.log(`[done    ] offline seed feed: ${counts.funds} funds / ${counts.holdings} holdings rows`);
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
                scripts/goldmansachs-funds.ts
  fund page     official per-fund page: Quick Stats, Key Facts, Fees &
                Expenses, Pricing Table, Cumulative/Annualized/Quarterly
                returns, Rate, Distributions table, top-10 holdings
  holdings      SEC EDGAR Form N-PORT-P for the exact series (the issuer
                publishes only top-10 holdings; no issuer CSV exists)
  distributions Distributions table on the official fund page (Yahoo
                dividend events as the fallback)
  history       Yahoo Finance public chart API (adjusted market-price closes)

Environment variables (all filters use AND logic):
  MAX_FETCHES=0       all eligible funds; positive value is a resumable batch
  REQUEST_SLEEP=1.5   seconds between request starts (proxy requests >= 3.2s)
  CONCURRENCY=3       parallel fund workers; every request stays paced
  AUM=:
  TER=:
  DIVIDEND_YIELD=:
  TICKERS="GSLC GBIL"  optional ticker allowlist
  PERFORMANCE_YTD|1Y|3Y|5Y|10Y=min:max   annualized ranges
  TOTAL_RETURN_YTD|1Y|3Y|5Y|10Y=min:max cumulative ranges
  HOLDINGS_PAGE_SIZE=250
  HISTORY_PAGE_SIZE=1000
  HISTORY_RANGE=max
  MAX_RETRIES=2
  STORE_RAW_DOWNLOADS=off
  EDGAR_FALLBACK=1
  SKIP_GOLDMANSACHS=off use the previously published catalog/fund-page data
  SKIP_YAHOO=off      keep previously published history when possible
  OFFLINE_SEED=off    replay scripts/goldmansachs-verified.ts (no network)

Examples:
  TICKERS="GSLC GBIL AAAU" ./scripts/update-data.ts
  AUM="large:" TER=":0.10" ./scripts/update-data.ts
  PERFORMANCE_3Y="10:" TOTAL_RETURN_1Y="15:" ./scripts/update-data.ts
  OFFLINE_SEED=1 ./scripts/update-data.ts
`;

async function main(): Promise<void> {
  const config = readConfig();
  requestSleepSeconds = config.requestSleep;
  requestGateAt = 0;
  proxyGateAt = 0;
  issuerDirectDenials = 0;
  console.log('Goldman Sachs ETF static data updater');
  console.log('Sources: Goldman Sachs Asset Management fund finder + fund pages + Distributions tables + SEC EDGAR N-PORT-P holdings + Yahoo Finance public chart API');
  for (const line of configLines(config)) console.log(`  ${line}`);

  if (config.offlineSeed) {
    await buildOfflineSeedFeed(config);
    return;
  }

  const previous = await readPreviousIndex();
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
      console.warn(`[catalog ] ${error instanceof Error ? error.message : String(error)} — keeping the published feed`);
    }
  }
  // The checked-in universe seed pins the catalog: seed funds the live finder
  // did not return (card layout drift, pagination) still refresh by URL, and
  // live-only tickers are kept so new listings are never dropped silently.
  for (const seed of seedCatalogFunds()) if (!catalog.has(seed.ticker)) catalog.set(seed.ticker, seed);
  if (!catalog.size) for (const [ticker, row] of previous) catalog.set(ticker, parsePreviousFund(ticker, row));
  if (catalog.size && catalogSource !== 'previous api/goldmansachs/index.json') for (const [ticker, row] of previous) if (!catalog.has(ticker)) catalog.set(ticker, parsePreviousFund(ticker, row));

  const universe = [...catalog.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
  if (!universe.length) throw new Error('No catalog rows available. Run this where am.gs.com is reachable or seed api/goldmansachs/index.json first.');
  console.log(`[catalog ] ${universe.length} Goldman Sachs ETFs (${catalogSource})`);

  let state: JsonRecord = {};
  try { state = JSON.parse(await readFile(STATE_FILE, 'utf8')) as JsonRecord; } catch { state = {}; }
  const cursor = config.maxFetches > 0 ? String(state.cursor || '') : '';
  const index = cursor ? universe.findIndex((fund) => fund.ticker === cursor) : -1;
  const ordered = index >= 0 ? universe.slice(index + 1).concat(universe.slice(0, index + 1)) : universe;
  const queue = ordered.slice();
  const totalAttempts = config.maxFetches > 0 ? Math.min(config.maxFetches, ordered.length) : ordered.length;
  const results: JsonRecord[] = [];
  let processed = 0;
  let completed = 0;
  let failures = 0;
  let lastTicker: string | null = cursor || null;
  const logProgress = (fund: CatalogFund, status: 'updated' | 'not updated', detail: string): void => {
    completed += 1;
    const ordinal = String(completed).padStart(String(Math.max(1, totalAttempts)).length, ' ');
    console.log(`[progress] ${ordinal}/${totalAttempts} ${fund.ticker.padEnd(5)} ${status}${detail ? ` — ${detail}` : ''}`);
  };
  const worker = async (): Promise<void> => {
    for (;;) {
      if (config.maxFetches > 0 && processed >= config.maxFetches) return;
      const fund = queue.shift();
      if (!fund) return;
      processed += 1;
      try {
        const row = await processFund(fund, config, previous.get(fund.ticker) || {});
        if (row.__skipped) {
          logProgress(fund, 'not updated', `filtered: ${(row.__skipReasons || ['not eligible']).join(', ')}`);
        } else {
          results.push(row);
          lastTicker = fund.ticker;
          logProgress(fund, 'updated', `${row.holdings ?? 0} holdings, ${row.history ?? 0} history rows`);
        }
      } catch (error) {
        failures += 1;
        const message = error instanceof Error ? error.message : String(error);
        const old = previous.get(fund.ticker);
        if (old && !hasConfiguredFilters(config)) results.push(old);
        logProgress(fund, 'not updated', `error: ${message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: config.concurrency }, () => worker()));

  const filterRun = hasConfiguredFilters(config);
  const funds = [...results].sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  if (!filterRun) {
    for (const fund of universe) if (!funds.some((row) => row.ticker === fund.ticker)) {
      const old = previous.get(fund.ticker);
      if (old) funds.push(old);
    }
    funds.sort((a, b) => String(a.ticker).localeCompare(String(b.ticker)));
  }
  const counts = { funds: funds.length, holdings: funds.reduce((sum, row) => sum + (numberOrNull(row.holdings) || 0), 0), history: funds.reduce((sum, row) => sum + (numberOrNull(row.history) || 0), 0) };
  await writeIfChanged(INDEX_FILE, {
    generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
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
  await writeIfChanged(STATE_FILE, { cursor: config.maxFetches > 0 ? lastTicker : null, savedAt: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
  console.log(`[done    ] ${results.length} funds updated, ${failures} failures`);
  console.log(`[done    ] counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### Goldman Sachs data update\n\n- updated: ${results.length}\n- failed: ${failures}\n- counts: ${counts.funds} funds / ${counts.holdings.toLocaleString('en-US')} holdings rows / ${counts.history.toLocaleString('en-US')} history rows\n`, 'utf8');
}

if ((import.meta as { main?: boolean }).main) {
  if (process.argv.some((arg) => ['-h', '--help', 'help'].includes(arg))) console.log(USAGE.trim());
  else await main().catch((error) => { console.error(error instanceof Error ? error.stack : String(error)); process.exitCode = 1; });
}
