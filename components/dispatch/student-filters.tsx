"use client";

import { useEffect, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { useUrlFilters } from "@/components/admin/url-filters";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useT } from "@/components/dispatch/lang";

export function StudentFilters({ batches }: { batches: { id: string; name: string }[] }) {
  const t = useT();
  const { searchParams, setParams, pending } = useUrlFilters();
  const urlQuery = searchParams.get("q") ?? "";
  const [q, setQ] = useState(urlQuery);
  const batch = searchParams.get("batch") ?? "all";
  const status = searchParams.get("status") ?? "active";
  const problem = searchParams.get("problem") ?? "all";

  useEffect(() => {
    if (q === urlQuery) return;
    const timer = setTimeout(() => setParams({ q }), 300);
    return () => clearTimeout(timer);
  }, [q, urlQuery, setParams]);

  const hasFilters = urlQuery || batch !== "all" || status !== "active" || problem !== "all";

  return (
    <div className={cn("grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_150px_170px_auto]", pending && "opacity-70")}>
      <div className="relative sm:col-span-2 lg:col-span-1">
        <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Search number, name, phone or city")}
          className="pl-9"
          aria-label={t("Search students")}
        />
      </div>
      <Select value={batch} onValueChange={(v) => setParams({ batch: v })}>
        <SelectTrigger className="w-full" aria-label={t("Batch")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("All batches")}</SelectItem>
          {batches.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={status} onValueChange={(v) => setParams({ status: v === "active" ? null : v })}>
        <SelectTrigger className="w-full" aria-label={t("Status")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">{t("Active")}</SelectItem>
          <SelectItem value="inactive">{t("Inactive")}</SelectItem>
          <SelectItem value="any">{t("Active and inactive")}</SelectItem>
        </SelectContent>
      </Select>
      <Select value={problem} onValueChange={(v) => setParams({ problem: v })}>
        <SelectTrigger className="w-full" aria-label={t("Problems")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("All details")}</SelectItem>
          <SelectItem value="address">{t("Missing address")}</SelectItem>
          <SelectItem value="phone">{t("No phone")}</SelectItem>
          <SelectItem value="phone-check">{t("Phone was changed on import")}</SelectItem>
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
          <XIcon /> {t("Clear")}
        </Button>
      )}
    </div>
  );
}
