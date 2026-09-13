/**
 * Thin wrapper over the Foundry SDK (Anthropic Messages format: POST
 * <baseURL>/v1/messages with an api key header) that turns "system + user →
 * JSON" into one call. The endpoint is Claude on Microsoft Foundry or any
 * Anthropic-compatible proxy (LiteLLM in front of a GPT deployment, the local
 * mock), so request features that are beta or proxy-dependent degrade:
 *
 *   1. structured output + adaptive thinking (medium effort)
 *   2. 400 naming the output format   → retry without `format`, parse JSON from text
 *   3. 400 naming thinking / effort    → retry with neither (the model's defaults)
 *   4. anything else                   → AiUpstreamError, classified (see `classify`)
 *
 * Keep `thinking: { type: 'adaptive' }` — the `enabled` + budget_tokens form
 * is rejected by current models and mis-mapped by LiteLLM.
 *
 * The SDK retries 429/5xx/connection errors itself (maxRetries). Foundry sends
 * no Anthropic rate-limit headers, so there is nothing smarter to do here.
 */
import AnthropicFoundry from '@anthropic-ai/foundry-sdk';
import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import type { AiConfig } from '../env';
import { hostOf } from './baseUrl';

export interface GenerationUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export interface JsonGenerationResult {
  json: unknown;
  usage: GenerationUsage;
  /** true when the provider accepted the JSON-schema output format */
  structured: boolean;
  attempts: number;
  model: string;
}

/**
 * Stable, provider-independent failure classes. The route maps these to OUR
 * HTTP status; the upstream status is kept only for logs (`upstreamStatus`).
 */
export type AiErrorCode =
  | 'model_not_deployed'
  | 'auth_failed'
  | 'upstream_rate_limited'
  | 'bad_request'
  | 'upstream_error'
  | 'unreachable'
  | 'bad_answer';

/** Configuration / connectivity problems — the card says "misconfigured", the route answers 503. */
export const CONFIG_ERROR_CODES: ReadonlySet<AiErrorCode> = new Set(['model_not_deployed', 'auth_failed', 'unreachable']);

export class AiUpstreamError extends Error {
  constructor(
    public readonly code: AiErrorCode,
    message: string,
    public readonly upstreamStatus: number | null = null,
  ) {
    super(message);
    this.name = 'AiUpstreamError';
  }
}

type Mode = 'structured' | 'text' | 'plain';

function statusOf(err: unknown): number | null {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Endpoint host for messages (Foundry resource form → its public host). */
export function endpointHost(cfg: Pick<AiConfig, 'baseUrl' | 'resource'>): string {
  if (cfg.baseUrl) return hostOf(cfg.baseUrl);
  return `${cfg.resource ?? '?'}.services.ai.azure.com`;
}

/**
 * Turn an SDK/transport failure into an AiUpstreamError with a stable code
 * and an operator-readable message. Never returns the upstream HTTP status as
 * something the route should echo.
 */
export function classify(status: number | null, msg: string, model: string, host: string): AiUpstreamError {
  if (status === null) return new AiUpstreamError('unreachable', `${host} is unreachable: ${msg}`, null);
  if (status === 404 || /DeploymentNotFound/i.test(msg)) {
    return new AiUpstreamError(
      'model_not_deployed',
      `deployment "${model}" does not exist at ${host} — create it or change FOUNDRY_MODEL`,
      status,
    );
  }
  if (status === 401 || status === 403) {
    return new AiUpstreamError('auth_failed', `${host} rejected the API key (HTTP ${status}) — check FOUNDRY_API_KEY`, status);
  }
  if (status === 429) return new AiUpstreamError('upstream_rate_limited', `${host} is rate-limiting requests (HTTP 429): ${msg}`, status);
  if (status === 400) return new AiUpstreamError('bad_request', `${host} rejected the request (HTTP 400): ${msg}`, status);
  return new AiUpstreamError('upstream_error', `${host} answered HTTP ${status}: ${msg}`, status);
}

/** Pull the first balanced {...} out of prose (models sometimes wrap JSON in text). */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('no JSON object in response');
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1)) as unknown;
    }
  }
  throw new Error('unterminated JSON object in response');
}

