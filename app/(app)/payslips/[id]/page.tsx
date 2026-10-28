import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, DownloadIcon } from "lucide-react";
import { PayslipView } from "@/components/payslip/payslip-view";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { getPayslip } from "@/lib/payslip";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Payslip" };

export default async function PayslipPage({ params }: PageProps<"/payslips/[id]">) {
  const profile = await requireUser();
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  const supabase = await createClient();
  const slip = await getPayslip(supabase, profile, id);
  if (!slip) notFound();

  const back = slip.viewingAsAdmin
    ? { href: `/admin/payments?month=${slip.monthKey}`, label: "Payments" }
    : { href: "/payslips", label: "My earnings" };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button asChild variant="ghost" className="-ml-3">
          <Link href={back.href}>
            <ArrowLeftIcon /> {back.label}
          </Link>
        </Button>
        <Button asChild>
          <a href={`/payslips/${id}/pdf`} download>
            <DownloadIcon /> Download PDF
          </a>
        </Button>
      </div>
      <PayslipView slip={slip} />
    </div>
  );
}
