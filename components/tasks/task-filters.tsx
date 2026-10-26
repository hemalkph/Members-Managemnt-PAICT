"use client";

import { useUrlFilters } from "@/components/admin/url-filters";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function TaskFilters({
  view,
  member,
  exam,
  members,
  exams,
}: {
  view: string;
  member: string;
  exam: string;
  members: { id: string; name: string }[];
  exams: { id: string; label: string }[];
}) {
  const { setParams, pending } = useUrlFilters();
  return (
    <div className={cn("flex flex-col gap-2 lg:flex-row lg:items-center", pending && "opacity-70")}>
      <Tabs value={view} onValueChange={(v) => setParams({ view: v === "open" ? null : v })}>
        <TabsList>
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="done">Done</TabsTrigger>
          <TabsTrigger value="cancelled">Cancelled</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="grid grid-cols-2 gap-2 lg:flex">
        <Select value={member || "all"} onValueChange={(v) => setParams({ member: v })}>
          <SelectTrigger className="lg:w-48" aria-label="Member">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={exam || "all"} onValueChange={(v) => setParams({ exam: v })}>
          <SelectTrigger className="lg:w-56" aria-label="Exam">
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
    </div>
  );
}
