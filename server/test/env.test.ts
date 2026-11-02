/**
 * Calendar env: WORKWEEK / WEEK_START fail boot with a readable message, empty
 * means default (like every other variable), and SYNC_TZ follows ORG_TIMEZONE
 * unless set. cwd points at an empty temp dir so a developer's .env can't leak in.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { loadCalendarEnv, loadEnv } from '../src/env';

const KEYS = ['DEMO_MODE', 'DATA_SOURCE', 'WORKWEEK', 'WEEK_START', 'ORG_TIMEZONE', 'SYNC_TZ'];
let saved: Record<string, string | undefined> = {};
let tmp = '';

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  process.env['DEMO_MODE'] = '1'; // no API keys needed
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'env-test-'));
  vi.spyOn(process, 'cwd').mockReturnValue(tmp);
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const k of KEYS) {
    const v = saved[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const withEnv = (vars: Record<string, string>) => {
  Object.assign(process.env, vars);
  return loadEnv();
};

/** The boot error's issues as 'PATH: message' lines. */
function bootError(vars: Record<string, string>): string[] {
  try {
    withEnv(vars);
  } catch (err) {
    expect(err).toBeInstanceOf(ZodError);
    return (err as ZodError).issues.map((i) => `${i.path.join('.')}: ${i.message}`);
  }
  throw new Error('expected loadEnv to fail');
}

describe('WORKWEEK / WEEK_START', () => {
  it('default to Sun–Thu weeks starting Sunday', () => {
    const env = loadEnv();
    expect(env.workweek).toEqual([0, 1, 2, 3, 4]);
    expect(env.weekStart).toBe(0);
  });

  it('treat empty values as unset', () => {
    const env = withEnv({ WORKWEEK: '', WEEK_START: ' ' });
    expect(env.workweek).toEqual([0, 1, 2, 3, 4]);
    expect(env.weekStart).toBe(0);
  });

  it('read presets and lists, sorted', () => {
    expect(withEnv({ WORKWEEK: 'mon-fri', WEEK_START: 'mon' })).toMatchObject({ workweek: [1, 2, 3, 4, 5], weekStart: 1 });
    expect(withEnv({ WORKWEEK: 'fri, mon,wed' }).workweek).toEqual([1, 3, 5]);
  });

  it('fail with the variable name and what to use instead', () => {
    expect(bootError({ WORKWEEK: 'mon-fry' })).toEqual([
      'WORKWEEK: unknown day "mon-fry" — use sun-thu, mon-fri, or a list like mon,tue,wed,thu,fri (or numbers 0–6, 0=Sunday, e.g. 1,2,3,4,5)',
    ]);
    expect(bootError({ WORKWEEK: ' , ' })).toEqual([expect.stringMatching(/^WORKWEEK: no days in " , "/)]);
  });

  it('reject an unknown week start', () => {
    expect(bootError({ WEEK_START: 'wed' })).toEqual(['WEEK_START: unknown week start "wed" — use sun or mon']);
  });
});

describe('loadCalendarEnv (the seeder\'s entry point)', () => {
  it('resolves exactly what loadEnv does', () => {
    for (const vars of [{}, { WORKWEEK: '', WEEK_START: '' }, { WORKWEEK: 'fri, mon,wed', WEEK_START: 'mon' }]) {
      Object.assign(process.env, vars);
      const env = loadEnv();
      expect(loadCalendarEnv()).toEqual({ workweek: env.workweek, weekStart: env.weekStart });
    }
  });

  it('fails the same way, naming the variable', () => {
    process.env['WORKWEEK'] = 'mon-fry';
    const err = (() => {
      try {
        loadCalendarEnv();
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ZodError);
    expect((err as ZodError).issues.map((i) => i.path.join('.'))).toEqual(['WORKWEEK']);
  });
});

describe('SYNC_TZ', () => {
  it('follows ORG_TIMEZONE when unset', () => {
    expect(withEnv({ ORG_TIMEZONE: 'America/New_York' }).syncTz).toBe('America/New_York');
  });

  it('keeps the old Asia/Jerusalem default when neither is set', () => {
    expect(loadEnv().syncTz).toBe('Asia/Jerusalem');
  });

  it('wins when set explicitly', () => {
    expect(withEnv({ ORG_TIMEZONE: 'America/New_York', SYNC_TZ: 'Europe/London' }).syncTz).toBe('Europe/London');
  });
});
