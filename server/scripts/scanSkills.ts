/**
 * `pnpm skills:scan` — walk the skill directories on THIS machine, parse each
 * SKILL.md frontmatter, and push the result to POST /api/skills/catalog.
 *
 * OTel events carry only `skill.name`, so the Skills tab has no way to know
 * what a skill does, who ships it, or what it is allowed to touch. This script
 * is that missing half: run it anywhere the skills are actually installed
 * (a dev machine, a CI job with the plugin cache warm) and point it at the
 * dashboard.
 *
 *   pnpm skills:scan                            # scan + push to DASHBOARD_URL
 *   pnpm skills:scan -- --dry-run               # print what would be pushed
 *   pnpm skills:scan -- --url http://host:8642
 *   pnpm skills:scan -- --project ~/work/repo   # extra .claude/skills root
 *
 * Auth: reuses OTEL_INGEST_TOKEN (the same secret the OTLP exporter uses);
 * omitted when the server has none configured.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SkillCatalogUpload, SkillCatalogUploadEntry, SkillSource } from '@dash/shared';
import { loadDotEnv } from '../src/env';

// ---------------------------------------------------------------------------
// Frontmatter
// ---------------------------------------------------------------------------

type Frontmatter = Record<string, string | string[]>;

const unquote = (v: string): string => {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))) {
    return t.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, ' ');
  }
  return t;
};

/**
 * Tolerant YAML-subset reader — enough for SKILL.md frontmatter (scalars,
 * quoted scalars, inline [a, b] arrays, `- item` block sequences and `|`/`>`
 * block scalars) without pulling a YAML dependency into the server.
 */
function parseFrontmatter(text: string): Frontmatter | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(text);
  if (!m || m[1] === undefined) return null;
  const lines = m[1].split(/\r?\n/);
  const out: Frontmatter = {};
  let key: string | null = null;
  let items: string[] | null = null;
  let block: string[] | null = null;

  const flush = (): void => {
    if (key === null) return;
    if (items !== null && items.length > 0) out[key] = items;
    else if (block !== null && block.length > 0) out[key] = block.join(' ').trim();
    key = null;
    items = null;
    block = null;
  };

  for (const line of lines) {
    if (line.trim() === '') continue;
    const indented = /^\s/.test(line);

    if (indented && items !== null) {
      const item = /^\s*-\s*(.*)$/.exec(line);
      if (item?.[1] !== undefined) {
        items.push(unquote(item[1]));
        continue;
      }
    }
    if (indented && block !== null) {
      block.push(line.trim());
      continue;
    }

    const kv = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv || kv[1] === undefined) continue;
    flush();
    key = kv[1];
    const rest = (kv[2] ?? '').trim();
    if (rest === '') {
      // a continuation line decides: `- x` fills items, anything else fills block
      items = [];
      block = [];
      continue;
    }
    if (rest === '|' || rest === '>' || rest === '|-' || rest === '>-') {
      block = [];
      continue;
    }
    if (rest.startsWith('[') && rest.endsWith(']')) {
      out[key] = rest
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s))
        .filter((s) => s !== '');
      key = null;
      continue;
    }
    out[key] = unquote(rest);
    key = null;
  }
  flush();
  return out;
}

const str = (fm: Frontmatter, key: string): string | null => {
  const v = fm[key];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
};

const listOf = (fm: Frontmatter, ...keys: string[]): string[] => {
  for (const key of keys) {
    const v = fm[key];
    if (Array.isArray(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      return v
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '');
    }
  }
  return [];
};

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

