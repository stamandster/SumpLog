import { expect, it } from "bun:test";
import { escapeCsv } from "./csv";
it("quotes CSV cells and neutralizes formula injection", () => {
  expect(escapeCsv('Text, with "quotes"')).toBe('"Text, with ""quotes"""');
  for (const value of ["=1+1", "+SUM(1,2)", "-1+2", "@SUM(1)", "\t=1+1", "\r=1+1"]) expect(escapeCsv(value).startsWith('"\'')).toBe(true);
  expect(escapeCsv("receipt")).toBe('"receipt"'); expect(escapeCsv(0)).toBe('"0"');
});