export class FoundryCoach {
  private readonly client: AnthropicFoundry;
  readonly host: string;

  constructor(private readonly cfg: AiConfig) {
    this.host = endpointHost(cfg);
    this.client = new AnthropicFoundry({
      apiKey: cfg.apiKey,
      ...(cfg.resource ? { resource: cfg.resource } : { baseURL: cfg.baseUrl ?? undefined }),
      timeout: 120_000, // ms — one generation can take tens of seconds with thinking
      maxRetries: 2,
    });
  }

  /**
   * One cheap round-trip in plain mode (no thinking, no output format) to
   * prove the endpoint, key and model exist. max_tokens 16 is the smallest
   * value LiteLLM accepts. Throws a classified AiUpstreamError.
   */
  async probe(): Promise<void> {
    try {
      await this.client.messages.create(
        {
          model: this.cfg.model,
          max_tokens: 16,
          messages: [{ role: 'user', content: 'Reply with the single word: ok' }],
        },
        { timeout: 20_000, maxRetries: 0 },
      );
    } catch (err) {
      throw classify(statusOf(err), messageOf(err), this.cfg.model, this.host);
    }
  }

  async generateJson(system: string, user: string, schema: Record<string, unknown>): Promise<JsonGenerationResult> {
    let mode: Mode = 'structured';
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await this.client.messages.create(this.params(system, user, schema, mode));
        return { ...this.read(res, mode), attempts: attempt, model: res.model };
      } catch (err) {
        if (err instanceof AiUpstreamError) throw err;
        const status = statusOf(err);
        const msg = messageOf(err);
        // Providers reject beta request features with a 400 that names the field.
        if (status === 400 && mode === 'structured' && /output_config|format|json_schema/i.test(msg)) {
          mode = 'text';
          continue;
        }
        if (status === 400 && mode !== 'plain' && /thinking|effort|output_config/i.test(msg)) {
          mode = 'plain';
          continue;
        }
        throw classify(status, msg, this.cfg.model, this.host);
      }
    }
    throw new AiUpstreamError('bad_request', `${this.host} rejected every request variant for "${this.cfg.model}"`, 400);
  }

  private params(system: string, user: string, schema: Record<string, unknown>, mode: Mode): MessageCreateParamsNonStreaming {
    const base: MessageCreateParamsNonStreaming = {
      model: this.cfg.model,
      max_tokens: 8000, // ~1k of JSON plus adaptive-thinking headroom
      system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [{ role: 'user', content: user }],
    };
    if (mode === 'plain') return base;
    return {
      ...base,
      thinking: { type: 'adaptive' },
      output_config:
        mode === 'structured'
          ? { effort: 'medium', format: { type: 'json_schema', schema } }
          : { effort: 'medium' },
    };
  }

  private read(res: Message, mode: Mode): Omit<JsonGenerationResult, 'attempts' | 'model'> {
    if (res.stop_reason === 'refusal') throw new AiUpstreamError('bad_answer', 'the model declined to answer');
    if (res.stop_reason === 'max_tokens') throw new AiUpstreamError('bad_answer', 'the answer was truncated (max_tokens)');
    const text = res.content
      .filter((b): b is Extract<Message['content'][number], { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!text) throw new AiUpstreamError('bad_answer', 'empty answer from the model');
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      try {
        json = extractJsonObject(text);
      } catch (e) {
        throw new AiUpstreamError('bad_answer', `the model did not return JSON: ${messageOf(e)}`);
      }
    }
    const u = res.usage;
    return {
      json,
      structured: mode === 'structured',
      usage: {
        inputTokens: u.input_tokens,
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens ?? 0,
        cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
