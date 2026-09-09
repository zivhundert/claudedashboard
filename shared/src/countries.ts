/**
 * Member locations — the fixed set the org operates in. Stored on users.country
 * as ISO 3166-1 alpha-2 codes; the UI renders the flag emoji built from the code.
 */
export const COUNTRIES = [
  { code: 'IL', name: 'Israel' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'AM', name: 'Armenia' },
  { code: 'ES', name: 'Spain' },
  { code: 'US', name: 'USA' },
  { code: 'GE', name: 'Georgia' },
  { code: 'PL', name: 'Poland' },
] as const;

export type CountryCode = (typeof COUNTRIES)[number]['code'];

export const COUNTRY_CODES: readonly CountryCode[] = COUNTRIES.map((c) => c.code);

export function isCountryCode(v: unknown): v is CountryCode {
  return typeof v === 'string' && (COUNTRY_CODES as readonly string[]).includes(v);
}

export function countryName(code: string | null | undefined): string | null {
  return COUNTRIES.find((c) => c.code === code)?.name ?? null;
}

/** 'IL' → 🇮🇱 via regional-indicator symbols; null for unknown/absent codes. */
export function countryFlag(code: string | null | undefined): string | null {
  if (!isCountryCode(code)) return null;
  return String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
}
