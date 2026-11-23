"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Batch filter stored in the URL (?batch=id). */
export function BatchSelect({ batches, value }: { batches: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const go = (batch: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("batch", batch);
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  return (
    <Select value={value} onValueChange={go}>
      <SelectTrigger className={cn("w-[180px]", pending && "opacity-70")} aria-label="Batch">
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
  );
}
