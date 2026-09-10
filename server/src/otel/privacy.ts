/**
 * Telemetry privacy policy — the policy is DATA (the exact object served by
 * GET /api/telemetry-policy) and `sanitize` is its only interpreter, applied
 * at one choke point in the logs/metrics walkers BEFORE any handler runs.
 * Transparency by construction: what the endpoint shows is what executes.
 */
import type { AttrAction, EventPolicy, PrivacyMode, TelemetryPolicyResponse } from '@dash/shared';
import type { AttrMap, AttrValue } from './common';

/** Built-in Claude Code tools whose names survive minimal mode. */
const BUILTIN_TOOLS = new Set([
  'Agent',
  'Bash',
  'BashOutput',
  'Edit',
  'ExitPlanMode',
  'Glob',
  'Grep',
  'KillShell',
  'LS',
  'MultiEdit',
  'NotebookEdit',
  'NotebookRead',
  'Read',
  'Skill',
  'SlashCommand',
  'Task',
  'TodoRead',
  'TodoWrite',
  'WebFetch',
  'WebSearch',
  'Write',
]);

/** Keys allowed to survive inside the tool_parameters JSON blob. */
const TOOL_PARAM_KEEP = ['skill_name', 'subagent_type', 'mcp_server_name', 'mcp_tool_name'] as const;

/** tool_parameters keys that carry MCP names — dropped entirely in minimal mode. */
const TOOL_PARAM_MCP = new Set(['mcp_server_name', 'mcp_tool_name']);

const NOTES_COMMON = [
  'prompt and response content are never collected',
  'emails identify users — the dashboard is per-user by design',
];

type AttrRules = Record<string, AttrAction>;

function ev(event: string, description: string, defaultAction: AttrAction, attrs: AttrRules = {}): EventPolicy {
  return { event, attrs, defaultAction, description };
}

/** Balanced identity attrs every event keeps (who/when, never content). */
const IDENTITY_KEEP: AttrRules = {
  'event.name': 'keep',
  'event.timestamp': 'keep',
  'user.email': 'keep',
  'session.id': 'keep',
};

function balancedEvents(): EventPolicy[] {
  return [
    ev(
      'user_prompt',
      'Prompt length and timing only — the prompt text itself is dropped.',
      'keep',
      { prompt: 'drop', prompt_length: 'keep' },
    ),
    ev(
      'tool_result',
      'Tool name and outcome; tool_parameters is filtered down to skill_name/subagent_type — commands, file paths and arguments are dropped.',
      'keep',
      { tool_parameters: 'redact' },
    ),
    ev(
      'tool_decision',
      'Which tool was allowed or rejected, and by what (config, hook, user); tool_parameters is filtered to skill/agent/MCP name markers.',
      'keep',
      { tool_parameters: 'redact' },
    ),
    ev('api_request', 'Model, token counts, cost and duration; skill/agent names for cost attribution.', 'keep'),
    ev('api_error', 'Model, status code and duration of failed API calls.', 'keep'),
    ev('skill_activated', 'Skill name, how it was triggered, and where it came from (source, kind, plugin, marketplace).', 'keep'),
    ev('at_mention', 'Counted without detail — mention target attributes are dropped.', 'drop', {
      ...IDENTITY_KEEP,
    }),
    ev(
      '*',
      'Any other event or metric: operational counters and dimension names are kept; prompt text is dropped and tool_parameters is filtered.',
      'keep',
      { prompt: 'drop', tool_parameters: 'redact' },
    ),
  ];
}

/** Minimal = balanced minus names: skills/agents/servers/plugins become buckets. */
const MINIMAL_NAME_RULES: AttrRules = {
  'skill.name': 'redact',
  'agent.name': 'redact',
  'mcp_server.name': 'redact',
  'plugin.name': 'redact',
  tool_name: 'redact',
};

function minimalEvents(): EventPolicy[] {
  return [
    ev('user_prompt', 'Prompt timing only — both the text and its length are dropped.', 'keep', {
      prompt: 'drop',
      prompt_length: 'drop',
    }),
    ev(
      'tool_result',
      'Tool outcome; built-in tool names are kept, everything else becomes custom_tool/mcp_tool; tool_parameters is reduced to bucketed skill/agent markers.',
      'keep',
      { tool_parameters: 'redact', tool_name: 'redact' },
    ),
    ev(
      'tool_decision',
      'Allow/reject decisions with bucketed tool names (built-ins kept, others become custom_tool/mcp_tool); tool_parameters is reduced to bucketed markers.',
      'keep',
      { tool_name: 'redact', tool_parameters: 'redact' },
    ),
    ev(
      'api_request',
      'Model, token counts, cost and duration; skill/agent names are bucketed to custom_skill/custom.',
      'keep',
      { 'skill.name': 'redact', 'agent.name': 'redact' },
    ),
    ev('api_error', 'Model, status code and duration of failed API calls.', 'keep'),
    ev('skill_activated', 'Skill activations are counted; every skill name becomes the custom_skill bucket.', 'keep', {
      'skill.name': 'redact',
    }),
    ev('at_mention', 'Counted without detail — mention target attributes are dropped.', 'drop', {
      ...IDENTITY_KEEP,
    }),
    ev(
      '*',
      'Any other event or metric: operational counters kept; prompt text/length dropped; skill/agent/MCP/plugin names bucketed; tool_parameters filtered.',
      'keep',
      { prompt: 'drop', prompt_length: 'drop', tool_parameters: 'redact', ...MINIMAL_NAME_RULES },
    ),
  ];
}