const HOME = os.homedir();
/** Paths are reported home-relative so machine layouts stay comparable. */
const homeRelative = (p: string): string => (p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

interface Scanned extends SkillCatalogUploadEntry {
  /** mtime of the SKILL.md, used to break ties between cached plugin versions */
  mtimeMs: number;
}

function readSkillDir(
  dir: string,
  source: SkillSource,
  pluginName: string,
  pluginVersion: string | null,
): Scanned | null {
  const file = path.join(dir, 'SKILL.md');
  let text: string;
  let mtimeMs: number;
  try {
    text = fs.readFileSync(file, 'utf8');
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
  const fm = parseFrontmatter(text);
  if (!fm) return null;
  const bare = str(fm, 'name') ?? path.basename(dir);
  return {
    // plugin skills are invoked as `plugin:skill` — match how a user types them
    name: pluginName === '' ? bare : `${pluginName}:${bare}`,
    source,
    pluginName,
    description: str(fm, 'description') ?? '',
    // a skill rarely pins its own version; the plugin cache dir is the next best thing
    version: str(fm, 'version') ?? pluginVersion,
    allowedTools: listOf(fm, 'allowed-tools', 'allowedTools', 'tools'),
    model: str(fm, 'model'),
    path: homeRelative(dir),
    mtimeMs,
  };
}

const subdirs = (dir: string): string[] => {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
};

/** `<root>/<skill>/SKILL.md` for one source. */
function scanSkillsRoot(
  root: string,
  source: SkillSource,
  pluginName = '',
  pluginVersion: string | null = null,
): Scanned[] {
  return subdirs(root)
    .map((d) => readSkillDir(d, source, pluginName, pluginVersion))
    .filter((s): s is Scanned => s !== null);
}

/** `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>/SKILL.md` */
function scanPluginCache(cacheRoot: string): Scanned[] {
  const out: Scanned[] = [];
  for (const marketplace of subdirs(cacheRoot)) {
    for (const plugin of subdirs(marketplace)) {
      for (const version of subdirs(plugin)) {
        out.push(
          ...scanSkillsRoot(
            path.join(version, 'skills'),
            'plugin',
            path.basename(plugin),
            path.basename(version),
          ),
        );
      }
    }
  }
  return out;
}

function scan(projectRoots: string[]): SkillCatalogUploadEntry[] {
  const found: Scanned[] = [
    ...scanSkillsRoot(path.join(HOME, '.claude', 'skills'), 'personal'),
    ...scanPluginCache(path.join(HOME, '.claude', 'plugins', 'cache')),
    ...projectRoots.flatMap((r) => scanSkillsRoot(path.join(r, '.claude', 'skills'), 'project')),
  ];
  // the plugin cache keeps every installed version side by side — one entry per
  // (source, plugin, name), newest SKILL.md wins
  const best = new Map<string, Scanned>();
  for (const s of found) {
    const key = `${s.source} ${s.pluginName ?? ''} ${s.name}`;
    const prev = best.get(key);
    if (!prev || s.mtimeMs > prev.mtimeMs) best.set(key, s);
  }
  return [...best.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ mtimeMs: _mtimeMs, ...entry }) => entry);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function flag(argv: string[], name: string): string | null {
  const i = argv.indexOf(`--${name}`);
  return i < 0 ? null : (argv[i + 1] ?? null);
}

const expandHome = (p: string): string => (p === '~' || p.startsWith('~/') ? HOME + p.slice(1) : p);

async function main(): Promise<void> {
  loadDotEnv();
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const url = (flag(argv, 'url') ?? process.env['DASHBOARD_URL'] ?? 'http://localhost:8080').replace(/\/+$/, '');
  const reportedBy = flag(argv, 'as') ?? os.hostname();

  const projectRoots = [process.cwd()];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') {
      const dir = argv[i + 1];
      if (dir !== undefined) projectRoots.push(path.resolve(expandHome(dir)));
    }
  }

  const entries = scan(projectRoots);
  const bySource = entries.reduce<Record<string, number>>((acc, e) => {
    acc[e.source] = (acc[e.source] ?? 0) + 1;
    return acc;
  }, {});
  const summary = Object.entries(bySource)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  // eslint-disable-next-line no-console
  console.log(`scanned ${entries.length} skills on ${reportedBy}${summary ? ` (${summary})` : ''}`);

  if (dryRun) {
    for (const e of entries) {
      // eslint-disable-next-line no-console
      console.log(`  ${e.name.padEnd(34)} ${e.source.padEnd(9)} ${(e.description ?? '').slice(0, 90)}`);
    }
    return;
  }
  if (entries.length === 0) {
    // eslint-disable-next-line no-console
    console.log('nothing to push — no SKILL.md found');
    return;
  }

  const body: SkillCatalogUpload = { reportedBy, entries, replaceReporter: true };
  const token = process.env['OTEL_INGEST_TOKEN'];
  const res = await fetch(`${url}/api/skills/catalog`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token !== undefined && token !== '' ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `POST ${url}/api/skills/catalog -> ${res.status} ${res.statusText}: ${text.slice(0, 300)}` +
        (res.status === 401 ? '\n(set OTEL_INGEST_TOKEN to the value the server was started with)' : ''),
    );
  }
  // eslint-disable-next-line no-console
  console.log(`pushed to ${url} -> ${text}`);
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
