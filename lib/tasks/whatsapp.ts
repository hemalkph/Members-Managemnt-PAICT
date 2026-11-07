import { formatDate } from "@/lib/core/format";
import type { TaskView } from "@/lib/tasks/queries";

/**
 * WhatsApp link with the message filled in. Not wa.me: its redirect turns
 * emojis into "�"; api.whatsapp.com keeps them.
 */
export function whatsAppLink(phone: string, text: string): string {
  return `https://api.whatsapp.com/send/?phone=${phone}&text=${encodeURIComponent(text)}`;
}

/** The WhatsApp message an admin sends a member about an open task. */
export function taskWhatsAppText(task: TaskView, siteUrl: string): string {
  const first = task.assigneeName.split(" ")[0];
  const link = task.paperId ? `${siteUrl}/papers/${task.paperId}` : `${siteUrl}/tasks`;
  const due = task.dueDate ? `Due: ${formatDate(task.dueDate)}` : null;

  if (task.overdue) {
    return [
      `Hi ${first}, a reminder about your task ⏰`,
      `*${task.title}*`,
      "",
      `${due} (${task.dueLabel ?? "overdue"})`,
      "",
      "Can you finish it today? Upload your work and mark it done here:",
      link,
      "",
      "Thank you! 🙏",
    ].join("\n");
  }

  const briefs = task.files.filter((f) => f.kind === "brief").length;
  const lines = [`Hi ${first}, you have a new task! 📝`, `*${task.title}*`, ""];
  if (due) lines.push(due);
  if (task.priority === "high") lines.push("Priority: High");
  if (task.quantity) lines.push(`Quantity: ${task.quantity}`);
  if (briefs > 0) lines.push(`Files: ${briefs} attached – download them from the task`);
  if (task.description) lines.push(`Details: ${task.description}`);
  lines.push(
    "",
    `Open your task: ${link}`,
    "",
    task.paperId ? "Thank you! 🙏" : "When you finish, upload your work there and mark it done. Thank you! 🙏",
  );
  return lines.join("\n");
}
