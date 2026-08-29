import './shims';
import { capabilitiesFor } from '@dash/shared';
import { AnthropicClient } from './anthropic/client';
import { EnterpriseClient } from './anthropic/enterpriseClient';
import { buildApp } from './app';
import { openDb } from './db/connection';
import { migrate } from './db/migrate';
import { loadEnv, type Env } from './env';
import { createRepos, type Repos } from './repos';
import { ConsoleSyncPlan } from './sync/consolePlan';
import { EnterpriseSyncPlan } from './sync/enterprise';
import { SyncLogBus } from './sync/logBus';
import { SyncManager, type SyncPlan } from './sync/manager';
import { startScheduler } from './sync/schedule';
import { TelemetrySyncPlan } from './sync/telemetryPlan';
import { configureOrgTimezone, configureStreakMode } from './util/time';

/** One plan per data source; demo has none (no scheduler, no API calls). */
function createSyncPlan(env: Env, repos: Repos, logBus: SyncLogBus): SyncPlan | null {
  switch (env.dataSource) {
    case 'demo':
      return null;
    case 'telemetry':
      return new TelemetrySyncPlan(repos);
    case 'enterprise':
      return new EnterpriseSyncPlan(
        env,
        repos,
        new EnterpriseClient(
          env.enterpriseAnalyticsKey ?? '',
          {
            baseUrl: env.enterpriseApiBase,
            minRequestGapMs: env.enterprisePaceMs,
          },
          logBus,
        ),
      );
    case 'console':
      return new ConsoleSyncPlan(env, repos, new AnthropicClient(env.adminApiKey ?? '', logBus));
  }
}

const SOURCE_LABEL: Record<Env['dataSource'], string> = {
  demo: 'demo (seeded data)',
  telemetry: 'telemetry (OTLP push receiver)',
  enterprise: 'enterprise (claude.ai Analytics API)',
  console: 'console (Admin API)',
};

async function main(): Promise<void> {
  const env = loadEnv();
  // before any repo/route touches a date key
  configureOrgTimezone(env.orgTimezone);
  configureStreakMode(env.streakMode);

  const db = openDb(env.dbPath);
  migrate(db);

  const repos = createRepos(db, { rosterScoped: capabilitiesFor(env.dataSource).roster });
  repos.settings.ensureDefaults();

  const syncLog = new SyncLogBus();
  const plan = createSyncPlan(env, repos, syncLog);
  const syncManager = new SyncManager(env, repos, plan, syncLog);

  const app = await buildApp({ env, db, repos, syncManager, syncLog });

  if (!env.demoMode) {
    startScheduler(env, syncManager, repos);
  }

  await app.listen({ port: env.port, host: '0.0.0.0' });

  const lines = [
    '',
    '  ┌─────────────────────────────────────────────────┐',
    '  │  Claude Code Org Dashboard — server up           │',
    `  │  port:      ${String(env.port).padEnd(37)}│`,
    `  │  db:        ${env.dbPath.slice(0, 36).padEnd(37)}│`,
    `  │  source:    ${SOURCE_LABEL[env.dataSource].padEnd(37)}│`,
    `  │  privacy:   ${env.privacyMode.padEnd(37)}│`,
    `  │  demo mode: ${(env.demoMode ? 'ON (no scheduler, no API calls)' : 'off').padEnd(37)}│`,
    `  │  nightly:   ${(env.demoMode ? '—' : `${env.syncCron} (${env.syncTz})`).padEnd(37)}│`,
    `  │  intraday:  ${(env.demoMode ? '—' : env.intradaySyncMinutes > 0 ? `every ${env.intradaySyncMinutes}m` : 'disabled').padEnd(37)}│`,
    '  └─────────────────────────────────────────────────┘',
    '',
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('fatal:', err);
  process.exit(1);
});
