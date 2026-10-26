"use client";

import { useState, useTransition } from "react";
import { EyeIcon, EyeOffIcon, Loader2Icon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action-result";
import { maskAccountNumber } from "@/lib/format";

/**
 * Shows ****1234. The full number is never sent to the browser until the
 * allowed viewer presses "Show" (the server re-checks who is asking).
 */
export function MaskedAccountNumber({
  last4,
  reveal,
}: {
  last4: string;
  reveal?: () => Promise<ActionResult<{ accountNumber: string }>>;
}) {
  const [full, setFull] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const onToggle = () => {
    if (full) return setFull(null);
    if (!reveal) return;
    startTransition(async () => {
      const result = await reveal();
      if (!result.ok || !result.data) {
        toast.error(result.ok ? "Could not load the number." : result.error);
        return;
      }
      setFull(result.data.accountNumber);
    });
  };

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono tracking-wider">{full ?? maskAccountNumber(last4)}</span>
      {reveal && (
        <Button type="button" variant="ghost" size="sm" onClick={onToggle} disabled={pending} className="h-7 px-2">
          {pending ? <Loader2Icon className="animate-spin" /> : full ? <EyeOffIcon /> : <EyeIcon />}
          {full ? "Hide" : "Show"}
        </Button>
      )}
    </span>
  );
}
