"use client";

import { XIcon } from "lucide-react";
import { MonthSelect } from "@/components/month-select";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useUrlFilters } from "./url-filters";

type SectionOption = { id: string; name: string; roles: { id: string; name: string }[] };

export function ReviewFilters({
  month,
  sections,
  members,
}: {
  month: string;
  sections: SectionOption[];
  members: { id: string; name: string }[];
}) {
  const { searchParams, setParams, pending } = useUrlFilters();
  const section = searchParams.get("section") ?? "all";
  const role = searchParams.get("role") ?? "all";
  const member = searchParams.get("member") ?? "all";
  const status = searchParams.get("status") ?? "all";
  const rolesToShow = section === "all" ? sections : sections.filter((s) => s.id === section);
  const hasFilters = section !== "all" || role !== "all" || member !== "all" || status !== "all";

  return (
    <div className={cn("flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center", pending && "opacity-70")}>
      <MonthSelect value={month} />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:flex lg:flex-1 lg:flex-wrap">
        <Select value={section} onValueChange={(v) => setParams({ section: v, role: null })}>
          <SelectTrigger className="lg:w-44" aria-label="Section">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sections</SelectItem>
            {sections.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={role} onValueChange={(v) => setParams({ role: v })}>
          <SelectTrigger className="lg:w-48" aria-label="Role">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {rolesToShow.map((s) => (
              <SelectGroup key={s.id}>
                <SelectLabel>{s.name}</SelectLabel>
                {s.roles.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <Select value={member} onValueChange={(v) => setParams({ member: v })}>
          <SelectTrigger className="lg:w-48" aria-label="Member">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All members</SelectItem>
            {members.map((m) => (
              <SelectItem key={m.id} value={m.id}>
                {m.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => setParams({ status: v })}>
          <SelectTrigger className="lg:w-36" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {hasFilters && (
        <Button variant="ghost" onClick={() => setParams({ section: null, role: null, member: null, status: null })}>
          <XIcon /> Clear filters
        </Button>
      )}
    </div>
  );
}
