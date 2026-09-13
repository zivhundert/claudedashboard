/**
 * Thin wrapper over the Foundry SDK that turns "system + user → JSON" into one
 * call with a degradation ladder for features that are still beta on
 * Microsoft Foundry (structured outputs, adaptive thinking/effort):
 *
 *   1. structured output + adaptive thinking (medium effort)
 *   2. 400 naming the output format   → retry without `format`, parse JSON from text
 *   3. 400 naming thinking / effort    → retry with neither (Opus 5 thinks by default)
 *   4. anything else                   → AiUpstreamError
 *
 * The SDK retries 429/5xx/connection errors itself (maxRetries). Foundry sends
 * no Anthropic rate-limit headers, so there is nothing smarter to do here.
 */
import AnthropicFoundry from '@anthropic-ai/foundry-sdk';
import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages';
import type { AiConfig } from '../env';

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

export class AiUpstreamError extends Error {
  constructor(
    public readonly status: number,
    message: string,
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

  constructor(private readonly cfg: AiConfig) {
    this.client = new AnthropicFoundry({
      apiKey: cfg.apiKey,
      ...(cfg.resource ? { resource: cfg.resource } : { baseURL: cfg.baseUrl ?? undefined }),
      timeout: 120_000, // ms — one generation can take tens of seconds with thinking
      maxRetries: 2,
    });
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
        // Foundry rejects beta request features with a 400 that names the field.
        if (status === 400 && mode === 'structured' && /output_config|format|json_schema/i.test(msg)) {
          mode = 'text';
          continue;
        }
        if (status === 400 && mode !== 'plain' && /thinking|effort|output_config/i.test(msg)) {
          mode = 'plain';
          continue;
        }
        throw new AiUpstreamError(status ?? 502, status === null ? `Foundry unreachable: ${msg}` : msg);
      }
    }
    throw new AiUpstreamError(502, 'Foundry rejected every request variant');
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
    if (res.stop_reason === 'refusal') throw new AiUpstreamError(200, 'the model declined to answer');
    if (res.stop_reason === 'max_tokens') throw new AiUpstreamError(200, 'the answer was truncated (max_tokens)');
    const text = res.content
      .filter((b): b is Extract<Message['content'][number], { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!text) throw new AiUpstreamError(200, 'empty answer from the model');
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      json = extractJsonObject(text);
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
