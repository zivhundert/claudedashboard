/**
 * Tiny stand-in for an Anthropic-format /v1/messages endpoint (Claude on
 * Microsoft Foundry, or a LiteLLM-style proxy) so the AI coach can be
 * exercised end to end without spending money or needing the VPN.
 *
 *   tsx server/scripts/mock-foundry.ts                 # port 8898
 *   MOCK_MODE=text tsx server/scripts/mock-foundry.ts  # see modes below
 *
 * then start the server with FOUNDRY_API_KEY=test FOUNDRY_BASE_URL=http://localhost:8898
 *
 * localhost is not a Foundry host, so the server adds no /anthropic suffix and
 * the SDK posts to http://localhost:8898/v1/messages — exactly what a proxy
 * serves at its root. Any other path answers 404 so a wrong base URL shows up
 * here as `model_not_deployed`, like it would in production.
 *
 * Modes (MOCK_MODE):
 *   ok            valid JSON payload as a text block               (default)
 *   text          the same payload wrapped in prose → exercises the JSON extractor
 *   reject-format first request with output_config.format gets a 400 naming it,
 *                 the retry succeeds → exercises the degradation ladder
 *   fail          500 on every request
 *   slow          answers after 30 s
 *   refusal       stop_reason: refusal
 */
import http from 'node:http';

const PORT = Number(process.env['MOCK_PORT'] ?? 8898);
const MODE = process.env['MOCK_MODE'] ?? 'ok';

const PAYLOAD = {
  summary:
    'You use Claude Code almost every working day (18 of 22) in long sessions, mostly for edits you keep — but rarely to plan first, and never with skills or subagents.',
  dataThin: false,
  strengths: [
    {
      title: 'A steady daily habit',
      why: 'Active on 18 of 22 workdays (82% consistency) with a current streak of 6 days — the routine is already there.',
      evidence: ['activity.consistencyPct', 'activity.streakCurrent', 'activity.activeDays'],
    },
  ],
  recommendations: [
    {
      id: 'plan-before-large-writes',
      title: 'Plan before large writes',
      why: 'You rejected 80 of 255 Write edits (31%) but only 154 of 515 Edit edits (30%) — and telemetry shows 2 plan-mode entries across 174 sessions.',
      tryThis: 'Press Shift+Tab to enter plan mode for anything touching more than two files; approve the plan, then let Claude Code edit one file at a time.',
      expectedEffect: { area: 'quality', note: 'agreed plans produce edits you keep instead of rejecting' },
      evidence: ['edits.perTool.write.rejected', 'edits.perTool.write.accepted', 'telemetry.planModeEntries', 'activity.sessions'],
    },
    {
      id: 'fix-or-drop-the-failing-mcp-server',
      title: 'Fix or drop the failing MCP server',
      why: 'Of 696 MCP calls, 37 failed; the jira server accounts for most failures (18% of its calls).',
      tryThis: 'Check the jira server configuration and credentials in your MCP settings, or remove it until it is fixed — every failed call costs a retry and context.',
      expectedEffect: { area: 'toolkit', note: 'a reliable toolkit means fewer interrupted tasks' },
      evidence: ['telemetry.mcpServers', 'telemetry.mcpFailures', 'telemetry.mcpCalls'],
    },
    {
      id: 'compact-instead-of-restarting',
      title: 'Compact instead of restarting',
      why: 'Cache hit rate is 64% with 63 compactions over 174 sessions — a third of your sessions start cold and re-read everything at full price ($60 this range).',
      tryThis: 'Keep one session per task and run /compact when the context gets long, instead of opening a fresh session for the same work.',
      expectedEffect: { area: 'efficiency', note: 'reused context is read from cache at a fraction of the price' },
      evidence: ['cost.cacheRatioPct', 'telemetry.compactions', 'cost.costUsd'],
    },
    {
      id: 'finish-tasks-with-a-commit',
      title: 'Finish tasks with a commit',
      why: '67 commits and 10 pull requests against 174 sessions — most sessions end without the work being committed from Claude Code.',
      tryThis: 'End each task with "run the tests, then commit this with a conventional message" — and for a finished feature, "open the PR".',
      expectedEffect: { area: 'delivery', note: 'the work you already did gets shipped from where it was done' },
      evidence: ['output.commits', 'output.pullRequests', 'activity.sessions', 'context.pullRequestsTracked'],
    },
  ],
};

function message(text: string, model: string) {
  return {
    id: `msg_mock_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content: [{ type: 'text', text }],
    stop_reason: MODE === 'refusal' ? 'refusal' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 2100,
      output_tokens: 900,
      cache_read_input_tokens: 2500,
      cache_creation_input_tokens: 0,
    },
  };
}

let calls = 0;

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => {
    const body = Buffer.concat(chunks).toString('utf8');
    const url = req.url ?? '';
    const hasKey = Boolean(req.headers['api-key'] ?? req.headers['x-api-key']);
    const send = (status: number, json: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(json));
    };
    if (req.method !== 'POST' || url.split('?')[0] !== '/v1/messages') {
      // eslint-disable-next-line no-console
      console.log(`[mock-foundry] 404 ${req.method ?? '?'} ${url} — this mock serves POST /v1/messages at its root`);
      return send(404, { type: 'error', error: { type: 'not_found_error', message: `DeploymentNotFound: no route ${url}` } });
    }
    if (!hasKey) return send(401, { type: 'error', error: { type: 'authentication_error', message: 'missing api-key' } });
    calls += 1;
    let parsed: { output_config?: { format?: unknown }; model?: string } = {};
    try {
      parsed = JSON.parse(body) as typeof parsed;
    } catch {
      return send(400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad json' } });
    }
    const hasFormat = Boolean(parsed.output_config?.format);
    // eslint-disable-next-line no-console
    console.log(`[mock-foundry] #${calls} ${url} model=${parsed.model ?? '?'} format=${hasFormat} mode=${MODE}`);

    if (MODE === 'fail') return send(500, { type: 'error', error: { type: 'api_error', message: 'mock outage' } });
    if (MODE === 'reject-format' && hasFormat) {
      return send(400, {
        type: 'error',
        error: { type: 'invalid_request_error', message: 'output_config.format is not supported for this deployment' },
      });
    }
    const text =
      MODE === 'text'
        ? `Here are your coaching notes:\n\n${JSON.stringify(PAYLOAD, null, 2)}\n\nHope this helps!`
        : JSON.stringify(PAYLOAD);
    const reply = () => send(200, message(MODE === 'refusal' ? '' : text, parsed.model ?? 'mock-model'));
    if (MODE === 'slow') setTimeout(reply, 30_000);
    else reply();
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`mock Foundry listening on http://localhost:${PORT} (mode=${MODE}) — set FOUNDRY_BASE_URL=http://localhost:${PORT}`);
});
