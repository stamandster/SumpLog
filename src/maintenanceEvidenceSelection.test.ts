import { describe, expect, test } from "bun:test";
import { availableEvidenceIds } from "./maintenanceEvidenceSelection";

const document = (id: number, vehicleId = 3, insurancePolicyId: number | null = null) => ({ id, vehicleId, insurancePolicyId });

describe("maintenance evidence selection", () => {
  test("drops a deleted attachment without losing the rearranged order", () => {
    expect(availableEvidenceIds([55, 51, 45, 50], [document(45), document(50), document(55)], 3)).toEqual([55, 45, 50]);
  });

  test("retains selection after a failed deletion and removes duplicates", () => {
    expect(availableEvidenceIds([2, 1, 2], [document(1), document(2)], 3)).toEqual([2, 1]);
  });

  test("does not auto-select other documents or retain vehicle/insurance-ineligible files", () => {
    expect(availableEvidenceIds([1, 2, 3], [document(1), document(2, 4), document(3, 3, 7), document(4)], 3)).toEqual([1]);
    expect(availableEvidenceIds([1, 2], [], 3)).toEqual([]);
    expect(availableEvidenceIds([], [document(1)], 3)).toEqual([]);
  });
});
