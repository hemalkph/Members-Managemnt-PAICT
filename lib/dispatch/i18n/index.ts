// Tute dispatch in English or Sinhala. The English text in the code is the
// key: t("Import students") returns the Sinhala when there is a translation
// (lib/dispatch/i18n/si.ts) and the English otherwise, so nothing ever shows
// blank. {name} placeholders are filled from `vars`.
import { SI, SI_PATTERNS } from "./si";

export type Lang = "en" | "si";
export const LANG_COOKIE = "dispatch-lang";
export const LANGS: Lang[] = ["en", "si"];

export type Vars = Record<string, string | number | null | undefined>;
export type T = (text: string | null | undefined, vars?: Vars) => string;

export function parseLang(value: string | null | undefined): Lang {
  return value === "si" ? "si" : "en";
}

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name] ?? "") : whole));
}

/** Translate one English text. Unknown text (for example an unexpected database message) stays in English. */
export function translate(lang: Lang, text: string | null | undefined, vars?: Vars): string {
  if (!text) return "";
  if (lang === "si") {
    const exact = SI[text];
    if (exact !== undefined) return fill(exact, vars);
    // Messages with numbers or names inside (mostly from the database).
    // Groups named t_… hold English text that is itself translated (e.g. a reason inside a message).
    for (const p of SI_PATTERNS) {
      const m = p.re.exec(text);
      if (!m) continue;
      const groups: Vars = {};
      for (const [k, v] of Object.entries(m.groups ?? {})) groups[k] = k.startsWith("t_") ? translate(lang, v) : v;
      return fill(p.si, { ...groups, ...vars });
    }
  }
  return fill(text, vars);
}

export function makeT(lang: Lang): T {
  return (text, vars) => translate(lang, text, vars);
}

/** English singular/plural choice; each form is its own translation key. */
export function plural(n: number, one: string, other: string): string {
  return n === 1 ? one : other;
}
