import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRightIcon, PencilIcon, TruckIcon } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { ContentsMatrix } from "@/components/dispatch/contents-matrix";
import { ParcelCorrectDialog } from "@/components/dispatch/parcel-correct-dialog";
import { RoundForm } from "@/components/dispatch/round-form";
import { RoundReviewPanel } from "@/components/dispatch/round-review";
import { RoundStudentsPicker, type ChosenSettings } from "@/components/dispatch/round-students-picker";
import { RoundTutesEditor } from "@/components/dispatch/round-tutes-editor";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RoundClosePanel, type CloseCheck } from "@/components/dispatch/round-close-panel";
import { mainAdminUnlocked } from "@/lib/auth";
import { requireDispatch } from "@/lib/dispatch/access";
import { reviewRound } from "@/lib/dispatch/review";
import { monthLabelFromDate, nextStep, ROUND_STATE } from "@/lib/dispatch/rounds";
import { formatLKR } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { uuid } from "@/lib/validation";
import { CheckCircle2Icon, HashIcon, PackageCheckIcon, PackageIcon, ScanBarcodeIcon } from "lucide-react";

export const metadata: Metadata = { title: "Round – Tute dispatch" };

const STEPS = [
  { key: "details", label: "1. Details" },
  { key: "tutes", label: "2. Tutes" },
  { key: "students", label: "3. Students" },
  { key: "contents", label: "4. Contents" },
  { key: "review", label: "5. Review" },
] as const;
type Step = (typeof STEPS)[number]["key"];

