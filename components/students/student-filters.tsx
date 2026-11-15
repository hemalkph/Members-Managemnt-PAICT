"use client";

import { useEffect, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { useUrlFilters } from "@/components/admin/url-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CARD_LABEL, CARD_TYPES, STATUS_LABEL, STATUSES } from "@/lib/students/rules";
import { cn } from "@/lib/utils";

export function StudentFilters({ batches }: { batches: { id: string; name: string }[] }) {
  const { searchParams, setParams, pending } = useUrlFilters();
  const urlQuery = searchParams.get("q") ?? "";
  const [q, setQ] = useState(urlQuery);
  const batch = searchParams.get("batch") ?? "all";
  const card = searchParams.get("card") ?? "all";
  const status = searchParams.get("status") ?? "all";

  useEffect(() => {
    if (q === urlQuery) return;
    const t = setTimeout(() => setParams({ q }), 300);
    return () => clearTimeout(t);
  }, [q, urlQuery, setParams]);

  const hasFilters = urlQuery || batch !== "all" || card !== "all" || status !== "all";
  const select = (key: string, value: string, label: string, options: [string, string][]) => (
    <Select value={value} onValueChange={(v) => setParams({ [key]: v })}>
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([v, l]) => (
          <SelectItem key={v} value={v}>
            {l}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className={cn("grid gap-2 sm:grid-cols-3 lg:grid-cols-[1fr_180px_150px_170px_auto]", pending && "opacity-70")}>
      <div className="relative sm:col-span-3 lg:col-span-1">
        <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name or student ID"
          className="pl-9"
          aria-label="Search students"
        />
      </div>
      {select("batch", batch, "Batch", [["all", "All batches"], ...batches.map((b): [string, string] => [b.id, b.name])])}
      {select("card", card, "Card type", [["all", "All cards"], ...CARD_TYPES.map((c): [string, string] => [c, CARD_LABEL[c]])])}
      {select("status", status, "Status", [
        ["all", "Any status"],
        ["missing", "Details missing"],
        ...STATUSES.map((s): [string, string] => [s, STATUS_LABEL[s]]),
      ])}
      {hasFilters ? (
        <Button
          variant="ghost"
          onClick={() => {
            setQ("");
            setParams({ q: null, batch: null, card: null, status: null });
          }}
        >
          <XIcon /> Clear
        </Button>
      ) : (
        <span className="hidden lg:block" />
      )}
    </div>
  );
}