function fullEvents(): EventPolicy[] {
  const keepAll = (event: string, description: string): EventPolicy => ev(event, description, 'keep');
  return [
    keepAll('user_prompt', 'Everything the exporter sends is kept, including prompt text if prompt logging is enabled client-side.'),
    keepAll('tool_result', 'Everything is kept, including full tool_parameters (commands, file paths, arguments).'),
    keepAll('tool_decision', 'Everything is kept.'),
    keepAll('api_request', 'Everything is kept.'),
    keepAll('api_error', 'Everything is kept.'),
    keepAll('skill_activated', 'Everything is kept.'),
    keepAll('at_mention', 'Everything is kept.'),
    keepAll('*', 'Any other event or metric is kept verbatim.'),
  ];
}

export function policyFor(mode: PrivacyMode): TelemetryPolicyResponse {
  switch (mode) {
    case 'full':
      return {
        mode,
        events: fullEvents(),
        notes: [
          'full mode keeps every attribute the exporter sends — including tool parameters such as commands and file paths',
          ...NOTES_COMMON.slice(1), // "never collected" would be misleading if prompt logging is on client-side
          'prompt text is only present when a developer opts in client-side (OTEL_LOG_USER_PROMPTS)',
        ],
      };
    case 'balanced':
      return {
        mode,
        events: balancedEvents(),
        notes: [
          ...NOTES_COMMON,
          'tool parameters (commands, file paths, arguments) are dropped before anything is stored',
        ],
      };
    case 'minimal':
      return {
        mode,
        events: minimalEvents(),
        notes: [
          ...NOTES_COMMON,
          'skill, agent, MCP server and plugin names are bucketed — only built-in tool names are stored',
        ],
      };
  }
}

// ---------------------------------------------------------------------------
// The one interpreter of the policy data
// ---------------------------------------------------------------------------

/** 'claude_code.tool_result' → 'tool_result'; metric names pass through to '*'. */
function shortEventName(eventName: string): string {
  return eventName.startsWith('claude_code.') ? eventName.slice('claude_code.'.length) : eventName;
}

function redactToolName(value: string): string {
  if (BUILTIN_TOOLS.has(value)) return value;
  if (value.startsWith('mcp__')) return 'mcp_tool';
  return 'custom_tool';
}

/** Filter the tool_parameters JSON blob down to the allow-listed keys. */
function redactToolParameters(raw: AttrValue, mode: PrivacyMode): string {
  if (typeof raw !== 'string') return '{}';
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return '{}';
  }
  if (typeof parsed !== 'object' || parsed === null) return '{}';
  const source = parsed as Record<string, unknown>;
  const kept: Record<string, string> = {};
  for (const key of TOOL_PARAM_KEEP) {
    const v = source[key];
    if (typeof v !== 'string' || v === '') continue;
    if (mode === 'minimal') {
      // MCP names must not survive minimal (parity with tool_name → 'mcp_tool')
      if (TOOL_PARAM_MCP.has(key)) continue;
      kept[key] = key === 'skill_name' ? 'custom_skill' : 'custom';
    } else {
      kept[key] = v;
    }
  }
  return JSON.stringify(kept);
}

/** Per-attribute 'redact' transformation; null → drop the attribute. */
function redactAttr(key: string, value: AttrValue, mode: PrivacyMode): AttrValue | null {
  switch (key) {
    case 'tool_parameters':
      return redactToolParameters(value, mode);
    case 'skill.name':
      return 'custom_skill';
    case 'agent.name':
      return 'custom';
    case 'mcp_server.name':
    case 'plugin.name':
      return 'redacted';
    case 'tool_name':
      return typeof value === 'string' ? redactToolName(value) : null;
    default:
      return null; // no known safe transformation — drop
  }
}

/**
 * Apply the policy to one event's (or metric datapoint's) attributes. Called
 * once per record BEFORE any handler sees the attrs — handlers can only store
 * what survives this filter.
 */
export function sanitize(eventName: string, attrs: AttrMap, policy: TelemetryPolicyResponse): AttrMap {
  if (policy.mode === 'full') return attrs;
  const short = shortEventName(eventName);
  const eventPolicy =
    policy.events.find((e) => e.event === short) ?? policy.events.find((e) => e.event === '*');
  if (!eventPolicy) return attrs;
  const out: AttrMap = new Map();
  for (const [key, value] of attrs) {
    const action = eventPolicy.attrs[key] ?? eventPolicy.defaultAction;
    if (action === 'drop') continue;
    if (action === 'keep') {
      out.set(key, value);
      continue;
    }
    const redacted = redactAttr(key, value, policy.mode);
    if (redacted !== null) out.set(key, redacted);
  }
  return out;
}
