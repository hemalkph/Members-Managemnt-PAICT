import Link from "next/link";
import { CheckIcon } from "lucide-react";
import { LinkButton } from "@/components/animate-ui/components/buttons/link-button";
import { ArrowRight02 } from "@/components/animate-ui/icons/hugeicons";
import type { T } from "@/lib/dispatch/i18n";
import type { NextAction, Stage } from "@/lib/dispatch/stages";
import { cn } from "@/lib/utils";

/**
 * The round's seven steps in a row (done ✓ · now ● · later ○) and, under them,
 * one sentence and one button for this person's next action.
 */
export function RoundPath({
  stages,
  sentence,
  action,
  waiting,
  t,
  compact = false,
}: {
  stages: Stage[];
  sentence: string;
  action: NextAction;
  waiting: string | null;
  t: T;
  compact?: boolean;
}) {
  const at = stages.findIndex((s) => s.status === "now");
  const current = at >= 0 ? { ...stages[at], index: at } : null;
  return (
    <div className={cn("space-y-3", !compact && "bg-card rounded-xl border p-3 sm:p-4 print:hidden")}>
      <ol className="flex items-start gap-0.5 sm:gap-1" aria-label={t("Round steps")}>
        {stages.map((s, i) => {
          const dot = (
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold tabular-nums transition-colors",
                s.status === "done" && "border-success bg-success text-white",
                s.status === "now" && "border-primary bg-primary text-primary-foreground ring-primary/20 ring-4",
                s.status === "started" && "border-primary text-primary",
                s.status === "later" && "border-muted-foreground/30 text-muted-foreground",
              )}
            >
              {s.status === "done" ? <CheckIcon className="size-4" /> : i + 1}
            </span>
          );
          const body = (
            <>
              {dot}
              <span
                className={cn(
                  "mt-1 hidden text-center text-xs leading-tight sm:block",
                  s.status === "now" ? "text-foreground font-semibold" : "text-muted-foreground",
                )}
              >
                {t(s.label)}
              </span>
              {s.count && !compact && (
                <span className="text-muted-foreground hidden text-center text-[10px] tabular-nums sm:block">
                  {s.count}
                </span>
              )}
            </>
          );
          return (
            <li key={s.key} className="flex min-w-0 flex-1 items-start">
              {s.href ? (
                <Link
                  href={s.href}
                  aria-current={s.status === "now" ? "step" : undefined}
                  className="hover:bg-muted focus-visible:ring-ring/50 flex w-full flex-col items-center rounded-lg px-1 py-1 outline-none focus-visible:ring-[3px]"
                >
                  {body}
                </Link>
              ) : (
                <span
                  className="flex w-full flex-col items-center px-1 py-1"
                  aria-current={s.status === "now" ? "step" : undefined}
                >
                  {body}
                </span>
              )}
              {i < stages.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    "mt-4 hidden h-0.5 w-full min-w-3 flex-1 rounded sm:block",
                    s.status === "done" ? "bg-success" : "bg-border",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
      {current && (
        <p className="text-primary text-xs font-semibold sm:hidden">
          {t("Step {n} of {total}: {label}", { n: current.index + 1, total: stages.length, label: t(current.label) })}
          {current.count && <span className="text-muted-foreground font-normal"> · {current.count}</span>}
        </p>
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className={cn("text-sm", compact ? "text-muted-foreground" : "font-medium")}>{sentence}</p>
        {action ? (
          <LinkButton href={action.href} className="shrink-0">
            {t(action.label)} <ArrowRight02 className="size-4" />
          </LinkButton>
        ) : waiting ? (
          <p className="text-muted-foreground shrink-0 text-xs">{t(waiting)}</p>
        ) : null}
      </div>
    </div>
  );
}
