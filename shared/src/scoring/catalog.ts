import type { BadgeId, SegmentTier } from '../types.js';

/** Display catalog — single source of truth for chips, tooltips, and the guide drawer. */

export interface BadgeMeta {
  id: BadgeId;
  name: string;
  emoji: string;
  description: string;
  rule: string;
}

export const BADGE_CATALOG: Record<BadgeId, BadgeMeta> = {
  pr_machine: {
    id: 'pr_machine',
    name: 'PR Machine',
    emoji: '🚀',
    description: 'Ships pull requests straight from Claude Code.',
    rule: 'PRs created by Claude Code ≥ org 80th percentile, minimum 5.',
  },
  ship_it: {
    id: 'ship_it',
    name: 'Ship It',
    emoji: '📦',
    description: 'Commits early, commits often — through Claude Code.',
    rule: 'Commits by Claude Code ≥ org 80th percentile, minimum 15.',
  },
  cache_master: {
    id: 'cache_master',
    name: 'Cache Master',
    emoji: '⚡',
    description: 'Reuses context masterfully — the biggest cost lever there is.',
    rule: 'Cache-read ratio ≥ 70% over at least 1M input tokens.',
  },
  night_owl: {
    id: 'night_owl',
    name: 'Night Owl',
    emoji: '🦉',
    description: 'Does their best Claude work after dark.',
    rule: 'By default ≥ 30% of your activity between 22:00 and 05:00 local time, over ≥ 10 active days in the last 90. Window and bar are org-configurable.',
  },
  early_bird: {
    id: 'early_bird',
    name: 'Early Bird',
    emoji: '🌅',
    description: 'First one in, coffee and Claude before standup.',
    rule: 'By default ≥ 15% of your activity between 05:00 and 10:00 local time, over ≥ 10 active days in the last 90 — a lower bar than Night Owl because the morning window is shorter. Window and bar are org-configurable.',
  },
  streak_bronze: {
    id: 'streak_bronze',
    name: 'Streak · Bronze',
    emoji: '🥉',
    description: 'A solid run of days with Claude, back to back.',
    rule: 'Best run of active days in a row in the last 90 — 5 by default. What that costs depends on your org: under the work-week rule a day you never work doesn\'t break a run, under the calendar rule every day counts. Threshold and rule are org-configurable.',
  },
  streak_silver: {
    id: 'streak_silver',
    name: 'Streak · Silver',
    emoji: '🥈',
    description: 'A long unbroken run with Claude.',
    rule: 'Best run of active days in a row in the last 90 — 10 by default, on your org\'s streak rule.',
  },
  streak_gold: {
    id: 'streak_gold',
    name: 'Streak · Gold',
    emoji: '🥇',
    description: 'Weeks of showing up, without a miss.',
    rule: 'Best run of active days in a row in the last 90 — 20 by default, on your org\'s streak rule.',
  },
  streak_kryptonite: {
    id: 'streak_kryptonite',
    name: 'Streak · Kryptonite',
    emoji: '💚',
    description: 'Workaholic — forty days of showing up, zero misses.',
    rule: 'Best run of active days in a row in the last 90 — 40 by default, on your org\'s streak rule.',
  },
  polyglot: {
    id: 'polyglot',
    name: 'Polyglot',
    emoji: '🎭',
    description: 'Picks the right model for the job — fluent in several.',
    rule: '≥ 3 models, each with ≥ 5% of personal token volume.',
  },
  marathon: {
    id: 'marathon',
    name: 'Marathon',
    emoji: '🏃',
    description: 'Session volume in a league of its own.',
    rule: 'Sessions ≥ org 90th percentile, minimum 60.',
  },
  high_output: {
    id: 'high_output',
    name: 'High Output',
    emoji: '🏗️',
    description: 'Among the org’s top line producers with Claude.',
    rule: 'Lines added by Claude Code ≥ org 80th percentile.',
  },
  efficient: {
    id: 'efficient',
    name: 'Efficient',
    emoji: '🎯',
    description: 'Gets more out of every session than almost anyone.',
    rule: 'Lines per session ≥ org 80th percentile, with ≥ 10 sessions.',
  },
  high_acceptance: {
    id: 'high_acceptance',
    name: 'High Acceptance',
    emoji: '🤝',
    description: 'Claude’s suggestions land — and stay.',
    rule: 'Tool acceptance rate ≥ 40% over ≥ 20 decisions.',
  },
  experimenting: {
    id: 'experimenting',
    name: 'Experimenting',
    emoji: '🧪',
    description: 'Deep in exploration — the output is coming.',
    rule: 'Adoption score ≥ 60 while impact is still < 40. Keep going! Once your impact passes 40 the badge no longer applies — you\'ve graduated.',
  },
  skill_smith: {
    id: 'skill_smith',
    name: 'Skill Smith',
    emoji: '🧰',
    description: 'Reaches for the right skill instead of raw prompting.',
    rule: '≥ 5 distinct skills used and ≥ 20 skill invocations in the range.',
  },
  plan_first: {
    id: 'plan_first',
    name: 'Plan-First',
    emoji: '🧭',
    description: 'Thinks before building — plan mode is a habit.',
    rule: 'Entered plan mode ≥ 10 times in the range.',
  },
  dream_builder: {
    id: 'dream_builder',
    name: 'Dream Builder',
    emoji: '🧞',
    description: 'Turns approved plans into shipped work.',
    rule: '≥ 5 plans approved (ExitPlanMode accepted) and ≥ 15 commits in the range.',
  },
  well_connected: {
    id: 'well_connected',
    name: 'Well Connected',
    emoji: '🔌',
    description: 'Wires MCP tools into the work — and they deliver.',
    rule: '≥ 150 MCP calls across ≥ 3 active servers (≥ 10 calls each) with ≥ 90% success.',
  },
  orchestrator: {
    id: 'orchestrator',
    name: 'Orchestrator',
    emoji: '🎼',
    description: 'Delegates to subagents — and they deliver.',
    rule: '≥ 25 subagent runs across ≥ 2 agent types with ≥ 90% success.',
  },
  deep_diver: {
    id: 'deep_diver',
    name: 'Deep Diver',
    emoji: '🤿',
    description: 'Works sessions so long they outgrow the context window — and keeps going.',
    rule: '≥ 25 context compactions all-time (counted over history, not the selected range).',
  },
};

