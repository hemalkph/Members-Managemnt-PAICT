import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { removableFiles } from "@/lib/paper-cleanup";

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
});
