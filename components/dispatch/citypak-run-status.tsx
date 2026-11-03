import { AlertTriangleIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type { T } from "@/lib/dispatch/i18n";
import { RUN_ERROR, RUN_OUTCOME } from "@/lib/citypak/labels";
import type { LastRun } from "@/lib/citypak/runs";
import { formatDateTime } from "@/lib/format";

/**
 * A Citypak list's sync state: the last run (Complete / Incomplete / Failed) and
 * the last COMPLETE sync, plus a warning for a failed or incomplete last run.
 * `savedNote` says what an incomplete run kept (e.g. "The orders it read are saved…").
 */
export function CitypakRunStatus({
  t,
  last,
  lastComplete,
  savedNote,
}: {
  t: T;
  last: LastRun | null;
  lastComplete: string | null;
  savedNote: string;
}) {
  if (!last) return null;
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm" role="status">
        <span className="text-muted-foreground">{t("Last sync")}</span>
        <Badge variant={RUN_OUTCOME[last.outcome].variant}>{t(RUN_OUTCOME[last.outcome].label)}</Badge>
        <span className="text-muted-foreground">{formatDateTime(last.created_at)}</span>
        <span className="text-muted-foreground">
          · {lastComplete ? t("Last complete sync {when}", { when: formatDateTime(lastComplete) }) : t("No complete sync yet")}
        </span>
      </div>

      {last.outcome === "failed" && (
        <Alert variant="warning">
          <AlertTriangleIcon />
          <AlertTitle>{t("The last sync failed")}</AlertTitle>
          <AlertDescription>
            {t(RUN_ERROR[last.error_class ?? ""] ?? "Something went wrong.")} {t("Nothing was changed by it. Showing what was saved earlier.")}
          </AlertDescription>
        </Alert>
      )}

      {last.outcome === "partial" && (
        <Alert variant="warning">
          <AlertTriangleIcon />
          <AlertTitle>{t("The last sync was incomplete")}</AlertTitle>
          <AlertDescription>
            {[
              last.truncated ? t("Stopped at the page limit") : null,
              last.rejected_count > 0 ? t("{n} records couldn't be read and were skipped", { n: last.rejected_count }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
            . {t(savedNote)}
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}
