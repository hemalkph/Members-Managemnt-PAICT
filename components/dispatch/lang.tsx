"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LANG_COOKIE, makeT, type Lang, type T } from "@/lib/dispatch/i18n";
import { cn } from "@/lib/utils";

const LangContext = React.createContext<{ lang: Lang; t: T }>({ lang: "en", t: makeT("en") });

/** Gives every dispatch component the chosen language. Set in the dispatch layout. */
export function DispatchLangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  const value = React.useMemo(() => ({ lang, t: makeT(lang) }), [lang]);
  return <LangContext value={value}>{children}</LangContext>;
}

export function useT(): T {
  return React.use(LangContext).t;
}

export function useLang(): Lang {
  return React.use(LangContext).lang;
}

function saveLang(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
}

/** EN / සිං switch. The choice is kept on this device for a year. */
export function LangToggle({ className }: { className?: string }) {
  const lang = useLang();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  const choose = (next: Lang) => {
    if (next === lang) return;
    saveLang(next);
    startTransition(() => router.refresh());
  };

  return (
    <div
      role="radiogroup"
      aria-label={lang === "si" ? "භාෂාව" : "Language"}
      className={cn(
        "bg-muted inline-flex shrink-0 items-center rounded-md p-0.5 text-xs font-medium",
        pending && "opacity-60",
        className,
      )}
    >
      {(
        [
          ["en", "EN", "English"],
          ["si", "සිං", "සිංහල"],
        ] as const
      ).map(([value, short, full]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={lang === value}
          aria-label={full}
          lang={value}
          onClick={() => choose(value)}
          className={cn(
            "focus-visible:ring-ring/50 rounded px-2.5 py-1 transition-colors outline-none focus-visible:ring-[3px]",
            lang === value ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {short}
        </button>
      ))}
    </div>
  );
}
