"use client";

import { useUrlFilters } from "@/components/admin/url-filters";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function PaperFilters({
  status,
  exam,
  exams,
}: {
  status: string;
  exam: string;
  exams: { id: string; label: string }[];
}) {
  const { setParams, pending } = useUrlFilters();
  return (
    <div className={cn("flex flex-col gap-2 sm:flex-row sm:items-center", pending && "opacity-70")}>
      <Tabs value={status} onValueChange={(v) => setParams({ status: v === "in_progress" ? null : v })}>
        <TabsList>
          <TabsTrigger value="in_progress">In progress</TabsTrigger>
          <TabsTrigger value="done">Done</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
        </TabsList>
      </Tabs>
      <Select value={exam || "all"} onValueChange={(v) => setParams({ exam: v })}>
        <SelectTrigger className="sm:w-64" aria-label="Exam">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All exams</SelectItem>
          {exams.map((e) => (
            <SelectItem key={e.id} value={e.id}>
              {e.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
