import type { Metadata } from "next";
import { CheckCheckIcon, FileStackIcon, LoaderIcon, TriangleAlertIcon, UsersIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { NewPaperDialog } from "@/components/papers/new-paper-dialog";
import { StorageCard } from "@/components/papers/storage-card";
import { PaperFilters } from "@/components/papers/paper-filters";
import { PaperRow } from "@/components/papers/paper-row";
import { GroupLinksForm } from "@/components/papers/stage-controls";
import BlurText from "@/components/reactbits/blur-text";
import { StatCard } from "@/components/stat-card";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { mainAdminUnlocked, requireAdmin } from "@/lib/auth";
import { STORAGE_LIMIT_BYTES } from "@/lib/paper-cleanup";
import { activeOptions, getClassOptions } from "@/lib/classes";
import { todayISO } from "@/lib/month";
import { getPapers } from "@/lib/paper-queries";
import { nextExamDay } from "@/lib/papers";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Papers" };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const STATUSES = ["in_progress", "done", "cancelled"] as const;

export default async function PapersPage({ searchParams }: PageProps<"/admin/papers">) {
  const profile = await requireAdmin();
  const sp = await searchParams;
  const exam = uuid.safeParse(one(sp.exam)).success ? one(sp.exam) : "";
  const status = STATUSES.find((s) => s === one(sp.status)) ?? "in_progress";

  const supabase = await createClient();
  const [
    papers,
    allPapers,
    classOptions,
    { data: profiles },
    { data: usage },
    { data: settings },
    canEdit,
    { data: openTasks },
  ] = await Promise.all([
    getPapers(supabase, { examId: exam || null, status }),
    getPapers(supabase, { examId: exam || null }),
    getClassOptions(supabase),
    supabase.from("profiles").select("id, full_name, email").eq("is_active", true).order("full_name"),
    supabase.rpc("storage_usage"),
    supabase
      .from("app_settings")
      .select("paper_file_days, paper_default_owners, lms_group_link, physical_group_link")
      .limit(1)
      .maybeSingle(),
    mainAdminUnlocked(profile),
    // Workload check: open and upcoming tasks per member (by due date).
    supabase
      .from("tasks")
      .select("assignee_id, due_date")
      .in("status", ["open", "waiting"])
      .not("due_date", "is", null)
      .limit(3000),
  ]);
  const tags = activeOptions(classOptions);

  const inProgress = allPapers.filter((p) => p.status === "in_progress");
  const overdue = inProgress.filter((p) => p.stages.some((s) => s.overdue)).length;
  const unassigned = inProgress.filter((p) => p.stages.some((s) => s.status === "in_progress" && !s.ownerId)).length;

  // Group by exam (papers without an exam last).
  const groups = new Map<string, { label: string; papers: typeof papers }>();
  for (const p of papers) {
    const key = p.examId ?? "none";
    const g = groups.get(key) ?? { label: p.examLabel ?? "Not for an exam", papers: [] };
    g.papers.push(p);
    groups.set(key, g);
  }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === "none" ? 1 : b === "none" ? -1 : 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <BlurText as="h1" text="Papers" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
          <p className="text-muted-foreground text-sm">
            Create → Type set + Convert → Type set (English) → Review → Hand over → Marking scheme, all in the system.
          </p>
        </div>
        <NewPaperDialog
          members={(profiles ?? []).map((p) => ({
            id: p.id,
            name: p.full_name || p.email,
            busy: (openTasks ?? []).filter((t) => t.assignee_id === p.id).map((t) => t.due_date!),
          }))}
          defaultOwners={(settings?.paper_default_owners ?? {}) as Record<string, string>}
          exams={tags.exams.map((e) => ({ id: e.id, label: e.label, examDate: e.examDate }))}
          defaultExam={exam || undefined}
          today={todayISO()}
          nextExamDay={nextExamDay(
            todayISO(),
            allPapers.filter((p) => p.kind === "paper" && p.status !== "cancelled").map((p) => p.examDay),
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="In progress" value={inProgress.length} icon={LoaderIcon} />
        <StatCard label="Behind schedule" value={overdue} icon={TriangleAlertIcon} tone="warning" delay={0.1} />
        <StatCard label="Need an owner" value={unassigned} icon={FileStackIcon} tone="info" delay={0.2} />
        <StatCard
          label="Finished"
          value={allPapers.filter((p) => p.status === "done").length}
          icon={CheckCheckIcon}
          tone="success"
          delay={0.3}
        />
      </div>

      <PaperFilters status={status} exam={exam} exams={classOptions.exams.map((e) => ({ id: e.id, label: e.label }))} />

      {papers.length === 0 ? (
        <EmptyState
          icon={FileStackIcon}
          title={
            status === "in_progress"
              ? "No papers in progress"
              : status === "done"
                ? "No finished papers"
                : "No cancelled papers"
          }
          description="Add a paper or tute and choose who does each stage."
        />
      ) : (
        <div className="space-y-4">
          {ordered.map(([key, group]) => (
            <Card key={key} className="gap-3">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {group.label}
                  <span className="text-muted-foreground text-sm font-normal">
                    {group.papers.length} {group.papers.length === 1 ? "paper" : "papers"}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                {group.papers.map((p) => (
                  <PaperRow key={p.id} paper={p} />
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UsersIcon className="text-primary size-5" /> WhatsApp groups
            </CardTitle>
            <CardDescription>
              The LMS admin and physical coordinator groups. Set them once – every paper&apos;s hand-over uses the same
              links, and members can message each other on WhatsApp from any paper.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GroupLinksForm
              lmsLink={settings?.lms_group_link ?? null}
              physicalLink={settings?.physical_group_link ?? null}
            />
          </CardContent>
        </Card>
        <StorageCard
          usage={(usage ?? []).map((u) => ({ bucket: u.bucket, files: Number(u.files), bytes: Number(u.bytes) }))}
          limitBytes={STORAGE_LIMIT_BYTES}
          days={settings?.paper_file_days ?? 14}
          canEdit={canEdit}
        />
      </div>
    </div>
  );
}
