"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, use, useEffect, useState } from "react";
import { CheckIcon } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useT } from "./lang";

type PlanContext = { setDirty: (dirty: boolean) => void; next: string | null };
const Ctx = createContext<PlanContext>({ setDirty: () => {}, next: null });

/** For a planning editor: say when it has unsaved changes. Returns where "Save & continue" goes. */
export function usePlanStep(dirty: boolean): string | null {
  const { setDirty, next } = use(Ctx);
  useEffect(() => {
    setDirty(dirty);
    return () => setDirty(false);
  }, [dirty, setDirty]);
  return next;
}

export type PlanTab = { key: string; label: string; href: string; done: boolean; count?: number; hint?: string };

/**
 * The planning tabs of a draft round: plain names (no second set of numbers –
 * the round's own steps are above), a tick when a part is done, and a warning
 * before leaving a tab with unsaved changes.
 */
export function PlanSteps({ tabs, current, children }: { tabs: PlanTab[]; current: string; children: React.ReactNode }) {
  const t = useT();
  const router = useRouter();
  const [dirty, setDirty] = useState(false);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const index = tabs.findIndex((x) => x.key === current);
  const next = tabs[index + 1]?.href ?? null;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return (
    <Ctx value={{ setDirty, next }}>
      <nav aria-label={t("Planning")} className="-mx-1 overflow-x-auto px-1">
        <ol className="flex min-w-max gap-1 rounded-xl border p-1 shadow-xs">
          {tabs.map((tab) => {
            const active = tab.key === current;
            return (
              <li key={tab.key} className="flex-1">
                <Link
                  href={tab.href}
                  aria-current={active ? "step" : undefined}
                  title={tab.hint}
                  onClick={(e) => {
                    if (dirty && !active) {
                      e.preventDefault();
                      setLeaveTo(tab.href);
                    }
                  }}
                  className={cn(
                    "focus-visible:ring-ring/50 flex min-h-10 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]",
                    active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {tab.done && !active && <CheckIcon className="text-success size-4" aria-label={t("Done")} />}
                  {tab.label}
                  {tab.count !== undefined && tab.count > 0 && (
                    <span className={cn("rounded-full px-1.5 text-xs tabular-nums", active ? "bg-primary-foreground/20" : "bg-muted")}>
                      {tab.count}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
      {children}
      <AlertDialog open={leaveTo !== null} onOpenChange={(open) => !open && setLeaveTo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("You have unsaved changes")}</AlertDialogTitle>
            <AlertDialogDescription>{t("If you leave this tab now, the changes you made here are lost.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Stay and save")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const to = leaveTo;
                setDirty(false);
                setLeaveTo(null);
                if (to) router.push(to);
              }}
            >
              {t("Leave without saving")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Ctx>
  );
}
