import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ClipboardCheckIcon, HistoryIcon, LandmarkIcon, MailIcon, PhoneIcon } from "lucide-react";
import { MemberActions } from "@/components/admin/member-actions";
import { EmptyState } from "@/components/empty-state";
import { MaskedAccountNumber } from "@/components/member/masked-account";
import { RolesList } from "@/components/member/roles-list";
import { StatusBadge } from "@/components/status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { adminRevealAccountNumberAction } from "@/lib/actions/bank";
import { roleOptionsFrom } from "@/lib/admin-queries";
import { mainAdminUnlocked, requirePage } from "@/lib/auth";
import { ADMINS_CAN_REVEAL_ACCOUNT_NUMBER } from "@/lib/config";
import { ageOn, formatBirthday, isBirthdayToday } from "@/lib/birthday";
import { formatDate, formatLKR, initials } from "@/lib/format";
import { dateToMonthKey, monthLabel, todayISO } from "@/lib/month";
import { getMemberRoles, getStructure } from "@/lib/queries";
import { signedAvatarUrl } from "@/lib/storage";
import { hasServiceRoleKey } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { uuid } from "@/lib/validation";

export const metadata: Metadata = { title: "Member" };

export default async function MemberDetailPage({ params }: PageProps<"/admin/members/[id]">) {
  const { id } = await params;
  if (!uuid.safeParse(id).success) notFound();

  const { profile: me, canEdit } = await requirePage("members");
  const supabase = await createClient();
  const { data: member } = await supabase.from("profiles").select("*").eq("id", id).maybeSingle();
  if (!member) notFound();

  const [roles, structure, avatarUrl, { data: bank }, { data: submissions }] = await Promise.all([
    getMemberRoles(supabase, id),
    getStructure(supabase),
    signedAvatarUrl(supabase, member.avatar_path),
    supabase
      .from("bank_details")
      .select("bank_name, branch, account_holder, account_last4")
      .eq("user_id", id)
      .maybeSingle(),
    supabase
      .from("submissions")
      .select(
        "id, title, quantity, date_done, status, work_month, admin_comment, amount, roles(name), rate_items(name)",
      )
      .eq("user_id", id)
      .order("work_month", { ascending: false })
      .order("date_done", { ascending: false }),
  ]);

  const months = new Map<string, NonNullable<typeof submissions>>();
  for (const s of submissions ?? []) {
    const key = dateToMonthKey(s.work_month);
    months.set(key, [...(months.get(key) ?? []), s]);
  }

  const revealAction = ADMINS_CAN_REVEAL_ACCOUNT_NUMBER ? adminRevealAccountNumberAction.bind(null, { id }) : undefined;

  return (
    <div className="space-y-6">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/admin/members">
          <ArrowLeftIcon /> All members
        </Link>
      </Button>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Avatar className="size-16">
            {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
            <AvatarFallback className="text-lg">{initials(member.full_name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-1">
            <h1 className="flex flex-wrap items-center gap-2 text-2xl font-semibold tracking-tight">
              {member.full_name || member.email}
              {member.is_admin && <Badge variant="outline">{member.is_main_admin ? "Main admin" : "Admin"}</Badge>}
              {member.is_active ? (
                <Badge variant="success">Active</Badge>
              ) : (
                <Badge variant="destructive">Inactive</Badge>
              )}
            </h1>
            <p className="text-muted-foreground text-sm">Joined {formatDate(member.created_at)}</p>
          </div>
        </div>
        {canEdit && (
        <MemberActions
          access={(await mainAdminUnlocked(me)) ? { isMainAdmin: member.is_main_admin, stored: member.page_access } : undefined}
          variant="buttons"
          showView={false}
          canManageAuth={hasServiceRoleKey()}
          isSelf={member.id === me.id}
          roleOptions={roleOptionsFrom(structure)}
          member={{
            id: member.id,
            email: member.email,
            full_name: member.full_name,
            phone: member.phone ?? "",
            whatsapp: member.whatsapp ?? "",
            nic: member.nic ?? "",
            role_ids: roles.map((r) => r.id),
            is_admin: member.is_admin,
            is_active: member.is_active,
          }}
        />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Contact</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 text-sm">
              <div className="flex items-center gap-2">
                <MailIcon className="text-muted-foreground size-4" />
                <a href={`mailto:${member.email}`} className="truncate hover:underline">
                  {member.email}
                </a>
              </div>
              <div className="flex items-center gap-2">
                <PhoneIcon className="text-muted-foreground size-4" />
                {member.phone ? <a href={`tel:${member.phone}`}>{member.phone}</a> : "—"}
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">WhatsApp</dt>
                <dd>{member.whatsapp ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">NIC</dt>
                <dd>{member.nic ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground text-xs">Birthday</dt>
                <dd>
                  {member.date_of_birth
                    ? `${formatBirthday(member.date_of_birth)} · ${ageOn(member.date_of_birth, todayISO())} years`
                    : "—"}
                  {isBirthdayToday(member.date_of_birth, todayISO()) && " 🎂 Today!"}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Roles</CardTitle>
          </CardHeader>
          <CardContent>
            <RolesList roles={roles} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LandmarkIcon className="text-primary size-4" /> Bank details
            </CardTitle>
          </CardHeader>
          <CardContent>
            {bank ? (
              <dl className="grid gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground text-xs">Bank / branch</dt>
                  <dd>
                    {bank.bank_name}, {bank.branch}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Account holder</dt>
                  <dd>{bank.account_holder}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Account number</dt>
                  <dd>
                    <MaskedAccountNumber last4={bank.account_last4} reveal={revealAction} />
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-muted-foreground text-sm">Not added yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <HistoryIcon className="size-5" /> Work history
        </h2>
        {months.size === 0 ? (
          <EmptyState icon={HistoryIcon} title="No work logged yet" />
        ) : (
          [...months.entries()].map(([month, rows]) => {
            const approved = rows.filter((r) => r.status === "approved");
            return (
              <Card key={month} className="gap-3 py-4">
                <CardHeader className="flex flex-wrap items-center justify-between gap-2 px-4">
                  <div>
                    <CardTitle>{monthLabel(month)}</CardTitle>
                    <CardDescription>
                      {rows.length} submitted · {approved.length} approved · approved quantity{" "}
                      {approved.reduce((sum, r) => sum + r.quantity, 0)} · earned{" "}
                      {formatLKR(approved.reduce((sum, r) => sum + Number(r.amount ?? 0), 0))}
                    </CardDescription>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/admin/review?month=${month}&member=${id}`}>
                      <ClipboardCheckIcon /> Review
                    </Link>
                  </Button>
                </CardHeader>
                <CardContent className="px-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-4">Title</TableHead>
                        <TableHead className="hidden sm:table-cell">Role</TableHead>
                        <TableHead className="text-right">Qty</TableHead>
                        <TableHead className="hidden text-right md:table-cell">Amount</TableHead>
                        <TableHead className="hidden sm:table-cell">Date</TableHead>
                        <TableHead className="pr-4">Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell className="max-w-[200px] truncate pl-4 sm:max-w-[320px]">{r.title}</TableCell>
                          <TableCell className="hidden sm:table-cell">
                            {r.roles?.name}
                            {r.rate_items && <span className="text-muted-foreground"> · {r.rate_items.name}</span>}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.quantity}</TableCell>
                          <TableCell className="hidden text-right tabular-nums md:table-cell">
                            {r.amount === null ? "—" : formatLKR(Number(r.amount))}
                          </TableCell>
                          <TableCell className="hidden sm:table-cell">{formatDate(r.date_done)}</TableCell>
                          <TableCell className="pr-4">
                            <StatusBadge status={r.status} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            );
          })
        )}
      </section>
    </div>
  );
}
