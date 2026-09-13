/**
 * Admin-editable coach guidance. The override lives in sync_state so it needs
 * no schema change; null/absent means "use the built-in default". Works
 * whether or not the AI coach is configured, so Settings can show it either way.
 */
import { createHash } from 'node:crypto';
import type { CoachPromptResponse } from '@dash/shared';
import type { Repos } from '../repos';
import { DEFAULT_COACH_GUIDANCE, OUTPUT_CONTRACT } from '../ai/prompt';
import { nowIso } from '../util/time';

const KEY_TEXT = 'ai_coach_guidance';
const KEY_AT = 'ai_coach_guidance_updated_at';

export const MAX_GUIDANCE_CHARS = 20_000;

export function effectiveGuidance(repos: Repos): string {
  const custom = repos.sync.getState(KEY_TEXT);
  return custom && custom.trim() !== '' ? custom : DEFAULT_COACH_GUIDANCE;
}

/** Short fingerprint of the guidance in force — mixed into the cache hash. */
export function guidanceHash(repos: Repos): string {
  return createHash('sha256').update(effectiveGuidance(repos)).digest('hex').slice(0, 16);
}

export function getCoachPrompt(repos: Repos, opts: { enabled: boolean; adminConfigured: boolean }): CoachPromptResponse {
  const custom = repos.sync.getState(KEY_TEXT);
  return {
    defaultGuidance: DEFAULT_COACH_GUIDANCE,
    customGuidance: custom && custom.trim() !== '' ? custom : null,
    effectiveGuidance: effectiveGuidance(repos),
    outputContract: OUTPUT_CONTRACT,
    updatedAt: repos.sync.getState(KEY_AT),
    enabled: opts.enabled,
    adminConfigured: opts.adminConfigured,
  };
}

/** null resets to the built-in default. Clears every cached note so the change shows at once. */
export function setCoachGuidance(repos: Repos, guidance: string | null): void {
  if (guidance === null) {
    repos.sync.deleteState(KEY_TEXT);
    repos.sync.deleteState(KEY_AT);
  } else {
    repos.sync.setState(KEY_TEXT, guidance);
    repos.sync.setState(KEY_AT, nowIso());
  }
  repos.aiRecs.clearAll();
}
