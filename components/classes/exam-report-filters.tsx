"use client";

import { useUrlFilters } from "@/components/admin/url-filters";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function ExamReportFilters({
  batches,
  centres,
  batchId,
  centreId,
}: {
  batches: { id: string; name: string }[];
  centres: { id: string; name: string }[];
  batchId: string;
  centreId: string;
}) {
  const { setParams, pending } = useUrlFilters();
  return (
    <div className={cn("grid grid-cols-2 gap-2 sm:flex", pending && "opacity-70")}>
      <Select value={batchId} onValueChange={(v) => setParams({ batch: v })}>
        <SelectTrigger className="sm:w-48" aria-label="Batch">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {batches.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={centreId || "all"} onValueChange={(v) => setParams({ centre: v })}>
        <SelectTrigger className="sm:w-48" aria-label="Centre">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All centres</SelectItem>
          {centres.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
