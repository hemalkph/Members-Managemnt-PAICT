import { describe, expect, it } from "vitest";

import { checkDetails, fillTitle, newFieldId, type TaskField } from "@/lib/tasks/types";

const fields: TaskField[] = [
  { id: "title", label: "Title", kind: "text", required: true, options: [] },
  { id: "lesson", label: "Lesson", kind: "select", required: true, options: ["Networking Theory", "Number Systems"] },
  { id: "video_url", label: "Video URL", kind: "link", required: true, options: [] },
  { id: "class_date", label: "Class date", kind: "date", required: false, options: [] },
  { id: "minutes", label: "Minutes", kind: "number", required: false, options: [] },
  { id: "notes", label: "Notes", kind: "long", required: false, options: [] },
];

const good = {
  title: " Networking Theory – Day 07 ",
  lesson: "Networking Theory",
  video_url: "https://drive.google.com/file/d/abc/view",
  class_date: "2026-11-07",
  minutes: "089",
};

describe("checkDetails", () => {
  it("saves filled fields with their labels and drops empty optional ones", () => {
    const result = checkDetails(fields, good);
    expect(result).toEqual({
      details: [
        { id: "title", label: "Title", kind: "text", value: "Networking Theory – Day 07" },
        { id: "lesson", label: "Lesson", kind: "select", value: "Networking Theory" },
        { id: "video_url", label: "Video URL", kind: "link", value: "https://drive.google.com/file/d/abc/view" },
        { id: "class_date", label: "Class date", kind: "date", value: "2026-11-07" },
        { id: "minutes", label: "Minutes", kind: "number", value: "89" },
      ],
    });
  });

  it("asks for required fields", () => {
    expect(checkDetails(fields, { ...good, title: "  " })).toEqual({ error: "Title is required." });
  });

  it("refuses values that don't fit the field", () => {
    expect(checkDetails(fields, { ...good, video_url: "javascript:alert(1)" })).toHaveProperty("error");
    expect(checkDetails(fields, { ...good, lesson: "Something else" })).toHaveProperty("error");
    expect(checkDetails(fields, { ...good, class_date: "2026-02-30" })).toHaveProperty("error");
    expect(checkDetails(fields, { ...good, minutes: "ten" })).toHaveProperty("error");
    expect(checkDetails(fields, { ...good, title: "x".repeat(201) })).toHaveProperty("error");
  });

  it("leaves file fields for the upload step, even when required", () => {
    const withFile: TaskField[] = [
      ...fields,
      { id: "thumb", label: "Thumbnail", kind: "file", required: true, options: [] },
    ];
    const result = checkDetails(withFile, { ...good, thumb: "anything" });
    expect("details" in result && result.details.some((d) => d.id === "thumb")).toBe(false);
  });

  it("ignores values for fields the type doesn't have", () => {
    const result = checkDetails(fields, { ...good, injected: "x" });
    expect("details" in result && result.details.some((d) => d.id === "injected")).toBe(false);
  });
});

describe("fillTitle", () => {
  it("fills {Label} parts from the values", () => {
    expect(fillTitle("Upload: {Title}", fields, good)).toBe("Upload: Networking Theory – Day 07");
    expect(fillTitle("{lesson} – {Title}", fields, good)).toBe("Networking Theory – Networking Theory – Day 07");
  });

  it("drops empty or unknown parts and a dangling separator", () => {
    expect(fillTitle("Upload: {Title}", fields, {})).toBe("Upload");
    expect(fillTitle("Upload {Nope}", fields, good)).toBe("Upload");
  });
});

describe("newFieldId", () => {
  it("makes a short id and avoids taken ones", () => {
    expect(newFieldId("Video URL", [])).toBe("video_url");
    expect(newFieldId("Video URL", ["video_url"])).toBe("video_url_2");
    expect(newFieldId("පාඩම", [])).toBe("field");
  });
});
