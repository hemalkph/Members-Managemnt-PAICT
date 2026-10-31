"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { CheckIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { resolveProblemAction } from "@/lib/actions/dispatch-packing";

export type OpenProblem = { id: string; reference: string; kind: string; note: string; openedBy: string; when: string };

/** Open problems (parcels on hold) with a "Fixed" action for planners. */
export function ProblemList({ roundId, problems, canResolve }: { roundId: string; problems: OpenProblem[]; canResolve: boolean }) {
  const router = useRouter();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const fix = (id: string) =>
    startTransition(async () => {
      const result = await resolveProblemAction({ exception_id: id, round_id: roundId, note: notes[id] ?? "" });
      if (!result.ok) return void toast.error(result.error);
      toast.success(result.message);
      router.refresh();
    });
  if (problems.length === 0) return <p className="text-muted-foreground text-sm">No parcels on hold.</p>;
  return (
    <ul className="divide-y">
      {problems.map((p) => (
        <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-sm">
            <p>
              <span className="font-mono font-medium">{p.reference}</span> · {p.kind.replace("_", " ")}
              {p.note ? ` – ${p.note}` : ""}
            </p>
            <p className="text-muted-foreground text-xs">
              {p.openedBy} · {p.when}
            </p>
          </div>
          {canResolve && (
            <div className="flex gap-2">
              <Input
                value={notes[p.id] ?? ""}
                onChange={(e) => setNotes((n) => ({ ...n, [p.id]: e.target.value }))}
                placeholder="What was done (optional)"
                className="h-8 sm:w-56"
                maxLength={300}
              />
              <Button size="sm" onClick={() => fix(p.id)} disabled={pending}>
                <CheckIcon /> Fixed
              </Button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
