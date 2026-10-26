import type { PaperStageName } from "@/lib/database.types";

// Shared by server and client code (no secrets here).

export const STAGES: { stage: PaperStageName; label: string; short: string; description: string }[] = [
  { stage: "created", label: "Create", short: "Created", description: "Write the paper or tute" },
  { stage: "typeset", label: "Type set", short: "Type set", description: "Type and lay out the pages" },
  { stage: "converted", label: "Convert to English", short: "Converted", description: "English medium version" },
  { stage: "marked", label: "Mark", short: "Marked", description: "Mark the answer scripts" },
];

export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.stage, s.label])) as Record<PaperStageName, string>;

export const PAPERS_BUCKET = "papers";

export type StageStatus = "waiting" | "in_progress" | "done" | "skipped";

export type StageView = {
  id: string;
  stage: PaperStageName;
  position: number;
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  status: StageStatus;
  completedAt: string | null;
  overdue: boolean;
};

export type PaperView = {
  id: string;
  title: string;
  kind: "paper" | "tute";
  examId: string | null;
  examLabel: string | null;
  notes: string | null;
  status: "in_progress" | "done" | "cancelled";
  createdAt: string;
  completedAt: string | null;
  stages: StageView[];
  fileCount: number;
};

/** Stepper steps for a paper. */
export function paperSteps(stages: StageView[], formatDue: (d: string) => string) {
  return stages.map((s) => ({
    key: s.stage,
    label: STAGE_LABEL[s.stage],
    state:
      s.status === "done"
        ? ("done" as const)
        : s.status === "skipped"
          ? ("skipped" as const)
          : s.status === "in_progress"
            ? s.overdue
              ? ("overdue" as const)
              : ("active" as const)
            : ("waiting" as const),
    hint:
      s.status === "skipped"
        ? "Skipped"
        : [s.ownerName ?? (s.status === "done" ? null : "No owner"), s.status !== "done" && s.dueDate ? formatDue(s.dueDate) : null]
            .filter(Boolean)
            .join(" · ") || undefined,
  }));
}
