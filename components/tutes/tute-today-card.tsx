import Link from "next/link";
import { ArrowRightIcon, BookCopyIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Counts = { low: number; out: number; late: number; due_soon: number };

/** Dashboard card for people with the Tute stock page: shown only when something needs doing. */
export function TuteTodayCard({ counts }: { counts: Counts | null }) {
  if (!counts || counts.low + counts.out + counts.late + counts.due_soon === 0) return null;
  const tutes = (n: number) => (n === 1 ? "tute" : "tutes");
  const jobs = (n: number) => (n === 1 ? "print job" : "print jobs");
  const items = [
    { n: counts.out, label: `${tutes(counts.out)} out of stock`, variant: "destructive" as const },
    { n: counts.low, label: `${tutes(counts.low)} running low`, variant: "warning" as const },
    { n: counts.late, label: `${jobs(counts.late)} late`, variant: "destructive" as const },
    { n: counts.due_soon, label: `${jobs(counts.due_soon)} due this week`, variant: "outline" as const },
  ].filter((i) => i.n > 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <BookCopyIcon className="size-4" /> Tute stock today
          </CardTitle>
          <CardDescription>What needs printing or giving out.</CardDescription>
        </div>
        <Button asChild size="sm" variant="outline">
          <Link href="/admin/tutes">
            Open <ArrowRightIcon />
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {items.map((i) => (
          <Badge key={i.label} variant={i.variant} className="text-sm">
            {i.n} {i.label}
          </Badge>
        ))}
      </CardContent>
    </Card>
  );
}
