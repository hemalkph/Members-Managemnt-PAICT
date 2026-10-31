"use client";

import { useEffect, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { useUrlFilters } from "@/components/admin/url-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export function StudentFilters({ batches }: { batches: { id: string; name: string }[] }) {
  const { searchParams, setParams, pending } = useUrlFilters();
  const urlQuery = searchParams.get("q") ?? "";
  const [q, setQ] = useState(urlQuery);
  const batch = searchParams.get("batch") ?? "all";
  const status = searchParams.get("status") ?? "active";
  const problem = searchParams.get("problem") ?? "all";

  useEffect(() => {
    if (q === urlQuery) return;
    const t = setTimeout(() => setParams({ q }), 300);
    return () => clearTimeout(t);
  }, [q, urlQuery, setParams]);

  const hasFilters = urlQuery || batch !== "all" || status !== "active" || problem !== "all";

  return (
    <div className={cn("grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_150px_170px_auto]", pending && "opacity-70")}>
      <div className="relative sm:col-span-2 lg:col-span-1">
        <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search number, name, phone or city"
          className="pl-9"
          aria-label="Search students"
        />
      </div>
      <Select value={batch} onValueChange={(v) => setParams({ batch: v })}>
        <SelectTrigger className="w-full" aria-label="Batch">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All batches</SelectItem>
          {batches.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={status} onValueChange={(v) => setParams({ status: v === "active" ? null : v })}>
        <SelectTrigger className="w-full" aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
          <SelectItem value="any">Active and inactive</SelectItem>
        </SelectContent>
      </Select>
      <Select value={problem} onValueChange={(v) => setParams({ problem: v })}>
        <SelectTrigger className="w-full" aria-label="Problems">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All details</SelectItem>
          <SelectItem value="address">Missing address</SelectItem>
          <SelectItem value="phone">No phone</SelectItem>
          <SelectItem value="phone-check">Phone was changed on import</SelectItem>
        </SelectContent>
      </Select>
      {hasFilters && (
        <Button
          variant="ghost"
          onClick={() => {
            setQ("");
            setParams({ q: null, batch: null, status: null, problem: null });
          }}
        >
          <XIcon /> Clear
        </Button>
      )}
    </div>
  );
}
