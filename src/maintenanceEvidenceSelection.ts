import type { DocumentRecord } from "./api";

/** Keep the user's order, excluding files no longer available to this vehicle. */
export function availableEvidenceIds(ids: readonly number[], documents: readonly Pick<DocumentRecord, "id" | "vehicleId" | "insurancePolicyId">[], vehicleId: number): number[] {
  const available = new Set(documents.filter((document) => document.vehicleId === vehicleId && !document.insurancePolicyId).map((document) => document.id));
  return [...new Set(ids)].filter((id) => available.has(id));
}
