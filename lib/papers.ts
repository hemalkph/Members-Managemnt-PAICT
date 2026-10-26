import type { PaperStageName } from "@/lib/database.types";

// Shared by server and client code (no secrets here).

export type StageMeta = {
  stage: PaperStageName;
  label: string;
  /** Who usually does it. */
  description: string;
  /** What the owner does, shown on "It's your turn". */
  howTo: string;
  /** Only needed when the paper is also in English. */
  english?: boolean;
  /** Default work days, counted from the physical-centre exam day (a Wednesday). */
  startOffset: number;
  dueOffset: number;
};

/**
 * The weekly flow. Exam day = Wednesday, when physical centres write the paper.
 *   Create Mon–Fri (week before) → Type set (Sinhala) + Convert Sat–Sun →
 *   Type set (English) Mon → Reviews Mon–Tue → Correct & hand over Tue → exam Wed.
 */
export const STAGES: StageMeta[] = [
  {
    stage: "create_si",
    label: "Create (Sinhala)",
    description: "Paper creating team writes the paper",
    howTo: "Write the Sinhala paper and add the link to your draft.",
    startOffset: -9,
    dueOffset: -5,
  },
  {
    stage: "typeset_si",
    label: "Type set (Sinhala)",
    description: "Type and lay out the Sinhala paper",
    howTo: "Type set the Sinhala paper and add the link to the file.",
    startOffset: -4,
    dueOffset: -3,
  },
  {
    stage: "convert",
    label: "Convert to English",
    description: "Conversion team makes the English version",
    howTo: "Convert the paper to English (2 days at most) and add the link.",
    english: true,
    startOffset: -4,
    dueOffset: -3,
  },
  {
    stage: "typeset_en",
    label: "Type set (English)",
    description: "Type and lay out the English paper",
    howTo: "Type set the English paper and add the link to the file.",
    english: true,
    startOffset: -2,
    dueOffset: -2,
  },
  {
    stage: "review_si",
    label: "Review (Sinhala)",
    description: "Paper creator checks the type set paper",
    howTo: "Check the type set Sinhala paper and send your corrections to the type setter.",
    startOffset: -2,
    dueOffset: -1,
  },
  {
    stage: "review_en",
    label: "Review (English)",
    description: "Converter checks the English paper",
    howTo: "Check the type set English paper and send your corrections to the type setter.",
    english: true,
    startOffset: -2,
    dueOffset: -1,
  },
  {
    stage: "handover",
    label: "Correct & hand over",
    description: "Type setter fixes it and sends the PDFs",
    howTo:
      "Make the corrections, then send the final PDF to the LMS admin and physical coordinator WhatsApp groups. Don't upload it here.",
    startOffset: -1,
    dueOffset: -1,
  },
  {
    stage: "mark",
    label: "Mark",
    description: "Mark the answer scripts (optional)",
    howTo: "Mark the answer scripts after the exam.",
    startOffset: 1,
    dueOffset: 7,
  },
];

export const STAGE_LABEL = Object.fromEntries(STAGES.map((s) => [s.stage, s.label])) as Record<PaperStageName, string>;
export const STAGE_META = Object.fromEntries(STAGES.map((s) => [s.stage, s])) as Record<PaperStageName, StageMeta>;

export const PAPERS_BUCKET = "papers";

export type PaperMedium = "si" | "both";
export type PaperPart = "mcq" | "essay" | "full";

export const MEDIUM_LABEL: Record<PaperMedium, string> = { si: "Sinhala", both: "Sinhala + English" };
export const PART_LABEL: Record<PaperPart, string> = { mcq: "MCQ", essay: "SE & Essay", full: "Full paper" };

// ---------------------------------------------------------------- dates
const DAY = 86_400_000;

/** "YYYY-MM-DD" plus n days. */
export function addDays(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
function weekday(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/**
 * The exam Wednesday that a paper started today would be ready for:
 * Monday or Tuesday → next week's Wednesday; later in the week → the one after.
 */
export function defaultExamDay(today: string): string {
  const d = weekday(today);
  const monday = addDays(today, d === 0 ? -6 : 1 - d);
  return addDays(monday, d >= 1 && d <= 2 ? 9 : 16);
}

/** Default start and due date of every stage for an exam day. */
export function defaultSchedule(examDay: string): Record<PaperStageName, { start: string; due: string }> {
  return Object.fromEntries(
    STAGES.map((s) => [s.stage, { start: addDays(examDay, s.startOffset), due: addDays(examDay, s.dueOffset) }]),
  ) as Record<PaperStageName, { start: string; due: string }>;
}

/** Physical centres are one paper ahead: online students write it a week later. */
export function onlineExamDay(examDay: string): string {
  return addDays(examDay, 7);
}

// ---------------------------------------------------------------- views
export type StageStatus = "waiting" | "in_progress" | "done" | "skipped";

export type StageView = {
  id: string;
  stage: PaperStageName;
  position: number;
  ownerId: string | null;
  ownerName: string | null;
  startDate: string | null;
  dueDate: string | null;
  link: string | null;
  status: StageStatus;
  completedAt: string | null;
  overdue: boolean;
};

export type PaperView = {
  id: string;
  title: string;
  kind: "paper" | "tute";
  medium: PaperMedium;
  part: PaperPart;
  examDay: string | null;
  examId: string | null;
  examLabel: string | null;
  notes: string | null;
  status: "in_progress" | "done" | "cancelled";
  lmsLink: string | null;
  physicalLink: string | null;
  handedOverAt: string | null;
  createdAt: string;
  completedAt: string | null;
  stages: StageView[];
  /** Stages with a work link. */
  linkCount: number;
};

/** Stepper steps for a paper. */
export function paperSteps(stages: StageView[], formatDue: (d: string) => string) {
  return stages.map((s) => ({
    key: s.stage,
    label: STAGE_LABEL[s.stage] ?? s.stage,
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