export interface SegmentMeta {
  tier: SegmentTier;
  name: string;
  emoji: string;
  description: string;
  rule: string;
  /** matching CSS custom property set in the web theme */
  cssVar: string;
}

export const SEGMENT_CATALOG: Record<SegmentTier, SegmentMeta> = {
  starter: {
    tier: 'starter',
    name: 'Starter',
    emoji: '🌱',
    description: 'Just getting started with Claude Code.',
    rule: 'Adoption score below 20.',
    cssVar: '--tier-starter',
  },
  explorer: {
    tier: 'explorer',
    name: 'Explorer',
    emoji: '🧭',
    description: 'Actively learning and experimenting.',
    rule: 'Between the other tiers — building momentum.',
    cssVar: '--tier-explorer',
  },
  producer: {
    tier: 'producer',
    name: 'Producer',
    emoji: '🚀',
    description: 'Regular, productive Claude Code usage.',
    rule: 'Adoption ≥ 50 and impact ≥ 40.',
    cssVar: '--tier-producer',
  },
  champion: {
    tier: 'champion',
    name: 'Champion',
    emoji: '🏆',
    description: 'Leading the org in both usage and shipped output.',
    rule: 'Adoption ≥ 80 and impact ≥ 80.',
    cssVar: '--tier-champion',
  },
};

export const SEGMENT_ORDER: SegmentTier[] = ['champion', 'producer', 'explorer', 'starter'];

/** One weighted ingredient of a score, rendered as a row in the info popover. */
export interface GuidePart {
  /** e.g. '35%' — kept as a string so 4/7-style redistributed weights render honestly */
  weight: string;
  label: string;
  note: string;
}

/** Plain-language metric documentation for info popovers + the guide drawer. */
export const METRIC_GUIDE: Record<
  string,
  { name: string; formula: string; explanation: string; parts?: GuidePart[] }
