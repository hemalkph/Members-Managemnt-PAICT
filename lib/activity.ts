// Activity log categories. Each action is "<group>.<verb>", e.g. "salary.changed".

export const ACTIVITY_CATEGORIES = {
  reviews: { label: "Work reviews", prefixes: ["submission."] },
  payments: { label: "Payments & deadlines", prefixes: ["month.", "payout.", "payroll.", "deadline."] },
  money: { label: "Rates, salaries & budget", prefixes: ["rate.", "salary.", "budget.", "role.salary_type_changed"] },
  members: { label: "Members & roles", prefixes: ["member.", "role.assigned", "role.removed"] },
  bank: { label: "Bank details", prefixes: ["bank."] },
  tasks: { label: "Tasks & papers", prefixes: ["task.", "paper."] },
  security: { label: "Security", prefixes: ["two_step.", "member.password_reset", "payroll.exported"] },
} as const;

export type ActivityCategory = keyof typeof ACTIVITY_CATEGORIES;

export function isActivityCategory(value: unknown): value is ActivityCategory {
  return typeof value === "string" && value in ACTIVITY_CATEGORIES;
}

/** Visual tone for an action: important money/security events stand out. */
export function activityTone(action: string): "success" | "danger" | "warning" | "info" | "neutral" {
  if (/\.(approved|paid|activated|enabled|closed|done)$/.test(action)) return "success";
  if (/\.(rejected|deleted|deactivated|removed|disabled|reset|admin_removed|main_admin_removed|cancelled)$/.test(action))
    return "danger";
  if (/^(salary|rate|budget|bank|payroll|member\.password_reset|member\.(main_)?admin_granted|month\.reopened|payout\.unpaid|deadline\.)/.test(action))
    return "warning";
  if (action.startsWith("submission.")) return "info";
  return "neutral";
}

export function activityGroupLabel(action: string): string {
  const group = action.split(".")[0];
  switch (group) {
    case "submission":
      return "Review";
    case "month":
    case "payout":
      return "Payment";
    case "deadline":
      return "Deadline";
    case "task":
      return "Task";
    case "paper":
      return "Paper";
    case "payroll":
      return "Payroll";
    case "rate":
      return "Rate";
    case "salary":
      return "Salary";
    case "budget":
      return "Budget";
    case "role":
      return "Role";
    case "member":
      return "Member";
    case "bank":
      return "Bank";
    case "two_step":
      return "Security";
    default:
      return "Other";
  }
}
