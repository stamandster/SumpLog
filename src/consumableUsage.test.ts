import { expect, test } from "bun:test";
import { describeConsumableUsage } from "./consumableUsage";

test("total volume describes full containers plus the remainder", () => {
  expect(describeConsumableUsage(1.5, 1, "qt")).toBe("1 full item + 0.5 qt from another");
  expect(describeConsumableUsage(6, 4, "qt")).toBe("1 full item + 2 qt from another");
  expect(describeConsumableUsage(3, 1, "qt")).toBe("3 full items");
  expect(describeConsumableUsage(0.5, 1, "qt")).toBe("0.5 qt from one item");
  expect(describeConsumableUsage(0.3, 0.1, "L")).toBe("3 full items");
  expect(describeConsumableUsage(NaN, 1, "qt")).toContain("Enter total volume");
});
