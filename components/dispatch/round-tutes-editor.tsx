"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setRoundTutesAction } from "@/lib/actions/dispatch-rounds";

import { useT } from "@/components/dispatch/lang";
export type TuteRow = {
  id: string;
  paper_id: string;
  manual_title: string;
  short_code: string;
  version_label: string;
  qty_per_parcel: number;
};

const MANUAL = "manual";

/** Which tutes go in this round. Finished tutes come from Papers; others can be typed in. */
export function RoundTutesEditor({
  roundId,
  initial,
  finished,
}: {
  roundId: string;
  initial: TuteRow[];
  finished: { id: string; title: string; label: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const [rows, setRows] = useState<TuteRow[]>(initial);
  const [pending, startTransition] = useTransition();

  const update = (i: number, patch: Partial<TuteRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () =>
    setRows((rs) => [
      ...rs,
      {
        id: "",
        paper_id: "",
        manual_title: "",
        short_code: `T${String(rs.length + 1).padStart(2, "0")}`,
        version_label: "",
        qty_per_parcel: 1,
      },
    ]);

  const save = () =>
    startTransition(async () => {
      const result = await setRoundTutesAction({ round_id: roundId, tutes: rows });
      if (!result.ok) return void toast.error(t(result.error));
      toast.success(t(result.message));
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {finished.length === 0 && (
        <p className="text-muted-foreground text-sm">
          {t(
            "No finished tutes in Papers yet, so type each tute's title in. Tutes finished in Papers will appear here to pick.",
          )}
        </p>
      )}
      <div className="space-y-3">
        {rows.map((r, i) => (
          <div
            key={i}
            className="grid grid-cols-3 gap-2 rounded-lg border p-3 sm:grid-cols-[1.4fr_1.6fr_110px_90px_80px_auto] sm:items-end"
          >
            <div className="col-span-3 grid gap-1.5 sm:col-span-1">
              <Label className="text-xs">{t("From")}</Label>
              <Select
                value={r.paper_id || MANUAL}
                onValueChange={(v) => update(i, { paper_id: v === MANUAL ? "" : v })}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={MANUAL}>{t("Type the title")}</SelectItem>
                  {finished.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="col-span-3 grid gap-1.5 sm:col-span-1">
              <Label className="text-xs">{t("Title")}</Label>
              {r.paper_id ? (
                <p className="text-muted-foreground flex h-9 items-center truncate text-sm">
                  {finished.find((p) => p.id === r.paper_id)?.title ?? t("Finished tute")}
                </p>
              ) : (
                <Input
                  value={r.manual_title}
                  onChange={(e) => update(i, { manual_title: e.target.value })}
                  placeholder={t("Tute 05 – Networking")}
                />
              )}
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("Short code")}</Label>
              <Input
                value={r.short_code}
                onChange={(e) => update(i, { short_code: e.target.value.toUpperCase() })}
                className="font-mono"
                maxLength={10}
                aria-label={t("Short code")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("Version")}</Label>
              <Input
                value={r.version_label}
                onChange={(e) => update(i, { version_label: e.target.value })}
                placeholder="e.g. v2"
                maxLength={30}
              />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">{t("Copies")}</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={r.qty_per_parcel}
                onChange={(e) => update(i, { qty_per_parcel: Number(e.target.value) || 1 })}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="col-span-3 justify-self-end sm:col-span-1"
              aria-label={`Remove ${r.short_code}`}
              onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
            >
              <Trash2Icon />
            </Button>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={add} disabled={rows.length >= 30}>
          <PlusIcon /> {t("Add tute")}
        </Button>
        <Button onClick={save} disabled={pending}>
          {pending && <Loader2Icon className="animate-spin" />} {t("Save tutes")}
        </Button>
      </div>
    </div>
  );
}
