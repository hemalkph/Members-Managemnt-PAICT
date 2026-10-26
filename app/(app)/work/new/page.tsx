import type { Metadata } from "next";
import { UserRoundXIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { SubmissionForm } from "@/components/member/submission-form";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { requireCompleteProfile } from "@/lib/auth";
import { SHOW_MEMBERS_THEIR_EARNINGS } from "@/lib/config";
import { parseMonthParam, recentMonths, todayISO } from "@/lib/month";
import { getMemberRoles, getRatesForRoles } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Submit work" };

export default async function NewWorkPage({ searchParams }: PageProps<"/work/new">) {
  const profile = await requireCompleteProfile();
  const sp = await searchParams;
  const month = parseMonthParam(sp.month);
  const fromId = typeof sp.from === "string" && uuid.safeParse(sp.from).success ? sp.from : null;

  const supabase = await createClient();
  const roles = await getMemberRoles(supabase, profile.id);
  const [rates, { data: from }] = await Promise.all([
    getRatesForRoles(
      supabase,
      roles.map((r) => r.id),
    ),
    fromId
      ? supabase
          .from("submissions")
          .select("role_id, rate_item_id, title, description, quantity, links")
          .eq("id", fromId)
          .eq("user_id", profile.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const months = recentMonths(12, true);
  if (!months.includes(month)) months.push(month);
  const roleOptions = roles.map((r) => ({ ...r, rates: rates.get(r.id) ?? [] }));
  const copyRole = from && roles.some((r) => r.id === from.role_id) ? from.role_id : null;
  const defaultRole = copyRole ?? (roles.length === 1 ? roles[0].id : "");
  const defaultRates = rates.get(defaultRole) ?? [];
  const defaultRate =
    from?.rate_item_id && defaultRates.some((r) => r.id === from.rate_item_id)
      ? from.rate_item_id
      : defaultRates.length === 1
        ? defaultRates[0].id
        : "";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={from ? "Log similar work" : "Submit work"}
        description={
          from ? "Copied from an earlier submission. Check the details and submit." : "Log a task you finished. An admin will review it."
        }
      />
      {roles.length === 0 ? (
        <EmptyState
          icon={UserRoundXIcon}
          title="You don't have a role yet"
          description="An admin needs to assign at least one role to you before you can log work."
        />
      ) : (
        <Card>
          <CardContent>
            <SubmissionForm
              userId={profile.id}
              roles={roleOptions}
              months={months}
              today={todayISO()}
              showMoney={SHOW_MEMBERS_THEIR_EARNINGS}
              defaultValues={{
                work_month: month,
                role_id: defaultRole,
                rate_item_id: defaultRate,
                title: from?.title ?? "",
                description: from?.description ?? "",
                quantity: from?.quantity ?? 1,
                date_done: todayISO(),
                links: (from?.links ?? []).map((url) => ({ url })),
              }}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
