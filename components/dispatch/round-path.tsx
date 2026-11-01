import Link from "next/link";
import { CheckIcon, ClockIcon } from "lucide-react";
import { LinkButton } from "@/components/animate-ui/components/buttons/link-button";
import { ArrowRight02 } from "@/components/animate-ui/icons/hugeicons";
import type { T } from "@/lib/dispatch/i18n";
import type { NextAction, Stage } from "@/lib/dispatch/stages";
import { cn } from "@/lib/utils";

/**
 * Where the round is: one progress segment per step, filled by how much of
 * that step is done (steps overlap, e.g. packing starts before every tracking
 * number is in). Under it, one sentence and one button for this person's next action.
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

  const track = (
    <ol
      className="grid gap-1.5"
      style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}
      aria-label={t("Round steps")}
    >
      {stages.map((s, i) => {
        const now = s.status === "now";
        const body = (
          <>
            <span
              className="bg-muted relative block h-1.5 overflow-hidden rounded-full"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(s.share * 100)}
              aria-label={t(s.label)}
            >
              <span
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
                  s.status === "done" ? "bg-success" : "bg-primary",
                )}
                style={{ width: `${s.share * 100}%` }}
              />
            </span>
            <span className="mt-2 hidden items-center gap-1.5 sm:flex">
              <span
                aria-hidden
                className={cn(
                  "flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums",
                  s.status === "done" && "bg-success text-white",
                  now && "bg-primary text-primary-foreground",
                  s.status === "started" && "border-primary text-primary border",
                  s.status === "later" && "border-muted-foreground/40 text-muted-foreground border",
                )}
              >
                {s.status === "done" ? <CheckIcon className="size-3" strokeWidth={3} /> : i + 1}
              </span>
              <span
                className={cn(
                  "truncate text-xs",
                  now ? "text-foreground font-semibold" : s.status === "later" ? "text-muted-foreground" : "text-foreground/80",
                )}
              >
                {t(s.label)}
              </span>
            </span>
            {!compact && (
              <span className="text-muted-foreground mt-0.5 hidden h-4 pl-5.5 text-xs tabular-nums sm:block">
                {s.count}
              </span>
            )}
          </>
        );
        const cls = cn(
          "block rounded-lg p-1.5 sm:p-2",
          now && "bg-primary/5 ring-primary/20 ring-1",
        );
        return (
          <li key={s.key} className="min-w-0" aria-current={now ? "step" : undefined}>
            {s.href ? (
              <Link
                href={s.href}
                className={cn(
                  cls,
                  "hover:bg-muted focus-visible:ring-ring/50 cursor-pointer transition-colors outline-none focus-visible:ring-[3px]",
                )}
              >
                {body}
              </Link>
            ) : (
              <span className={cls}>{body}</span>
            )}
          </li>
        );
      })}
    </ol>
  );

  return (
    <div className={cn(!compact && "bg-card overflow-hidden rounded-xl border shadow-xs print:hidden")}>
      <div className={cn(!compact && "p-2 sm:p-3")}>
        {track}
        {current && (
          <p className="mt-2 px-1.5 text-xs sm:hidden">
            <span className="text-primary font-semibold">
              {t("Step {n} of {total}: {label}", { n: current.index + 1, total: stages.length, label: t(current.label) })}
            </span>
            {current.count && <span className="text-muted-foreground tabular-nums"> · {current.count}</span>}
          </p>
        )}
      </div>
      <div
        className={cn(
          "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
          compact ? "mt-3 px-1.5" : "bg-muted/40 border-t px-4 py-3",
        )}
      >
        <p className={cn("text-sm leading-snug", compact ? "text-muted-foreground" : "font-medium")}>{sentence}</p>
        {action ? (
          <LinkButton href={action.href} className="shrink-0" size={compact ? "sm" : "default"}>
            {t(action.label)} <ArrowRight02 className="size-4" />
          </LinkButton>
        ) : waiting ? (
          <p className="text-muted-foreground bg-background inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs">
            <ClockIcon className="size-3.5" /> {t(waiting)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
