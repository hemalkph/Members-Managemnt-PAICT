import { describe, expect, test } from "vitest";
import type { TaskView } from "@/lib/tasks/queries";
import { taskWhatsAppText, whatsAppLink } from "@/lib/tasks/whatsapp";

const base = {
  title: "Type set Paper 2",
  description: "Use the new cover.",
  assigneeName: "Nudara Dewmini",
  dueDate: "2026-11-07",
  dueLabel: "Due in 4 days",
  overdue: false,
  priority: "high",
  quantity: null,
  paperId: null,
  files: [
    { id: "1", kind: "brief", fileName: "a.pdf", sizeBytes: 1, when: "", seen: false },
    { id: "2", kind: "brief", fileName: "b.psd", sizeBytes: 1, when: "", seen: false },
    { id: "3", kind: "work", fileName: "c.pdf", sizeBytes: 1, when: "", seen: false },
  ],
} as unknown as TaskView;

describe("task WhatsApp message", () => {
  test("open task: title, due, priority, brief files, details and link", () => {
    const text = taskWhatsAppText(base, "https://example.app");
    expect(text).toContain("Hi Nudara, you have a new task! 📝");
    expect(text).toContain("*Type set Paper 2*");
    expect(text).toContain("Due: 7 Nov 2026");
    expect(text).toContain("Priority: High");
    expect(text).toContain("Files: 2 attached");
    expect(text).toContain("Details: Use the new cover.");
    expect(text).toContain("Open your task: https://example.app/tasks");
  });

  test("overdue task gets a reminder", () => {
    const text = taskWhatsAppText({ ...base, overdue: true, dueLabel: "2 days overdue" }, "https://example.app");
    expect(text).toContain("Due: 7 Nov 2026 (2 days overdue)");
    expect(text).not.toContain("Files:");
  });

  test("paper stage links to the paper", () => {
    const text = taskWhatsAppText({ ...base, paperId: "p1", files: [] }, "https://example.app");
    expect(text).toContain("https://example.app/papers/p1");
    expect(text).not.toContain("upload your work");
  });

  test("link keeps emojis (wa.me would turn them into �)", () => {
    const url = whatsAppLink("94771234567", "Hi 📝");
    expect(url.startsWith("https://api.whatsapp.com/send/?phone=94771234567&text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toBe("Hi 📝");
  });
});
