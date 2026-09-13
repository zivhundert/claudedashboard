/**
 * Foundry endpoints come in several spellings — the portal's Target URI ends
 * in /anthropic/v1/messages, docs use /anthropic/, ops often paste the bare
 * resource host. The SDK wants the /anthropic root, so normalise once here.
 */
export function normalizeFoundryBaseUrl(raw: string): string {
  let url = raw.trim().replace(/\/+$/, '');
  url = url.replace(/\/v1\/messages$/i, '').replace(/\/v1$/i, '');
  if (!/\/anthropic$/i.test(url)) url = `${url}/anthropic`;
  return url;
}
