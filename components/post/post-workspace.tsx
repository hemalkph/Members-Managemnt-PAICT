"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowRightIcon, CheckIcon, HomeIcon, PackageIcon, PencilIcon, SendIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { buildPostRoundAction, confirmPostAddressesAction, savePostAddressAction } from "@/lib/actions/post";
import { formatDateTime } from "@/lib/core/format";
import { monthLabel } from "@/lib/core/month";
import type { PostRoundSummary, PostStudent } from "@/lib/post/queries";

export const ROUND_STATUS = {
  packing: { label: "Packing", variant: "warning" },
  handed_over: { label: "Handed over", variant: "success" },
  cancelled: { label: "Cancelled", variant: "secondary" },
} as const;

function addressState(s: PostStudent): { label: string; variant: "success" | "warning" | "destructive" | "outline" } {
  if (!s.address) return { label: "No address", variant: "destructive" };
  if (s.checked) return { label: "Confirmed", variant: "success" };
  if (s.problem) return { label: s.problem, variant: "warning" };
  return { label: "Not checked", variant: "outline" };
}

export function PostWorkspace({
  students,
  rounds,
  batchId,
  month,
  canEdit,
  tab: initialTab,
}: {
  students: PostStudent[];
  rounds: PostRoundSummary[];
  batchId: string;
  month: string;
  canEdit: boolean;
  tab: "rounds" | "addresses";
}) {
  const router = useRouter();
  const [tab, setTab] = useState(initialTab);
  const [editing, setEditing] = useState<PostStudent | null>(null);
  const [pending, startTransition] = useTransition();

  const confirmed = students.filter((s) => s.checked);
  const waiting = confirmed.filter((s) => s.tutesDue > s.tutesSent);
  const sentAll = students.filter((s) => s.tutesDue > 0 && s.tutesSent >= s.tutesDue);
  const fine = students.filter((s) => s.address && !s.checked && !s.problem);
  const hasMain = rounds.some((r) => r.kind === "main" && r.status !== "cancelled");
  const sorted = [...students].sort(
    (a, b) => Number(a.checked) - Number(b.checked) || Number(!a.address) - Number(!b.address) || a.name.localeCompare(b.name),
  );

  const changeTab = (value: string) => {
    setTab(value as "rounds" | "addresses");
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    window.history.replaceState(null, "", url);
  };

  const build = () =>
    startTransition(async () => {
      const res = await buildPostRoundAction({ batch_id: batchId, month, kind: hasMain ? "top_up" : "main" });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.push(`/admin/post/${res.data!.id}`);
    });

  const confirmAll = () =>
    startTransition(async () => {
      const res = await confirmPostAddressesAction(fine.map((s) => s.studentKey));
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      router.refresh();
    });

  const saveAddress = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;
    const address = String(new FormData(e.currentTarget).get("address") ?? "");
    startTransition(async () => {
      const res = await savePostAddressAction({ student_key: editing.studentKey, address, checked: true });
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      setEditing(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={`Online students paid ${monthLabel(month, "short")}`} value={students.length} icon={UsersIcon} />
        <StatCard label="Address confirmed" value={confirmed.length} icon={HomeIcon} tone="info" delay={0.05} />
        <StatCard label="Ready to post" value={waiting.length} icon={PackageIcon} tone="warning" delay={0.1} />
        <StatCard label="Tutes sent" value={sentAll.length} icon={SendIcon} tone="success" delay={0.15} />
      </div>

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList>
          <TabsTrigger value="rounds">Rounds</TabsTrigger>
          <TabsTrigger value="addresses">
            Addresses
            {students.length - confirmed.length > 0 && (
              <span className="text-muted-foreground ml-1 tabular-nums">{students.length - confirmed.length}</span>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="rounds" className="mt-3 space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3">
              <div className="space-y-1">
                <CardTitle className="text-base">{hasMain ? "Top-up round" : `Main round for ${monthLabel(month)}`}</CardTitle>
                <CardDescription>
                  {waiting.length > 0
                    ? `${waiting.length} Online student${waiting.length === 1 ? "" : "s"} with a confirmed address still need ${monthLabel(month, "short")} tutes. Students at the same address share one parcel. Copies are held for the round until handover.`
                    : "Everyone with a confirmed address already has this month's tutes."}
                  {students.length - confirmed.length > 0 &&
                    ` ${students.length - confirmed.length} more need their address confirmed first (Addresses tab).`}
                </CardDescription>
              </div>
              {canEdit && (
                <Button onClick={build} disabled={pending || waiting.length === 0}>
                  <PackageIcon /> {hasMain ? "Build top-up round" : "Build round"}
                </Button>
              )}
            </CardHeader>
          </Card>

          {rounds.length === 0 ? (
            <EmptyState icon={PackageIcon} title="No rounds this month yet" description="Build the main round once addresses are confirmed." />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {rounds.map((r) => (
                <Link key={r.id} href={`/admin/post/${r.id}`} className="group">
                  <Card className="group-hover:border-primary/40 gap-2 transition-colors">
                    <CardHeader className="flex flex-row items-center justify-between gap-3">
                      <CardTitle className="text-base">{r.kind === "main" ? "Main round" : "Top-up round"}</CardTitle>
                      <Badge variant={ROUND_STATUS[r.status].variant}>{ROUND_STATUS[r.status].label}</Badge>
                    </CardHeader>
                    <CardContent className="text-muted-foreground flex items-center justify-between gap-3 text-sm">
                      <span>
                        {r.parcels} parcels · {r.packed} packed · {r.tracked} tracked
                        {r.handedOverAt && ` · handed over ${formatDateTime(r.handedOverAt)}`}
                      </span>
                      <ArrowRightIcon className="size-4 shrink-0" />
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="addresses" className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-muted-foreground text-sm">
              Addresses come from the paid-list upload (Address + Nearest City). Check each one once; a new address in
              the LMS needs checking again.
            </p>
            {canEdit && fine.length > 0 && (
              <Button size="sm" variant="outline" onClick={confirmAll} disabled={pending}>
                <CheckIcon /> Confirm {fine.length} that look fine
              </Button>
            )}
          </div>
          {students.length === 0 ? (
            <EmptyState
              icon={UsersIcon}
              title="No Online students for this month"
              description="Upload this month's paid list on Fee reminders. Online students and their addresses show up here."
            />
          ) : (
            <Card className="py-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Student</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Tutes</TableHead>
                    {canEdit && <TableHead className="w-0" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((s) => {
                    const state = addressState(s);
                    return (
                      <TableRow key={s.studentKey}>
                        <TableCell>
                          <p className="font-medium">{s.name}</p>
                          <p className="text-muted-foreground text-xs">{s.classes}</p>
                        </TableCell>
                        <TableCell className="max-w-80 text-sm whitespace-pre-line">{s.address ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={state.variant}>{state.label}</Badge>
                        </TableCell>
                        <TableCell className="text-sm tabular-nums">
                          {s.tutesSent} / {s.tutesDue}
                        </TableCell>
                        {canEdit && (
                          <TableCell>
                            <Button size="sm" variant="outline" onClick={() => setEditing(s)}>
                              <PencilIcon /> {s.address ? "Check" : "Add"}
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={editing !== null} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Address for {editing?.name}</DialogTitle>
            <DialogDescription>
              House number, street, village or town, and postal code if you know it. Saving confirms it for posting.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={saveAddress} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="post-address">Address</Label>
              <Textarea id="post-address" name="address" rows={4} maxLength={500} defaultValue={editing?.address ?? ""} required />
              {editing?.whatsapp && <p className="text-muted-foreground text-xs">WhatsApp {editing.whatsapp} — ask the student if unsure.</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditing(null)}>
                Close
              </Button>
              <Button type="submit" disabled={pending}>
                Save and confirm
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
