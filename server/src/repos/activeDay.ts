/**
 * THE definition of "active on a day", shared by every query that counts or
 * lists active people (Overview KPI and trend bars, adoption %, streaks,
 * scoring active-days, the "see who" drawer and its "not active" complement).
 *
 * Any core counter above zero counts. `num_sessions` alone is not enough: the
 * session counter ticks only when a session STARTS, so a session that runs
 * past midnight (or keeps going after the exporter was configured) produces a
 * day with edits, lines and commits but zero sessions — and that person was
 * plainly active. Keeping one expression here is what stops the KPI and the
 * drawer from disagreeing again.
 */
export function activeDaySql(alias: string): string {
  const a = alias;
  return (
    `(${a}.num_sessions > 0 OR ${a}.lines_added > 0 OR ${a}.lines_removed > 0 OR ${a}.commits > 0 OR ${a}.pull_requests > 0` +
    ` OR ${a}.edit_accepted + ${a}.edit_rejected + ${a}.multi_edit_accepted + ${a}.multi_edit_rejected` +
    ` + ${a}.write_accepted + ${a}.write_rejected + ${a}.notebook_accepted + ${a}.notebook_rejected > 0)`
  );
}