> = {
  adoption: {
    name: 'Adoption score',
    formula: '0.40·S(sessions) + 0.40·(active days ÷ workdays × 100) + 0.20·S(tool decisions)',
    parts: [
      { weight: '40%', label: 'Sessions', note: 'vs a target of 8 per workday' },
      { weight: '40%', label: 'Consistency', note: 'active days ÷ workdays — showing up regularly' },
      { weight: '20%', label: 'Tool decisions', note: 'edits reviewed, vs 50 per workday' },
    ],
    explanation:
      'How often and how consistently you work with Claude Code. Every part is measured against a fixed target — half the target ≈ 71 points, at target = 100, beyond it adds nothing. Only your own work moves your score.',
  },
  impact: {
    name: 'Impact score',
    formula: '0.40·S(lines added) + 0.30·S(commits) + 0.30·S(pull requests)',
    parts: [
      { weight: '40%', label: 'Lines added', note: 'vs 1,400 per workday' },
      { weight: '30%', label: 'Commits', note: 'vs 7.5 per workday' },
      { weight: '30%', label: 'Pull requests', note: 'vs 0.5 per workday (GitHub-counted only)' },
    ],
    explanation:
      'Code that actually ships: written, committed, PR’d. If fewer than 25% of active users can produce a part at all (e.g. PRs in a non-GitHub org), its weight moves to the other parts — nobody is penalized for a tool gap.',
  },
  efficiency: {
    name: 'Efficiency score',
    formula: '0.35·S(lines/session) + 0.45·S(lines/$) + 0.20·(cache ratio × 100)',
    parts: [
      { weight: '45%', label: 'Lines per $', note: 'the biggest part — lots of code at low cost' },
      { weight: '35%', label: 'Lines per session', note: 'focused sessions that produce, vs 430' },
      { weight: '20%', label: 'Cache ratio', note: 'reusing context instead of re-paying for it' },
    ],
    explanation:
      'Output per unit of effort and money. Shipping a lot at low cost is the strongest signal here. Halved below 10 sessions (too little data to judge).',
  },
  trust: {
    name: 'Trust score',
    formula: 'min(acceptance rate ÷ 0.60, 1) × 100',
    parts: [
      { weight: '100%', label: 'Acceptance rate', note: 'edits kept ÷ edits reviewed; 60% already = 100 pts' },
    ],
    explanation:
      'How often Claude’s file edits are kept. Rejecting bad suggestions is healthy, so 60% acceptance already counts as perfect. Halved below 20 decisions (too little data to judge).',
  },
  composite: {
    name: 'Composite score',
    formula: '0.35·Adoption + 0.35·Impact + 0.15·Efficiency + 0.15·Trust',
    parts: [
      { weight: '35%', label: 'Adoption', note: 'how often & how consistently you use it' },
      { weight: '35%', label: 'Impact', note: 'code that ships: lines, commits, PRs' },
      { weight: '15%', label: 'Efficiency', note: 'output per session and per dollar' },
      { weight: '15%', label: 'Trust', note: 'how often your edits are kept' },
    ],
    explanation:
      'The leaderboard rank. Every part is scored against fixed targets, not against other people — half the target ≈ 71 points, at target = 100, beyond it adds nothing. Withheld ("—") under 3 active days.',
  },
  acceptanceRate: {
    name: 'Acceptance rate',
    formula: 'accepted ÷ (accepted + rejected) across Edit, MultiEdit, Write, NotebookEdit',
    explanation:
      'Share of Claude’s proposed file changes that were accepted. Only these four tools report accept/reject.',
  },
  cacheRatio: {
    name: 'Cache efficiency',
    formula: 'cache-read tokens ÷ (cache-read + fresh input tokens)',
    explanation:
      'How much of the context Claude reads comes from the prompt cache instead of being re-sent (and re-billed). Higher is cheaper and faster.',
  },
  timeSaved: {
    name: 'Time saved',
    formula: 'net lines by Claude ÷ (lines per minute × 60)',
    explanation:
      'Estimated engineering hours saved, using the adjustable lines-per-minute assumption in Settings.',
  },
  costSavings: {
    name: 'Cost savings',
    formula: 'hours saved × hourly rate',
    explanation: 'Time saved converted to money using the adjustable hourly rate.',
  },
  roi: {
    name: 'ROI',
    formula: '(savings − spend) ÷ spend × 100, spend = seats × seat cost + API cost',
    explanation: 'Return on the Claude investment under the adjustable assumptions.',
  },
  activeUsers: {
    name: 'Active users',
    formula: 'users with ≥ 1 Claude Code session in the range',
    explanation: 'API-key actors are excluded from people metrics (their spend still counts).',
  },
  partialDay: {
    name: 'Partial days',
    formula: 'today (UTC) — data arrives with up to 1 hour delay',
    explanation: 'Hollow/dashed points mean the day isn’t finished; numbers will still grow.',
  },
  trueCost: {
    name: 'Actual cost',
    formula: 'daily invoice-grade USD from the Anthropic cost report',
    explanation:
      'What the org is actually billed, including web search and code execution. Note: Priority Tier spend is excluded by the API.',
  },
  estimatedVsActual: {
    name: 'Estimated vs actual',
    formula: 'Claude Code per-model estimates vs the billing-grade cost report',
    explanation:
      'Estimates are per-user but approximate (and notional for subscription seats); the cost report is what the invoice says, but has no per-user breakdown. Divergence is expected — big gaps mean non-Claude-Code API usage or subscription-seat traffic.',
  },
  serviceTier: {
    name: 'Service tier mix',
    formula: 'tokens by tier: standard / batch / priority / flex',
    explanation:
      'Batch runs asynchronously at a ~50% discount — a large all-standard share on offline-able workloads is a savings opportunity.',
  },
  contextWindow: {
    name: 'Context window mix',
    formula: 'tokens by request context size: 0–200k vs 200k–1M',
    explanation: 'Long-context (200k+) requests are billed at higher rates — worth knowing who needs them.',
  },
  webSearch: {
    name: 'Web search usage',
    formula: 'server-side web_search_requests from the usage report',
    explanation: 'How often Claude reached for web search. Each request carries a small per-call cost.',
  },
  customerType: {
    name: 'API vs subscription',
    formula: 'sessions and estimated cost split by billing type',
    explanation:
      'Whether Claude Code ran on a subscription seat or on API billing. Estimated cost for seats is notional (not billed per token).',
  },
  wauMau: {
    name: 'DAU / WAU / MAU',
    formula: 'distinct active users that day / trailing 7 days / trailing 30 days',
    explanation: 'The adoption pulse: rising WAU with flat DAU means broader but less frequent usage.',
  },
  sessions: {
    name: 'Sessions',
    formula: 'distinct Claude Code sessions started (per Anthropic analytics)',
    explanation:
      'A session is one Claude Code conversation — opening the CLI/IDE panel and working through a task. Long tasks are still one session; ten quick questions are ten.',
  },
  netLines: {
    name: 'Net lines',
    formula: 'lines added − lines removed, as written by Claude Code',
    explanation:
      'Only counts lines Claude Code itself wrote or deleted across all files — not lines the developer typed. Negative days usually mean refactoring/cleanup, which is healthy.',
  },
  commitsPrs: {
    name: 'Commits & PRs',
    formula: 'commits and pull requests created through Claude Code’s own git flows',
    explanation:
      'Only actions Claude Code performed count — commits or PRs the developer made manually are invisible to the API. PR counting works only with GitHub tooling.',
  },
  estCost: {
    name: 'Estimated cost',
    formula: 'per-model tokens × list prices, as estimated by Anthropic',
    explanation:
      'An estimate, not the invoice: for subscription seats it’s the notional API-equivalent value of the usage. For billing-grade numbers see the Costs page.',
  },
  activityTrend: {
    name: 'Activity trend',
    formula: 'sessions (bars) and distinct active users (line) per period',
    explanation:
      'The heartbeat chart: bars show how much Claude Code is used, the line shows how many different people used it. Bars up + line flat = the same people using it more.',
  },
  codeImpact: {
    name: 'Code impact',
    formula: 'lines added (up) vs lines removed (down) by Claude Code, with the net line',
    explanation:
      'Diverging bars show the churn Claude generates; the line is the net result. Big removals are often refactors — not a bad sign.',
  },
  costByModel: {
    name: 'Cost by model',
    formula: 'estimated spend per model per period, stacked',
    explanation:
      'Where the money goes across models. A growing share of a heavy model is the first thing to check when spend jumps.',
  },
  modelMix: {
    name: 'Model & token mix',
    formula: 'token volume per model, split into input / output / cache-read / cache-creation',
    explanation:
      'Which models the org actually uses and what kind of tokens they burn. Cache-read tokens are ~10× cheaper than fresh input — a big cache-read block is a good sign. Hover for each model’s cost share.',
  },
  whenWeWork: {
    name: 'When we work',
    formula: 'token activity by hour × weekday, local time',
    explanation:
      'When Claude Code is actually in use. Row-normalized mode shows each day’s shape regardless of volume. Covers signed-in (OAuth) usage only — API-key traffic has no per-hour attribution.',
  },
  quadrant: {
    name: 'Adoption × Impact',
    formula: 'each dot = one person, positioned by their Adoption and Impact scores',
    explanation:
      'Top-right (≥80/≥80) is Champion territory; high adoption with low impact means lots of usage that isn’t landing as shipped code yet — a coaching opportunity, not a failure.',
  },
  segmentDistribution: {
    name: 'Segment distribution',
    formula: 'people per tier: Starter / Explorer / Producer / Champion',
    explanation:
      'The org’s maturity curve. Healthy adoption shows the mass moving right over time; a big Starter block is enablement work waiting to happen.',
  },
  terminalMix: {
    name: 'Environment mix',
    formula: 'sessions by terminal type (VS Code, iTerm, tmux…)',
    explanation: 'Where people run Claude Code from — useful for targeting IDE-specific enablement.',
  },
  personalTrend: {
    name: 'Personal trend',
    formula: 'your sessions per day; splittable by terminal or by model',
    explanation:
      'Your own usage rhythm. The “by model” split shows only cost per model per day (the API has no per-model session counts); “by terminal” splits real sessions.',
  },
  scoreRadar: {
    name: 'Score radar',
    formula: 'your four axis scores vs the org median (dashed)',
    explanation:
      'Adoption = how often, Impact = what shipped, Efficiency = output per effort/$, Trust = edits kept. The dashed shape is the org median — outside it means above-median.',
  },
  activityCalendar: {
    name: 'Activity calendar',
    formula: 'one cell per day, colored by sessions / net lines / cost',
    explanation:
      'A year of activity at a glance. Streaks follow your org\'s rule: consecutive calendar days, or runs measured against the work week you actually keep.',
  },
  badgeCase: {
    name: 'Badge case',
    formula: 'earned badges bright, unearned ghosted with a progress bar',
    explanation:
      'Most thresholds are percentile-based against the org for the selected range, so they self-calibrate as the org grows. Hover any badge for its exact rule.',
  },
  teamVsTeam: {
    name: 'Team vs team',
    formula: 'metrics normalized per active member (toggle for absolute)',
    explanation:
      'Per-member normalization keeps a 12-person team from “winning” against a 4-person team by headcount alone. Use absolute mode for raw totals.',
  },
  teamRadar: {
    name: 'Team radar',
    formula: 'average member scores per team across the four axes',
    explanation: 'Shape comparison between teams — a team can be high-adoption but low-trust, etc.',
  },
  topMovers: {
    name: 'Top movers',
    formula: 'largest session growth vs the previous 14 days',
    explanation: 'Who is accelerating right now — momentum, not absolute rank.',
  },
  acceptanceByTool: {
    name: 'Acceptance by tool',
    formula: 'accepted vs rejected edits per tool (Edit / MultiEdit / Write / Notebook)',
    explanation:
      'How often Claude’s proposed file changes are kept, per tool. Only these four tools report accept/reject — Bash, Read and others have no accept flow.',
  },
  streak: {
    name: 'Streak',
    formula: 'active days in a row (trailing 90 days), on your org\'s streak rule',
    explanation:
      'Two rules exist and your org picks one. Work week (the default) learns the weekdays you actually work from your own history — Sun–Thu, Mon–Fri or six days all measure the same way — so a day off you never work doesn’t break a run, a day you do work always counts, and more than a week away ends it. Calendar counts plain consecutive days: every day counts and any gap ends the run, so a five-day week tops out at 5 and going past that means working a weekend. Either way today gets grace until it ends — an inactive today doesn’t reset you, it measures the run through yesterday.',
  },
  skillsUsage: {
    name: 'Skills usage',
    formula: 'skill_activated events from Claude Code telemetry, per skill',
    explanation:
      'Which skills (slash commands and proactive skill activations) the org actually uses. Comes from the OpenTelemetry rollout, not the Anthropic API — machines without the managed telemetry settings are invisible here.',
  },
  skillTriggers: {
    name: 'How skills start',
    formula: 'invocation trigger: typed /command vs Claude activating it proactively vs nested in another skill',
    explanation:
      'A high proactive share means Claude reaches for the skill on its own — usually a sign the skill description is well written.',
  },
  agentsUsage: {
    name: 'Subagent usage',
    formula: 'Agent/Task tool calls from telemetry, split by subagent type',
    explanation:
      'How much work gets delegated to subagents (Explore, Plan, custom agents…) and how often those runs succeed.',
  },
  toolsUsage: {
    name: 'Tool usage',
    formula: 'tool_result events per tool, with accept/reject where the tool has a decision flow',
    explanation:
      'The full tool picture beyond the four file-edit tools the Admin API reports — Bash, Read, web, MCP tools and more.',
  },
  activeTime: {
    name: 'Engaged time',
    formula: 'active_time telemetry: seconds the human (or the CLI) was actively working',
    explanation:
      'Genuine engagement, not wall-clock. "User" time is the developer interacting; "CLI" time is Claude working. This is the honest measure — session length includes idle.',
  },
  sessionLength: {
    name: 'Session length',
    formula: 'wall-clock span from a session\'s first to last telemetry event',
    explanation:
      'Includes idle time (a session left open over lunch counts) — compare with Engaged time for the real picture. Sessions crossing midnight attribute to their starting day.',
  },
  promptCadence: {
    name: 'Prompts',
    formula: 'user_prompt telemetry events (content is never collected)',
    explanation:
      'How often developers prompt Claude. Only the count is stored — prompt text never leaves the developer\'s machine.',
  },
  errorRate: {
    name: 'Error rate',
    formula: 'API errors ÷ (successful requests + errors)',
    explanation:
      'How often Claude Code requests fail (rate limits, server errors). A rising rate usually means rate-limit pressure — check the 429 split.',
  },
  refusals: {
    name: 'Refusals',
    formula: 'api_refusal telemetry events',
    explanation: 'Requests Claude declined to complete. Occasional refusals are normal; clusters are worth a look.',
  },
  compactions: {
    name: 'Compactions',
    formula: 'context-compaction telemetry events',
    explanation:
      'How often sessions outgrow the context window and get compacted. Frequent compaction suggests very long sessions — sometimes efficient, sometimes a sign to start fresh.',
  },
  decisionSources: {
    name: 'Approval sources',
    formula: 'tool_decision.source: config / hook / user-permanent / user-temporary / abort / reject',
    explanation:
      'How tool permissions get decided: pre-approved by config, remembered "always allow", one-off clicks, or rejections. High config share = a well-tuned allowlist.',
  },
  permissionModes: {
    name: 'Permission modes',
    formula: 'permission_mode_changed telemetry events per target mode',
    explanation:
      'Who switches Claude Code into which permission mode (including bypass/auto-accept modes) and how often — governance visibility, not a gotcha.',
  },
  mcpUsage: {
    name: 'MCP servers',
    formula: 'MCP tool calls, tokens and connections per server',
    explanation:
      'Which connected tools (Jira, Slack, internal MCP servers…) the team actually uses through Claude, and which fail to connect.',
  },
  pluginAdoption: {
    name: 'Plugins',
    formula: 'plugin install/load telemetry events',
    explanation: 'Which Claude Code plugins are installed and actually loaded across the team.',
  },
  versionDrift: {
    name: 'Version drift',
    formula: 'latest Claude Code version reported per machine',
    explanation:
      'Who runs which Claude Code version. Old versions miss features and fixes — nudge the stragglers.',
  },
  modelSpeedMix: {
    name: 'Model / speed / effort mix',
    formula: 'tokens by model × speed × reasoning-effort attributes',
    explanation: 'How the team balances fast mode, effort levels and models — the cost/quality dial in aggregate.',
  },
  whatsCollected: {
    name: 'What\'s collected',
    formula: 'the exact ingest policy the server is running (keep / drop / redact per attribute)',
    explanation:
      'Full transparency: this page renders the same policy object the server applies to incoming telemetry, so what you see is exactly what\'s stored. Prompt and response content are never collected.',
  },
};
