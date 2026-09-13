import { describe, expect, it } from 'vitest';
import { AiUpstreamError, CONFIG_ERROR_CODES, classify, endpointHost, extractJsonObject } from '../src/ai/foundryClient';

const MODEL = 'gpt-5.6-luna';
const HOST = '172.17.0.1:3000';

describe('classify — upstream failures get a stable code, never the upstream HTTP status', () => {
  it('404 / DeploymentNotFound → model_not_deployed with an actionable message', () => {
    const err = classify(404, '404 {"error":{"code":"DeploymentNotFound","message":"The API deployment for this resource does not exist."}}', MODEL, HOST);
    expect(err).toBeInstanceOf(AiUpstreamError);
    expect(err.code).toBe('model_not_deployed');
    expect(err.upstreamStatus).toBe(404);
    expect(err.message).toBe(`deployment "${MODEL}" does not exist at ${HOST} — create it or change FOUNDRY_MODEL`);
  });

  it('DeploymentNotFound in the body wins even under a non-404 status', () => {
    expect(classify(400, 'DeploymentNotFound: gpt-5.6-luna', MODEL, HOST).code).toBe('model_not_deployed');
  });

  it('401 / 403 → auth_failed', () => {
    expect(classify(401, 'invalid api key', MODEL, HOST).code).toBe('auth_failed');
    expect(classify(403, 'forbidden', MODEL, HOST).code).toBe('auth_failed');
    expect(classify(401, 'x', MODEL, HOST).message).toContain('FOUNDRY_API_KEY');
  });

  it('null status (connection refused / DNS / timeout) → unreachable, naming the host', () => {
    const err = classify(null, 'connect ECONNREFUSED 172.17.0.1:3000', MODEL, HOST);
    expect(err.code).toBe('unreachable');
    expect(err.upstreamStatus).toBeNull();
    expect(err.message).toContain(HOST);
  });

  it('429 → upstream_rate_limited; 400 → bad_request; 5xx → upstream_error', () => {
    expect(classify(429, 'slow down', MODEL, HOST).code).toBe('upstream_rate_limited');
    expect(classify(400, 'thinking is not supported', MODEL, HOST).code).toBe('bad_request');
    expect(classify(500, 'boom', MODEL, HOST).code).toBe('upstream_error');
    expect(classify(503, 'overloaded', MODEL, HOST).code).toBe('upstream_error');
  });

  it('config-class codes are exactly the ones the route answers 503 with', () => {
    expect([...CONFIG_ERROR_CODES].sort()).toEqual(['auth_failed', 'model_not_deployed', 'unreachable']);
  });
});

describe('endpointHost', () => {
  it('uses the base URL host, or the resource form of Foundry', () => {
    expect(endpointHost({ baseUrl: 'http://172.17.0.1:3000', resource: null })).toBe('172.17.0.1:3000');
    expect(endpointHost({ baseUrl: null, resource: 'my-res' })).toBe('my-res.services.ai.azure.com');
  });
});

describe('extractJsonObject', () => {
  it('pulls the first balanced object out of prose, respecting strings', () => {
    expect(extractJsonObject('Sure! {"a":"}{","b":{"c":1}} done')).toEqual({ a: '}{', b: { c: 1 } });
  });
  it('throws on missing / unterminated objects', () => {
    expect(() => extractJsonObject('no json here')).toThrow();
    expect(() => extractJsonObject('{"a":')).toThrow();
  });
});
