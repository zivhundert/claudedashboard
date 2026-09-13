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
  standing:
    'Adoption 62 sits above the org median of 48, while Trust trails at 41 vs 66 — you use Claude Code often but keep fewer of its edits than most.',
  dataThin: false,
  strengths: [
    {
      title: 'Consistent daily habit',
      why: 'Active on 18 of 22 workdays (82% consistency) with a current streak of 6 — well above the org median adoption of 48.',
      evidence: ['activity.consistencyPct', 'activity.streakCurrent', 'orgMedianScores.adoption'],
    },
  ],
  recommendations: [
    {
      id: 'ask-for-smaller-diffs',
      title: 'Ask for smaller diffs',
      why: 'Acceptance rate is 41%; 60% already scores 100 on Trust. Most rejected edits are Write operations.',
      tryThis: 'Before a large change, ask Claude to propose the plan and touch one file at a time; approve incrementally instead of rejecting a big Write.',
      expectedEffect: { axis: 'trust', note: 'fewer rejected edits lifts the acceptance rate directly' },
      evidence: ['trust.acceptanceRatePct', 'trust.perTool', 'targets.toolEvents'],
    },
    {
      id: 'commit-from-claude-code',
      title: 'Commit from inside Claude Code',
      why: 'Commits this range: 4 vs a target of 165 for 22 workdays, while lines added (5,200) are near target.',
      tryThis: 'End each task with "commit this with a conventional message" so the work you already do is counted.',
      expectedEffect: { axis: 'impact', note: 'commits carry 30% of the Impact score' },
      evidence: ['output.commits', 'targets.commits', 'output.linesAdded'],
    },
    {
      id: 'reuse-context-within-a-task',
      title: 'Reuse context within a task',
      why: 'Cache hit rate is 38% vs the 60% target band; cost per range is $84.',
      tryThis: 'Keep one session per task and use /compact instead of starting fresh; restarts re-read everything at full price.',
      expectedEffect: { axis: 'efficiency', note: 'cache ratio is 20% of Efficiency and lowers cost per line' },
      evidence: ['cost.cacheRatioPct', 'cost.costUsd', 'output.linesPerDollar'],
    },
    {
      id: 'try-plan-mode-first',
      title: 'Try plan mode before big edits',
      why: 'Telemetry shows 0 plan-mode entries alongside 27 rejected edits.',
      tryThis: 'Press Shift+Tab to enter plan mode for anything touching more than two files; approve the plan, then let it edit.',
      expectedEffect: { axis: 'trust', note: 'agreed plans produce edits you keep' },
      evidence: ['telemetry.planModeEntries', 'trust.toolRejected'],
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
