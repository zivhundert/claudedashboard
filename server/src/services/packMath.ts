/** Small numeric helpers shared by the telemetry-pack routes and the AI coach input. */

/** errors / (requests + errors); null when nothing happened. */
export function errorRate(requests: number, errors: number): number | null {
  const denom = requests + errors;
  return denom > 0 ? errors / denom : null;
}

/** total duration / request count; null when no requests. */
export function avgMs(totalDurationMs: number, requests: number): number | null {
  return requests > 0 ? totalDurationMs / requests : null;
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** standard interpolated median of an UNSORTED list; null when empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const hi = sorted[mid] ?? 0;
  if (sorted.length % 2 === 1) return hi;
  return ((sorted[mid - 1] ?? 0) + hi) / 2;
}
