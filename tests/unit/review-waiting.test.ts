import { describe, expect, test } from "vitest";
import { isOverLimit, waitingHours, waitingSince, waitingText } from "@/lib/review/waiting";

const H = 3_600_000;

describe("review waiting", () => {
  test("since", () => {
    expect(waitingSince({ created_at: "2026-11-20T08:00:00Z", resubmitted_at: "2026-11-25T08:00:00Z" })).toBe(
      "2026-11-25T08:00:00Z",
    );
    expect(waitingSince({ created_at: "2026-11-20T08:00:00Z", resubmitted_at: null })).toBe("2026-11-20T08:00:00Z");
    expect(waitingSince({ created_at: "2026-11-20T08:00:00Z" })).toBe("2026-11-20T08:00:00Z");
  });

  test("hours", () => {
    const since = "2026-11-25T00:00:00Z";
    expect(waitingHours(since, Date.parse(since) + 30 * H + 59 * 60_000)).toBe(30);
    expect(waitingHours(since, Date.parse(since) - H)).toBe(0);
  });

  test("text", () => {
    expect(waitingText(0)).toBe("under 1 h");
    expect(waitingText(30)).toBe("30 h");
    expect(waitingText(47)).toBe("47 h");
    expect(waitingText(72)).toBe("3 d");
  });

  test("over limit", () => {
    expect(isOverLimit(24, 24)).toBe(true);
    expect(isOverLimit(23, 24)).toBe(false);
  });
});
