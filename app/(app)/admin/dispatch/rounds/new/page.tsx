import type { Metadata } from "next";
import Link from "next/link";
import { CheckIcon, CopyIcon, FilePlus2Icon, GraduationCapIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { RoundForm } from "@/components/dispatch/round-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireDispatch } from "@/lib/dispatch/access";
import { plural } from "@/lib/dispatch/i18n";
import { monthLabelFromDate } from "@/lib/dispatch/rounds";
import { shiftMonth } from "@/lib/month";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { uuid } from "@/lib/validation";

import { getT } from "@/lib/dispatch/i18n/server";
export const metadata: Metadata = { title: "New round – Tute dispatch" };

export default async function NewRoundPage({ searchParams }: PageProps<"/admin/dispatch/rounds/new">) {
  const t = await getT();
  await requireDispatch("plan");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: batches }, { data: settings }, { data: recent }] = await Promise.all([
    supabase.from("batches").select("id, name").eq("is_active", true).order("sort_order").order("name"),
    supabase.from("dispatch_settings").select("default_cod, default_weight_g, default_pieces").limit(1).maybeSingle(),
    supabase
      .from("dispatch_rounds")
      .select("*")
      .neq("state", "cancelled")
      .order("created_at", { ascending: false })
      .limit(6),
  ]);
  const rounds = recent ?? [];
  const ids = rounds.map((r) => r.id);
  const [{ data: tuteRows }, { data: studentRows }] = ids.length
    ? await Promise.all([
        supabase.from("round_tutes").select("round_id").in("round_id", ids),
        supabase.from("round_students").select("round_id").in("round_id", ids).limit(20000),
      ])
    : [{ data: [] }, { data: [] }];
  const count = (rows: { round_id: string }[] | null, id: string) => (rows ?? []).filter((r) => r.round_id === id).length;
  const batchName = new Map((batches ?? []).map((b) => [b.id, b.name]));

  const fromId = typeof sp.from === "string" && uuid.safeParse(sp.from).success ? sp.from : null;
  // An older round (opened from its own page) may not be in the recent list.
  const from =
    rounds.find((r) => r.id === fromId) ??
    (fromId
      ? ((await supabase.from("dispatch_rounds").select("*").eq("id", fromId).neq("state", "cancelled").maybeSingle())
          .data ?? undefined)
      : undefined);
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const values = from
    ? {
        id: "",
        name: "",
        batch_id: from.batch_id,
        sending_month: shiftMonth(from.sending_month.slice(0, 7), 1),
        group_label: from.group_label,
        subject: from.subject,
        ref_prefix: "",
        default_cod: Number(from.default_cod),
        default_weight_g: from.default_weight_g,
        default_pieces: from.default_pieces,
        planned_handover: "",
        notes: from.notes,
      }
    : {
        id: "",
        name: "",
        batch_id: batches?.[0]?.id ?? "",
        sending_month: thisMonth,
        group_label: "",
        subject: "",
        ref_prefix: "",
        default_cod: Number(settings?.default_cod ?? 0),
        default_weight_g: settings?.default_weight_g ?? 1000,
        default_pieces: settings?.default_pieces ?? 1,
        planned_handover: "",
        notes: "",
      };
  // The copied round's batch must be selectable even if it was made inactive since.
  const batchOptions =
    from && !(batches ?? []).some((b) => b.id === from.batch_id)
      ? [...(batches ?? []), { id: from.batch_id, name: t("Batch of the copied round") }]
      : (batches ?? []);

  const option = (href: string, selected: boolean, icon: React.ReactNode, title: string, detail: string) => (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "focus-visible:ring-ring/50 flex min-h-14 items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors outline-none focus-visible:ring-[3px]",
        selected ? "border-primary bg-primary/5" : "hover:bg-muted",
      )}
    >
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md",
          selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {selected ? <CheckIcon className="size-4" /> : icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="text-muted-foreground block truncate text-xs">{detail}</span>
      </span>
    </Link>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("New dispatch round")}
        description={t("Start from an earlier round to reuse its tutes and students, or start an empty one.")}
      />
      {!batches || batches.length === 0 ? (
        <EmptyState
          icon={GraduationCapIcon}
          title={t("Add a batch first")}
          description={t("Rounds belong to a batch. Add one under Batches & exams.")}
        />
      ) : (
        <>
          {rounds.length > 0 && (
            <Card className="gap-3">
              <CardHeader>
                <CardTitle className="text-base">{t("Start from")}</CardTitle>
                <CardDescription>
                  {t("A copy keeps the batch, tutes and students (with their COD and contents). You can change anything before finalising.")}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {option(
                  "/admin/dispatch/rounds/new",
                  !from,
                  <FilePlus2Icon className="size-4" />,
                  t("An empty round"),
                  t("Choose tutes and students yourself"),
                )}
                {rounds.map((r) =>
                  option(
                    `/admin/dispatch/rounds/new?from=${r.id}`,
                    from?.id === r.id,
                    <CopyIcon className="size-4" />,
                    r.name,
                    `${batchName.get(r.batch_id) ?? "—"} · ${monthLabelFromDate(r.sending_month)} · ${t(
                      plural(count(tuteRows, r.id), "{n} tute", "{n} tutes"),
                      { n: count(tuteRows, r.id) },
                    )} · ${t(plural(count(studentRows, r.id), "{n} student", "{n} students"), {
                      n: count(studentRows, r.id),
                    })}`,
                  ),
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{from ? t("Details of the new round") : t("Round details")}</CardTitle>
              {from && (
                <CardDescription>
                  {t("Copying “{name}”. Give the new round its own name and a new reference prefix (the last one was {prefix}).", {
                    name: from.name,
                    prefix: from.ref_prefix,
                  })}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {/* key: switching the round to copy refills the form. */}
              <RoundForm
                key={from?.id ?? "empty"}
                batches={batchOptions}
                lockBatch={Boolean(from)}
                copyFrom={from?.id}
                values={values}
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
