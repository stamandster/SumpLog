function validIds(value: unknown): number[] {
  return Array.isArray(value) ? [...new Set(value.filter((id): id is number => typeof id === "number" && Number.isSafeInteger(id) && id > 0))] : [];
}

export function readMaintenanceDetails(url: URL, historyState: unknown): number[] {
  const saved = (historyState as { maintenanceDetails?: { vehicle?: unknown; expandedIds?: unknown } } | null)?.maintenanceDetails;
  // An explicit empty array means the user closed everything, even on a record deep link.
  if (saved?.vehicle === url.searchParams.get("vehicle") && Array.isArray(saved.expandedIds)) return validIds(saved.expandedIds);
  return validIds([Number(url.searchParams.get("record"))]);
}

export function saveMaintenanceDetails(url: URL, historyState: unknown, expandedIds: number[]) {
  return { ...(typeof historyState === "object" && historyState !== null ? historyState : {}), maintenanceDetails: { vehicle: url.searchParams.get("vehicle"), expandedIds: validIds(expandedIds) } };
}
