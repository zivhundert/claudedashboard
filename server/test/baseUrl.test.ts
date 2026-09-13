import { describe, expect, it } from 'vitest';
import { hostOf, isFoundryHost, normalizeFoundryBaseUrl } from '../src/ai/baseUrl';

const FOUNDRY_ROOT = 'https://my-res.services.ai.azure.com/anthropic';

describe('normalizeFoundryBaseUrl — Microsoft Foundry hosts', () => {
  it.each([
    ['bare resource host', 'https://my-res.services.ai.azure.com'],
    ['docs form with trailing slash', 'https://my-res.services.ai.azure.com/anthropic/'],
    ['already the SDK root', 'https://my-res.services.ai.azure.com/anthropic'],
    ['portal Target URI', 'https://my-res.services.ai.azure.com/anthropic/v1/messages'],
    ['/v1 only', 'https://my-res.services.ai.azure.com/anthropic/v1'],
    ['surrounding whitespace', '  https://my-res.services.ai.azure.com/anthropic/v1/messages  '],
    ['mixed case suffix', 'https://my-res.services.ai.azure.com/Anthropic'],
  ])('%s → ends in /anthropic', (_label, raw) => {
    const out = normalizeFoundryBaseUrl(raw);
    expect(out.toLowerCase()).toBe(FOUNDRY_ROOT);
    expect(isFoundryHost(out)).toBe(true);
  });
});

describe('normalizeFoundryBaseUrl — non-Foundry hosts (LiteLLM, mock, any proxy)', () => {
  it.each([
    ['docker bridge proxy', 'http://172.17.0.1:3000', 'http://172.17.0.1:3000'],
    ['mock with trailing slash', 'http://localhost:8898/', 'http://localhost:8898'],
    ['proxy pasted with /v1', 'http://proxy/v1', 'http://proxy'],
    ['proxy pasted with /v1/messages', 'https://gateway.corp.example.com/v1/messages', 'https://gateway.corp.example.com'],
    ['proxy under a path prefix', 'https://gateway.corp.example.com/llm/', 'https://gateway.corp.example.com/llm'],
  ])('%s → unchanged root, NO /anthropic', (_label, raw, expected) => {
    const out = normalizeFoundryBaseUrl(raw);
    expect(out).toBe(expected);
    expect(out).not.toMatch(/\/anthropic/i);
    expect(isFoundryHost(out)).toBe(false);
  });

  it('keeps plain http (private-network proxies)', () => {
    expect(normalizeFoundryBaseUrl('http://172.17.0.1:3000')).toMatch(/^http:\/\//);
  });
});

describe('hostOf', () => {
  it('returns host:port for messages, never the path', () => {
    expect(hostOf('http://172.17.0.1:3000')).toBe('172.17.0.1:3000');
    expect(hostOf('https://my-res.services.ai.azure.com/anthropic')).toBe('my-res.services.ai.azure.com');
  });
});
