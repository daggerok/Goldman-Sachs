/// <reference types="bun" />
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { CONTROL_NAMES, readConfig, resolveControls, runtimeControls } from './update-data';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const file = () => JSON.parse(read('scripts/update-data.config.json'));

test('configuration precedence: file < advanced < nonblank input < environment', () => {
  const c = resolveControls({ CONCURRENCY: 2, TICKERS: 'GSLC' }, { CONCURRENCY: 3, TICKERS: 'GBIL' }, { CONCURRENCY: '4', TICKERS: '' }, { CONCURRENCY: '5' });
  expect(c.CONCURRENCY).toBe('5');
  expect(c.TICKERS).toBe('GBIL');
  expect(resolveControls({ CONCURRENCY: 2 }, { CONCURRENCY: 3 }, { CONCURRENCY: '4' }).CONCURRENCY).toBe('4');
  expect(resolveControls({ TICKERS: 'GSLC' }, { TICKERS: '' }, { TICKERS: '' }).TICKERS).toBe('');
  expect(resolveControls({ CONCURRENCY: 2 }, {}, { CONCURRENCY: '' }).CONCURRENCY).toBe('2');
  expect(resolveControls({ SKIP_YAHOO: true }, {}, {}, { SKIP_YAHOO: 'false' }).SKIP_YAHOO).toBe('false');
  expect(readConfig(resolveControls({ MAX_RETRIES: 0 })).maxRetries).toBe(0);
  expect(resolveControls({ MAX_FETCHES: 7 }, {}, {}, { UNRELATED: 'x' }).MAX_FETCHES).toBe('7');
});

test('scheduled path (empty advanced and inputs) equals the config defaults', () => {
  const defaults = file();
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
  expect(config.secUa).toContain('Goldman Sachs');
});

test('runtime controls read the checked-in file and let the environment override it', async () => {
  expect(await runtimeControls({})).toEqual(file());
  const controls = await runtimeControls({ TICKERS: 'GSLC GBIL', SKIP_YAHOO: 'true', PERFORMANCE_1Y: '15:' });
  expect(controls.TICKERS).toBe('GSLC GBIL');
  const config = readConfig(controls);
  expect([...(config.tickers ?? [])]).toEqual(['GSLC', 'GBIL']);
  expect(config.skipYahoo).toBe(true);
  expect(config.performance['1Y']).toEqual({ min: 15, max: undefined });
});

test('resolver rejects unknown, non-scalar, invalid and multiline values', () => {
  const bad: unknown[] = [{ UNKNOWN: 1 }, { SEC_UA: 'x\nEVIL=yes' }, { CONCURRENCY: 0 }, { MAX_RETRIES: -1 }, { MAX_FETCHES: 1.5 }, { REQUEST_SLEEP: '-1' }, { VERBOSE: 'maybe' }, { EDGAR_FALLBACK: 'sometimes' }, { AUM: '1:2:3' }, { TER: '5:1' }, { PERFORMANCE_1Y: 'a:b' }, { TICKERS: ['GSLC'] }, { TICKERS: null }, { OUTPUT_DIR: '/tmp' }, null, []];
  for (const value of bad) expect(() => resolveControls(value)).toThrow();
  expect(() => resolveControls({}, { SEC_UA: 'x\rfoo' })).toThrow();
  expect(() => resolveControls({}, [])).toThrow();
  expect(() => resolveControls({}, {}, { TICKERS: 'A\nB' })).toThrow();
  expect(() => resolveControls({}, {}, {}, { SEC_UA: 'x\0bad' })).toThrow();
  expect(() => JSON.parse('{bad')).toThrow();
});

test('config keys, CONTROL_NAMES, README rows and --help are in sync', () => {
  expect(Object.keys(file()).sort()).toEqual([...CONTROL_NAMES].sort());
  for (const value of Object.values(file())) expect(typeof value).toBe('string');
  const doc = read('README.md');
  const usage = read('scripts/update-data.ts');
  for (const name of CONTROL_NAMES) {
    const tenor = name.match(/^(PERFORMANCE|TOTAL_RETURN)_(1Y|3Y|5Y|10Y)$/);
    expect(doc).toContain(tenor ? '`_' + tenor[2] + '`' : '`' + name + '`');
    if (tenor) expect(doc).toContain('`' + tenor[1] + '_YTD`');
    expect(usage).toContain(tenor ? `${tenor[1]}_YTD|1Y|3Y|5Y|10Y` : name);
  }
  expect(doc).toContain('scripts/update-data.config.json');
});

test('workflow resolves the same controls and only writes under api/goldmansachs', () => {
  const yml = read('.github/workflows/update-data.yml');
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
});
