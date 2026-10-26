"use client";

import { useEffect, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

export function MemberFilters({ sections }: { sections: SectionOption[] }) {
  const { searchParams, setParams, pending } = useUrlFilters();
  const urlQuery = searchParams.get("q") ?? "";
  const [q, setQ] = useState(urlQuery);
  const section = searchParams.get("section") ?? "all";
  const role = searchParams.get("role") ?? "all";
  const status = searchParams.get("status") ?? "all";

  // Debounce typing into the URL.
  useEffect(() => {
    if (q === urlQuery) return;
    const t = setTimeout(() => setParams({ q }), 300);
    return () => clearTimeout(t);
  }, [q, urlQuery, setParams]);

  const rolesToShow = section === "all" ? sections : sections.filter((s) => s.id === section);
  const hasFilters = urlQuery || section !== "all" || role !== "all" || status !== "all";

  return (
    <div className={cn("grid gap-2 sm:grid-cols-2 lg:grid-cols-[1fr_180px_200px_150px_auto]", pending && "opacity-70")}>
      <div className="relative sm:col-span-2 lg:col-span-1">
        <SearchIcon className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name, email or phone"
          className="pl-9"
          aria-label="Search members"
        />
      </div>
      <Select value={section} onValueChange={(v) => setParams({ section: v, role: null })}>
        <SelectTrigger aria-label="Section">
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
        <SelectTrigger aria-label="Role">
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
      <Select value={status} onValueChange={(v) => setParams({ status: v })}>
        <SelectTrigger aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Any status</SelectItem>
          <SelectItem value="active">Active</SelectItem>
          <SelectItem value="inactive">Inactive</SelectItem>
        </SelectContent>
      </Select>
      {hasFilters ? (
        <Button
          variant="ghost"
          onClick={() => {
            setQ("");
            setParams({ q: null, section: null, role: null, status: null });
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
