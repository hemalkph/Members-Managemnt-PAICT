import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { removableFiles } from "@/lib/papers/cleanup";

describe("paper file clean-up", () => {
  test("keeps the latest reviewed papers and final outputs, removes drafts and older versions", () => {
    const files = [
      { stage: "create_si", version: 1 },
      { stage: "typeset_si", version: 1 },
      { stage: "typeset_si", version: 2 },
      { stage: "typeset_en", version: 1 },
      { stage: "handover", version: 1 },
      { stage: "scheme", version: 3 },
    ];
    expect(removableFiles(files)).toEqual([
      { stage: "create_si", version: 1 },
      { stage: "typeset_si", version: 1 },
    ]);
  });

  test("keeps the file marked as the correct paper, even when a newer one was added", () => {
    const files = [
      { stage: "handover", version: 1, is_main: true },
      { stage: "handover", version: 2, is_main: false },
      { stage: "create_si", version: 1, is_main: true },
    ];
    expect(removableFiles(files)).toEqual([
      { stage: "handover", version: 2, is_main: false },
      { stage: "create_si", version: 1, is_main: true },
    ]);
  });
});
