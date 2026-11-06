/**
 * Pending line of the dashboard "Bugün" card. `allPending` is the bell's count
 * (every day); null when the bell data failed to load.
 */
export function pendingSummaryText(todayPending: number, allPending: number | null): string {
  if (allPending === null) {
    return todayPending > 0 ? `${todayPending} talep onay bekliyor` : "Bugün onay bekleyen talep yok";
  }
  const total = Math.max(allPending, todayPending);
  if (total === 0) return "Onay bekleyen talep yok";
  if (todayPending === 0) return `${total} talep onay bekliyor · sonraki günlerde`;
  if (todayPending === total) return `${total} talep onay bekliyor`;
  return `${total} talep onay bekliyor · ${todayPending} tanesi bugün`;
}
