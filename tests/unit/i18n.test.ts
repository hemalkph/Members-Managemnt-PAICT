// Every text marked for translation in the dispatch pages must have Sinhala,
// with the same {placeholders}. Reads the code with the TypeScript parser.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { makeT, plural, translate } from "@/lib/dispatch/i18n";
import { SI, SI_PATTERNS } from "@/lib/dispatch/i18n/si";
import { ACTION_LABEL, STAGE_LABEL, WAITING_FOR } from "@/lib/dispatch/stages";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

const CODE = [...files("app/(app)/admin/dispatch"), ...files("components/dispatch"), "lib/dispatch/rounds.ts"];
// Label lists shown through t() at display time.
const LABEL_FILES = [
  "lib/dispatch/rounds.ts",
  "lib/dispatch/delivery.ts",
  "lib/dispatch/money.ts",
  "lib/dispatch/capabilities.ts",
  "lib/dispatch/packing.ts",
  "components/dispatch/scan-station.tsx",
  "components/dispatch/courier-uploads.tsx",
  "components/dispatch/import-wizard.tsx",
  "components/dispatch/settings-form.tsx",
  "components/dispatch/round-form.tsx",
  "components/dispatch/student-dialog.tsx",
  "components/dispatch/round-review.tsx",
  "components/dispatch/round-close-panel.tsx",
  "components/dispatch/people-grants.tsx",
  "components/dispatch/parcel-correct-dialog.tsx",
  "components/dispatch/delivery-board.tsx",
  "app/(app)/admin/dispatch/rounds/[id]/page.tsx",
  "app/(app)/admin/dispatch/layout.tsx",
  "lib/dispatch/import.ts",
];

function collectKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  const str = (n: ts.Node) => (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) ? n.text : null);
  const parse = (file: string) =>
    ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
  for (const file of CODE) {
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) {
        const name = n.expression.text;
        if (name === "t" && n.arguments[0]) {
          const s = str(n.arguments[0]);
          if (s) keys.set(s, file);
          else {
            const inner = (m: ts.Node): void => {
              if (ts.isConditionalExpression(m.parent) || ts.isBinaryExpression(m.parent)) {
                const x = str(m);
                if (x && /[A-Za-z]/.test(x)) keys.set(x, file);
              }
              ts.forEachChild(m, inner);
            };
            inner(n.arguments[0]);
          }
        }
        if (name === "plural")
          for (const a of n.arguments.slice(1, 3)) {
            const s = str(a);
            if (s) keys.set(s, file);
          }
      }
      ts.forEachChild(n, visit);
    };
    visit(parse(file));
  }
  for (const file of LABEL_FILES) {
    const visit = (n: ts.Node): void => {
      if (ts.isPropertyAssignment(n) && /^(label|title|description|hint|why)$/.test(n.name.getText())) {
        const s = str(n.initializer);
        if (s && /[A-Za-z]/.test(s)) keys.set(s, file);
      }
      if (ts.isArrayLiteralExpression(n))
        for (const e of n.elements) {
          const s = str(e);
          if (s && /^[A-Z][A-Za-z ,'()/.–-]+$/.test(s) && s.length < 60) keys.set(s, file);
        }
      ts.forEachChild(n, visit);
    };
    visit(parse(file));
  }
  return keys;
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("Sinhala translations", () => {
  const keys = collectKeys();

  test("every marked text has Sinhala", () => {
    const missing = [...keys].filter(([k]) => SI[k] === undefined).map(([k, f]) => `${f}: ${k}`);
    expect(missing, `No Sinhala for:\n${missing.join("\n")}`).toEqual([]);
  });

  test("round steps, their buttons and waiting notes have Sinhala", () => {
    const texts = [...Object.values(STAGE_LABEL), ...Object.values(ACTION_LABEL), ...Object.values(WAITING_FOR)];
    expect(texts.filter((x) => SI[x] === undefined)).toEqual([]);
  });

  test("placeholders match", () => {
    const wrong = Object.entries(SI)
      .filter(([en, si]) => placeholders(en).join() !== placeholders(si).join())
      .map(([en]) => en);
    expect(wrong).toEqual([]);
  });

  test("patterns fill their placeholders", () => {
    for (const p of SI_PATTERNS) {
      const groups = [...p.re.source.matchAll(/\(\?<(\w+)>/g)].map((m) => m[1]).sort();
      expect(placeholders(p.si), p.re.source).toEqual([...new Set(groups)].sort());
    }
  });
});

describe("translate", () => {
  test("English stays English, with placeholders filled", () => {
    const t = makeT("en");
    expect(t("{n} to pack", { n: 3 })).toBe("3 to pack");
    expect(t(plural(1, "Save {n} row", "Save {n} rows"), { n: 1 })).toBe("Save 1 row");
    expect(t(undefined)).toBe("");
  });
  test("Sinhala, and unknown text falls back to English", () => {
    expect(translate("si", "Save")).toBe("සුරකින්න");
    expect(translate("si", "{n} to pack", { n: 3 })).toBe("පැක් කිරීමට 3");
    expect(translate("si", "Some brand-new message")).toBe("Some brand-new message");
  });
});

describe("server and database messages", () => {
  test.each([
    "Handed 12 parcels to the courier",
    "Updated 3 parcels · 1 skipped",
    "You counted 3 but 2 were scanned. Find the difference before confirming.",
    "Already packed by Kushmi Packer",
    "On hold: missing item, damaged",
    "Only Rs. 100.00 is owed for this parcel.",
    "Address or city missing: 101, 102",
    "This parcel belongs to round “Round A”.",
    "You are not signed in or not allowed to do this.",
  ])("%s", (msg) => {
    const si = translate("si", msg);
    expect(si).not.toBe(msg);
    expect(si).toMatch(/[඀-෿]/); // Sinhala letters
  });

  test("a reason inside a message is translated too", () => {
    expect(translate("si", "Can't close yet: A handover is still open – confirm or cancel it.")).toBe(
      "තවම වසා දැමිය නොහැක: භාර දීමක් තවම විවෘතයි – එය තහවුරු කරන්න හෝ අවලංගු කරන්න.",
    );
    expect(translate("si", "On hold: missing item")).toBe("නවතා ඇත: අයිතමයක් අඩුයි");
  });
});
