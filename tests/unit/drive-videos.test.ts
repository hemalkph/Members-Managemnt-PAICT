import { describe, expect, it } from "vitest";

import {
  DRIVE_FILE_ID,
  formatDuration,
  isSourceFolder,
  isVideoRole,
  monthFolderKey,
  sortMonthFolders,
} from "@/lib/drive-videos";

describe("monthFolderKey", () => {
  it("reads the team's folder names", () => {
    expect(monthFolderKey("2026 October")).toBe("2026-10");
    expect(monthFolderKey(" 2026  december ")).toBe("2026-12");
  });

  it("accepts the other order and short month names", () => {
    expect(monthFolderKey("November 2026")).toBe("2026-11");
    expect(monthFolderKey("2026 Sep")).toBe("2026-09");
  });

  it("ignores other folders", () => {
    expect(monthFolderKey("Old stuff")).toBeNull();
    expect(monthFolderKey("2026")).toBeNull();
    expect(monthFolderKey("2026 Ma")).toBeNull();
    expect(monthFolderKey("2026 October extra")).toBeNull();
  });
});

describe("sortMonthFolders", () => {
  it("puts the newest month first and other names last", () => {
    const sorted = sortMonthFolders([
      { id: "a", name: "2026 October" },
      { id: "b", name: "Archive" },
      { id: "c", name: "2026 December" },
      { id: "d", name: "2027 January" },
    ]);
    expect(sorted.map((m) => m.name)).toEqual(["2027 January", "2026 December", "2026 October", "Archive"]);
  });
});

describe("isSourceFolder", () => {
  it("matches the sub-folders without case or spaces", () => {
    expect(isSourceFolder("Edited", "edited")).toBe(true);
    expect(isSourceFolder(" edited ", "edited")).toBe(true);
    expect(isSourceFolder("External edits", "external")).toBe(true);
    expect(isSourceFolder("To be edited", "edited")).toBe(false);
    expect(isSourceFolder("Edited", "external")).toBe(false);
  });
});

describe("formatDuration", () => {
  it("formats minutes and hours", () => {
    expect(formatDuration(95_000)).toBe("1:35");
    expect(formatDuration(3_725_000)).toBe("1:02:05");
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(0)).toBeNull();
  });
});

describe("isVideoRole and DRIVE_FILE_ID", () => {
  it("finds video roles by name", () => {
    expect(isVideoRole("Video Editing")).toBe(true);
    expect(isVideoRole("video editor")).toBe(true);
    expect(isVideoRole("Graphic Design")).toBe(false);
    expect(isVideoRole(undefined)).toBe(false);
  });

  it("accepts Drive ids only", () => {
    expect(DRIVE_FILE_ID.test("16goGFQtqimNXa-TcExb0WslFyJk9cZKX")).toBe(true);
    expect(DRIVE_FILE_ID.test("x' or '1'='1")).toBe(false);
    expect(DRIVE_FILE_ID.test("short")).toBe(false);
  });
});
