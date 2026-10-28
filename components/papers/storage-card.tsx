"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BrushCleaningIcon, HardDriveIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import CountUp from "@/components/reactbits/count-up";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cleanupPaperFilesNowAction, setPaperFileDaysAction } from "@/lib/actions/storage";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

const BUCKET_LABEL: Record<string, string> = {
  papers: "Paper drafts",
  attachments: "Work attachments",
  avatars: "Profile pictures",
};
const DAY_OPTIONS = [3, 7, 14, 21, 30, 60, 90];

/** Admins: how much storage is used, and the automatic paper file clean-up. */
export function StorageCard({
  usage,
  limitBytes,
  days,
  canEdit,
}: {
  usage: { bucket: string; files: number; bytes: number }[];
  limitBytes: number;
  days: number;
  /** Main admins (two-step done) can change the days and clean up now. */
  canEdit: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(String(days));
  const [pending, startTransition] = useTransition();
  const total = usage.reduce((s, u) => s + u.bytes, 0);
  const pct = Math.min(100, (total / limitBytes) * 100);
  const options = DAY_OPTIONS.includes(days) ? DAY_OPTIONS : [...DAY_OPTIONS, days].sort((a, b) => a - b);

  const saveDays = (v: string) => {
    setValue(v);
    startTransition(async () => {
      const result = await setPaperFileDaysAction({ days: Number(v) });
      if (!result.ok) {
        toast.error(result.error);
        setValue(String(days));
        return;
      }
      toast.success(result.message);
      router.refresh();
    });
  };

  const cleanNow = () =>
    startTransition(async () => {
      const result = await cleanupPaperFilesNowAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message);
      router.refresh();
    });

  return (
    <Card className="gap-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardDriveIcon className="text-primary size-5" /> Storage
        </CardTitle>
        <CardDescription>
          Paper drafts are deleted automatically {days} day{days === 1 ? "" : "s"} after a paper is handed over (or
          finished / cancelled), so storage stays small.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-2xl font-semibold tabular-nums">
              <CountUp to={Math.round(pct * 10) / 10} decimals={1} />%
            </p>
            <p className="text-muted-foreground text-sm">
              {formatBytes(total)} of {formatBytes(limitBytes)} used
            </p>
          </div>
          <Progress
            value={pct}
            aria-label={`Storage used: ${pct.toFixed(1)}%`}
            indicatorClassName={cn(pct > 85 ? "bg-destructive" : pct > 60 ? "bg-warning" : "bg-primary")}
          />
          <ul className="grid gap-2 pt-1 sm:grid-cols-3">
            {usage.map((u) => (
              <li key={u.bucket} className="rounded-lg border p-2.5">
                <p className="text-muted-foreground text-xs">{BUCKET_LABEL[u.bucket] ?? u.bucket}</p>
                <p className="font-medium tabular-nums">{formatBytes(u.bytes)}</p>
                <p className="text-muted-foreground text-xs">
                  {u.files} file{u.files === 1 ? "" : "s"}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {canEdit && (
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <span className="text-sm">Keep paper files</span>
            <Select value={value} onValueChange={saveDays} disabled={pending}>
              <SelectTrigger aria-label="Days to keep paper files" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((d) => (
                  <SelectItem key={d} value={String(d)}>
                    {d} day{d === 1 ? "" : "s"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground text-sm">after hand-over.</span>
            <Button variant="outline" size="sm" className="ml-auto" onClick={cleanNow} disabled={pending}>
              {pending ? <Loader2Icon className="animate-spin" /> : <BrushCleaningIcon />}
              Clean up now
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
