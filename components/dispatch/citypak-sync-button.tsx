"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Loader2Icon, RefreshCwIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { syncCitypakBulkUploadsAction, syncCitypakOrdersAction } from "@/lib/actions/dispatch-citypak";
import { useT } from "./lang";

/** Sync now: fetches every bulk-upload page through the server (never from the browser). */
export function CitypakSyncButton({ demo, list = "bulk_uploads" }: { demo: boolean; list?: "bulk_uploads" | "orders" }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const sync = () =>
    startTransition(async () => {
      const result = await (list === "orders" ? syncCitypakOrdersAction() : syncCitypakBulkUploadsAction());
      if (!result.ok) {
        toast.error(t(result.error));
      } else {
        const r = result.data!;
        const counts = t("{new} new · {updated} updated · {unchanged} unchanged", {
          new: r.new,
          updated: r.updated,
          unchanged: r.unchanged,
        });
        if (r.outcome === "ok") toast.success(t(result.message), { description: counts });
        else
          toast.warning(t(result.message), {
            description: [
              counts,
              r.truncated ? t("Stopped at the page limit") : null,
              r.rejected > 0 ? t("{n} records couldn't be read and were skipped", { n: r.rejected }) : null,
            ]
              .filter(Boolean)
              .join(" · "),
          });
      }
      router.refresh();
    });

  return (
    <Button onClick={sync} disabled={pending}>
      {pending ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
      {demo ? t("Sync demo data") : t("Sync now")}
    </Button>
  );
}
