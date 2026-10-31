import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRightIcon, FileSpreadsheetIcon, PackageIcon, MapPinOffIcon, PhoneOffIcon, ShieldCheckIcon, UsersIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CAPABILITIES } from "@/lib/dispatch/capabilities";
import { requireDispatch } from "@/lib/dispatch/access";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Tute dispatch" };

type NextAction = { title: string; detail: string; href: string; label: string };

export default async function DispatchOverviewPage() {
  const { caps, canEdit } = await requireDispatch();
  const canSeeStudents = caps.has("plan") || caps.has("courier");
  const supabase = await createClient();

  // Counts come straight from the database; students are only readable with plan or courier.
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

  // Rounds and parcels hold no personal data, so everyone with the page sees these.
  const [{ data: openRounds }, { data: waitingParcels }] = await Promise.all([
    supabase.from("dispatch_rounds").select("id, name, state").in("state", ["draft", "finalised", "active"]).order("created_at"),
    supabase.from("parcels").select("round_id").eq("registration_state", "unregistered").limit(20000),
  ]);
  const waitingByRound = new Map<string, number>();
  for (const p of waitingParcels ?? []) waitingByRound.set(p.round_id, (waitingByRound.get(p.round_id) ?? 0) + 1);
  const needsTracking = (openRounds ?? []).find((r) => r.state !== "draft" && (waitingByRound.get(r.id) ?? 0) > 0);

  // The next step, worked out from what is actually saved.
  let next: NextAction | null = null;
  if (needsTracking && caps.has("courier")) {
    const n = waitingByRound.get(needsTracking.id) ?? 0;
    next = {
      title: `${n} parcel${n === 1 ? "" : "s"} in “${needsTracking.name}” need tracking numbers`,
      detail: "Register them with Citypak, then upload the processed sheet Citypak gives back.",
      href: `/admin/dispatch/rounds/${needsTracking.id}/courier`,
      label: "Import tracking sheet",
    };
  }
  if (next === null && caps.has("plan") && activeCount === 0) {
    next = {
      title: "Add your students",
      detail: "Import the student list from a Citypak sheet or CSV. Nothing is saved until you check the preview.",
      href: "/admin/dispatch/students/import",
      label: "Import students",
    };
  } else if (next === null && canSeeStudents && missingCount > 0) {
    next = {
      title: `Review ${missingCount} ${missingCount === 1 ? "address" : "addresses"}`,
      detail: "These active students have no address or city, so a parcel can't be sent to them yet.",
      href: "/admin/dispatch/students?problem=address",
      label: "Review addresses",
    };
  } else if (next === null && canSeeStudents && phoneCount > 0) {
    next = {
      title: `Add ${phoneCount} phone ${phoneCount === 1 ? "number" : "numbers"}`,
      detail: "Citypak needs a contact number for each parcel.",
      href: "/admin/dispatch/students?problem=phone",
      label: "Review phones",
    };
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tute dispatch"
        description="Plan tute rounds, add Citypak tracking numbers, pack and hand parcels over, track delivery and COD, then close each round."
        actions={
          caps.has("plan") ? (
            <Button asChild>
              <Link href="/admin/dispatch/students/import">
                <FileSpreadsheetIcon /> Import students
              </Link>
            </Button>
          ) : undefined
        }
      />

      {canSeeStudents ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Open rounds" value={(openRounds ?? []).length} icon={PackageIcon} hint="Draft, finalised or active" />
          <StatCard label="Active students" value={activeCount} icon={UsersIcon} hint="In the delivery register" />
          <StatCard
            label="Missing address"
            value={missingCount}
            icon={MapPinOffIcon}
            tone={missingCount > 0 ? "warning" : "success"}
            hint="No address line or city"
            delay={0.1}
          />
          <StatCard
            label="No phone"
            value={phoneCount}
            icon={PhoneOffIcon}
            tone={phoneCount > 0 ? "warning" : "success"}
            hint="No usable contact number"
            delay={0.2}
          />
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Progress view</CardTitle>
            <CardDescription>
              You can follow dispatch progress here. Round and parcel counts appear once dispatch rounds are added in the
              next phase. Student addresses and phone numbers are only shown to people who plan or send parcels.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {next && (
        <Card className="border-primary/40 gap-3">
          <CardHeader>
            <CardDescription className="text-primary text-xs font-semibold tracking-wide uppercase">Next step</CardDescription>
            <CardTitle>{next.title}</CardTitle>
            <CardDescription>{next.detail}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link href={next.href}>
                {next.label} <ArrowRightIcon />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheckIcon className="text-primary size-5" /> Your dispatch permissions
            </CardTitle>
            <CardDescription>
              {canEdit ? "What you can do in Tute dispatch." : "You have read-only access to Tute dispatch."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {CAPABILITIES.filter((c) => caps.has(c.key)).map((c) => (
              <Badge key={c.key} variant="secondary" title={c.description}>
                {c.title}
              </Badge>
            ))}
            {caps.size === 0 && <span className="text-muted-foreground text-sm">View only</span>}
          </CardContent>
        </Card>

        {caps.has("plan") && (
          <Card className="gap-3">
            <CardHeader>
              <CardTitle>Recent imports</CardTitle>
              <CardDescription>Uploaded files are deleted automatically after the retention period.</CardDescription>
            </CardHeader>
            <CardContent>
              {imports.data && imports.data.length > 0 ? (
                <ul className="divide-y text-sm">
                  {imports.data.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium">{i.file_name}</p>
                        <p className="text-muted-foreground text-xs">
                          {formatDateTime(i.created_at)} · {i.row_count} rows
                        </p>
                      </div>
                      {i.applied_at ? (
                        <Badge variant="success">{i.applied_count} saved</Badge>
                      ) : (
                        <Badge variant="outline">Not saved</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">No imports yet.</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
