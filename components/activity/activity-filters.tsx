"use client";

import { useEffect, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { useUrlFilters } from "@/components/admin/url-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ACTIVITY_CATEGORIES } from "@/lib/activity";
import { monthLabel, recentMonths } from "@/lib/month";
import { cn } from "@/lib/utils";

export function ActivityFilters({ people }: { people: { id: string; name: string }[] }) {
  const { searchParams, setParams, pending } = useUrlFilters();
  const type = searchParams.get("type") ?? "all";
  const person = searchParams.get("person") ?? "all";
  const month = searchParams.get("month") ?? "all";
  const q = searchParams.get("q") ?? "";
  const [text, setText] = useState(q);

  // Search as you type (after a short pause).
  useEffect(() => {
    if (text === q) return;
    const timer = setTimeout(() => setParams({ q: text.trim() || null, page: null }), 350);
    return () => clearTimeout(timer);
  }, [text, q, setParams]);

  const hasFilters = type !== "all" || person !== "all" || month !== "all" || q !== "";

  return (
    <div className={cn("flex flex-col gap-2 lg:flex-row lg:items-center", pending && "opacity-70")}>
      <div className="relative lg:w-64">
        <SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search the log…"
          className="pl-9"
          aria-label="Search the activity log"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex lg:flex-1 lg:flex-wrap">
        <Select value={type} onValueChange={(v) => setParams({ type: v, page: null })}>
          <SelectTrigger className="lg:w-52" aria-label="Type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everything</SelectItem>
            {Object.entries(ACTIVITY_CATEGORIES).map(([key, c]) => (
              <SelectItem key={key} value={key}>
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={person} onValueChange={(v) => setParams({ person: v, page: null })}>
          <SelectTrigger className="lg:w-48" aria-label="Person">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Anyone</SelectItem>
            {people.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={month} onValueChange={(v) => setParams({ month: v, page: null })}>
          <SelectTrigger className="col-span-2 sm:col-span-1 lg:w-44" aria-label="Month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any time</SelectItem>
            {recentMonths(18).map((m) => (
              <SelectItem key={m} value={m}>
                {monthLabel(m)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button
            variant="ghost"
            onClick={() => {
              setText("");
              setParams({ type: null, person: null, month: null, q: null, page: null });
            }}
          >
            <XIcon /> Clear
          </Button>
        )}
      </div>
    </div>
  );
}
