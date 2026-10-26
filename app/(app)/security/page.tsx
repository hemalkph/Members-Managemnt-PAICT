import type { Metadata } from "next";
import { ShieldAlertIcon, ShieldCheckIcon, ShieldIcon } from "lucide-react";
import BlurText from "@/components/reactbits/blur-text";
import SpotlightCard from "@/components/reactbits/spotlight-card";
import { DisableTwoStepButton, ResetTwoStepButton } from "@/components/security/two-step-actions";
import { TwoStepSetup } from "@/components/security/two-step-setup";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAuthSession, requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { createAdminClient, hasServiceRoleKey } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Two-step login" };

type TeamRow = { id: string; name: string; role: string; on: boolean; since: string | null };

/** Admins and anyone with two-step login on (main admins only, needs the service role key). */
async function getTeamTwoStep(): Promise<TeamRow[] | null> {
  if (!hasServiceRoleKey()) return null;
  const supabase = await createClient();
  const admin = createAdminClient();
  const [{ data: profiles }, { data: users, error }] = await Promise.all([
    supabase.from("profiles").select("id, full_name, email, is_admin, is_main_admin, is_active"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (error) return null;
  const factorsByUser = new Map(
    (users?.users ?? []).map((u) => [
      u.id,
      (u.factors ?? []).filter((f) => f.factor_type === "totp" && f.status === "verified"),
    ]),
  );
  return (profiles ?? [])
    .filter((p) => p.is_active && (p.is_admin || (factorsByUser.get(p.id)?.length ?? 0) > 0))
    .map((p) => {
      const factors = factorsByUser.get(p.id) ?? [];
      return {
        id: p.id,
        name: p.full_name || p.email,
        role: p.is_main_admin ? "Main admin" : p.is_admin ? "Admin" : "Member",
        on: factors.length > 0,
        since: factors[0]?.created_at ?? null,
      };
    })
    .sort((a, b) => Number(b.role === "Main admin") - Number(a.role === "Main admin") || a.name.localeCompare(b.name));
}

export default async function SecurityPage({ searchParams }: PageProps<"/security">) {
  const profile = await requireUser();
  const session = await getAuthSession();
  const { required } = await searchParams;

  const factor = (session?.user.factors ?? []).find((f) => f.factor_type === "totp" && f.status === "verified");
  const on = Boolean(factor);
  const unlockedMainAdmin = profile.is_main_admin && on && Boolean(session?.twoStepVerified);
  const team = unlockedMainAdmin ? await getTeamTwoStep() : null;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-1">
        <BlurText as="h1" text="Two-step login" className="text-2xl font-semibold tracking-tight sm:text-3xl" />
        <p className="text-muted-foreground text-sm">
          A code from your phone, as well as your password, every time you log in.
        </p>
      </div>

      {profile.is_main_admin && !on && (
        <Alert variant="warning">
          <ShieldAlertIcon />
          <AlertTitle>{required ? "Turn on two-step login to continue" : "Required for main admins"}</AlertTitle>
          <AlertDescription>
            Main admins can see full bank account numbers and record payments, so Analytics, Payments, Rates &amp;
            budget and the Activity log only open after two-step login is on.
          </AlertDescription>
        </Alert>
      )}

      <SpotlightCard className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <div
              className={
                on
                  ? "bg-success/15 text-success flex size-11 shrink-0 items-center justify-center rounded-xl"
                  : "bg-muted text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded-xl"
              }
            >
              {on ? <ShieldCheckIcon className="size-5" /> : <ShieldIcon className="size-5" />}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="font-semibold">Authenticator app</p>
                {on ? <Badge variant="success">On</Badge> : <Badge variant="outline">Off</Badge>}
              </div>
              <p className="text-muted-foreground text-sm">
                {on
                  ? `Turned on ${formatDate(factor?.created_at)}. You enter a code from the app each time you log in.`
                  : "Protects your account even if someone learns your password."}
              </p>
            </div>
          </div>
          {on && !profile.is_main_admin && <DisableTwoStepButton />}
        </div>

        {!on && (
          <div className="mt-6 border-t pt-6">
            <TwoStepSetup />
          </div>
        )}
        {on && profile.is_main_admin && (
          <p className="text-muted-foreground mt-4 border-t pt-4 text-xs">
            Main admins can&apos;t turn this off. If you lose your phone, ask the other main admin to reset it from this
            page, then set it up again.
          </p>
        )}
      </SpotlightCard>

      {unlockedMainAdmin && (
        <Card className="gap-3">
          <CardHeader>
            <CardTitle>Team two-step login</CardTitle>
            <CardDescription>Admins, plus anyone who turned it on. Reset it when someone loses their phone.</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
            {team === null ? (
              <p className="text-muted-foreground px-6 text-sm">
                Add SUPABASE_SERVICE_ROLE_KEY on the server to see and reset the team&apos;s two-step login.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Name</TableHead>
                    <TableHead className="hidden sm:table-cell">Access</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="pr-6 text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {team.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="pl-6">
                        <p className="font-medium">{m.name}</p>
                        <p className="text-muted-foreground text-xs sm:hidden">{m.role}</p>
                      </TableCell>
                      <TableCell className="text-muted-foreground hidden sm:table-cell">{m.role}</TableCell>
                      <TableCell>
                        {m.on ? (
                          <Badge variant="success">On · {formatDate(m.since)}</Badge>
                        ) : (
                          <Badge variant={m.role === "Main admin" ? "warning" : "outline"}>Off</Badge>
                        )}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        {m.on && m.id !== profile.id && <ResetTwoStepButton userId={m.id} name={m.name} />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
