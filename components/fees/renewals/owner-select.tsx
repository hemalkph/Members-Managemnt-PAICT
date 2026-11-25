"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setCallOwnerAction } from "@/lib/actions/renewals";

const NONE = "__none__";

/** Who phones this class's unpaid students. */
export function OwnerSelect({
  classId,
  ownerId,
  team,
}: {
  classId: string;
  ownerId: string | null;
  team: { id: string; name: string; away?: string | null }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const change = (value: string) =>
    startTransition(async () => {
      const res = await setCallOwnerAction({ class_id: classId, owner_id: value === NONE ? null : value });
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.message);
      router.refresh();
    });

  return (
    <Select value={ownerId ?? NONE} onValueChange={change} disabled={pending}>
      <SelectTrigger size="sm" className="w-56" aria-label="Who calls unpaid students">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>Calls: anyone</SelectItem>
        {team.map((p) => (
          <SelectItem
            key={p.id}
            value={p.id}
            hint={
              p.away ? (
                <span className="ml-auto pl-3 text-xs text-amber-700 dark:text-warning">{p.away}</span>
              ) : undefined
            }
          >
            Calls: {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
