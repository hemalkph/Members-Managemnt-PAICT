import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangleIcon, ChevronRightIcon, MapPinOffIcon, PhoneOffIcon, RouteIcon, UsersIcon } from "lucide-react";
import { LinkButton } from "@/components/animate-ui/components/buttons/link-button";
import { ArrowRight02, FileImport, Route01 } from "@/components/animate-ui/icons/hugeicons";
import { RoundPath } from "@/components/dispatch/round-path";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireDispatch } from "@/lib/dispatch/access";
import { CAPABILITIES } from "@/lib/dispatch/capabilities";
import { plural } from "@/lib/dispatch/i18n";
import { getT } from "@/lib/dispatch/i18n/server";
import { loadRoundProgress } from "@/lib/dispatch/round-progress";
import { countsFromProgress, nextStep, ROUND_STATE } from "@/lib/dispatch/rounds";
import { nextAction, roundStages, waitingFor } from "@/lib/dispatch/stages";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tute dispatch" };

type Setup = { title: string; detail: string; href: string; label: string };

/** The dispatch home: each open round with its steps and the one thing to do next. */
export default async function DispatchOverviewPage() {
  const t = await getT();
  const { caps, canEdit } = await requireDispatch();
  const canSeeStudents = caps.has("plan") || caps.has("courier");
  const supabase = await createClient();

  // Student checks (students are only readable with plan or courier).
  const [active, missingAddress, phoneCheck, imports] = canSeeStudents
    ? await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }).eq("is_active", true),
        supabase
          .from("students")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
          .or(`address_line1.eq."",city.eq.""`),
        supabase.from("students").select("id", { count: "exact", head: true }).eq("is_active", true).is("phone1", null),
        caps.has("plan")
          ? supabase
              .from("student_imports")
              .select("id, file_name, row_count, applied_at, applied_count, created_at")
              .order("created_at", { ascending: false })
              .limit(5)
          : Promise.resolve({ data: [] as never[] }),
      ])
    : [{ count: 0 }, { count: 0 }, { count: 0 }, { data: [] as never[] }];
  const activeCount = active.count ?? 0;
  const missingCount = missingAddress.count ?? 0;
  const phoneCount = phoneCheck.count ?? 0;

  // Open rounds, with this person's next action first.
  const { data: open } = await supabase
    .from("dispatch_rounds")
    .select("id")
    .in("state", ["draft", "finalised", "active"]);
  const rounds = (
    await loadRoundProgress(
      supabase,
      (open ?? []).map((r) => r.id),
    )
  )
    .map((r) => {
      const stages = roundStages(r.id, r.progress, caps);
      const action = nextAction(r.id, r.progress, caps);
      return { ...r, stages, action, waiting: action ? null : waitingFor(stages) };
    })
    .sort((a, b) => Number(Boolean(b.action)) - Number(Boolean(a.action)));

  // Getting the student list ready comes before any round.
  let setup: Setup | null = null;
  if (caps.has("plan") && activeCount === 0) {
    setup = {
      title: t("Add your students"),
      detail: t("Import the student list from a Citypak sheet or CSV. Nothing is saved until you check the preview."),
      href: "/admin/dispatch/students/import",
      label: t("Import students"),
    };
  } else if (canSeeStudents && missingCount > 0) {
    setup = {
      title: t(plural(missingCount, "Review {n} address", "Review {n} addresses"), { n: missingCount }),
      detail: t("These active students have no address or city, so a parcel can't be sent to them yet."),
      href: "/admin/dispatch/students?problem=address",
      label: t("Review addresses"),
    };
  } else if (canSeeStudents && phoneCount > 0) {
    setup = {
      title: t(plural(phoneCount, "Add {n} phone number", "Add {n} phone numbers"), { n: phoneCount }),
      detail: t("Citypak needs a contact number for each parcel."),
      href: "/admin/dispatch/students?problem=phone",
      label: t("Review phones"),
    };
  }

  const checks = [
    {
      label: t("Active students"),
      value: activeCount,
      icon: UsersIcon,
      href: "/admin/dispatch/students",
      bad: false,
    },
    {
      label: t("Missing address"),
      value: missingCount,
      icon: MapPinOffIcon,
      href: "/admin/dispatch/students?problem=address",
      bad: missingCount > 0,
    },
    {
      label: t("No phone"),
      value: phoneCount,
      icon: PhoneOffIcon,
      href: "/admin/dispatch/students?problem=phone",
      bad: phoneCount > 0,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Tute dispatch")}
        description={t("Your rounds and the one thing to do next in each.")}
        actions={
          caps.has("plan") ? (
            <>
              <LinkButton href="/admin/dispatch/students/import" variant="outline">
                <FileImport className="size-4" /> {t("Import students")}
              </LinkButton>
              <LinkButton href="/admin/dispatch/rounds/new">
                <Route01 className="size-4" /> {t("New round")}
              </LinkButton>
            </>
          ) : undefined
        }
      />

      {setup && (
        <Alert variant="warning" className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
            <div>
              <AlertTitle>{setup.title}</AlertTitle>
              <AlertDescription>{setup.detail}</AlertDescription>
            </div>
          </div>
          <LinkButton href={setup.href} variant="outline" size="sm" className="shrink-0">
            {setup.label} <ArrowRight02 className="size-4" />
          </LinkButton>
        </Alert>
      )}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <section className="space-y-3" aria-labelledby="rounds-now">
          <div className="flex items-baseline justify-between gap-2">
            <h2 id="rounds-now" className="text-base font-semibold">
              {t("Rounds in progress")}
              {rounds.length > 0 && (
                <span className="text-muted-foreground ml-2 text-sm font-normal tabular-nums">{rounds.length}</span>
              )}
            </h2>
            <Link
              href="/admin/dispatch/rounds"
              className="text-primary text-sm font-medium underline-offset-4 hover:underline"
            >
              {t("All rounds")}
            </Link>
          </div>
          {rounds.length === 0 ? (
            <EmptyState
              icon={RouteIcon}
              title={t("No rounds in progress")}
              description={t("Start a round to send tutes to a batch. It walks you through each step.")}
              action={
                caps.has("plan") ? (
                  <LinkButton href="/admin/dispatch/rounds/new">
                    <Route01 className="size-4" /> {t("New round")}
                  </LinkButton>
                ) : undefined
              }
            />
          ) : (
            <ul className="space-y-3">
              {rounds.map((r) => (
                <li key={r.id} className="bg-card rounded-xl border p-4 shadow-xs transition-shadow hover:shadow-sm">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/admin/dispatch/rounds/${r.id}`}
                        className="block truncate font-semibold underline-offset-4 hover:underline"
                      >
                        {r.name}
                      </Link>
                      <p className="text-muted-foreground text-xs tabular-nums">
                        {t(plural(r.progress.live, "{n} parcel", "{n} parcels"), { n: r.progress.live })}
                        {r.progress.onHold > 0 && (
                          <span className="text-amber-700 dark:text-warning">
                            {" "}
                            · {t("{n} on hold", { n: r.progress.onHold })}
                          </span>
                        )}
                      </p>
                    </div>
                    <Badge variant={ROUND_STATE[r.progress.state].variant}>
                      {t(ROUND_STATE[r.progress.state].label)}
                    </Badge>
                  </div>
                  <RoundPath
                    compact
                    t={t}
                    stages={r.stages}
                    action={r.action}
                    waiting={r.waiting}
                    sentence={nextStep(r.progress.state, countsFromProgress(r.progress), t)}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="space-y-4">
          {canSeeStudents && (
            <Card className="gap-2 py-4">
              <CardHeader>
                <CardTitle className="text-sm">{t("Student register")}</CardTitle>
              </CardHeader>
              <CardContent className="px-2">
                <ul>
                  {checks.map((c) => (
                    <li key={c.href}>
                      <Link
                        href={c.href}
                        className="hover:bg-muted focus-visible:ring-ring/50 flex min-h-11 items-center gap-3 rounded-lg px-2 transition-colors outline-none focus-visible:ring-[3px]"
                      >
                        <span
                          className={cn(
                            "flex size-8 shrink-0 items-center justify-center rounded-md",
                            c.bad ? "bg-warning/20 text-amber-700 dark:text-warning" : "bg-muted text-muted-foreground",
                          )}
                        >
                          <c.icon className="size-4" />
                        </span>
                        <span className="flex-1 text-sm">{c.label}</span>
                        <span
                          className={cn(
                            "text-sm font-semibold tabular-nums",
                            c.bad && "text-amber-700 dark:text-warning",
                          )}
                        >
                          {c.value}
                        </span>
                        <ChevronRightIcon className="text-muted-foreground size-4" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          <Card className="gap-2 py-4">
            <CardHeader>
              <CardTitle className="text-sm">{t("Your dispatch permissions")}</CardTitle>
              <CardDescription className="text-xs">
                {canEdit ? t("What you can do in Tute dispatch.") : t("You have read-only access to Tute dispatch.")}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1.5">
              {CAPABILITIES.filter((c) => caps.has(c.key)).map((c) => (
                <Badge key={c.key} variant="secondary" title={t(c.description)}>
                  {t(c.title)}
                </Badge>
              ))}
              {caps.size === 0 && <span className="text-muted-foreground text-sm">{t("View only")}</span>}
            </CardContent>
          </Card>

          {caps.has("plan") && (
            <Card className="gap-2 py-4">
              <CardHeader>
                <CardTitle className="text-sm">{t("Recent imports")}</CardTitle>
                <CardDescription className="text-xs">
                  {t("Uploaded files are deleted automatically after the retention period.")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {imports.data && imports.data.length > 0 ? (
                  <ul className="divide-y text-sm">
                    {imports.data.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{i.file_name}</p>
                          <p className="text-muted-foreground text-xs">
                            {formatDateTime(i.created_at)} · {t("{n} rows", { n: i.row_count })}
                          </p>
                        </div>
                        {i.applied_at ? (
                          <Badge variant="success">
                            {t("{applied_count} saved", { applied_count: i.applied_count })}
                          </Badge>
                        ) : (
                          <Badge variant="outline">{t("Not saved")}</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground text-sm">{t("No imports yet.")}</p>
                )}
              </CardContent>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}