export default async function RoundPage({ params, searchParams }: PageProps<"/admin/dispatch/rounds/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();
  const { caps, profile } = await requireDispatch();
  const canPlan = caps.has("plan");
  const seesPeople = canPlan || caps.has("courier");
  const sp = await searchParams;

  const supabase = await createClient();
  const { data: round } = await supabase.from("dispatch_rounds").select("*").eq("id", id).maybeSingle();
  if (!round) notFound();
  const [{ data: batch }, { data: tuteRows }] = await Promise.all([
    supabase.from("batches").select("id, name").eq("id", round.batch_id).maybeSingle(),
    supabase.from("round_tutes").select("*").eq("round_id", id).order("sort_order"),
  ]);
  const tutes = tuteRows ?? [];
  const state = ROUND_STATE[round.state];

  const header = (
    <PageHeader
      title={round.name}
      description={
        <>
          {batch?.name ?? "—"} · {monthLabelFromDate(round.sending_month)} · prefix <span className="font-mono">{round.ref_prefix}</span>
        </>
      }
      actions={<Badge variant={state.variant}>{state.label}</Badge>}
    />
  );

  // ------------------------------------------------------------------ draft: the planner
  if (round.state === "draft") {
    if (!canPlan) {
      return (
        <div className="space-y-6">
          {header}
          <Card>
            <CardHeader>
              <CardTitle>Being planned</CardTitle>
              <CardDescription>This round is still a draft. Parcels appear here once a planner finalises it.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      );
    }
    const step: Step = STEPS.some((s) => s.key === sp.step) ? (sp.step as Step) : "tutes";
    const [{ data: chosenRows }, { data: students }, { data: batches }, { data: finished }] = await Promise.all([
      supabase.from("round_students").select("*").eq("round_id", id),
      supabase
        .from("students")
        .select("id, student_no, full_name, address_line1, city, phone1, is_active")
        .eq("batch_id", round.batch_id)
        .eq("is_active", true)
        .is("anonymised_at", null)
        .order("student_no")
        .limit(5000),
      supabase.from("batches").select("id, name").eq("is_active", true).order("sort_order").order("name"),
      supabase.from("papers").select("id, title, exam:exams(name)").eq("kind", "tute").eq("status", "done").order("completed_at", { ascending: false }).limit(200),
    ]);
    const chosen: Record<string, ChosenSettings> = Object.fromEntries(
      (chosenRows ?? []).map((r) => [r.student_id, { cod_amount: r.cod_amount, note: r.note, excluded_tute_ids: r.excluded_tute_ids }]),
    );
    const studentList = students ?? [];
    const byId = new Map(studentList.map((s) => [s.id, s]));
    const problems = (s: (typeof studentList)[number]) =>
      [!s.address_line1 || !s.city ? "No address" : null, !s.phone1 ? "No phone" : null].filter((x): x is string => x !== null);

    let body: React.ReactNode = null;
    if (step === "details") {
      body = (
        <RoundForm
          batches={batches ?? []}
          lockBatch={(chosenRows ?? []).length > 0}
          values={{
            id: round.id,
            name: round.name,
            batch_id: round.batch_id,
            sending_month: round.sending_month.slice(0, 7),
            group_label: round.group_label,
            subject: round.subject,
            ref_prefix: round.ref_prefix,
            default_cod: Number(round.default_cod),
            default_weight_g: round.default_weight_g,
            default_pieces: round.default_pieces,
            planned_handover: round.planned_handover ?? "",
            notes: round.notes,
          }}
        />
      );
    } else if (step === "tutes") {
      body = (
        <RoundTutesEditor
          roundId={id}
          initial={tutes.map((t) => ({
            id: t.id,
            paper_id: t.paper_id ?? "",
            manual_title: t.manual_title ?? "",
            short_code: t.short_code,
            version_label: t.version_label,
            qty_per_parcel: t.qty_per_parcel,
          }))}
          finished={(finished ?? []).map((p) => {
            const exam = p.exam as unknown as { name: string } | null;
            return { id: p.id, title: p.title, label: exam ? `${p.title} (${exam.name})` : p.title };
          })}
        />
      );
    } else if (step === "students") {
      body = (
        <RoundStudentsPicker
          roundId={id}
          chosen={chosen}
          students={studentList.map((s) => ({ id: s.id, no: s.student_no, name: s.full_name, city: s.city, problems: problems(s) }))}
        />
      );
    } else if (step === "contents") {
      body = (
        <ContentsMatrix
          roundId={id}
          defaultCod={Number(round.default_cod)}
          tutes={tutes.map((t) => ({ id: t.id, code: t.short_code, title: t.title }))}
          initial={(chosenRows ?? [])
            .map((r) => ({ r, s: byId.get(r.student_id) }))
            .sort((a, b) => (a.s?.student_no ?? "").localeCompare(b.s?.student_no ?? ""))
            .map(({ r, s }) => ({
              student_id: r.student_id,
              no: s?.student_no ?? "?",
              name: s?.full_name ?? "No longer active",
              cod: r.cod_amount === null ? "" : String(r.cod_amount),
              note: r.note,
              excluded: r.excluded_tute_ids,
            }))}
        />
      );
    } else {
      // Inactive or removed students are fetched separately so the review can flag them.
      const missing = (chosenRows ?? []).filter((r) => !byId.has(r.student_id)).map((r) => r.student_id);
      const { data: extra } = missing.length
        ? await supabase.from("students").select("id, student_no, full_name, address_line1, city, phone1, is_active").in("id", missing)
        : { data: [] };
      const all = new Map([...studentList, ...(extra ?? []).map((s) => ({ ...s, is_active: false }))].map((s) => [s.id, s]));
      const refs = (chosenRows ?? []).map((r) => round.ref_prefix + (all.get(r.student_id)?.student_no ?? ""));
      // Looked up in chunks so a big round doesn't make an over-long request.
      const used: { reference: string }[] = [];
      for (let i = 0; i < refs.length; i += 200) {
        const { data } = await supabase.from("parcels").select("reference").in("reference", refs.slice(i, i + 200));
        used.push(...(data ?? []));
      }
      const review = reviewRound({
        prefix: round.ref_prefix,
        defaultCod: Number(round.default_cod),
        tutes: tutes.map((t) => ({ id: t.id, title: t.title, shortCode: t.short_code, qty: t.qty_per_parcel, fromPapers: Boolean(t.paper_id) })),
        chosen: (chosenRows ?? []).map((r) => {
          const s = all.get(r.student_id);
          return {
            id: r.student_id,
            studentNo: s?.student_no ?? "?",
            name: s?.full_name ?? "",
            address: s?.address_line1 ?? "",
            city: s?.city ?? "",
            phone1: s?.phone1 ?? null,
            active: Boolean(s?.is_active),
            codAmount: r.cod_amount === null ? null : Number(r.cod_amount),
            excluded: r.excluded_tute_ids,
          };
        }),
        notChosen: studentList.filter((s) => !chosen[s.id]).length,
        usedReferences: new Set(used.map((u) => u.reference)),
      });
      body = <RoundReviewPanel roundId={id} review={review} canEdit={canPlan} />;
    }

    return (
      <div className="space-y-6">
        {header}
        <nav aria-label="Plan steps" className="flex flex-wrap gap-2">
          {STEPS.map((s) => (
            <Button key={s.key} asChild size="sm" variant={s.key === step ? "default" : "outline"}>
              <Link href={`/admin/dispatch/rounds/${id}?step=${s.key}`} aria-current={s.key === step ? "step" : undefined}>
                {s.label}
              </Link>
            </Button>
          ))}
        </nav>
        <p className="text-muted-foreground text-sm">
          {tutes.length} tute{tutes.length === 1 ? "" : "s"} · {Object.keys(chosen).length} student{Object.keys(chosen).length === 1 ? "" : "s"} chosen ·
          Save each step before moving on.
        </p>
        <Card>
          <CardContent>{body}</CardContent>
        </Card>
      </div>
    );
  }

  // ------------------------------------------------------------------ finalised and later: the parcels
  // Recipients and student numbers come embedded; the database hides them from view-only users.
  const [{ data: parcels }, { data: items }, { data: closeCheck }, canReopen] = await Promise.all([
    supabase
      .from("parcels")
      .select(
        "id, student_id, reference, tracking_no, registration_state, pack_state, delivery_state, on_hold, cod_expected, row_version, parcel_recipients(*), students(student_no)",
      )
      .eq("round_id", id)
      .order("reference")
      .limit(5000),
    supabase.from("parcel_items").select("parcel_id, round_tute_id, parcels!inner(round_id)").eq("parcels.round_id", id).limit(50000),
    supabase.rpc("round_close_check", { p_round: id }),
    profile.is_main_admin ? mainAdminUnlocked(profile) : Promise.resolve(false),
  ]);
  type Recipient = {
    name: string;
    address_line1: string;
    address_line2: string;
    address_line3: string;
    city: string;
    phone1: string | null;
    phone2: string | null;
  };
  const list = parcels ?? [];
  const recipientOf = new Map(
    list.map((p) => [p.id, (seesPeople ? (p.parcel_recipients as unknown as Recipient | null) : null) ?? undefined]),
  );
  const noOf = new Map(list.map((p) => [p.student_id, (p.students as unknown as { student_no: string } | null)?.student_no]));
  const itemsOf = new Map<string, string[]>();
  for (const it of items ?? []) itemsOf.set(it.parcel_id, [...(itemsOf.get(it.parcel_id) ?? []), it.round_tute_id]);
  const codeOf = new Map(tutes.map((t) => [t.id, t.short_code]));

  const counts = {
    parcels: list.length,
    registered: list.filter((p) => p.registration_state === "registered").length,
    voided: list.filter((p) => p.registration_state === "voided").length,
    packed: list.filter((p) => p.registration_state !== "voided" && p.pack_state !== "planned").length,
    verified: list.filter((p) => p.pack_state === "verified").length,
    onHold: list.filter((p) => p.on_hold).length,
    handedOver: list.filter((p) => p.registration_state !== "voided" && p.delivery_state !== "awaiting_pickup").length,
    delivered: list.filter((p) => p.registration_state !== "voided" && p.delivery_state === "delivered").length,
    problems: list.filter((p) => p.registration_state !== "voided" && p.delivery_state === "failed").length,
    returned: list.filter((p) => p.registration_state !== "voided" && p.delivery_state === "returned").length,
    codOwing: Number((closeCheck as { cod_outstanding?: number } | null)?.cod_outstanding ?? 0),
    canClose: Boolean((closeCheck as { can_close?: boolean } | null)?.can_close),
  };
  const waiting = counts.parcels - counts.registered - counts.voided;
  const codTotal = list.filter((p) => p.registration_state !== "voided").reduce((s, p) => s + Number(p.cod_expected), 0);

  return (
    <div className="space-y-6">
      {header}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Parcels" value={counts.parcels - counts.voided} icon={PackageIcon} />
        <StatCard label="With tracking" value={counts.registered} icon={CheckCircle2Icon} tone="success" delay={0.1} />
        <StatCard label="Waiting for tracking" value={waiting} icon={HashIcon} tone={waiting > 0 ? "warning" : "success"} delay={0.2} />
        <StatCard label="Packed" value={counts.packed} icon={PackageCheckIcon} tone="success" delay={0.3} hint={`${counts.verified} verified · ${counts.onHold} on hold`} />
        {counts.handedOver > 0 ? (
          <StatCard
            label="With the courier"
            value={counts.handedOver}
            icon={TruckIcon}
            tone={counts.problems > 0 ? "warning" : "info"}
            delay={0.4}
            hint={`${counts.delivered} delivered · ${counts.returned} returned · ${counts.problems} failed`}
          />
        ) : (
          <StatCard label="COD expected" value={codTotal} prefix="Rs. " icon={TruckIcon} tone="info" delay={0.4} />
        )}
      </div>

      <Card className="border-primary/40 gap-3">
        <CardHeader>
          <CardDescription className="text-primary text-xs font-semibold tracking-wide uppercase">Next step</CardDescription>
          <CardTitle>{nextStep(round.state, counts)}</CardTitle>
        </CardHeader>
        {(round.state === "finalised" || round.state === "active") && (
          <CardContent className="flex flex-wrap gap-2">
            {caps.has("courier") && (
              <Button asChild variant="outline">
                <Link href={`/admin/dispatch/rounds/${id}/courier`}>
                  Courier files <ArrowRightIcon />
                </Link>
              </Button>
            )}
            {canPlan && (
              <Button asChild variant="outline">
                <Link href={`/admin/dispatch/rounds/${id}/packing`}>
                  Packing <ArrowRightIcon />
                </Link>
              </Button>
            )}
            {(caps.has("pack") || caps.has("verify")) && counts.registered > 0 && (
              <Button asChild>
                <Link href={`/admin/dispatch/rounds/${id}/scan`}>
                  <ScanBarcodeIcon /> Packing station
                </Link>
              </Button>
            )}
            {caps.has("verify") && counts.packed > 0 && (
              <Button asChild variant="outline">
                <Link href={`/admin/dispatch/rounds/${id}/handover`}>
                  Handover <ArrowRightIcon />
                </Link>
              </Button>
            )}
            {caps.has("courier") && counts.handedOver > 0 && (
              <Button asChild variant="outline">
                <Link href={`/admin/dispatch/rounds/${id}/delivery`}>
                  Delivery <ArrowRightIcon />
                </Link>
              </Button>
            )}
          </CardContent>
        )}
      </Card>

      {closeCheck && (counts.handedOver > 0 || round.state === "closed") && (
        <RoundClosePanel roundId={id} check={closeCheck as unknown as CloseCheck} canClose={canPlan} canReopen={canReopen} />
      )}

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Reference</TableHead>
              {seesPeople && <TableHead className="hidden md:table-cell">Recipient</TableHead>}
              <TableHead>Tutes</TableHead>
              <TableHead className="hidden sm:table-cell text-right">COD</TableHead>
              <TableHead>Tracking</TableHead>
              {canPlan && (
                <TableHead className="w-12 pr-4">
                  <span className="sr-only">Correct</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((p) => {
              const r = recipientOf.get(p.id);
              const tuteIds = itemsOf.get(p.id) ?? [];
              return (
                <TableRow key={p.id} className={cn(p.registration_state === "voided" && "opacity-50")}>
                  <TableCell className="pl-4">
                    <p className="font-mono text-sm">{p.reference}</p>
                    {seesPeople && <p className="text-muted-foreground text-xs md:hidden">{r?.name}</p>}
                  </TableCell>
                  {seesPeople && (
                    <TableCell className="hidden max-w-[260px] md:table-cell">
                      <p className="truncate">
                        <span className="text-muted-foreground font-mono text-xs">{noOf.get(p.student_id)}</span> {r?.name}
                      </p>
                      <p className="text-muted-foreground truncate text-xs">{r?.city}</p>
                    </TableCell>
                  )}
                  <TableCell className="font-mono text-xs">{tuteIds.map((t) => codeOf.get(t)).join(" ")}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatLKR(Number(p.cod_expected))}</TableCell>
                  <TableCell>
                    {p.registration_state === "voided" ? (
                      <Badge variant="secondary">Voided</Badge>
                    ) : p.tracking_no ? (
                      <span className="font-mono text-sm">{p.tracking_no}</span>
                    ) : (
                      <Badge variant="outline">Waiting</Badge>
                    )}
                  </TableCell>
                  {canPlan && (
                    <TableCell className="pr-4">
                      {p.registration_state === "unregistered" && r && (
                        <ParcelCorrectDialog
                          tutes={tutes.map((t) => ({ id: t.id, code: t.short_code }))}
                          parcel={{
                            id: p.id,
                            reference: p.reference,
                            rowVersion: p.row_version,
                            cod: Number(p.cod_expected),
                            tuteIds,
                            recipient: {
                              name: r.name,
                              address_line1: r.address_line1,
                              address_line2: r.address_line2,
                              address_line3: r.address_line3,
                              city: r.city,
                              phone1: r.phone1 ?? "",
                              phone2: r.phone2 ?? "",
                            },
                          }}
                        >
                          <Button variant="ghost" size="icon-sm" aria-label={`Correct ${p.reference}`}>
                            <PencilIcon />
                          </Button>
                        </ParcelCorrectDialog>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
