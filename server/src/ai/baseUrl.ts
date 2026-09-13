/**
 * Base-URL normalisation for the AI coach's Anthropic-format endpoint.
 *
 * Two kinds of host are supported:
 *   - Microsoft Foundry (`*.services.ai.azure.com`): the SDK wants the
 *     `/anthropic` root, but the portal's Target URI ends in
 *     /anthropic/v1/messages, docs use /anthropic/, and ops often paste the
 *     bare resource host — so the suffix is added when missing.
 *   - Anything else (a LiteLLM proxy, server/scripts/mock-foundry.ts, any
 *     Anthropic-compatible gateway): used as-is. Those serve /v1/messages at
 *     their root, so forcing /anthropic onto them would 404.
 * In both cases a trailing `/`, `/v1` or `/v1/messages` is stripped because the
 * SDK appends `/v1/messages` itself.
 */
const FOUNDRY_HOST_SUFFIX = '.services.ai.azure.com';

/** true when the URL points at a real Microsoft Foundry resource. */
export function isFoundryHost(url: string): boolean {
  try {
    return new URL(url).hostname.toLowerCase().endsWith(FOUNDRY_HOST_SUFFIX);
  } catch {
    return false;
  }
}

export function normalizeFoundryBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  url = url.replace(/\/v1\/messages$/i, '').replace(/\/v1$/i, '').replace(/\/+$/, '');
  if (isFoundryHost(url) && !/\/anthropic$/i.test(url)) url = `${url}/anthropic`;
  return url;
}

/** Host shown in error messages and the boot banner (never the key). */
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
