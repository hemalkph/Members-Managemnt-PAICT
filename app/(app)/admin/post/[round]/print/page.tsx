import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { PrintButton } from "@/components/students/print-button";
import { Button } from "@/components/ui/button";
import { requirePage } from "@/lib/auth";
import { monthLabel } from "@/lib/core/month";
import { uuid } from "@/lib/core/validation";
import { getPostRound } from "@/lib/post/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Speed Post labels" };

/** Labels (default) or the post list (?view=list), printed from the browser so Sinhala addresses print right. */
export default async function PostPrintPage({ params, searchParams }: PageProps<"/admin/post/[round]/print">) {
  await requirePage("post");
  const { round: id } = await params;
  const sp = await searchParams;
  if (!uuid.safeParse(id).success) notFound();
  const supabase = await createClient();
  const round = await getPostRound(supabase, id);
  if (!round) notFound();
  const parcels = round.parcelList.filter((p) => p.status !== "void");
  const list = sp.view === "list";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <Button asChild variant="ghost">
          <Link href={`/admin/post/${round.id}`}>
            <ArrowLeftIcon /> Back to the round
          </Link>
        </Button>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link href={list ? `/admin/post/${round.id}/print` : `/admin/post/${round.id}/print?view=list`}>
              {list ? "Labels" : "Post list"}
            </Link>
          </Button>
          <PrintButton />
        </div>
      </div>

      {list ? (
        <div className="space-y-2 text-sm">
          <h1 className="text-lg font-semibold">
            Speed Post list · {monthLabel(round.month)} {round.kind === "main" ? "main round" : "top-up round"} · {parcels.length}{" "}
            parcels
          </h1>
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b">
                <th className="py-1 pr-2">#</th>
                <th className="py-1 pr-2">Name</th>
                <th className="py-1 pr-2">Address</th>
                <th className="py-1 pr-2">Phone</th>
                <th className="py-1 pr-2">Tracking number</th>
              </tr>
            </thead>
            <tbody>
              {parcels.map((p) => (
                <tr key={p.id} className="border-b align-top break-inside-avoid">
                  <td className="py-1.5 pr-2 tabular-nums">{p.number}</td>
                  <td className="py-1.5 pr-2">{p.name}</td>
                  <td className="py-1.5 pr-2 whitespace-pre-line">{p.address}</td>
                  <td className="py-1.5 pr-2 tabular-nums">{p.whatsapp ?? ""}</td>
                  <td className="py-1.5 pr-2 font-mono">{p.trackingNo ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 print:gap-0">
          {parcels.map((p) => (
            <div key={p.id} className="flex min-h-36 break-inside-avoid flex-col gap-1 rounded-md border p-3 print:rounded-none">
              <div className="flex items-start justify-between gap-2">
                <p className="text-base leading-tight font-semibold">{p.name}</p>
                <span className="text-2xl leading-none font-bold tabular-nums">{p.number}</span>
              </div>
              <p className="text-sm whitespace-pre-line">{p.address}</p>
              {p.whatsapp && <p className="text-sm tabular-nums">{p.whatsapp}</p>}
              <p className="text-muted-foreground mt-auto text-[10px]">{p.tutes.join(" · ")}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
