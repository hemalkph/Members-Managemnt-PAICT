"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon, SaveIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveSettlementAction } from "@/lib/actions/dispatch-money";

import { useT } from "@/components/dispatch/lang";
export type SettlementHeader = {
  id: string | null;
  reference: string;
  settled_on: string;
  remitted: number;
  note: string;
};

/** The settlement's own details: Citypak's reference, the date and what they paid us. */
export function SettlementForm({ initial, disabled = false }: { initial: SettlementHeader; disabled?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [v, setV] = useState({ ...initial, remitted: String(initial.remitted || "") });
  const [pending, startTransition] = useTransition();

  const save = () =>
    startTransition(async () => {
      const r = await saveSettlementAction({ ...v, remitted: Number(v.remitted || 0) });
      if (!r.ok) return void toast.error(t(r.error));
      toast.success(t(r.message));
      if (!initial.id) router.push(`/admin/dispatch/money/${r.data!.id}`);
      else router.refresh();
    });

  return (
    <form
      className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_160px_180px_1.5fr_auto] lg:items-end"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="s-ref">{t("Citypak settlement reference")}</Label>
        <Input
          id="s-ref"
          value={v.reference}
          onChange={(e) => setV({ ...v, reference: e.target.value })}
          maxLength={60}
          disabled={disabled}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="s-date">{t("Paid on")}</Label>
        <Input
          id="s-date"
          type="date"
          value={v.settled_on}
          onChange={(e) => setV({ ...v, settled_on: e.target.value })}
          disabled={disabled}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="s-amount">{t("Amount received (Rs.)")}</Label>
        <Input
          id="s-amount"
          inputMode="decimal"
          value={v.remitted}
          onChange={(e) => setV({ ...v, remitted: e.target.value.replace(/[^\d.]/g, "") })}
          disabled={disabled}
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="s-note">{t("Note (optional)")}</Label>
        <Input
          id="s-note"
          value={v.note}
          onChange={(e) => setV({ ...v, note: e.target.value })}
          maxLength={300}
          disabled={disabled}
        />
      </div>
      {!disabled && (
        <Button type="submit" disabled={pending || !v.reference.trim() || !v.settled_on}>
          {pending ? <Loader2Icon className="animate-spin" /> : <SaveIcon />}{" "}
          {initial.id ? t("Save") : t("Start settlement")}
        </Button>
      )}
    </form>
  );
}
