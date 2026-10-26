"use client";

import { AlertTriangleIcon, RotateCcwIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <EmptyState
      icon={AlertTriangleIcon}
      title="Something went wrong"
      description="Please try again. If it keeps happening, tell a team admin."
      action={
        <Button variant="outline" onClick={reset}>
          <RotateCcwIcon /> Try again
        </Button>
      }
    />
  );
}
