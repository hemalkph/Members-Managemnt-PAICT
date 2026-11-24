"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { BookOpenIcon, Loader2Icon, PencilIcon, PlusIcon, SchoolIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { AddTutesDialog } from "@/components/class-ops/add-tutes-dialog";
import { ClassDialog, MODE_LABEL } from "@/components/class-ops/class-dialog";
import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { removeClassTuteAction, saveClassPaidCountAction } from "@/lib/actions/class-ops";
import type { ClassRow, PlannedTute, ShelfTute } from "@/lib/class-ops/queries";
import type { ActionResult } from "@/lib/core/action-result";
import { formatDateTime } from "@/lib/core/format";
import { monthLabel, todayISO } from "@/lib/core/month";

type Batch = { id: string; name: string; isActive: boolean };

/** Classes grouped by batch, in the overview's order. */
function byBatch(classes: ClassRow[]) {
  const groups: { batchId: string; batchName: string; classes: ClassRow[] }[] = [];
  for (const c of classes) {
    const last = groups[groups.length - 1];
    if (last?.batchId === c.batch_id) last.classes.push(c);
    else groups.push({ batchId: c.batch_id, batchName: c.batch_name, classes: [c] });
  }
  return groups;
}

export function ClassOpsWorkspace({
  months,
  classes,
  batches,
  tutes,
  plan,
  month,
  tab,
  canEdit,
}: {
  months: string[];
  classes: ClassRow[];
  batches: Batch[];
  tutes: ShelfTute[];
  plan: PlannedTute[];
  month: string;
  tab: "classes" | "plan";
  canEdit: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const groups = useMemo(() => byBatch(classes), [classes]);
  const activeGroups = useMemo(() => byBatch(classes.filter((c) => c.is_active)), [classes]);
  const defaultBatchId = batches.find((b) => b.isActive)?.id ?? batches[0]?.id ?? "";
  const isThisMonth = month === todayISO().slice(0, 7);

  const run = (fn: () => Promise<ActionResult<unknown>>, after?: () => void) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      after?.();
      router.refresh();
    });

  const newClass = canEdit && batches.length > 0 && (
    <ClassDialog batches={batches} defaultBatchId={defaultBatchId} onSaved={() => router.refresh()}>
      <Button size="sm">
        <PlusIcon /> New class
      </Button>
    </ClassDialog>
  );

  if (classes.length === 0) {
    return (
      <EmptyState
        icon={SchoolIcon}
        title="No classes yet"
        description={
          batches.length === 0
            ? "Add a batch in Batches & exams first, then add its classes here."
            : "Add each class a batch runs (Physical, Online or both). Fee reminders, Tute stock and Speed Post use them."
        }
        action={newClass || undefined}
      />
    );
  }

  return (
    <Tabs defaultValue={tab} className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <TabsList>
          <TabsTrigger value="classes">Classes &amp; counts</TabsTrigger>
          <TabsTrigger value="plan">
            <BookOpenIcon className="size-3.5" /> Tute plan
          </TabsTrigger>
        </TabsList>
        <div className="flex items-center gap-2">
          {canEdit && activeGroups.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <BookOpenIcon /> Add tutes
            </Button>
          )}
          {newClass}
        </div>
      </div>

      <TabsContent value="classes" className="space-y-5">
        {!isThisMonth && (
          <p className="text-muted-foreground text-sm">
            Showing {monthLabel(month)}. Paid counts can only be typed for this month.
          </p>
        )}
        {groups.map((g) => (
          <section key={g.batchId} className="space-y-2">
            <h3 className="px-1 text-xs font-semibold">
              {g.batchName} <span className="text-muted-foreground font-normal">· {g.classes.length}</span>
            </h3>
            <div className="bg-card divide-y overflow-hidden rounded-xl border">
              {g.classes.map((c) => (
                <ClassCountRow
                  key={c.class_id}
                  row={c}
                  batches={batches}
                  canEdit={canEdit}
                  canType={canEdit && isThisMonth && c.is_active}
                  pending={pending}
                  onSave={(count) => run(() => saveClassPaidCountAction({ class_id: c.class_id, count }))}
                  onSaved={() => router.refresh()}
                />
              ))}
            </div>
          </section>
        ))}
        <p className="text-muted-foreground px-1 text-xs">
          <span className="text-foreground font-medium">Paid so far</span> is the newest of the uploaded paid list (Fee
          reminders) and a count typed here. Tute stock plans copies from it: the higher of paid so far and the
          forecast.
        </p>
      </TabsContent>

      <TabsContent value="plan">
        {activeGroups.length === 0 ? (
          <EmptyState icon={BookOpenIcon} title="No classes in use" description="Add a class or tick In use on one." />
        ) : (
          <div className="bg-card overflow-x-auto rounded-xl border">
            <table className="w-full min-w-[720px] table-fixed text-sm">
              <thead>
                <tr className="text-muted-foreground border-b text-left text-xs">
                  <th className="w-[220px] px-4 py-2 font-medium">Class</th>
                  {months.map((m) => (
                    <th key={m} className="px-3 py-2 font-medium">
                      {monthLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeGroups.map((g) => (
                  <PlanBatchRows
                    key={g.batchId}
                    batchName={g.batchName}
                    classes={g.classes}
                    months={months}
                    plan={plan}
                    canEdit={canEdit}
                    pending={pending}
                    onRemove={(id) => run(() => removeClassTuteAction(id))}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </TabsContent>

      {addOpen && (
        <AddTutesDialog
          months={months}
          groups={activeGroups}
          tutes={tutes}
          plan={plan}
          pending={pending}
          run={(fn) => run(fn, () => setAddOpen(false))}
          onClose={() => setAddOpen(false)}
        />
      )}
    </Tabs>
  );
}

function ClassCountRow({
  row,
  batches,
  canEdit,
  canType,
  pending,
  onSave,
  onSaved,
}: {
  row: ClassRow;
  batches: Batch[];
  canEdit: boolean;
  canType: boolean;
  pending: boolean;
  onSave: (count: number) => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  const n = value.trim() === "" ? null : Number(value);
  const valid = n !== null && Number.isInteger(n) && n >= 0 && n <= 100000;
  const save = () => {
    if (!valid || pending || n === null) return;
    onSave(n);
    setValue("");
  };

  return (
    <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="truncate text-sm font-semibold">{row.name}</p>
          <Badge variant="outline" className="text-[10px]">
            {MODE_LABEL[row.mode]}
          </Badge>
          {!row.is_active && (
            <Badge variant="secondary" className="text-[10px]">
              Archived
            </Badge>
          )}
        </div>
        <p className="text-muted-foreground text-xs tabular-nums">
          {row.paid === null ? (
            "No paid count yet this month"
          ) : (
            <>
              <span className="text-foreground font-medium">{row.paid} paid so far</span> ·{" "}
              {row.paid_source === "typed" ? "typed" : "paid list"} {formatDateTime(row.paid_at)}
            </>
          )}
          {row.last_month !== null && <> · last month {row.last_month}</>}
        </p>
        <p className="text-muted-foreground text-xs tabular-nums">
          Tutes planned for {row.expected} · {row.tutes_this} tute{row.tutes_this === 1 ? "" : "s"} this month
          {row.tutes_next > 0 && `, ${row.tutes_next} next month`}
        </p>
      </div>

      <div className="flex items-center gap-1.5">
        {canType && (
          <>
            <Input
              type="number"
              inputMode="numeric"
              min={0}
              max={100000}
              step={1}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
              placeholder="Paid today…"
              aria-label={`Paid so far for ${row.name}`}
              className="h-8 w-32 text-right tabular-nums"
            />
            <Button size="sm" variant="secondary" className="h-8" disabled={!valid || pending} onClick={save}>
              {pending ? <Loader2Icon className="animate-spin" /> : "Save"}
            </Button>
          </>
        )}
        {canEdit && (
          <ClassDialog
            batches={batches}
            defaultBatchId={row.batch_id}
            editing={{ id: row.class_id, batchId: row.batch_id, name: row.name, mode: row.mode, isActive: row.is_active }}
            onSaved={onSaved}
          >
            <Button size="icon-sm" variant="ghost" className="size-8" aria-label={`Edit ${row.name}`}>
              <PencilIcon className="size-4" />
            </Button>
          </ClassDialog>
        )}
      </div>
    </div>
  );
}

function PlanBatchRows({
  batchName,
  classes,
  months,
  plan,
  canEdit,
  pending,
  onRemove,
}: {
  batchName: string;
  classes: ClassRow[];
  months: string[];
  plan: PlannedTute[];
  canEdit: boolean;
  pending: boolean;
  onRemove: (id: string) => void;
}) {
  return (
    <>
      <tr className="bg-muted/40 border-b">
        <td colSpan={months.length + 1} className="px-4 py-1.5 text-xs font-semibold">
          {batchName}
        </td>
      </tr>
      {classes.map((c) => (
        <tr key={c.class_id} className="border-b align-top last:border-b-0">
          <td className="px-4 py-2.5">
            <p className="font-medium">{c.name}</p>
            <p className="text-muted-foreground text-xs">{MODE_LABEL[c.mode]}</p>
          </td>
          {months.map((m) => {
            const items = plan.filter((p) => p.classId === c.class_id && p.month === m);
            return (
              <td key={m} className="px-3 py-2.5">
                {items.length === 0 ? (
                  <span className="text-muted-foreground text-xs">—</span>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {items.map((p) => (
                      <Badge key={p.id} variant="secondary" className="gap-1 font-normal" title={p.name}>
                        {p.code ? <span className="font-mono">{p.code}</span> : p.name}
                        {canEdit && (
                          <button
                            type="button"
                            disabled={pending}
                            onClick={() => onRemove(p.id)}
                            className="hover:text-destructive -mr-1 rounded-sm p-0.5"
                            aria-label={`Remove ${p.name} from ${c.name} in ${monthLabel(m)}`}
                          >
                            <XIcon className="size-3" />
                          </button>
                        )}
                      </Badge>
                    ))}
                  </div>
                )}
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
