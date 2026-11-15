import { expect, test } from "vitest";
import { groupExams } from "@/lib/organisation/exam-groups";

test("exams sit under their series in number order, the rest under Other exams", () => {
  const series = [
    { id: "s", batchId: "b", name: "Ranking Full Papers", code: "RFP" },
    { id: "x", batchId: "other", name: "Elsewhere", code: "X" },
  ];
  const exams = [
    { id: "5", batchId: "b", seriesId: "s", number: 5, name: "RFP 05" },
    { id: "t", batchId: "b", seriesId: null, number: null, name: "Term test" },
    { id: "4", batchId: "b", seriesId: "s", number: 4, name: "RFP 04" },
    { id: "o", batchId: "other", seriesId: "x", number: 1, name: "X 01" },
  ];
  expect(groupExams("b", series, exams).map((g) => [g.label, g.exams.map((e) => e.id)])).toEqual([
    ["Ranking Full Papers (RFP)", ["4", "5"]],
    ["Other exams", ["t"]],
  ]);
});
