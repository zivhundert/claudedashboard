import type { Db } from '../db/connection';
import { ApiKeyRepo } from './apiKeyRepo';
import { BreakdownRepo } from './breakdownRepo';
import { CostRepo } from './costRepo';
import { DimensionsRepo } from './dimensionsRepo';
import { OrgSummaryRepo } from './orgSummaryRepo';
import { OtelPacksRepo } from './otelPacksRepo';
import { OtelRepo } from './otelRepo';
import { SettingsRepo } from './settingsRepo';
import { SyncRepo } from './syncRepo';
import { TeamRepo } from './teamRepo';
import { UsageRepo } from './usageRepo';
import { UserRepo } from './userRepo';

export interface Repos {
  users: UserRepo;
  teams: TeamRepo;
  usage: UsageRepo;
  sync: SyncRepo;
  settings: SettingsRepo;
  cost: CostRepo;
  apiKeys: ApiKeyRepo;
  dimensions: DimensionsRepo;
  orgSummaries: OrgSummaryRepo;
  otel: OtelRepo;
  otelPacks: OtelPacksRepo;
  breakdown: BreakdownRepo;
}

export function createRepos(db: Db, opts: { rosterScoped: boolean }): Repos {
  return {
    users: new UserRepo(db),
    teams: new TeamRepo(db, opts.rosterScoped),
    usage: new UsageRepo(db),
    sync: new SyncRepo(db),
    settings: new SettingsRepo(db),
    cost: new CostRepo(db),
    apiKeys: new ApiKeyRepo(db),
    dimensions: new DimensionsRepo(db),
    orgSummaries: new OrgSummaryRepo(db),
    otel: new OtelRepo(db),
    otelPacks: new OtelPacksRepo(db),
    breakdown: new BreakdownRepo(db, opts.rosterScoped),
  };
}

export {
  ApiKeyRepo,
  BreakdownRepo,
  CostRepo,
  DimensionsRepo,
  OrgSummaryRepo,
  OtelPacksRepo,
  OtelRepo,
  SettingsRepo,
  SyncRepo,
  TeamRepo,
  UsageRepo,
  UserRepo,
};
