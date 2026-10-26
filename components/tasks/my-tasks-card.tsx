import Link from "next/link";
import { ArrowRightIcon, CalendarClockIcon, FlameIcon, ListTodoIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { TaskView } from "@/lib/task-queries";
import { cn } from "@/lib/utils";

/** Dashboard: the next few open tasks. */
export function MyTasksCard({ tasks }: { tasks: TaskView[] }) {
  const open = tasks.filter((t) => t.status === "open");
  if (open.length === 0) return null;
  const shown = [...open]
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"))
    .slice(0, 4);

  return (
    <Card className="h-fit gap-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ListTodoIcon className="text-primary size-5" /> My tasks
        </CardTitle>
        <CardDescription>
          {open.length} to do{open.some((t) => t.overdue) ? ` · ${open.filter((t) => t.overdue).length} overdue` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <ul className="space-y-2">
          {shown.map((t) => (
            <li key={t.id}>
              <Link
                href={t.paperId ? `/papers/${t.paperId}` : `/work/new?task=${t.id}`}
                className={cn(
                  "hover:bg-accent/50 block rounded-lg border p-2.5 transition-colors",
                  t.overdue && "border-destructive/40 bg-destructive/5",
                )}
              >
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {t.priority === "high" && <FlameIcon className="text-destructive size-3.5 shrink-0" />}
                  <span className="truncate">{t.title}</span>
                </p>
                {t.dueLabel && (
                  <p
                    className={cn(
                      "text-muted-foreground mt-0.5 flex items-center gap-1 text-xs",
                      t.overdue && "text-destructive font-semibold",
                      t.dueSoon && "font-semibold text-amber-700 dark:text-warning",
                    )}
                  >
                    <CalendarClockIcon className="size-3" /> {t.dueLabel}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
        <Button asChild variant="ghost" size="sm" className="w-full">
          <Link href="/tasks">
            See all tasks <ArrowRightIcon />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
