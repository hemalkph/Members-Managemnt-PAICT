import type { Metadata } from "next";
import Link from "next/link";
import { DownloadIcon, FileTextIcon, LibraryIcon, SearchIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import BlurText from "@/components/reactbits/blur-text";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { requireUser } from "@/lib/auth";
import type { PaperStageName } from "@/lib/database.types";
import { formatBytes, formatDate, formatDay } from "@/lib/format";
import { FINAL_STAGES, MEDIUM_LABEL, PART_LABEL, type PaperMedium, type PaperPart } from "@/lib/papers";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Paper library" };

const OUTPUT_LABEL: Partial<Record<PaperStageName, string>> = {
  handover: "Final paper",
  scheme: "Marking scheme",
  scheme_rewrite: "Marking scheme (clear copy)",
  scheme_en: "Marking scheme (English)",
};

type PaperRow = {
  id: string;
  title: string;
  kind: "paper" | "tute";
  part: PaperPart;
  medium: PaperMedium;
  exam_day: string | null;
  exam: { name: string; batch: { name: string } | null } | null;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

/** Every member: download the final paper PDFs and marking schemes, any time. */
export default async function LibraryPage({ searchParams }: PageProps<"/library">) {
  await requireUser();
  const q = one((await searchParams).q)
    .trim()
    .slice(0, 80);

  const supabase = await createClient();
  const { data } = await supabase
    .from("paper_files")
    .select(
      "id, stage, version, file_name, size_bytes, created_at, paper:papers!inner(id, title, kind, part, medium, exam_day, exam:exams(name, batch:batches(name)))",
    )
    .in("stage", FINAL_STAGES)
    .order("created_at", { ascending: false })
    .limit(3000);

  // Latest version of each output, grouped by paper.
  const papers = new Map<
    string,
    {
      paper: PaperRow;
      latest: string;
      files: { id: string; stage: PaperStageName; version: number; fileName: string; size: number; when: string }[];
    }
  >();
  for (const f of data ?? []) {
    const paper = f.paper as unknown as PaperRow;
    if (q && !paper.title.toLowerCase().includes(q.toLowerCase())) continue;
    const entry = papers.get(paper.id) ?? { paper, latest: f.created_at, files: [] };
    if (!entry.files.some((x) => x.stage === f.stage)) {
      entry.files.push({
        id: f.id,
        stage: f.stage as PaperStageName,
        version: f.version,
        fileName: f.file_name,
        size: f.size_bytes,
        when: f.created_at,
      });
    }
    papers.set(paper.id, entry);
  }
  const list = [...papers.values()].sort(
    (a, b) => (b.paper.exam_day ?? "").localeCompare(a.paper.exam_day ?? "") || b.latest.localeCompare(a.latest),
  );
  for (const p of list) p.files.sort((a, b) => FINAL_STAGES.indexOf(a.stage) - FINAL_STAGES.indexOf(b.stage));

  // Group by exam.
  const groups = new Map<string, typeof list>();
  for (const p of list) {
    const e = p.paper.exam;
    const label = e ? `${e.batch?.name ? `${e.batch.name} – ` : ""}${e.name}` : "Other papers";
    groups.set(label, [...(groups.get(label) ?? []), p]);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <BlurText as="h1" text="Paper library" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
          <p className="text-muted-foreground text-sm">
            The final papers and marking schemes. Download them any time – for the LMS, the physical centres or marking.
          </p>
        </div>
        <form className="flex w-full gap-2 sm:w-72" action="/library">
          <Input name="q" defaultValue={q} placeholder="Search papers" aria-label="Search papers" />
          <Button type="submit" variant="outline" size="icon" aria-label="Search">
            <SearchIcon />
          </Button>
        </form>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={LibraryIcon}
          title={q ? "No papers match" : "No final papers yet"}
          description={
            q ? "Try another name." : "When a type setter uploads the final PDF at hand-over, it appears here."
          }
        />
      ) : (
        [...groups.entries()].map(([label, items]) => (
          <Card key={label} className="gap-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {label}
                <span className="text-muted-foreground text-sm font-normal">
                  {items.length} {items.length === 1 ? "paper" : "papers"}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {items.map(({ paper, files }) => (
                <SpotlightCard key={paper.id} className="min-w-0 space-y-3 p-4">
                  <div className="space-y-1">
                    <Link href={`/papers/${paper.id}`} className="font-semibold hover:underline">
                      {paper.title}
                    </Link>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs">
                      <Badge variant="outline">{paper.kind === "tute" ? "Tute" : PART_LABEL[paper.part]}</Badge>
                      <Badge variant="secondary">{MEDIUM_LABEL[paper.medium]}</Badge>
                      {paper.exam_day && <span className="text-muted-foreground">{formatDay(paper.exam_day)}</span>}
                    </p>
                  </div>
                  <ul className="space-y-2">
                    {files.map((f) => (
                      <li key={f.id} className="bg-background flex min-w-0 items-center gap-2.5 rounded-lg border p-2">
                        <span className="bg-primary/10 text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
                          <FileTextIcon className="size-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{OUTPUT_LABEL[f.stage] ?? f.stage}</span>
                          <span className="text-muted-foreground block truncate text-xs">
                            {f.fileName} · {formatBytes(f.size)} · {formatDate(f.when)}
                          </span>
                        </span>
                        <Button asChild size="sm" variant="outline">
                          <a href={`/papers/files/${f.id}?download=1`} aria-label={`Download ${OUTPUT_LABEL[f.stage]}`}>
                            <DownloadIcon /> <span className="hidden sm:inline">Download</span>
                          </a>
                        </Button>
                      </li>
                    ))}
                  </ul>
                </SpotlightCard>
              ))}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
