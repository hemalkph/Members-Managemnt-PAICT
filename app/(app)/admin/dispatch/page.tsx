import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton } from "@/components/animate-ui/components/buttons/link-button";
import {
  ArrowRight02,
  CallBlocked,
  FileImport,
  LocationOffline01,
  Route01,
  SecurityCheck,
  Students,
} from "@/components/animate-ui/icons/hugeicons";
import { RoundPath } from "@/components/dispatch/round-path";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireDispatch } from "@/lib/dispatch/access";
import { CAPABILITIES } from "@/lib/dispatch/capabilities";
import { plural } from "@/lib/dispatch/i18n";
import { getT } from "@/lib/dispatch/i18n/server";
import { loadRoundProgress } from "@/lib/dispatch/round-progress";
import { nextStep, ROUND_STATE } from "@/lib/dispatch/rounds";
import { nextAction, roundStages, waitingFor, type RoundProgress } from "@/lib/dispatch/stages";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tute dispatch" };

type Setup = { title: string; detail: string; href: string; label: string };

const counts = (p: RoundProgress) => ({
  parcels: p.live,
  registered: p.registered,
  voided: 0,
  packed: p.packed,
  verified: p.verified,
  onHold: p.onHold,
  handedOver: p.handedOver,
  delivered: p.delivered,
  returned: p.returned,
  problems: p.failed,
  codOwing: p.codOwing,
  canClose:
    p.live > 0 && p.handedOver >= p.live && p.delivered + p.returned >= p.live && p.codOwing <= 0 && p.inDraft === 0,
});

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
        <Card className="border-warning/60 gap-3">
          <CardHeader>
            <CardTitle>{setup.title}</CardTitle>
            <CardDescription>{setup.detail}</CardDescription>
          </CardHeader>
          <CardContent>
            <LinkButton href={setup.href} variant="outline">
              {setup.label} <ArrowRight02 className="size-4" />
            </LinkButton>
          </CardContent>
        </Card>
      )}

      <section className="space-y-3" aria-labelledby="rounds-now">
        <h2 id="rounds-now" className="text-lg font-semibold">
          {t("Rounds in progress")}
        </h2>
        {rounds.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>{t("No rounds in progress")}</CardTitle>
              <CardDescription>
                {t("Start a round to send tutes to a batch. It walks you through each step.")}
              </CardDescription>
            </CardHeader>
            {caps.has("plan") && (
              <CardContent>
                <LinkButton href="/admin/dispatch/rounds/new">
                  <Route01 className="size-4" /> {t("New round")}
                </LinkButton>
              </CardContent>
            )}
          </Card>
        ) : (
          <div className="space-y-3">
            {rounds.map((r) => (
              <Card key={r.id} className="gap-3">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <CardTitle className="leading-snug">
                        <Link href={`/admin/dispatch/rounds/${r.id}`} className="underline-offset-4 hover:underline">
                          {r.name}
                        </Link>
                      </CardTitle>
                      <CardDescription>
                        {t(plural(r.progress.live, "{n} parcel", "{n} parcels"), { n: r.progress.live })}
                        {r.progress.onHold > 0 && (
                          <span className="text-amber-700 dark:text-warning">
                            {" "}
                            · {t("{n} on hold", { n: r.progress.onHold })}
                          </span>
                        )}
                      </CardDescription>
                    </div>
                    <Badge variant={ROUND_STATE[r.progress.state].variant}>
                      {t(ROUND_STATE[r.progress.state].label)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <RoundPath
                    compact
                    t={t}
                    stages={r.stages}
                    action={r.action}
                    waiting={r.waiting}
                    sentence={nextStep(r.progress.state, counts(r.progress), t)}
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {canSeeStudents && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <StatCard
            label={t("Active students")}
            value={activeCount}
            icon={Students}
            hint={t("In the delivery register")}
          />
          <StatCard
            label={t("Missing address")}
            value={missingCount}
            icon={LocationOffline01}
            tone={missingCount > 0 ? "warning" : "success"}
            hint={t("No address line or city")}
            delay={0.1}
          />
          <StatCard
            label={t("No phone")}
            value={phoneCount}
            icon={CallBlocked}
            tone={phoneCount > 0 ? "warning" : "success"}
            hint={t("No usable contact number")}
            delay={0.2}
          />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SecurityCheck className="text-primary size-5" animateOnView /> {t("Your dispatch permissions")}
            </CardTitle>
            <CardDescription>
              {canEdit ? t("What you can do in Tute dispatch.") : t("You have read-only access to Tute dispatch.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {CAPABILITIES.filter((c) => caps.has(c.key)).map((c) => (
              <Badge key={c.key} variant="secondary" title={t(c.description)}>
                {t(c.title)}
              </Badge>
            ))}
            {caps.size === 0 && <span className="text-muted-foreground text-sm">{t("View only")}</span>}
          </CardContent>
        </Card>

        {caps.has("plan") && (
          <Card className="gap-3">
            <CardHeader>
              <CardTitle>{t("Recent imports")}</CardTitle>
              <CardDescription>
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
      </div>
    </div>
  );
}
