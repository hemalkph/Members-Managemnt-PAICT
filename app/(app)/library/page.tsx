import type { Metadata } from "next";
import Link from "next/link";
import { CalendarDaysIcon, DownloadIcon, EyeIcon, FileCheck2Icon, FileTextIcon, LibraryIcon, SearchIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { LibraryWhatsApp, type LibraryContact } from "@/components/library/library-whatsapp";
import { waNumber } from "@/components/papers/review-contacts";
import BlurText from "@/components/reactbits/blur-text";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/lib/auth";
import type { PaperStageName } from "@/lib/supabase/database.types";
import { getSiteUrl } from "@/lib/core/env";
import { formatBytes, formatDate, formatDay } from "@/lib/core/format";
import { markingKind, setKey, setTitle } from "@/lib/work/marking";
import { MEDIUM_LABEL, PART_LABEL, type PaperMedium, type PaperPart } from "@/lib/papers";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Paper library" };

const QUESTION_STAGES: { stage: PaperStageName; label: string }[] = [
  { stage: "typeset_si", label: "Sinhala" },
  { stage: "typeset_en", label: "English" },
  { stage: "handover", label: "Final PDF (hand-over)" },
];
const SCHEME_STAGES: { stage: PaperStageName; label: string }[] = [
  { stage: "scheme", label: "Sinhala" },
  { stage: "scheme_rewrite", label: "Sinhala – clear copy" },
  { stage: "scheme_en", label: "English" },
];

type FileItem = { id: string; fileName: string; size: number; when: string; version: number };
type LibPaper = { id: string; title: string; part: PaperPart; files: Partial<Record<PaperStageName, FileItem>> };
type LibSet = {
  key: string;
  title: string;
  kind: "paper" | "tute";
  medium: PaperMedium;
  examDay: string | null;
  papers: LibPaper[];
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/**
 * Every member: the Sinhala and English papers, each once its own review is
 * done, and the marking schemes once every scheme step is finished.
 * One card per paper set ("RFP 04" = MCQ + SE & Essay), grouped by exam.
 */
export default async function LibraryPage({ searchParams }: PageProps<"/library">) {
  const profile = await requireUser();
  const sp = await searchParams;
  const q = one(sp.q).trim().slice(0, 80);
  const kind = one(sp.kind) === "tute" ? "tute" : one(sp.kind) === "paper" ? "paper" : "";
  const exam = one(sp.exam).slice(0, 150);

  const supabase = await createClient();
  const [{ data }, contacts] = await Promise.all([
    supabase.rpc("paper_library"),
    profile.is_admin ? getLibraryContacts(supabase) : Promise.resolve(null),
  ]);
  const rows = data ?? [];
  const examOf = (r: (typeof rows)[number]) =>
    r.exam_name ? `${r.batch_name ? `${r.batch_name} – ` : ""}${r.exam_name}` : "Other papers";
  const exams = [...new Set(rows.map(examOf))].sort((a, b) => (a === "Other papers" ? 1 : b === "Other papers" ? -1 : a.localeCompare(b)));

  // exam → set → paper → latest file per stage
  const groups = new Map<string, Map<string, LibSet>>();
  for (const r of rows) {
    if (kind && r.kind !== kind) continue;
    if (exam && examOf(r) !== exam) continue;
    if (q && !r.title.toLowerCase().includes(q.toLowerCase())) continue;
    const label = examOf(r);
    const sets = groups.get(label) ?? new Map<string, LibSet>();
    const key = r.kind === "tute" ? `tute:${r.paper_id}` : setKey(r.title);
    const set =
      sets.get(key) ??
      ({ key, title: r.kind === "tute" ? r.title : setTitle(r.title), kind: r.kind, medium: r.medium, examDay: r.exam_day, papers: [] } as LibSet);
    let paper = set.papers.find((p) => p.id === r.paper_id);
    if (!paper) {
      paper = { id: r.paper_id, title: r.title, part: r.kind === "tute" ? r.part : markingKind(r.part, r.title), files: {} };
      set.papers.push(paper);
    }
    paper.files[r.stage] = { id: r.file_id, fileName: r.file_name, size: r.size_bytes, when: r.created_at, version: r.version };
    if (r.exam_day && (!set.examDay || r.exam_day < set.examDay)) set.examDay = r.exam_day;
    sets.set(key, set);
    groups.set(label, sets);
  }
  const ordered = [...groups.entries()]
    .map(([label, sets]) => ({
      label,
      sets: [...sets.values()]
        .map((s) => ({ ...s, papers: s.papers.sort((a, b) => partOrder(a.part) - partOrder(b.part)) }))
        .sort((a, b) => (b.examDay ?? "").localeCompare(a.examDay ?? "") || a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => (a.label === "Other papers" ? 1 : b.label === "Other papers" ? -1 : (b.sets[0]?.examDay ?? "").localeCompare(a.sets[0]?.examDay ?? "")));
  const total = ordered.reduce((n, g) => n + g.sets.length, 0);

  const href = (patch: Record<string, string>) => {
    const next = new URLSearchParams({ ...(q && { q }), ...(kind && { kind }), ...(exam && { exam }), ...patch });
    for (const [k, v] of [...next.entries()]) if (!v) next.delete(k);
    const s = next.toString();
    return s ? `/library?${s}` : "/library";
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <BlurText as="h1" text="Paper library" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
          <p className="text-muted-foreground text-sm">
            Reviewed papers in Sinhala and English, and their marking schemes. Download them any time – for the LMS, the
            physical centres or marking.
          </p>
        </div>
        <form className="flex w-full gap-2 sm:w-72" action="/library">
          {kind && <input type="hidden" name="kind" value={kind} />}
          {exam && <input type="hidden" name="exam" value={exam} />}
          <Input name="q" defaultValue={q} placeholder="Search e.g. RFP 04" aria-label="Search papers" />
          <Button type="submit" variant="outline" size="icon" aria-label="Search">
            <SearchIcon />
          </Button>
        </form>
      </div>

      {rows.length > 0 && (
        <div className="space-y-2">
          <FilterRow
            label="Type"
            items={[
              { label: "All", href: href({ kind: "" }), active: !kind },
              { label: "Papers", href: href({ kind: "paper" }), active: kind === "paper" },
              { label: "Tutes", href: href({ kind: "tute" }), active: kind === "tute" },
            ]}
          />
          {exams.length > 1 && (
            <FilterRow
              label="Exam"
              items={[
                { label: "All exams", href: href({ exam: "" }), active: !exam },
                ...exams.map((e) => ({ label: e, href: href({ exam: e }), active: exam === e })),
              ]}
            />
          )}
        </div>
      )}

      {total === 0 ? (
        <EmptyState
          icon={LibraryIcon}
          title={q || kind || exam ? "No papers match" : "No papers in the library yet"}
          description={
            q || kind || exam
              ? "Try another name or clear the filters."
              : "Each paper appears here once its Sinhala or English review is done. Its marking scheme follows when the Sinhala and English schemes are finished."
          }
        />
      ) : (
        ordered.map((g) => (
          <Card key={g.label} className="gap-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {g.label}
                <span className="text-muted-foreground text-sm font-normal">
                  {g.sets.length} {g.sets.length === 1 ? "set" : "sets"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 lg:grid-cols-2">
              {g.sets.map((set) => (
                <PaperSet key={set.key} set={set} contacts={contacts} />
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}

/**
 * Admins: who to WhatsApp about a paper. Same role-name rule as the database's
 * library notifications (public.notify_library_paper).
 */
async function getLibraryContacts(supabase: Awaited<ReturnType<typeof createClient>>): Promise<LibraryContact[]> {
  const { data } = await supabase.from("member_roles").select("user_id, roles(name), profiles(full_name, email, whatsapp, is_active)");
  const contacts: LibraryContact[] = [];
  for (const r of data ?? []) {
    const name = r.roles?.name ?? "";
    const job = /lms.*admin/i.test(name) ? "lms" : /physical.*coordinator/i.test(name) ? "print" : null;
    if (!job || !r.profiles?.is_active || contacts.some((c) => c.userId === r.user_id && c.job === job)) continue;
    const person = r.profiles.full_name?.trim() || r.profiles.email;
    contacts.push({ userId: r.user_id, name: person, number: waNumber(r.profiles.whatsapp), job });
  }
  return contacts.sort((a, b) => a.name.localeCompare(b.name));
}

const partOrder = (p: PaperPart) => (p === "mcq" ? 0 : p === "essay" ? 1 : 2);

function FilterRow({ label, items }: { label: string; items: { label: string; href: string; active: boolean }[] }) {
  return (
    <nav aria-label={label} className="-mx-1 flex items-center gap-2 overflow-x-auto px-1">
      <span className="text-muted-foreground w-12 shrink-0 text-xs font-medium">{label}</span>
      <ul className="flex min-w-max gap-1.5">
        {items.map((i) => (
          <li key={i.label}>
            <Link
              href={i.href}
              aria-current={i.active ? "page" : undefined}
              className={cn(
                "focus-visible:ring-ring/50 inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors outline-none focus-visible:ring-[3px]",
                i.active ? "bg-primary text-primary-foreground border-primary" : "hover:bg-muted",
              )}
            >
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** One paper set: its question papers (per part) and its marking scheme. */
function PaperSet({ set, contacts }: { set: LibSet; contacts: LibraryContact[] | null }) {
  const split = set.papers.length > 1;
  const schemeFrom = set.papers.find((p) => SCHEME_STAGES.some((s) => p.files[s.stage]));
  const parts = set.kind === "tute" ? "Tute" : split ? set.papers.map((p) => PART_LABEL[p.part]).join(" + ") : PART_LABEL[set.papers[0].part];

  return (
    <SpotlightCard className="min-w-0 space-y-4 p-4">
      <div className="space-y-1.5">
        <p className="text-lg leading-tight font-semibold">{set.title}</p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <Badge variant="outline">{parts}</Badge>
          <Badge variant="secondary">{MEDIUM_LABEL[set.medium]}</Badge>
          {set.examDay && (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <CalendarDaysIcon className="size-3.5 shrink-0" /> {formatDay(set.examDay)}
            </span>
          )}
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Question paper</h3>
        {set.papers.map((p) => {
          const items = QUESTION_STAGES.filter((s) => p.files[s.stage]);
          if (items.length === 0) return null;
          return (
            <div key={p.id} className="space-y-1.5">
              {(set.kind === "paper" || contacts) && (
                <div className="flex items-center justify-between gap-2">
                  {/* Always name the part, so a set with only one part in the library is still clear. */}
                  {set.kind === "paper" ? (
                    <p className="text-sm font-semibold">
                      {PART_LABEL[p.part]} <span className="text-muted-foreground font-normal">paper</span>
                    </p>
                  ) : (
                    <span />
                  )}
                  {contacts && (
                    <LibraryWhatsApp
                      contacts={contacts}
                      paperTitle={p.title}
                      files={items.map((s) => s.label).join(", ")}
                      url={`${getSiteUrl()}/library?q=${encodeURIComponent(set.title)}`}
                    />
                  )}
                </div>
              )}
              <ul className="space-y-1.5">
                {items.map((s) => (
                  <FileRow
                    key={s.stage}
                    label={set.kind === "paper" ? `${PART_LABEL[p.part]} – ${s.label}` : s.label}
                    file={p.files[s.stage]!}
                    icon="paper"
                  />
                ))}
              </ul>
              {set.medium === "both" && !p.files.typeset_en && !p.files.handover && (
                <p className="text-muted-foreground text-xs">English paper shows here after its review.</p>
              )}
            </div>
          );
        })}
      </section>

      <section className="space-y-2">
        <h3 className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">Marking scheme</h3>
        {schemeFrom ? (
          <ul className="space-y-1.5">
            {SCHEME_STAGES.filter((s) => schemeFrom.files[s.stage]).map((s) => (
              <FileRow key={s.stage} label={s.label} file={schemeFrom.files[s.stage]!} icon="scheme" />
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">Shows here once the Sinhala and English marking schemes are finished.</p>
        )}
      </section>
    </SpotlightCard>
  );
}

function FileRow({ label, file, icon }: { label: string; file: FileItem; icon: "paper" | "scheme" }) {
  const Icon = icon === "paper" ? FileTextIcon : FileCheck2Icon;
  return (
    <li className="bg-background flex min-w-0 items-center gap-2.5 rounded-lg border p-2">
      <span
        className={cn(
          "flex size-8 shrink-0 items-center justify-center rounded-md",
          icon === "paper" ? "bg-primary/10 text-primary" : "bg-success/15 text-success",
        )}
      >
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{label}</span>
        <span className="text-muted-foreground block truncate text-xs">
          v{file.version} · {formatBytes(file.size)} · {formatDate(file.when)}
        </span>
      </span>
      <Button asChild size="icon" variant="ghost" aria-label={`Open ${label}`}>
        <a href={`/papers/files/${file.id}`} target="_blank" rel="noreferrer">
          <EyeIcon />
        </a>
      </Button>
      <Button asChild size="sm" variant="outline">
        <a href={`/papers/files/${file.id}?download=1`} aria-label={`Download ${label}`}>
          <DownloadIcon /> <span className="hidden sm:inline">Download</span>
        </a>
      </Button>
    </li>
  );
}
