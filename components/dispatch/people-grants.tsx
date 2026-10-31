"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2Icon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { setDispatchGrantAction } from "@/lib/actions/dispatch";
import { CAPABILITIES } from "@/lib/dispatch/capabilities";
import type { DispatchCapability } from "@/lib/database.types";

import { useT } from "@/components/dispatch/lang";
export type DispatchPerson = {
  id: string;
  name: string;
  kind: "Main admin" | "Admin" | "Member";
  /** Tute dispatch page access for this person. */
  page: "edit" | "view" | "none";
  granted: DispatchCapability[];
};

type Pending = { person: DispatchPerson; cap: DispatchCapability; grant: boolean } | null;

/** Who can do what in Tute dispatch. Main admins (two-step done) change it. */
export function PeopleGrants({ people, canChange }: { people: DispatchPerson[]; canChange: boolean }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ask, setAsk] = useState<Pending>(null);
  const [reason, setReason] = useState("");

  const confirm = () =>
    startTransition(async () => {
      if (!ask) return;
      const result = await setDispatchGrantAction({
        user_id: ask.person.id,
        capability: ask.cap,
        grant: ask.grant,
        reason,
      });
      if (!result.ok) return void toast.error(t(result.error));
      toast.success(t(result.message));
      setAsk(null);
      router.refresh();
    });

  const has = (p: DispatchPerson, cap: DispatchCapability) => {
    if (p.kind === "Main admin") return { on: true, why: "main admin" };
    const def = p.kind === "Admin" && CAPABILITIES.find((c) => c.key === cap)?.adminDefault;
    if (def) return { on: true, why: "admin default" };
    return { on: p.granted.includes(cap), why: null };
  };

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">{t("Person")}</TableHead>
              {CAPABILITIES.map((c) => (
                <TableHead key={c.key} className="text-center" title={t(c.description)}>
                  {t(c.title)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="pl-4">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {t(p.kind)} ·{" "}
                    {p.page === "edit"
                      ? t("dispatch page: edit")
                      : p.page === "view"
                        ? t("dispatch page: view only")
                        : t("no dispatch page")}
                  </p>
                  {p.page !== "edit" && p.granted.length > 0 && (
                    <Badge variant="warning" className="mt-1">
                      {t("Permissions inactive until given dispatch edit access")}
                    </Badge>
                  )}
                </TableCell>
                {CAPABILITIES.map((c) => {
                  const state = has(p, c.key);
                  const fixed = state.why !== null;
                  return (
                    <TableCell key={c.key} className="text-center">
                      <Checkbox
                        aria-label={t("{permission} for {name}", { permission: t(c.title), name: p.name })}
                        checked={state.on}
                        disabled={!canChange || fixed || pending}
                        title={fixed ? t("Included as {why}", { why: t(state.why ?? "") }) : t(c.description)}
                        onCheckedChange={(v) => {
                          setReason("");
                          setAsk({ person: p, cap: c.key, grant: v === true });
                        }}
                      />
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={ask !== null} onOpenChange={(o) => !o && setAsk(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t(ask?.grant ? "Give the {title} permission" : "Remove the {title} permission", {
                title: t(CAPABILITIES.find((c) => c.key === ask?.cap)?.title),
              })}
            </DialogTitle>
            <DialogDescription>
              {t(
                ask?.grant
                  ? "For {name}. This is recorded in the activity log."
                  : "From {name}. This is recorded in the activity log.",
                {
                  name: ask?.person.name,
                },
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="grant-reason">{t("Reason (optional)")}</Label>
            <Input
              id="grant-reason"
              value={reason}
              maxLength={300}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("e.g. LMS admin packs parcels")}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAsk(null)} disabled={pending}>
              {t("Cancel")}
            </Button>
            <Button onClick={confirm} disabled={pending}>
              {pending && <Loader2Icon className="animate-spin" />}
              {ask?.grant ? t("Give permission") : t("Remove permission")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
