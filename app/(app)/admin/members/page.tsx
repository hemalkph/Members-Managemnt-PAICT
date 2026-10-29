import type { Metadata } from "next";
import Link from "next/link";
import { KeyRoundIcon, ShieldCheckIcon, UserCheckIcon, UserPlusIcon, UserXIcon, UsersIcon } from "lucide-react";
import { MemberActions } from "@/components/admin/member-actions";
import { AddMemberDialog } from "@/components/admin/member-dialogs";
import { MemberFilters } from "@/components/admin/member-filters";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { StatCard } from "@/components/stat-card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAllMemberRoles, roleOptionsFrom } from "@/lib/admin-queries";
import { mainAdminUnlocked, requirePage } from "@/lib/auth";
import { accessMap, PAGES } from "@/lib/page-access";
import { ReadOnlyNotice } from "@/components/read-only-notice";
import { isBirthdayToday } from "@/lib/birthday";
import { initials } from "@/lib/format";
import { todayISO } from "@/lib/month";
import { flattenRoles, getStructure } from "@/lib/queries";
import { signedAvatarUrls } from "@/lib/storage";
import { hasServiceRoleKey } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Members" };

function param(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

export default async function MembersPage({ searchParams }: PageProps<"/admin/members">) {
  const { profile: me, canEdit } = await requirePage("members");
  const sp = await searchParams;
  const q = param(sp.q).trim().toLowerCase();
  const section = param(sp.section);
  const role = param(sp.role);
  const status = param(sp.status);

  const supabase = await createClient();
  const [{ data: profiles }, structure, rolesByUser] = await Promise.all([
    supabase.from("profiles").select("*").order("full_name"),
    getStructure(supabase),
    getAllMemberRoles(supabase),
  ]);

  const everyoneRows = profiles ?? [];
  const allRoles = flattenRoles(structure);
  const roleById = new Map(allRoles.map((r) => [r.id, r]));
  const roleOptions = roleOptionsFrom(structure);

  const members = (profiles ?? []).filter((p) => {
    const roleIds = rolesByUser.get(p.id) ?? [];
    if (q && ![p.full_name, p.email, p.phone, p.whatsapp].some((v) => v?.toLowerCase().includes(q))) return false;
    if (status === "active" && !p.is_active) return false;
    if (status === "inactive" && p.is_active) return false;
    if (role && !roleIds.includes(role)) return false;
    if (section && !roleIds.some((id) => roleById.get(id)?.sectionId === section)) return false;
    return true;
  });

  const avatars = await signedAvatarUrls(
    supabase,
    members.map((m) => m.avatar_path),
  );
  const canManageAuth = hasServiceRoleKey();
  // Only main admins (with two-step done) can change page access.
  const canSetAccess = await mainAdminUnlocked(me);
  /** Short label for the member list: custom admin access, or admin pages given to a member. */
  const accessLabel = (p: (typeof everyoneRows)[number]) => {
    if (p.is_main_admin) return null;
    const pages = accessMap(p);
    if (p.is_admin) {
      if (!p.page_access) return null;
      const off = PAGES.filter((pg) => !pg.mainOnly && pages[pg.key] === "none").length;
      const view = PAGES.filter((pg) => pages[pg.key] === "view").length;
      return [off ? `${off} hidden` : null, view ? `${view} read only` : null].filter(Boolean).join(" · ") || null;
    }
    const given = PAGES.filter((pg) => pages[pg.key] !== "none");
    if (given.length === 0) return null;
    const viewOnly = given.every((pg) => pages[pg.key] === "view");
    return `${given.map((pg) => pg.title).join(", ")}${viewOnly ? " (read only)" : ""}`;
  };
  const today = todayISO();
  const everyone = everyoneRows;
  const activeCount = everyone.filter((p) => p.is_active).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Members"
        description={`Showing ${members.length} of ${everyone.length} accounts`}
        actions={
          canEdit ? (
            <AddMemberDialog roleOptions={roleOptions} canCreate={canManageAuth}>
              <Button>
                <UserPlusIcon /> Add member
              </Button>
            </AddMemberDialog>
          ) : undefined
        }
      />
      {!canEdit && <ReadOnlyNotice />}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total accounts" value={everyone.length} icon={UsersIcon} hint="Everyone in the team" />
        <StatCard
          label="Active"
          value={activeCount}
          icon={UserCheckIcon}
          tone="success"
          hint="Can log in"
          delay={0.1}
        />
        <StatCard
          label="Inactive"
          value={everyone.length - activeCount}
          icon={UserXIcon}
          tone="warning"
          hint="Cannot log in"
          delay={0.2}
        />
        <StatCard
          label="Admins"
          value={everyone.filter((p) => p.is_admin).length}
          icon={ShieldCheckIcon}
          tone="info"
          hint="Full access"
          delay={0.3}
        />
      </div>

      <MemberFilters
        sections={structure.map((s) => ({
          id: s.id,
          name: s.name,
          roles: s.roles.map((r) => ({ id: r.id, name: r.name })),
        }))}
      />

      {members.length === 0 ? (
        <EmptyState icon={UsersIcon} title="No members found" description="Try changing the search or filters." />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Member</TableHead>
                <TableHead className="hidden md:table-cell">Contact</TableHead>
                <TableHead className="hidden md:table-cell">Roles</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                <TableHead className="w-10 pr-4">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const roleIds = rolesByUser.get(m.id) ?? [];
                const roles = roleIds.map((id) => roleById.get(id)).filter((r) => r !== undefined);
                const avatar = m.avatar_path ? avatars.get(m.avatar_path) : undefined;
                return (
                  <TableRow key={m.id} className={m.is_active ? undefined : "opacity-60"}>
                    <TableCell className="pl-4">
                      <Link href={`/admin/members/${m.id}`} className="flex items-center gap-3">
                        <Avatar className="size-9">
                          {avatar && <AvatarImage src={avatar} alt="" />}
                          <AvatarFallback>{initials(m.full_name)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate font-medium hover:underline">
                            {m.full_name || "—"}
                            {m.is_admin && (
                              <Badge variant="outline" className="text-[10px]">
                                {m.is_main_admin ? "Main admin" : "Admin"}
                              </Badge>
                            )}
                            {m.id === me.id && <Badge className="text-[10px]">You</Badge>}
                            {accessLabel(m) && (
                              <Badge
                                variant="secondary"
                                className="max-w-[160px] truncate text-[10px] sm:max-w-[240px]"
                                title={`Page access: ${accessLabel(m)}`}
                              >
                                <KeyRoundIcon /> {accessLabel(m)}
                              </Badge>
                            )}
                            {isBirthdayToday(m.date_of_birth, today) && (
                              <span title="Birthday today" aria-label="Birthday today">
                                🎂
                              </span>
                            )}
                          </p>
                          <p className="text-muted-foreground max-w-[200px] truncate text-xs sm:max-w-none">
                            {m.email}
                          </p>
                          <p className="text-muted-foreground max-w-[200px] truncate text-xs md:hidden">
                            {roles.length === 0 ? "No roles" : roles.map((r) => r.name).join(", ")}
                            {!m.is_active && " · Inactive"}
                          </p>
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground hidden text-xs md:table-cell">
                      <p>{m.phone ?? "—"}</p>
                      {m.whatsapp && <p>WA {m.whatsapp}</p>}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex max-w-[260px] flex-wrap gap-1">
                        {roles.length === 0 && <span className="text-muted-foreground text-xs">No roles</span>}
                        {roles.slice(0, 3).map((r) => (
                          <Badge key={r.id} variant="secondary" title={r.sectionName}>
                            {r.name}
                          </Badge>
                        ))}
                        {roles.length > 3 && <Badge variant="outline">+{roles.length - 3}</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {m.is_active ? (
                        <Badge variant="success">Active</Badge>
                      ) : (
                        <Badge variant="destructive">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <span
                          className={
                            m.is_active
                              ? "bg-success size-2.5 rounded-full"
                              : "bg-muted-foreground/40 size-2.5 rounded-full"
                          }
                          title={m.is_active ? "Active" : "Inactive"}
                          aria-label={m.is_active ? "Active" : "Inactive"}
                        />
                        {canEdit && (
                        <MemberActions
                          access={canSetAccess ? { isMainAdmin: m.is_main_admin, stored: m.page_access } : undefined}
                          canManageAuth={canManageAuth}
                          isSelf={m.id === me.id}
                          roleOptions={roleOptions}
                          member={{
                            id: m.id,
                            email: m.email,
                            full_name: m.full_name,
                            phone: m.phone ?? "",
                            whatsapp: m.whatsapp ?? "",
                            nic: m.nic ?? "",
                            role_ids: roleIds,
                            is_admin: m.is_admin,
                            is_active: m.is_active,
                          }}
                        />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
