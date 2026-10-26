import type { Metadata } from "next";
import { LandmarkIcon, ShieldCheckIcon } from "lucide-react";
import { MaskedAccountNumber } from "@/components/member/masked-account";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { revealMyAccountNumberAction } from "@/lib/actions/bank";
import { requireCompleteProfile } from "@/lib/auth";
import { formatDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { BankForm } from "./bank-form";

export const metadata: Metadata = { title: "Bank details" };

export default async function BankPage() {
  const profile = await requireCompleteProfile();
  const supabase = await createClient();
  // Note: the full account_number is deliberately NOT selected here.
  const { data: bank } = await supabase
    .from("bank_details")
    .select("bank_name, branch, account_holder, account_last4, updated_at")
    .eq("user_id", profile.id)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <PageHeader title="Bank details" description="Used by the team to pay you for your work." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader>
            <CardTitle>{bank ? "Update bank details" : "Add bank details"}</CardTitle>
            <CardDescription>
              {bank ? "Leave the account number empty to keep the saved one." : "All fields are required."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <BankForm
              hasExisting={Boolean(bank)}
              last4={bank?.account_last4 ?? null}
              defaultValues={{
                bank_name: bank?.bank_name ?? "",
                branch: bank?.branch ?? "",
                account_holder: bank?.account_holder ?? profile.full_name,
                account_number: "",
              }}
            />
          </CardContent>
        </Card>

        <div className="grid content-start gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <LandmarkIcon className="text-primary size-5" /> Saved account
              </CardTitle>
            </CardHeader>
            <CardContent>
              {bank ? (
                <dl className="grid gap-3 text-sm">
                  <div>
                    <dt className="text-muted-foreground text-xs">Bank</dt>
                    <dd className="font-medium">{bank.bank_name}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Branch</dt>
                    <dd className="font-medium">{bank.branch}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Account holder</dt>
                    <dd className="font-medium">{bank.account_holder}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-xs">Account number</dt>
                    <dd>
                      <MaskedAccountNumber last4={bank.account_last4} reveal={revealMyAccountNumberAction} />
                    </dd>
                  </div>
                  <p className="text-muted-foreground text-xs">Last updated {formatDateTime(bank.updated_at)}</p>
                </dl>
              ) : (
                <p className="text-muted-foreground text-sm">Nothing saved yet.</p>
              )}
            </CardContent>
          </Card>
          <div className="text-muted-foreground flex gap-3 rounded-xl border p-4 text-sm">
            <ShieldCheckIcon className="text-success size-5 shrink-0" />
            <p>Only you and the team admins can read your bank details. The account number is always masked.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
